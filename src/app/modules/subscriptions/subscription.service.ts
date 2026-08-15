import prisma, { prismaUnscoped } from "../../lib/prisma.js";
import { getStripe } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";
import type { AuthTokenPayload } from "../../utils/jwt.js";
import type { CancelSubscriptionInput, ChangePlanInput } from "./subscription.validation.js";

const getCurrent = async (auth: AuthTokenPayload) => {
    const subscription = await prisma.subscription.findUnique({
        where: { organizationId: auth.organizationId },
        include: {
            plan: true,
            organization: { select: { name: true, status: true } },
        },
    });

    if (!subscription) {
        throw AppError.notFound("No subscription found for this organization");
    }

    const now = Date.now();
    const endsAt = subscription.currentPeriodEnd?.getTime();

    return {
        ...subscription,
        // Surfaced so the client can prompt a renewal without recomputing it.
        daysUntilRenewal: endsAt ? Math.ceil((endsAt - now) / 86_400_000) : null,
        isExpired: Boolean(endsAt && endsAt < now),
    };
};

/**
 * Upgrade or downgrade.
 *
 * The change is pushed to Stripe first: Stripe owns the billing relationship,
 * and applying it locally before Stripe accepts it would leave the two out of
 * step if the API call failed. Proration is left at Stripe's default so a
 * mid-cycle upgrade is charged fairly.
 */
const changePlan = async (auth: AuthTokenPayload, payload: ChangePlanInput) => {
    const subscription = await prisma.subscription.findUnique({
        where: { organizationId: auth.organizationId },
        include: { plan: true },
    });

    if (!subscription) {
        throw AppError.notFound("No subscription found for this organization");
    }

    if (subscription.planId === payload.planId) {
        throw AppError.conflict("You are already on this plan");
    }

    if (subscription.status !== "ACTIVE") {
        throw AppError.conflict("Only an active subscription can change plan");
    }

    const nextPlan = await prismaUnscoped.plan.findFirst({
        where: { id: payload.planId, isActive: true },
    });

    if (!nextPlan) {
        throw AppError.badRequest("Selected plan is not available");
    }

    const isUpgrade = nextPlan.priceCents > subscription.plan.priceCents;

    if (subscription.stripeSubscriptionId) {
        const stripe = getStripe();
        const remote = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        const itemId = remote.items.data[0]?.id;

        if (!itemId) {
            throw AppError.badRequest("Stripe subscription has no billable item");
        }

        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            items: [{ id: itemId, price: nextPlan.stripePriceId }],
            proration_behavior: "create_prorations",
        });
    }

    // Local record and audit trail move together.
    const [updated] = await prisma.$transaction([
        prisma.subscription.update({
            where: { id: subscription.id },
            data: { planId: nextPlan.id },
        }),
        prisma.transaction.create({
            data: {
                organizationId: auth.organizationId,
                type: isUpgrade ? "SUBSCRIPTION_UPGRADE" : "SUBSCRIPTION_DOWNGRADE",
                status: "SUCCESS",
                amountCents: nextPlan.priceCents - subscription.plan.priceCents,
                metadata: {
                    fromPlan: subscription.plan.name,
                    toPlan: nextPlan.name,
                },
            },
        }),
    ]);

    return {
        subscription: updated,
        plan: nextPlan,
        direction: isUpgrade ? "upgrade" : "downgrade",
    };
};

/**
 * Cancellation is requested through Stripe wherever a Stripe subscription
 * exists, so the resulting customer.subscription.deleted webhook is what
 * actually flips our records. That keeps a single source of truth instead of
 * two code paths writing the same state.
 */
const cancel = async (auth: AuthTokenPayload, payload: CancelSubscriptionInput) => {
    const subscription = await prisma.subscription.findUnique({
        where: { organizationId: auth.organizationId },
    });

    if (!subscription) {
        throw AppError.notFound("No subscription found for this organization");
    }

    if (subscription.status === "CANCELLED") {
        throw AppError.conflict("This subscription is already cancelled");
    }

    if (subscription.stripeSubscriptionId) {
        await getStripe().subscriptions.cancel(subscription.stripeSubscriptionId);

        return {
            status: "cancellation_requested",
            message: "Cancellation submitted to Stripe; it will be confirmed by webhook.",
        };
    }

    // No Stripe subscription (seeded or manually created data) — apply directly.
    await prisma.$transaction([
        prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "CANCELLED" },
        }),
        prisma.organization.update({
            where: { id: auth.organizationId },
            data: { status: "CANCELLED" },
        }),
        prisma.transaction.create({
            data: {
                organizationId: auth.organizationId,
                type: "SUBSCRIPTION_CANCELLED",
                status: "SUCCESS",
                amountCents: 0,
                metadata: { reason: payload.reason ?? null },
            },
        }),
    ]);

    return { status: "cancelled", message: "Subscription cancelled." };
};

/**
 * Marks lapsed subscriptions EXPIRED.
 *
 * Nothing else in the system sets EXPIRED: Stripe reports failures and
 * cancellations, but a period simply running out is a local, time-based fact.
 * Runs unscoped across all tenants, so it is Platform Admin / scheduled work.
 */
const expireLapsed = async () => {
    const now = new Date();

    const lapsed = await prismaUnscoped.subscription.findMany({
        where: {
            status: "ACTIVE",
            currentPeriodEnd: { lt: now },
        },
        select: { id: true, organizationId: true },
    });

    if (lapsed.length === 0) {
        return { expired: 0 };
    }

    await prismaUnscoped.$transaction([
        prismaUnscoped.subscription.updateMany({
            where: { id: { in: lapsed.map((s) => s.id) } },
            data: { status: "EXPIRED" },
        }),
        prismaUnscoped.transaction.createMany({
            data: lapsed.map((s) => ({
                organizationId: s.organizationId,
                type: "SUBSCRIPTION_EXPIRED",
                status: "SUCCESS" as const,
                amountCents: 0,
                metadata: { expiredAt: now.toISOString() },
            })),
        }),
    ]);

    return { expired: lapsed.length };
};

/** Subscriptions lapsing soon — the data source for the reminder email in P5. */
const findExpiringSoon = async (withinDays = 7) => {
    const cutoff = new Date(Date.now() + withinDays * 86_400_000);

    return prismaUnscoped.subscription.findMany({
        where: {
            status: "ACTIVE",
            currentPeriodEnd: { gte: new Date(), lte: cutoff },
        },
        include: {
            plan: { select: { name: true } },
            organization: { select: { name: true, billingEmail: true, contactEmail: true } },
        },
    });
};

export const SubscriptionService = {
    getCurrent,
    changePlan,
    cancel,
    expireLapsed,
    findExpiringSoon,
};
