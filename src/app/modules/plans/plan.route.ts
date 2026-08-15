import { Router } from "express";
import { PlanController } from "./plan.controller.js";
import { validate } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { createPlanSchema, updatePlanSchema } from "./plan.validation.js";

const router = Router();

// Public: the signup page has to show plans before an account exists. Only
// active plans are returned unless a platform admin asks for all of them.
router.get("/", PlanController.list);
router.get("/:id", PlanController.getById);

// Platform Admin only — the catalogue is global, so no tenant scope applies.
const adminOnly = [requireAuth, requireRole("PLATFORM_ADMIN")];

router.post("/", ...adminOnly, validate(createPlanSchema), PlanController.create);
router.patch("/:id", ...adminOnly, validate(updatePlanSchema), PlanController.update);
router.patch("/:id/disable", ...adminOnly, PlanController.setActive);
router.patch("/:id/enable", ...adminOnly, PlanController.setActive);

export const PlanRoutes = router;
