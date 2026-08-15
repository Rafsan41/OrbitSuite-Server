import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.js";
import { verifyToken } from "../utils/jwt.js";

// Reads a Bearer access token, verifies it, and attaches the caller to the
// request. Everything after this in the chain can assume req.user exists.
export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
        return next(AppError.unauthorized("Authentication required"));
    }

    const token = header.slice("Bearer ".length).trim();

    if (!token) {
        return next(AppError.unauthorized("Authentication required"));
    }

    try {
        req.user = verifyToken(token, "access");
        next();
    } catch (error) {
        next(error);
    }
};
