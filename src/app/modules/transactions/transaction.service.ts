import prisma, { prismaUnscoped } from "../../lib/prisma.js";
import { toMeta, toPrismaPaging } from "../../utils/paginate.js";
import type { ListTransactionsQuery } from "./transaction.validation.js";

/** Filters shared by both listings, minus anything tenant-specific. */
const buildWhere = (query: ListTransactionsQuery, includeOrgFilter: boolean) => ({
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(includeOrgFilter && query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.from || query.to
        ? {
              createdAt: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
              },
          }
        : {}),
});

/**
 * The caller's own transactions. organizationId from the query string is
 * ignored here — the tenant extension pins the filter, so supplying another
 * organization's id simply returns nothing.
 */
const listOwn = async (query: ListTransactionsQuery) => {
    const where = buildWhere(query, false);

    const [data, total] = await Promise.all([
        prisma.transaction.findMany({
            where,
            ...toPrismaPaging(query),
            include: {
                payment: { select: { id: true, status: true, currency: true } },
            },
        }),
        prisma.transaction.count({ where }),
    ]);

    return { data, meta: toMeta(query, total) };
};

/** Platform-wide view: every tenant, filterable by organization. */
const listAll = async (query: ListTransactionsQuery) => {
    const where = buildWhere(query, true);

    const [data, total] = await Promise.all([
        prismaUnscoped.transaction.findMany({
            where,
            ...toPrismaPaging(query),
            include: {
                organization: { select: { id: true, name: true } },
                payment: { select: { id: true, status: true, currency: true } },
            },
        }),
        prismaUnscoped.transaction.count({ where }),
    ]);

    return { data, meta: toMeta(query, total) };
};

export const TransactionService = { listOwn, listAll };
