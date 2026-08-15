import prisma from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { toMeta, toPrismaPaging, type PaginationQuery } from "../../utils/paginate.js";

type ListPaymentsQuery = PaginationQuery & {
    status?: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
};

/**
 * Billing history for the caller's organization. No organizationId filter is
 * written here — the tenant extension supplies it.
 */
const listOwn = async (query: ListPaymentsQuery) => {
    const where = query.status ? { status: query.status } : {};

    const [data, total] = await Promise.all([
        prisma.payment.findMany({
            where,
            ...toPrismaPaging(query),
            include: {
                subscription: {
                    select: {
                        id: true,
                        status: true,
                        plan: { select: { name: true, billingInterval: true } },
                    },
                },
                transactions: { select: { id: true, type: true, status: true } },
            },
        }),
        prisma.payment.count({ where }),
    ]);

    return { data, meta: toMeta(query, total) };
};

/**
 * A single payment, shaped as the data an invoice would be rendered from.
 * The PDF itself is a listed bonus and is deliberately not implemented.
 */
const getOwnById = async (id: string) => {
    const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
            organization: { select: { name: true, billingEmail: true, contactEmail: true } },
            subscription: {
                select: {
                    currentPeriodEnd: true,
                    plan: { select: { name: true, priceCents: true, billingInterval: true } },
                },
            },
            transactions: true,
        },
    });

    if (!payment) {
        throw AppError.notFound("Payment not found");
    }

    return {
        ...payment,
        // Stable, human-readable reference derived from the id rather than a
        // separate sequence, so it needs no extra state to stay unique.
        invoiceNumber: `INV-${payment.createdAt.getFullYear()}-${payment.id.slice(0, 8).toUpperCase()}`,
    };
};

export const PaymentService = { listOwn, getOwnById };
