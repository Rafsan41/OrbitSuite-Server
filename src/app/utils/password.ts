import { Algorithm, hash, verify } from "@node-rs/argon2";
import crypto from "node:crypto";

/**
 * argon2id is the current OWASP recommendation for password storage.
 *
 * `@node-rs/argon2` rather than `argon2`: the latter is a node-gyp addon that
 * has to compile against the exact Node version of whatever runs it, which is
 * the usual reason a deploy to a serverless platform fails at install. This one
 * ships prebuilt napi binaries.
 *
 * The parameters are stated rather than left to the library's defaults, which
 * are lower than the previous implementation's. Both produce standard PHC
 * strings and each verifies the other's hashes, so stored passwords keep
 * working — but a silent drop in cost is not something to inherit by accident.
 */
const ARGON2_OPTIONS = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 4,
} as const;

export const hashPassword = (plain: string): Promise<string> =>
    hash(plain, ARGON2_OPTIONS);

// Parameters are read from the stored hash, so this verifies older hashes too.
export const verifyPassword = (hashed: string, plain: string): Promise<boolean> =>
    verify(hashed, plain);

// Reset and invite tokens: the raw token goes in the email, only its SHA-256
// digest is stored. A leaked database therefore yields no usable tokens.
// SHA-256 is correct here rather than argon2 — these are high-entropy random
// values, not guessable passwords, so slow hashing buys nothing.
export const generateSecureToken = () => {
    const raw = crypto.randomBytes(32).toString("hex");
    return { raw, hash: hashToken(raw) };
};

export const hashToken = (raw: string): string =>
    crypto.createHash("sha256").update(raw).digest("hex");
