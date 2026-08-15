import { Router } from "express";
import { env } from "../../config/env.js";
import { seedDatabase } from "../../lib/seed.js";
import { requireAuth } from "../../middlewares/require-auth.js";
import { requireRole } from "../../middlewares/require-role.js";
import { AppError } from "../../utils/app-error.js";
import { asyncHandler } from "../../utils/async-handler.js";

const router = Router();

/**
 * Local development helpers. Destructive, and deliberately fenced three ways.
 *
 * This router is only mounted when NODE_ENV === "development" (see
 * routers/index.ts), so in any other environment the path does not exist at
 * all. The check below is a second, independent guard in case that mount
 * condition is ever loosened — a route that erases every table should not
 * depend on one line somewhere else staying correct.
 */
router.use((_req, _res, next) => {
    if (env.NODE_ENV !== "development") {
        // 404, not 403: outside development this endpoint should be
        // indistinguishable from one that was never written.
        return next(AppError.notFound("Not found"));
    }
    next();
});

// Third fence: even locally, only a platform admin can trigger it, so a stray
// request from a signed-in tenant cannot wipe the database.
router.post(
    "/seed",
    requireAuth,
    requireRole("PLATFORM_ADMIN"),
    asyncHandler(async (_req, res) => {
        await seedDatabase();

        // Every session is now invalid — the users those tokens referred to have
        // been deleted and recreated with new ids. Saying so lets the client
        // sign the caller out rather than leave them holding a token for a row
        // that no longer exists.
        res.status(200).json({
            success: true,
            message: "Database reseeded. All existing sessions are now invalid.",
            data: { sessionsInvalidated: true },
        });
    }),
);

export const DevRoutes = router;
