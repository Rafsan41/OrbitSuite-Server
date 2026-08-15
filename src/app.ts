import express, { Application, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import prisma from "./app/lib/prisma.js";
import { env } from "./app/config/env.js";
import { IndexRoutes } from "./app/routers/index.js";
import { WebhookRoutes } from "./app/modules/webhooks/webhook.route.js";
import { errorHandler, notFoundHandler } from "./app/middlewares/error-handler.js";

const app: Application = express();

// Security headers first, before anything can write a response.
app.use(helmet());

// credentials:true is required for the httpOnly refresh cookie to survive a
// cross-origin request from the Next.js client.
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));

// Mounted ABOVE express.json() deliberately. The route parses its own body with
// express.raw() because Stripe signs the exact bytes it sent; letting the JSON
// parser touch this request first would break every signature check.
app.use("/api/v1/webhooks", WebhookRoutes);

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
