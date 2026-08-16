import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { AppError } from "../../utils/app-error.js";
import { env } from "../../config/env.js";

const REFRESH_COOKIE = "refreshToken";

const isProduction = env.NODE_ENV === "production";

/**
 * httpOnly keeps the refresh token out of reach of JavaScript, so an XSS bug
 * cannot exfiltrate a long-lived session.
 *
 * sameSite has to differ by environment. Locally the client and API are both on
 * localhost — the same site, ports being irrelevant to that definition — so
 * `strict` costs nothing. Deployed, they sit on separate hosts, and because
 * `vercel.app` is on the Public Suffix List each subdomain is a *different*
 * site. A `strict` cookie is never sent cross-site, so the browser would hold a
 * refresh token it never once attached: every refresh would 401 and users would
 * be signed out on each page reload.
 *
 * `none` is safe here because it is not what defends this API. Every
 * authenticated route reads a Bearer token from the Authorization header, which
 * a cross-site form or image cannot set — so CSRF cannot drive an authenticated
 * action regardless of cookie policy. The one cookie-authenticated endpoint is
 * /auth/refresh, and forcing a victim's browser to refresh achieves nothing: the
 * attacker cannot read the response, because CORS is locked to CLIENT_URL.
 */
const refreshCookieOptions = {
    httpOnly: true,
    // `none` is only legal on a secure cookie, so these two move together.
    secure: isProduction,
    sameSite: isProduction ? ("none" as const) : ("strict" as const),
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
