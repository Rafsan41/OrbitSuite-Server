import express, { Application, NextFunction, Request, Response } from "express";
import prisma from "./app/lib/prisma.js";
import { IndexRoutes } from "./app/routers/index.js";


const app: Application = express();

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());

app.use("/api/v1", IndexRoutes)

// Health check — read-only and idempotent, so it returns the same 200 on every
// call. Anything that writes here breaks on the second request.
app.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({
            success: true,
            message: "api working",
            data: {
                database: "connected",
                timestamp: new Date().toISOString()
            }
        })
    } catch (error) {
        next(error);
    }
});

// Unknown routes get the same envelope as everything else
app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
        data: null
    })
});

// Without this, Express's default handler answers failures with an HTML page
// instead of the JSON shape every other response uses.
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
        return next(err);
    }
    console.error(err);
    res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : "Internal server error",
        data: null
    })
});

export default app;
