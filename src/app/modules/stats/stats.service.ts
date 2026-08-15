import { prismaUnscoped } from "../../lib/prisma.js";

/**
 * Platform-wide overview. Every figure here spans tenants by design, so this is
 * the unscoped client behind a PLATFORM_ADMIN gate.
 *
 * The counts run as one Promise.all rather than sequentially — they are
 * independent, and the dashboard should not pay for six round trips in series.
 */
const getOverview = async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [
        totalOrganizations,
        organizationsByStatus,
        totalUsers,
        activeSubscriptions,
        revenue,
        failedPayments,
        recentSignups,
        subscriptionsByPlan,
    ] = await Promise.all([
        prismaUnscoped.organization.count(),
        prismaUnscoped.organization.groupBy({ by: ["status"], _count: { _all: true } }),
        prismaUnscoped.user.count({ where: { status: { not: "REMOVED" } } }),
        prismaUnscoped.subscription.count({ where: { status: "ACTIVE" } }),
        // Only settled money counts toward revenue.
        prismaUnscoped.payment.aggregate({
            where: { status: "SUCCESS" },
            _sum: { amountCents: true },
            _count: { _all: true },
        }),
        prismaUnscoped.payment.count({ where: { status: "FAILED" } }),
        prismaUnscoped.organization.findMany({
            where: { createdAt: { gte: thirtyDaysAgo } },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, name: true, status: true, createdAt: true },
        }),
        prismaUnscoped.subscription.groupBy({
            by: ["planId"],
            where: { status: "ACTIVE" },
            _count: { _all: true },
        }),
    ]);

    // Resolve plan names for the per-plan breakdown in one extra query.
    const plans = await prismaUnscoped.plan.findMany({
        where: { id: { in: subscriptionsByPlan.map((row) => row.planId) } },
        select: { id: true, name: true, priceCents: true },
    });

    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    return {
        organizations: {
            total: totalOrganizations,
            byStatus: Object.fromEntries(
                organizationsByStatus.map((row) => [row.status, row._count._all]),
            ),
            recentSignups,
        },
        users: { total: totalUsers },
        subscriptions: {
            active: activeSubscriptions,
            byPlan: subscriptionsByPlan.map((row) => ({
                planId: row.planId,
                planName: planById.get(row.planId)?.name ?? "Unknown",
                subscribers: row._count._all,
                monthlyRecurringCents:
                    (planById.get(row.planId)?.priceCents ?? 0) * row._count._all,
            })),
        },
        revenue: {
            totalCents: revenue._sum.amountCents ?? 0,
            successfulPayments: revenue._count._all,
            failedPayments,
        },
    };
};

export const StatsService = { getOverview };
