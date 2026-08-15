import { Router } from "express";
import { SubscriptionController } from "./subscription.controller.js";
import { validate } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { withTenantScope } from "../../middlewares/with-tenant-scope.js";
import { cancelSubscriptionSchema, changePlanSchema } from "./subscription.validation.js";

const router = Router();

router.use(requireAuth);

// --- Platform Admin: cross-tenant maintenance -----------------------------
// Must never run inside a tenant scope, so these are registered without
// withTenantScope and read through the unscoped client.
const adminOnly = requireRole("PLATFORM_ADMIN");

router.post("/expire", adminOnly, SubscriptionController.expireLapsed);
router.get("/expiring-soon", adminOnly, SubscriptionController.expiringSoon);
router.post("/notify-expiring", adminOnly, SubscriptionController.notifyExpiringSoon);

// --- Org Admin: their own subscription ------------------------------------
const orgAdmin = [withTenantScope, requireRole("ORG_ADMIN")];

router.get(
    "/me",
    withTenantScope,
    requireRole("ORG_ADMIN", "ORG_MEMBER"),
    SubscriptionController.getCurrent,
);
router.post(
    "/change-plan",
    ...orgAdmin,
    validate(changePlanSchema),
    SubscriptionController.changePlan,
);
router.post("/cancel", ...orgAdmin, validate(cancelSubscriptionSchema), SubscriptionController.cancel);

export const SubscriptionRoutes = router;
