import { z } from "zod";
import { paginationSchema } from "../../utils/paginate.js";

export const createPlanSchema = z.object({
    name: z.string().trim().min(2, "Plan name must be at least 2 characters").max(60),
    priceCents: z.coerce.number().int().min(0, "Price cannot be negative"),
    billingInterval: z.enum(["MONTH", "YEAR"]),
    features: z.array(z.string().trim().min(1)).default([]),
});

// Price and interval are omitted deliberately: Stripe prices are immutable, so
// changing an amount means issuing a new plan rather than editing this one.
export const updatePlanSchema = z.object({
    name: z.string().trim().min(2).max(60).optional(),
    features: z.array(z.string().trim().min(1)).optional(),
    isActive: z.boolean().optional(),
});

export const listPlansSchema = paginationSchema.extend({
    includeInactive: z
        .union([z.boolean(), z.string()])
        .transform((v) => v === true || v === "true")
        .default(false),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ListPlansQuery = z.infer<typeof listPlansSchema>;
