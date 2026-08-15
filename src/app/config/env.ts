import "dotenv/config";
import { z } from "zod";

// Fail fast at boot rather than at the first request that needs a missing var.
// Stripe and SMTP are optional here so the server still runs before those
// accounts exist; the modules that use them assert their own vars on use.
const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default("OrbitSuite <no-reply@orbitsuite.test>"),

    CLIENT_URL: z.string().url().default("http://localhost:3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
}

export const env = parsed.data;

// Narrow accessors for the optional groups — call these at the point of use so
// a missing key surfaces as a clear error instead of `undefined` reaching Stripe.
// Split deliberately: creating prices and checkout sessions needs only the API
// key, while signature verification needs only the signing secret. Demanding
// both together would block price setup before `stripe listen` has ever run.
export const requireStripeSecretKey = (): string => {
    if (!env.STRIPE_SECRET_KEY) {
        throw new Error("STRIPE_SECRET_KEY must be set");
    }
    return env.STRIPE_SECRET_KEY;
};

export const requireStripeWebhookSecret = (): string => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
        throw new Error("STRIPE_WEBHOOK_SECRET must be set");
    }
    return env.STRIPE_WEBHOOK_SECRET;
};

export const requireSmtpEnv = () => {
    if (!env.SMTP_HOST || !env.SMTP_PORT) {
        throw new Error("SMTP_HOST and SMTP_PORT must be set");
    }
    return {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.MAIL_FROM,
    };
};
