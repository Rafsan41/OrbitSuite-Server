import { z } from "zod";
import { paginationSchema } from "../../utils/paginate.js";

// Shared by the tenant and platform-wide listings. organizationId is accepted
// but only honoured on the platform route; the tenant extension overrides it
// everywhere else, so it cannot be used to reach another tenant.
export const listTransactionsSchema = paginationSchema.extend({
    status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED", "ROLLED_BACK"]).optional(),
    type: z.string().trim().optional(),
    organizationId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;
