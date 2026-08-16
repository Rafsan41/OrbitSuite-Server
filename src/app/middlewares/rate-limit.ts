import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const json = (message: string) => ({ success: false, message, data: null });

/**
 * The limiters key on IP, and an entire test run shares one. Left active, the
 * authentication suite would exhaust the ten-attempt budget partway through and
 * the remaining cases would fail on 429s that prove nothing about auth.
 *
 * This is the narrowest bypass available: it disengages only under
 * NODE_ENV=test, which vitest sets and which the env schema already recognises.
 * Development and production keep the full guard, unchanged.
 */
const skipInTests = () => env.NODE_ENV === "test";

// Brute-force guard on credential endpoints. Keyed by IP; a real deployment
// behind a proxy needs `app.set("trust proxy", 1)` for this to key correctly.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: json("Too many attempts from this IP, please try again in 15 minutes"),
    skip: skipInTests,
});

// Stricter still: password reset emails cost money and can be used to spam a
// third party's inbox.
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: json("Too many password reset requests, please try again in an hour"),
    skip: skipInTests,
});
