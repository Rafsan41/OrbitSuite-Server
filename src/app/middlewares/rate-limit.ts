import rateLimit from "express-rate-limit";

const json = (message: string) => ({ success: false, message, data: null });

// Brute-force guard on credential endpoints. Keyed by IP; a real deployment
// behind a proxy needs `app.set("trust proxy", 1)` for this to key correctly.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: json("Too many attempts from this IP, please try again in 15 minutes"),
});

// Stricter still: password reset emails cost money and can be used to spam a
// third party's inbox.
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: json("Too many password reset requests, please try again in an hour"),
});
