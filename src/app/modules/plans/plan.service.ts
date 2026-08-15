import { prismaUnscoped } from "../../lib/prisma.js";
import { upsertPlanPrice } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";
import { toMeta, toPrismaPaging } from "../../utils/paginate.js";
import type { CreatePlanInput, ListPlansQuery, UpdatePlanInput } from "./plan.validation.js";

// Plans are a platform-wide catalogue shared by every tenant, so they are never
// filtered by organization.

const slugify = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

const list = async (query: ListPlansQuery) => {
    // The signup page must only ever offer plans that can actually be bought.
    const where = query.includeInactive ? {} : { isActive: true };

    const [data, total] = await Promise.all([
        prismaUnscoped.plan.findMany({ where, ...toPrismaPaging(query, "priceCents") }),
        prismaUnscoped.plan.count({ where }),
    ]);

    return { data, meta: toMeta(query, total) };
};

const getById = async (id: string) => {
    const plan = await prismaUnscoped.plan.findUnique({ where: { id } });

    if (!plan) {
        throw AppError.notFound("Plan not found");
    }

    return plan;
};

/**
 * Creating a plan also creates its Stripe Price, because a plan without one
 * cannot be checked out against. Stripe is called before the row is written so
 * a Stripe failure leaves no unusable plan behind.
 */
const create = async (payload: CreatePlanInput) => {
    const lookupKey = `orbitsuite_${slugify(payload.name)}_${payload.billingInterval.toLowerCase()}`;

    const stripePriceId = await upsertPlanPrice({
        lookupKey,
        name: `OrbitSuite ${payload.name}`,
        priceCents: payload.priceCents,
        billingInterval: payload.billingInterval,
    });

    return prismaUnscoped.plan.create({
        data: {
            name: payload.name,
            priceCents: payload.priceCents,
            billingInterval: payload.billingInterval,
            features: payload.features,
            stripePriceId,
        },
    });
};

/**
 * Only presentation fields and the active flag are editable. Stripe prices are
 * immutable, so a price change means a new plan — existing subscribers keep
 * billing at the price they signed up on.
 */
const update = async (id: string, payload: UpdatePlanInput) => {
    await getById(id);

    return prismaUnscoped.plan.update({
        where: { id },
        data: {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.features !== undefined ? { features: payload.features } : {}),
            ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        },
    });
};

/**
 * Disabling hides a plan from new signups. It is never deleted, because
 * subscriptions reference it and their history must stay readable.
 */
const setActive = async (id: string, isActive: boolean) => {
    await getById(id);

    if (!isActive) {
        const activeSubscribers = await prismaUnscoped.subscription.count({
            where: { planId: id, status: "ACTIVE" },
        });

        if (activeSubscribers > 0) {
            // Not an error: they keep their plan, it simply stops being offered.
            console.warn(`Plan ${id} disabled with ${activeSubscribers} active subscriber(s).`);
        }
    }

    return prismaUnscoped.plan.update({ where: { id }, data: { isActive } });
};

export const PlanService = { list, getById, create, update, setActive };
