import { z } from "zod";

// Shared by every list endpoint so paging, sorting and the response envelope
// stay identical across panels.
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export type PaginationMeta = {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
};

/** Translates page/limit into Prisma's skip/take plus an orderBy clause. */
export const toPrismaPaging = (query: PaginationQuery, defaultSortBy = "createdAt") => ({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    orderBy: { [query.sortBy ?? defaultSortBy]: query.sortOrder },
});

export const toMeta = (query: PaginationQuery, total: number): PaginationMeta => ({
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
});

/**
 * Builds a case-insensitive OR filter across the given fields.
 * Returns undefined for an empty term so it can be spread into a where clause
 * without introducing an always-true condition.
 */
export const searchFilter = (term: string | undefined, fields: string[]) => {
    const trimmed = term?.trim();
    if (!trimmed) return undefined;

    return {
        OR: fields.map((field) => ({
            [field]: { contains: trimmed, mode: "insensitive" as const },
        })),
    };
};
