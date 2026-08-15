// Authentication legitimately crosses tenants: a login looks a user up by
// email before any organization is known. This is one of the few places
// allowed to bypass tenant scoping.
import { prismaUnscoped as prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import {
    generateSecureToken,
    hashPassword,
    hashToken,
    verifyPassword,
} from "../../utils/password.js";
import { signTokenPair, verifyToken, type AuthTokenPayload } from "../../utils/jwt.js";
import type {
    ChangePasswordInput,
    ForgotPasswordInput,
    LoginInput,
    RegisterInput,
    ResetPasswordInput,
} from "./auth.validation.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Shape returned to the client. Never includes passwordHash or reset fields.
const toPublicUser = (user: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    organizationId: string;
}) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId,
});

/**
 * Paid onboarding: the organization is created in PENDING and stays unusable
 * until a Stripe webhook confirms payment. Org, admin user and subscription are
 * written in one transaction so a half-registered tenant can never exist.
 */
const register = async (payload: RegisterInput) => {
    const plan = await prisma.plan.findFirst({
        where: { id: payload.planId, isActive: true },
    });

    if (!plan) {
        throw AppError.badRequest("Selected plan is not available");
    }

    const existing = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { id: true },
    });

    if (existing) {
        throw AppError.conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(payload.password);

    const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
            data: {
                name: payload.organizationName,
                contactEmail: payload.email,
                billingEmail: payload.email,
                status: "PENDING",
            },
        });

        const user = await tx.user.create({
            data: {
                organizationId: organization.id,
                name: payload.name,
                email: payload.email,
                passwordHash,
                role: "ORG_ADMIN",
                status: "ACTIVE",
            },
        });

        const subscription = await tx.subscription.create({
            data: {
                organizationId: organization.id,
                planId: plan.id,
                status: "PENDING",
            },
        });

        return { organization, user, subscription };
    });

    // The admin can authenticate immediately so they are able to retry an
    // abandoned checkout — but the organization stays PENDING until payment.
    const tokens = signTokenPair({
        userId: result.user.id,
        organizationId: result.organization.id,
        role: "ORG_ADMIN",
    });

    return {
        user: toPublicUser(result.user),
        organization: {
            id: result.organization.id,
            name: result.organization.name,
            status: result.organization.status,
        },
        subscription: { id: result.subscription.id, status: result.subscription.status },
        plan: { id: plan.id, name: plan.name, priceCents: plan.priceCents },
        ...tokens,
    };
};

const login = async (payload: LoginInput) => {
    const user = await prisma.user.findUnique({
        where: { email: payload.email },
        include: { organization: { select: { id: true, name: true, status: true } } },
    });

    // Identical error and a password verification either way, so response
    // content and timing do not reveal whether the email exists.
    if (!user) {
        await hashPassword(payload.password);
        throw AppError.unauthorized("Invalid email or password");
    }

    const passwordValid = await verifyPassword(user.passwordHash, payload.password);

    if (!passwordValid) {
        throw AppError.unauthorized("Invalid email or password");
    }

    if (user.status === "REMOVED") {
        throw AppError.forbidden("This account has been deactivated");
    }

    if (user.status === "INVITED") {
        throw AppError.forbidden("Please accept your invitation before signing in");
    }

    if (user.organization.status === "SUSPENDED") {
        throw AppError.forbidden("This organization has been suspended");
    }

    const tokens = signTokenPair({
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
    });

    return {
        user: toPublicUser(user),
        organization: user.organization,
        ...tokens,
    };
};

/**
 * Refresh rotates both tokens. The user and organization are re-read so a
 * revoked account or suspended org cannot keep renewing a live session.
 */
const refresh = async (refreshToken: string) => {
    const decoded = verifyToken(refreshToken, "refresh");

    const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { organization: { select: { id: true, name: true, status: true } } },
    });

    if (!user || user.status !== "ACTIVE") {
        throw AppError.unauthorized("Session is no longer valid");
    }

    if (user.organization.status === "SUSPENDED") {
        throw AppError.forbidden("This organization has been suspended");
    }

    const tokens = signTokenPair({
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
    });

    return { user: toPublicUser(user), organization: user.organization, ...tokens };
};

/**
 * Always reports success. Revealing whether an email is registered would turn
 * this endpoint into an account enumeration oracle.
 */
const forgotPassword = async (payload: ForgotPasswordInput) => {
    const user = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { id: true, status: true },
    });

    if (!user || user.status === "REMOVED") {
        return { resetToken: null };
    }

    const { raw, hash } = generateSecureToken();

    await prisma.user.update({
        where: { id: user.id },
        data: {
            resetTokenHash: hash,
            resetTokenExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
    });

    // Returned to the caller only so the controller can hand it to the mailer.
    // It is never included in the HTTP response body.
    return { resetToken: raw };
};

const resetPassword = async (payload: ResetPasswordInput) => {
    const user = await prisma.user.findFirst({
        where: {
            resetTokenHash: hashToken(payload.token),
            resetTokenExpires: { gt: new Date() },
        },
        select: { id: true },
    });

    if (!user) {
        throw AppError.badRequest("This reset link is invalid or has expired");
    }

    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash: await hashPassword(payload.password),
            resetTokenHash: null,
            resetTokenExpires: null,
        },
    });
};

const changePassword = async (auth: AuthTokenPayload, payload: ChangePasswordInput) => {
    const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, passwordHash: true },
    });

    if (!user) {
        throw AppError.unauthorized("Session is no longer valid");
    }

    const valid = await verifyPassword(user.passwordHash, payload.currentPassword);

    if (!valid) {
        throw AppError.unauthorized("Current password is incorrect");
    }

    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash: await hashPassword(payload.newPassword),
            resetTokenHash: null,
            resetTokenExpires: null,
        },
    });
};

const getCurrentUser = async (auth: AuthTokenPayload) => {
    const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: {
            organization: {
                select: {
                    id: true,
                    name: true,
                    status: true,
                    subscription: {
                        select: {
                            status: true,
                            currentPeriodEnd: true,
                            plan: { select: { id: true, name: true, priceCents: true } },
                        },
                    },
                },
            },
        },
    });

    if (!user) {
        throw AppError.unauthorized("Session is no longer valid");
    }

    return { user: toPublicUser(user), organization: user.organization };
};

export const AuthService = {
    register,
    login,
    refresh,
    forgotPassword,
    resetPassword,
    changePassword,
    getCurrentUser,
};
