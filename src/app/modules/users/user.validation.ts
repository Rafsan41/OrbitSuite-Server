import { z } from "zod";
import { paginationSchema } from "../../utils/paginate.js";

// Members can only ever be org-level roles. PLATFORM_ADMIN is deliberately not
// accepted here, so an Org Admin cannot escalate anyone onto the platform team.
const memberRoleSchema = z.enum(["ORG_ADMIN", "ORG_MEMBER"]);

const passwordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72)
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number");

export const listMembersSchema = paginationSchema.extend({
    search: z.string().trim().optional(),
    role: memberRoleSchema.optional(),
    status: z.enum(["ACTIVE", "INVITED", "REMOVED"]).optional(),
});

export const inviteMemberSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().trim().toLowerCase().email("A valid email is required"),
    role: memberRoleSchema.default("ORG_MEMBER"),
});

export const changeRoleSchema = z.object({
    role: memberRoleSchema,
});

export const updateProfileSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
});

export const acceptInviteSchema = z.object({
    token: z.string().min(1, "Invitation token is required"),
    password: passwordSchema,
});

export type ListMembersQuery = z.infer<typeof listMembersSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
