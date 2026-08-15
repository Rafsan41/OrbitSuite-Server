import express, { Application, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import prisma from "./app/lib/prisma.js";
import { env } from "./app/config/env.js";
import { IndexRoutes } from "./app/routers/index.js";
import { errorHandler, notFoundHandler } from "./app/middlewares/error-handler.js";

const app: Application = express();

// Security headers first, before anything can write a response.
app.use(helmet());

// credentials:true is required for the httpOnly refresh cookie to survive a
// cross-origin request from the Next.js client.
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));

// NOTE (P3): the Stripe webhook route must be mounted ABOVE express.json()
// with express.raw() — signature verification needs the unparsed body.

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1", IndexRoutes);

// Health check — read-only and idempotent, so it returns the same 200 on every
// call. Anything that writes here breaks on the second request.
app.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({
            success: true,
            message: "api working",
            data: {
                database: "connected",
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        next(error);
    }
});

// Both must stay last: the 404 catches unmatched routes, and the error handler
// is terminal.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
