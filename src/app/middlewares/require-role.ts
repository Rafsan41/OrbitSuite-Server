import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.js";
import type { UserRole } from "../../generated/prisma/enums.js";

// Authorization is enforced here, server-side. Hiding a button in the UI is
// not access control — every protected route carries its own role gate.
export const requireRole =
    (...allowed: UserRole[]) =>
    (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(AppError.unauthorized("Authentication required"));
        }

        if (!allowed.includes(req.user.role)) {
            // Deliberately vague: telling the caller which roles would work
            // leaks the permission model.
            return next(AppError.forbidden());
        }

        next();
    };
