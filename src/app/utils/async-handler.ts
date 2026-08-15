import { NextFunction, Request, RequestHandler, Response } from "express";

// Express 5 forwards rejected promises on its own, but wrapping keeps the
// intent explicit at every route and avoids relying on that behaviour.
export const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
    (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
