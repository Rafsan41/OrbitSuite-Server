import argon2 from "argon2";
import crypto from "node:crypto";

// argon2id is the current OWASP recommendation for password storage. The
// library's defaults (64 MiB memory, 3 iterations) are the tuned parameters.
export const hashPassword = (plain: string): Promise<string> =>
    argon2.hash(plain, { type: argon2.argon2id });

export const verifyPassword = (hash: string, plain: string): Promise<boolean> =>
    argon2.verify(hash, plain);

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
