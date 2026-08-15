import { NextFunction, Request, Response } from "express";
import { ZodError, ZodType } from "zod";
import { AppError } from "../utils/app-error.js";

// Parses and REPLACES req.body with the validated result, so handlers receive
// stripped, correctly typed data rather than whatever the client posted.
export const validate =
    (schema: ZodType) =>
    (req: Request, _res: Response, next: NextFunction) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const details = error.issues.map((issue) => ({
                    field: issue.path.join(".") || "body",
                    message: issue.message,
                }));
                return next(AppError.badRequest("Validation failed", details));
            }
            next(error);
        }
    };
