import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "./app-error.js";
import type { UserRole } from "../../generated/prisma/enums.js";

// organizationId travels in the token so tenant scoping never needs an extra
// query. It is signed, so a client cannot tamper with it to reach another org.
export type AuthTokenPayload = {
    userId: string;
    organizationId: string;
    role: UserRole;
};

type TokenKind = "access" | "refresh";

const secrets: Record<TokenKind, string> = {
    access: env.JWT_ACCESS_SECRET,
    refresh: env.JWT_REFRESH_SECRET,
};

const lifetimes: Record<TokenKind, string> = {
    access: env.JWT_ACCESS_EXPIRES_IN,
    refresh: env.JWT_REFRESH_EXPIRES_IN,
};

const sign = (payload: AuthTokenPayload, kind: TokenKind): string =>
    jwt.sign(payload, secrets[kind], {
        expiresIn: lifetimes[kind],
    } as SignOptions);

export const signAccessToken = (payload: AuthTokenPayload) => sign(payload, "access");
export const signRefreshToken = (payload: AuthTokenPayload) => sign(payload, "refresh");

export const signTokenPair = (payload: AuthTokenPayload) => ({
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
});

// Separate secrets per kind mean a stolen access token can never be replayed
// against the refresh endpoint, and vice versa.
export const verifyToken = (token: string, kind: TokenKind): AuthTokenPayload => {
    try {
        return jwt.verify(token, secrets[kind]) as AuthTokenPayload;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw AppError.unauthorized(
                kind === "access" ? "Access token has expired" : "Session has expired, please log in again",
            );
        }
        throw AppError.unauthorized("Invalid authentication token");
    }
};
