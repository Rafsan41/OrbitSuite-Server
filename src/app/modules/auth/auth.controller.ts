import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { AppError } from "../../utils/app-error.js";
import { env } from "../../config/env.js";

const REFRESH_COOKIE = "refreshToken";

// httpOnly keeps the refresh token out of reach of JavaScript, so an XSS bug
// cannot exfiltrate a long-lived session. sameSite=strict blocks CSRF replay.
const refreshCookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/v1/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

const send = (res: Response, status: number, message: string, data: unknown = null) =>
    res.status(status).json({ success: true, message, data });

const register = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken, ...result } = await AuthService.register(req.body);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    send(res, 201, "Registration started. Complete payment to activate your organization.", result);
});

const login = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken, ...result } = await AuthService.login(req.body);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    send(res, 200, "Logged in successfully", result);
});

const refresh = asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.[REFRESH_COOKIE];

    if (!token) {
        throw AppError.unauthorized("No active session");
    }

    const { refreshToken, ...result } = await AuthService.refresh(token);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    send(res, 200, "Session refreshed", result);
});

const logout = asyncHandler(async (_req: Request, res: Response) => {
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
    send(res, 200, "Logged out successfully");
});

const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { resetToken } = await AuthService.forgotPassword(req.body);

    // TODO(P5): hand resetToken to the mailer instead of logging it.
    if (resetToken && env.NODE_ENV === "development") {
        console.log(`[dev] password reset token for ${req.body.email}: ${resetToken}`);
    }

    // Same response whether or not the account exists.
    send(res, 200, "If an account exists for that email, a reset link has been sent.");
});

const resetPassword = asyncHandler(async (req: Request, res: Response) => {
    await AuthService.resetPassword(req.body);
    send(res, 200, "Password has been reset. Please log in.");
});

const changePassword = asyncHandler(async (req: Request, res: Response) => {
    await AuthService.changePassword(req.user!, req.body);
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
    send(res, 200, "Password changed. Please log in again.");
});

const me = asyncHandler(async (req: Request, res: Response) => {
    const result = await AuthService.getCurrentUser(req.user!);
    send(res, 200, "Current user retrieved", result);
});

export const AuthController = {
    register,
    login,
    refresh,
    logout,
    forgotPassword,
    resetPassword,
    changePassword,
    me,
};
