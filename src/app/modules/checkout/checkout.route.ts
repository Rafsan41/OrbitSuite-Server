import { Router } from "express";
import { CheckoutController } from "./checkout.controller.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";

const router = Router();

// Only the organization admin who owns the billing relationship may start or
// retry a checkout. Members must never reach payment endpoints.
router.use(requireAuth, requireRole("ORG_ADMIN"));

// Doubles as the retry path for an abandoned or failed payment: it recreates a
// session for whatever subscription is still pending.
router.post("/session", CheckoutController.createSession);
router.get("/status", CheckoutController.getStatus);

export const CheckoutRoutes = router;
