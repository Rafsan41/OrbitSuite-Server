import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.js";
import { env } from "../config/env.js";

// Prisma's known request errors carry a `code`; we translate the few that map
// to meaningful HTTP responses and treat the rest as unexpected.
type PrismaKnownError = { code: string; meta?: { target?: string[] } };

const isPrismaKnownError = (error: unknown): error is PrismaKnownError =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("P");

const translatePrismaError = (error: PrismaKnownError): AppError | null => {
    switch (error.code) {
        case "P2002": {
            const field = error.meta?.target?.join(", ");
            return AppError.conflict(
                field ? `A record with this ${field} already exists` : "Record already exists",
            );
        }
        case "P2025":
            return AppError.notFound();
        case "P2003":
            return AppError.badRequest("Referenced record does not exist");
        default:
            return null;
    }
};

export const notFoundHandler = (req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
        data: null,
    });
};

// Terminal handler. Anything that is not an AppError is treated as unexpected
// and reported generically — internal messages and stack traces never reach
// the client outside development.
export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
) => {
    if (res.headersSent) {
        return next(err);
    }

    let appError: AppError | null = err instanceof AppError ? err : null;

    if (!appError && isPrismaKnownError(err)) {
        appError = translatePrismaError(err);
    }

    if (appError) {
        return res.status(appError.statusCode).json({
            success: false,
            message: appError.message,
            data: null,
            ...(appError.details ? { errors: appError.details } : {}),
        });
    }

    console.error("Unhandled error:", err);

    res.status(500).json({
        success: false,
        message: "Something went wrong",
        data: null,
        ...(env.NODE_ENV === "development" && err instanceof Error
            ? { debug: { message: err.message, stack: err.stack } }
            : {}),
    });
};
