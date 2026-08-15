// Errors thrown as AppError are considered safe to show the client. Anything
// else reaching the error handler is treated as unexpected and reported as a
// generic 500, so internal details never leak.
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational = true;
    public readonly details?: unknown;

    constructor(statusCode: number, message: string, details?: unknown) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad request", details?: unknown) {
        return new AppError(400, message, details);
    }

    static unauthorized(message = "Authentication required") {
        return new AppError(401, message);
    }

    static forbidden(message = "You do not have permission to perform this action") {
        return new AppError(403, message);
    }

    static notFound(message = "Resource not found") {
        return new AppError(404, message);
    }

    static conflict(message = "Resource already exists") {
        return new AppError(409, message);
    }

    static tooManyRequests(message = "Too many requests, please try again later") {
        return new AppError(429, message);
    }
}
