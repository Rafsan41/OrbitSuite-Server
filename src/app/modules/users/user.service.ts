import prisma, { prismaUnscoped } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { toMeta, toPrismaPaging, searchFilter } from "../../utils/paginate.js";
import { generateSecureToken, hashPassword, hashToken } from "../../utils/password.js";
import type { AuthTokenPayload } from "../../utils/jwt.js";
import type {
    AcceptInviteInput,
    ChangeRoleInput,
    InviteMemberInput,
    ListMembersQuery,
    UpdateProfileInput,
} from "./user.validation.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const publicFields = {
    id: true,
    name: true,
    email: true,
    role: true,
    status: true,
    createdAt: true,
} as const;

/**
 * Members of the caller's organization. No organizationId filter appears here —
 * the tenant extension adds it, so this cannot leak another tenant's users.
 */
const listMembers = async (query: ListMembersQuery) => {
    const where = {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(searchFilter(query.search, ["name", "email"]) ?? {}),
    };

    const [data, total] = await Promise.all([
        prisma.user.findMany({ where, select: publicFields, ...toPrismaPaging(query) }),
        prisma.user.count({ where }),
    ]);

    return { data, meta: toMeta(query, total) };
};

/**
 * Invites a member into the caller's organization.
 *
 * The user row is created immediately with status INVITED and an unusable
 * password, so they occupy a seat and appear in the members list before
 * accepting. The invitation token is stored hashed, exactly like a password
 * reset, and returned once so the caller can email it.
 */
const inviteMember = async (auth: AuthTokenPayload, payload: InviteMemberInput) => {
    // Emails are globally unique, so this check must cross tenants.
    const existing = await prismaUnscoped.user.findUnique({
        where: { email: payload.email },
        select: { id: true, organizationId: true },
    });

    if (existing) {
        throw AppError.conflict(
            existing.organizationId === auth.organizationId
                ? "This person is already a member of your organization"
                : "An account with this email already exists",
        );
    }

    const { raw, hash } = generateSecureToken();

    // An unusable placeholder hash: the invitee sets a real password on accept.
    const placeholder = await hashPassword(generateSecureToken().raw);

    const user = await prisma.user.create({
        data: {
            // organizationId is forced by the tenant extension regardless of
            // what is passed, so an invite cannot be planted in another tenant.
            organizationId: auth.organizationId,
            name: payload.name,
            email: payload.email,
            role: payload.role,
            status: "INVITED",
            passwordHash: placeholder,
            resetTokenHash: hash,
            resetTokenExpires: new Date(Date.now() + INVITE_TTL_MS),
        },
        select: publicFields,
    });

    // Names for the invitation email, read here so the controller stays a thin
    // request/response layer with no data access of its own.
    const [organization, inviter] = await Promise.all([
        prisma.organization.findUnique({
            where: { id: auth.organizationId },
            select: { name: true },
        }),
        prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } }),
    ]);

    return {
        user,
        inviteToken: raw,
        organizationName: organization?.name ?? "your organization",
        invitedBy: inviter?.name ?? "An administrator",
    };
};

/**
 * Accepting an invitation is public — the invitee has no session yet, so this
 * runs unscoped and is authorised solely by possession of the token.
 */
const acceptInvite = async (payload: AcceptInviteInput) => {
    const user = await prismaUnscoped.user.findFirst({
        where: {
            resetTokenHash: hashToken(payload.token),
            resetTokenExpires: { gt: new Date() },
            status: "INVITED",
        },
        select: { id: true },
    });

    if (!user) {
        throw AppError.badRequest("This invitation is invalid or has expired");
    }

    await prismaUnscoped.user.update({
        where: { id: user.id },
        data: {
            passwordHash: await hashPassword(payload.password),
            status: "ACTIVE",
            resetTokenHash: null,
            resetTokenExpires: null,
        },
    });
};

const getMember = async (id: string) => {
    const user = await prisma.user.findUnique({ where: { id }, select: publicFields });

    if (!user) {
        throw AppError.notFound("Member not found");
    }

    return user;
};

/**
 * Removal is a soft delete. Hard-deleting would cascade away the audit trail,
 * and the brief requires payment and transaction history to remain readable.
 */
const removeMember = async (auth: AuthTokenPayload, id: string) => {
    if (id === auth.userId) {
        throw AppError.badRequest("You cannot remove yourself");
    }

    const member = await getMember(id);

    if (member.role === "ORG_ADMIN") {
        const admins = await prisma.user.count({
            where: { role: "ORG_ADMIN", status: "ACTIVE" },
        });

        if (admins <= 1) {
            throw AppError.conflict("An organization must keep at least one active admin");
        }
    }

    return prisma.user.update({
        where: { id },
        data: { status: "REMOVED" },
        select: publicFields,
    });
};

const changeRole = async (auth: AuthTokenPayload, id: string, payload: ChangeRoleInput) => {
    if (id === auth.userId) {
        throw AppError.badRequest("You cannot change your own role");
    }

    const member = await getMember(id);

    // Guard against an organization demoting away its last administrator.
    if (member.role === "ORG_ADMIN" && payload.role !== "ORG_ADMIN") {
        const admins = await prisma.user.count({
            where: { role: "ORG_ADMIN", status: "ACTIVE" },
        });

        if (admins <= 1) {
            throw AppError.conflict("An organization must keep at least one active admin");
        }
    }

    return prisma.user.update({
        where: { id },
        data: { role: payload.role },
        select: publicFields,
    });
};

const getOwnProfile = async (auth: AuthTokenPayload) => getMember(auth.userId);

const updateOwnProfile = async (auth: AuthTokenPayload, payload: UpdateProfileInput) => {
    if (payload.email) {
        const taken = await prismaUnscoped.user.findUnique({
            where: { email: payload.email },
            select: { id: true },
        });

        if (taken && taken.id !== auth.userId) {
            throw AppError.conflict("An account with this email already exists");
        }
    }

    return prisma.user.update({
        where: { id: auth.userId },
        data: payload,
        select: publicFields,
    });
};

export const UserService = {
    listMembers,
    inviteMember,
    acceptInvite,
    getMember,
    removeMember,
    changeRole,
    getOwnProfile,
    updateOwnProfile,
};
