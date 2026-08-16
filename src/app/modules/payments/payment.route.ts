import { Router } from "express";
import { PaymentController } from "./payment.controller.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { withTenantScope } from "../../middlewares/with-tenant-scope.js";

const router = Router();

// Billing is Org Admin territory throughout — the brief gives members no
// access to payment data at all.
router.use(requireAuth, withTenantScope, requireRole("ORG_ADMIN"));

router.get("/", PaymentController.listOwn);
// Registered before "/:id" would be ambiguous — Express matches in order, and
// this is the more specific path.
router.get("/:id/invoice", PaymentController.downloadInvoice);
router.get("/:id", PaymentController.getOwnById);

export const PaymentRoutes = router;
