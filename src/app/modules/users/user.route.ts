import { Router } from "express";
import { UserController } from "./user.controller.js";
import { validate } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { withTenantScope } from "../../middlewares/with-tenant-scope.js";
import { passwordResetLimiter } from "../../middlewares/rate-limit.js";
import {
    acceptInviteSchema,
    changeRoleSchema,
    inviteMemberSchema,
    updateProfileSchema,
} from "./user.validation.js";

const router = Router();

// Public and deliberately above requireAuth: the invitee has no session yet and
// is authorised purely by the token they were emailed.
router.post(
    "/accept-invite",
    passwordResetLimiter,
    validate(acceptInviteSchema),
    UserController.acceptInvite,
);

router.use(requireAuth, withTenantScope);

// --- Own profile: available to every authenticated role -------------------
router.get("/me", UserController.getOwnProfile);
router.patch("/me", validate(updateProfileSchema), UserController.updateOwnProfile);

// --- Member management: Org Admin only ------------------------------------
const orgAdminOnly = requireRole("ORG_ADMIN");

router.get("/", orgAdminOnly, UserController.listMembers);
router.post("/invite", orgAdminOnly, validate(inviteMemberSchema), UserController.inviteMember);
router.get("/:id", orgAdminOnly, UserController.getMember);
router.patch("/:id/role", orgAdminOnly, validate(changeRoleSchema), UserController.changeRole);
router.delete("/:id", orgAdminOnly, UserController.removeMember);

export const UserRoutes = router;
