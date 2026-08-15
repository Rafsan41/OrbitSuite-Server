import type Stripe from "stripe";
import { prismaUnscoped } from "../../lib/prisma.js";
import { NotificationService } from "../notifications/notification.service.js";

// Prisma's transactional client. Every write below goes through it so the whole
// event is applied as one unit.
type Tx = Parameters<Parameters<typeof prismaUnscoped.$transaction>[0]>[0];

export type WebhookOutcome =
    | { status: "processed"; event: string }
    | { status: "duplicate"; event: string }
    | { status: "ignored"; event: string };

// Notification payloads the handlers return for dispatch after commit.
type PendingNotification =
    | {
          kind: "payment_succeeded";
          to: string | null;
          organizationName: string;
          planName: string;
          amountCents: number;
          currency: string;
          periodEnd: Date;
      }
    | {
          kind: "payment_failed";
          organizationId: string;
          amountCents: number;
          currency: string;
      }
    | { kind: "subscription_cancelled"; to: string | null; organizationName: string }
    | null;

const dispatchNotification = async (notify: PendingNotification) => {
    if (!notify) return;

    switch (notify.kind) {
        case "payment_succeeded":
            if (!notify.to) return;
            return NotificationService.paymentSucceeded({
                to: notify.to,
                organizationName: notify.organizationName,
                planName: notify.planName,
                amountCents: notify.amountCents,
                currency: notify.currency,
                periodEnd: notify.periodEnd,
            });

        case "payment_failed": {
            // Resolved outside the transaction, so the lookup costs nothing
            // while a lock is held.
            const organization = await prismaUnscoped.organization.findUnique({
                where: { id: notify.organizationId },
                select: { name: true, billingEmail: true, contactEmail: true },
            });
            const to = organization?.billingEmail ?? organization?.contactEmail;
            if (!to) return;

            return NotificationService.paymentFailed({
                to,
                organizationName: organization?.name ?? "your organization",
                amountCents: notify.amountCents,
                currency: notify.currency,
            });
        }

        case "subscription_cancelled":
            if (!notify.to) return;
            return NotificationService.subscriptionChanged({
                to: notify.to,
                organizationName: notify.organizationName,
                change: "cancelled",
            });
    }
};

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
        select: { billingInterval: true, name: true },
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

    const organization = await tx.organization.update({
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

    // Returned rather than sent here: the transaction has not committed yet, and
    // a rollback must not leave a customer holding a receipt for a payment we
    // did not record.
    return {
        kind: "payment_succeeded" as const,
        to: organization.billingEmail ?? organization.contactEmail,
        organizationName: organization.name,
        planName: plan?.name ?? "your plan",
        amountCents,
        currency: session.currency ?? "usd",
        periodEnd,
    };
};

/** Payment failed: the organization stays unusable and the failure is recorded. */
const applyPaymentFailed = async (tx: Tx, invoice: Stripe.Invoice) => {
    const subscription = await tx.subscription.findFirst({
        where: { stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : "" },
    });

    if (!subscription) return null;

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

    // Organization details are looked up after commit rather than here: they are
    // only needed for the email, and every extra query inside the transaction
    // holds a database lock open for another network round trip.
    return {
        kind: "payment_failed" as const,
        organizationId: subscription.organizationId,
        amountCents,
        currency: invoice.currency ?? "usd",
    };
};

const applySubscriptionDeleted = async (tx: Tx, stripeSub: Stripe.Subscription) => {
    const subscription = await tx.subscription.findFirst({
        where: { stripeSubscriptionId: stripeSub.id },
    });

    if (!subscription) return null;

    await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELLED" },
    });

    const organization = await tx.organization.update({
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

    return {
        kind: "subscription_cancelled" as const,
        to: organization.billingEmail ?? organization.contactEmail,
        organizationName: organization.name,
    };
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
        const { outcome, notify } = await prismaUnscoped.$transaction(async (tx) => {
            await tx.processedWebhookEvent.create({ data: { stripeEventId: event.id } });

            switch (event.type) {
                case "checkout.session.completed":
                    return {
                        outcome: { status: "processed", event: event.type } as const,
                        notify: await applyCheckoutCompleted(
                            tx,
                            event.data.object as Stripe.Checkout.Session,
                        ),
                    };

                case "invoice.payment_failed":
                    return {
                        outcome: { status: "processed", event: event.type } as const,
                        notify: await applyPaymentFailed(tx, event.data.object as Stripe.Invoice),
                    };

                case "customer.subscription.deleted":
                    return {
                        outcome: { status: "processed", event: event.type } as const,
                        notify: await applySubscriptionDeleted(
                            tx,
                            event.data.object as Stripe.Subscription,
                        ),
                    };

                default:
                    // Recorded as seen so Stripe stops resending it.
                    return {
                        outcome: { status: "ignored", event: event.type } as const,
                        notify: null,
                    };
            }
        },
        {
            // Prisma's 5s default is tight against a pooled remote Postgres,
            // where each statement in the transaction is a network round trip.
            // Exceeding it would abort a payment we have already been paid for.
            timeout: 20_000,
            maxWait: 10_000,
        },
    );

        // Only now that the transaction has committed, and deliberately not
        // awaited: a slow mail server must not delay our 200 back to Stripe,
        // which retries anything it does not see acknowledged quickly.
        void dispatchNotification(notify);

        return outcome;
    } catch (error) {
        if (isUniqueViolation(error)) {
            return { status: "duplicate", event: event.type };
        }
        throw error;
    }
};
