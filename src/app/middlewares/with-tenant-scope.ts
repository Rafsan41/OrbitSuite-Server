import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.js";
import { runWithTenantSync } from "../lib/tenant-context.js";

/**
 * Opens a tenant scope for the rest of the request. Must run after requireAuth.
 *
 * Platform Admins are deliberately left unscoped — seeing across organizations
 * is their entire function — so their routes must use `prismaUnscoped` and carry
 * a requireRole("PLATFORM_ADMIN") gate of their own.
 */
export const withTenantScope = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
        return next(AppError.unauthorized("Authentication required"));
    }

    if (req.user.role === "PLATFORM_ADMIN") {
        return next();
    }

    // next() is invoked inside run(), so every later middleware, handler and
    // awaited query inherits this store through async context propagation.
    runWithTenantSync(
        { organizationId: req.user.organizationId, role: req.user.role },
        () => next(),
    );
};
