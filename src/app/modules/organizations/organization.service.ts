import prisma, { prismaUnscoped } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { toMeta, toPrismaPaging, searchFilter } from "../../utils/paginate.js";
import type { AuthTokenPayload } from "../../utils/jwt.js";
import type {
    ListOrganizationsQuery,
    UpdateOrganizationInput,
} from "./organization.validation.js";

/**
 * Platform Admin listing — intentionally unscoped, because seeing every tenant
 * is the whole purpose of the role. Every other function here goes through the
 * tenant-scoped client.
 */
const listAll = async (query: ListOrganizationsQuery) => {
    const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.planId ? { subscription: { planId: query.planId } } : {}),
        ...(searchFilter(query.search, ["name", "contactEmail", "billingEmail"]) ?? {}),
    };

    const [rows, total] = await Promise.all([
        prismaUnscoped.organization.findMany({
            where,
            ...toPrismaPaging(query),
            include: {
                subscription: { include: { plan: { select: { name: true, priceCents: true } } } },
                // Member count without loading every user row.
                _count: { select: { users: true } },
            },
        }),
        prismaUnscoped.organization.count({ where }),
    ]);

    const data = rows.map((org) => ({
        id: org.id,
        name: org.name,
        contactEmail: org.contactEmail,
        status: org.status,
        createdAt: org.createdAt,
        memberCount: org._count.users,
        plan: org.subscription?.plan?.name ?? null,
        subscriptionStatus: org.subscription?.status ?? null,
    }));

    return { data, meta: toMeta(query, total) };
};

/** Platform Admin detail view: profile, members and full financial history. */
const getByIdAsAdmin = async (id: string) => {
    const organization = await prismaUnscoped.organization.findUnique({
        where: { id },
        include: {
            users: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    status: true,
                    createdAt: true,
                },
                orderBy: { createdAt: "asc" },
            },
            subscription: { include: { plan: true } },
            payments: {
                orderBy: { createdAt: "desc" },
                include: { subscription: { select: { id: true, status: true } } },
            },
            transactions: { orderBy: { createdAt: "desc" }, take: 50 },
        },
    });

    if (!organization) {
        throw AppError.notFound("Organization not found");
    }

    return organization;
};

/**
 * The caller's own organization. The tenant extension constrains this by id, so
 * passing another organization's id simply yields nothing.
 */
const getOwn = async (auth: AuthTokenPayload) => {
    const organization = await prisma.organization.findUnique({
        where: { id: auth.organizationId },
        include: {
            subscription: {
                include: {
                    plan: {
                        select: {
                            id: true,
                            name: true,
                            priceCents: true,
                            billingInterval: true,
                            features: true,
                        },
                    },
                },
            },
            _count: { select: { users: true } },
        },
    });

    if (!organization) {
        throw AppError.notFound("Organization not found");
    }

    return organization;
};

/**
 * Read-only view for ORG_MEMBER. Financial detail is stripped rather than
 * hidden in the UI, so the data never leaves the server in the first place.
 */
const getOwnPublic = async (auth: AuthTokenPayload) => {
    const organization = await getOwn(auth);

    return {
        id: organization.id,
        name: organization.name,
        status: organization.status,
        memberCount: organization._count.users,
        plan: organization.subscription?.plan?.name ?? null,
    };
};

const updateOwn = async (auth: AuthTokenPayload, payload: UpdateOrganizationInput) =>
    prisma.organization.update({
        where: { id: auth.organizationId },
        data: payload,
    });

/**
 * Suspension is a Platform Admin action. Suspended organizations are refused at
 * login and on refresh, so an existing session cannot outlive the suspension by
 * more than the access token's lifetime.
 */
const setSuspended = async (id: string, suspended: boolean) => {
    const organization = await prismaUnscoped.organization.findUnique({ where: { id } });

    if (!organization) {
        throw AppError.notFound("Organization not found");
    }

    if (suspended && organization.status === "SUSPENDED") {
        throw AppError.conflict("Organization is already suspended");
    }

    // Reactivation restores ACTIVE only when the subscription can support it;
    // an unpaid organization returns to PENDING rather than silently going live.
    let nextStatus: "SUSPENDED" | "ACTIVE" | "PENDING" = "SUSPENDED";

    if (!suspended) {
        const subscription = await prismaUnscoped.subscription.findUnique({
            where: { organizationId: id },
            select: { status: true },
        });
        nextStatus = subscription?.status === "ACTIVE" ? "ACTIVE" : "PENDING";
    }

    return prismaUnscoped.organization.update({
        where: { id },
        data: { status: nextStatus },
    });
};

export const OrganizationService = {
    listAll,
    getByIdAsAdmin,
    getOwn,
    getOwnPublic,
    updateOwn,
    setSuspended,
};
