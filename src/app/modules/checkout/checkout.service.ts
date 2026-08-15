import { prismaUnscoped } from "../../lib/prisma.js";
import { getStripe } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";
import { env } from "../../config/env.js";
import type { AuthTokenPayload } from "../../utils/jwt.js";

/**
 * Creates a Stripe Checkout Session for an organization's pending subscription.
 *
 * Nothing is marked paid here. Activation happens only when Stripe calls our
 * webhook — a frontend redirect can be forged, so it is never trusted as proof
 * of payment.
 */
const createSession = async (auth: AuthTokenPayload) => {
    const subscription = await prismaUnscoped.subscription.findUnique({
        where: { organizationId: auth.organizationId },
        include: { plan: true, organization: true },
    });

    if (!subscription) {
        throw AppError.notFound("No subscription found for this organization");
    }

    if (subscription.status === "ACTIVE") {
        throw AppError.conflict("This subscription is already active");
    }

    // Subscription mode, so Stripe owns the billing cycle and emits the invoice
    // and lifecycle events the webhook handler relies on. A one-time payment
    // would never produce invoice.payment_failed or customer.subscription.deleted.
    const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: subscription.plan.stripePriceId, quantity: 1 }],
        customer_email: subscription.organization.billingEmail ?? undefined,
        // Repeated on the subscription itself: renewal invoices arrive without
        // the originating Checkout Session, so the metadata has to live on the
        // long-lived object too.
        subscription_data: {
            metadata: {
                organizationId: subscription.organizationId,
                subscriptionId: subscription.id,
                planId: subscription.planId,
            },
        },
        success_url: `${env.CLIENT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.CLIENT_URL}/checkout/cancel`,
        // Carried back to us on the webhook, so the handler knows which records
        // to update without trusting anything the browser sends.
        metadata: {
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            planId: subscription.planId,
        },
    });

    return {
        checkoutUrl: session.url,
        sessionId: session.id,
        plan: {
            name: subscription.plan.name,
            priceCents: subscription.plan.priceCents,
            billingInterval: subscription.plan.billingInterval,
        },
    };
};

/** Current payment state, so the client can decide whether to offer a retry. */
const getStatus = async (auth: AuthTokenPayload) => {
    const subscription = await prismaUnscoped.subscription.findUnique({
        where: { organizationId: auth.organizationId },
        include: {
            plan: { select: { name: true, priceCents: true } },
            organization: { select: { status: true } },
        },
    });

    if (!subscription) {
        throw AppError.notFound("No subscription found for this organization");
    }

    return {
        subscriptionStatus: subscription.status,
        organizationStatus: subscription.organization.status,
        plan: subscription.plan,
        canRetry: subscription.status !== "ACTIVE",
    };
};

export const CheckoutService = { createSession, getStatus };
