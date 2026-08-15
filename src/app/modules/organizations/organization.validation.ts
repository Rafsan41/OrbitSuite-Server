import { z } from "zod";
import { paginationSchema } from "../../utils/paginate.js";

export const listOrganizationsSchema = paginationSchema.extend({
    search: z.string().trim().optional(),
    status: z.enum(["PENDING", "TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
    planId: z.string().uuid().optional(),
});

// Org Admins may edit their own profile. Status is deliberately absent — only a
// Platform Admin can suspend or reactivate, via dedicated endpoints.
export const updateOrganizationSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Organization name must be at least 2 characters")
        .max(100)
        .optional(),
    contactEmail: z.string().trim().toLowerCase().email().optional(),
    billingEmail: z.string().trim().toLowerCase().email().optional(),
});

export type ListOrganizationsQuery = z.infer<typeof listOrganizationsSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
