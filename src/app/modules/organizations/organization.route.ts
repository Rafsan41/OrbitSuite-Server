import { Router } from "express";
import { OrganizationController } from "./organization.controller.js";
import { validate } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { withTenantScope } from "../../middlewares/with-tenant-scope.js";
import { updateOrganizationSchema } from "./organization.validation.js";

const router = Router();

router.use(requireAuth);

// --- Tenant-facing: scoped to the caller's own organization ---------------
// withTenantScope must run before any handler that touches tenant data.
router.get("/me", withTenantScope, requireRole("ORG_ADMIN"), OrganizationController.getOwn);

router.patch(
    "/me",
    withTenantScope,
    requireRole("ORG_ADMIN"),
    validate(updateOrganizationSchema),
    OrganizationController.updateOwn,
);

// Members get a deliberately reduced view: no billing or financial detail.
router.get(
    "/me/summary",
    withTenantScope,
    requireRole("ORG_ADMIN", "ORG_MEMBER"),
    OrganizationController.getOwnPublic,
);

// --- Platform Admin: unscoped by design -----------------------------------
const adminOnly = requireRole("PLATFORM_ADMIN");

router.get("/", adminOnly, OrganizationController.listAll);
router.get("/:id", adminOnly, OrganizationController.getByIdAsAdmin);
router.patch("/:id/suspend", adminOnly, OrganizationController.setSuspended);
router.patch("/:id/reactivate", adminOnly, OrganizationController.setSuspended);

export const OrganizationRoutes = router;
