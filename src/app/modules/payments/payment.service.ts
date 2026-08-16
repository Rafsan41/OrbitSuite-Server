import prisma from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { toMeta, toPrismaPaging, type PaginationQuery } from "../../utils/paginate.js";

type ListPaymentsQuery = PaginationQuery & {
    status?: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
};

/**
 * Stable, human-readable reference derived from the id rather than a separate
 * sequence, so it needs no extra state to stay unique. Defined once and used by
 * both the list and the detail view — two copies of this formula would drift,
 * and the number ends up printed on a PDF a customer keeps.
 */
const invoiceNumberFor = (id: string, createdAt: Date) =>
    `INV-${createdAt.getFullYear()}-${id.slice(0, 8).toUpperCase()}`;

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

    return {
        // Surfaced on the list too, so the billing table can show the reference
        // and name the downloaded file without a second request.
        data: data.map((payment) => ({
            ...payment,
            invoiceNumber: invoiceNumberFor(payment.id, payment.createdAt),
        })),
        meta: toMeta(query, total),
    };
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
        invoiceNumber: invoiceNumberFor(payment.id, payment.createdAt),
    };
};

export const PaymentService = { listOwn, getOwnById };
