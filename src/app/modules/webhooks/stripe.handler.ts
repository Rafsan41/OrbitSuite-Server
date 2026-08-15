import type Stripe from "stripe";
import { prismaUnscoped } from "../../lib/prisma.js";

// Prisma's transactional client. Every write below goes through it so the whole
// event is applied as one unit.
type Tx = Parameters<Parameters<typeof prismaUnscoped.$transaction>[0]>[0];

export type WebhookOutcome =
    | { status: "processed"; event: string }
    | { status: "duplicate"; event: string }
    | { status: "ignored"; event: string };

const isUniqueViolation = (error: unknown): boolean =>
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

const metadataOf = (session: Stripe.Checkout.Session) => {
    const { organizationId, subscriptionId, planId } = session.metadata ?? {};

    if (!organizationId || !subscriptionId || !planId) {
        throw new Error(`Checkout session ${session.id} is missing required metadata`);
    }

    return { organizationId, subscriptionId, planId };
};

/**
 * Payment succeeded: record the payment, activate the subscription, activate the
 * organization, and log the transaction. These four writes must all land or none
 * of them — a paid customer with an inactive organization, or an active
 * organization with no payment record, are both corrupt states.
 */
const applyCheckoutCompleted = async (tx: Tx, session: Stripe.Checkout.Session) => {
    const { organizationId, subscriptionId, planId } = metadataOf(session);
    const amountCents = session.amount_total ?? 0;

    // Renewal date follows the plan's own interval rather than assuming monthly,
    // otherwise an annual plan would appear to lapse after one month.
    const plan = await tx.plan.findUnique({
        where: { id: planId },
        select: { billingInterval: true },
    });

    const periodEnd = new Date();
    if (plan?.billingInterval === "YEAR") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const payment = await tx.payment.create({
        data: {
            organizationId,
            subscriptionId,
            amountCents,
            currency: session.currency ?? "usd",
            status: "SUCCESS",
            stripePaymentIntentId:
                typeof session.payment_intent === "string" ? session.payment_intent : null,
        },
    });

    await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
            status: "ACTIVE",
            currentPeriodEnd: periodEnd,
            stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
            // Without this, customer.subscription.deleted can never be matched
            // back to a row and cancellations would be silently dropped.
            stripeSubscriptionId:
                typeof session.subscription === "string" ? session.subscription : undefined,
        },
    });

    await tx.organization.update({
        where: { id: organizationId },
        data: { status: "ACTIVE" },
    });

    await tx.transaction.create({
        data: {
            organizationId,
            paymentId: payment.id,
            type: "SUBSCRIPTION_PAYMENT",
            status: "SUCCESS",
            amountCents,
            metadata: { stripeSessionId: session.id },
        },
    });
};

/** Payment failed: the organization stays unusable and the failure is recorded. */
const applyPaymentFailed = async (tx: Tx, invoice: Stripe.Invoice) => {
    const subscription = await tx.subscription.findFirst({
        where: { stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : "" },
    });

    if (!subscription) return;

    const amountCents = invoice.amount_due ?? 0;

    const payment = await tx.payment.create({
        data: {
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            amountCents,
            currency: invoice.currency ?? "usd",
            status: "FAILED",
        },
    });

    await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "FAILED" },
    });

    await tx.transaction.create({
        data: {
            organizationId: subscription.organizationId,
            paymentId: payment.id,
            type: "SUBSCRIPTION_PAYMENT",
            status: "FAILED",
            amountCents,
            metadata: { stripeInvoiceId: invoice.id },
        },
    });
};

const applySubscriptionDeleted = async (tx: Tx, stripeSub: Stripe.Subscription) => {
    const subscription = await tx.subscription.findFirst({
        where: { stripeSubscriptionId: stripeSub.id },
    });

    if (!subscription) return;

    await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELLED" },
    });

    await tx.organization.update({
        where: { id: subscription.organizationId },
        data: { status: "CANCELLED" },
    });

    await tx.transaction.create({
        data: {
            organizationId: subscription.organizationId,
            type: "SUBSCRIPTION_CANCELLED",
            status: "SUCCESS",
            amountCents: 0,
            metadata: { stripeSubscriptionId: stripeSub.id },
        },
    });
};

/**
 * Applies a Stripe event exactly once.
 *
 * The event id is inserted into processed_webhook_events as the FIRST statement
 * of the transaction. Its primary key makes a replay collide immediately, so a
 * duplicate does no work at all rather than being detected halfway through.
 * Because the marker is written inside the same transaction, a later failure
 * rolls it back too — leaving the event genuinely unprocessed so Stripe's retry
 * can succeed, rather than marked done after a partial write.
 */
export const handleStripeEvent = async (event: Stripe.Event): Promise<WebhookOutcome> => {
    try {
        return await prismaUnscoped.$transaction(async (tx) => {
            await tx.processedWebhookEvent.create({ data: { stripeEventId: event.id } });

            switch (event.type) {
                case "checkout.session.completed":
                    await applyCheckoutCompleted(tx, event.data.object as Stripe.Checkout.Session);
                    return { status: "processed", event: event.type } as const;

                case "invoice.payment_failed":
                    await applyPaymentFailed(tx, event.data.object as Stripe.Invoice);
                    return { status: "processed", event: event.type } as const;

                case "customer.subscription.deleted":
                    await applySubscriptionDeleted(tx, event.data.object as Stripe.Subscription);
                    return { status: "processed", event: event.type } as const;

                default:
                    // Recorded as seen so Stripe stops resending it.
                    return { status: "ignored", event: event.type } as const;
            }
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            return { status: "duplicate", event: event.type };
        }
        throw error;
    }
};
