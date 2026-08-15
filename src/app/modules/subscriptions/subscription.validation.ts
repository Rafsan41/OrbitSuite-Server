import { z } from "zod";

export const changePlanSchema = z.object({
    planId: z.string().uuid("A valid plan must be selected"),
});

export const cancelSubscriptionSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});

export type ChangePlanInput = z.infer<typeof changePlanSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
