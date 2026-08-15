import { Router } from "express";
import { StatsController } from "./stats.controller.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";

const router = Router();

// Deliberately no withTenantScope: these figures aggregate across every tenant,
// which is exactly what the role exists for.
router.get("/", requireAuth, requireRole("PLATFORM_ADMIN"), StatsController.getOverview);

export const StatsRoutes = router;
