import { Router } from "express";
import { TransactionController } from "./transaction.controller.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { withTenantScope } from "../../middlewares/with-tenant-scope.js";

const router = Router();

router.use(requireAuth);

// Platform-wide ledger. Registered before "/" so the literal path wins, and
// left unscoped because crossing tenants is the point of this view.
router.get("/all", requireRole("PLATFORM_ADMIN"), TransactionController.listAll);

// The caller's own transactions. Members are excluded: the brief gives them no
// access to transaction data.
router.get("/", withTenantScope, requireRole("ORG_ADMIN"), TransactionController.listOwn);

export const TransactionRoutes = router;
