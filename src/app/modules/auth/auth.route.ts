import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { validate } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { authLimiter, passwordResetLimiter } from "../../middlewares/rate-limit.js";
import {
    changePasswordSchema,
    forgotPasswordSchema,
    loginSchema,
    registerSchema,
    resetPasswordSchema,
} from "./auth.validation.js";

const router = Router();

// Public — rate limited, since these are the credential-guessing surface.
router.post("/register", authLimiter, validate(registerSchema), AuthController.register);
router.post("/login", authLimiter, validate(loginSchema), AuthController.login);
router.post("/refresh", AuthController.refresh);
router.post("/logout", AuthController.logout);

router.post(
    "/forgot-password",
    passwordResetLimiter,
    validate(forgotPasswordSchema),
    AuthController.forgotPassword,
);
router.post(
    "/reset-password",
    passwordResetLimiter,
    validate(resetPasswordSchema),
    AuthController.resetPassword,
);

// Authenticated — any role.
router.get("/me", requireAuth, AuthController.me);
router.post(
    "/change-password",
    requireAuth,
    validate(changePasswordSchema),
    AuthController.changePassword,
);

export const AuthRoutes = router;
