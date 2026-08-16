import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { prismaUnscoped } from "../src/app/lib/prisma.js";
import { signAccessToken, signRefreshToken } from "../src/app/utils/jwt.js";
import { hashPassword } from "../src/app/utils/password.js";

/**
 * Authentication, exercised over HTTP rather than by calling the service.
 *
 * That distinction is the whole point: requireAuth is Express middleware, so a
 * direct service call would skip the very code being tested. Everything here
 * goes through the real router, the real middleware chain and the real error
 * handler, which is the only way to prove a bad token is refused before a
 * handler ever runs.
 */

const PASSWORD = "TestPassword123";
const ORG_PREFIX = "Auth Test Org";

let activeUser: { id: string; email: string; organizationId: string };
let suspendedUser: { email: string };
let invitedUser: { email: string };
let removedUser: { email: string };

beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const stamp = Date.now();

    const activeOrg = await prismaUnscoped.organization.create({
        data: { name: `${ORG_PREFIX} Active ${stamp}`, status: "ACTIVE" },
    });

    const suspendedOrg = await prismaUnscoped.organization.create({
        data: { name: `${ORG_PREFIX} Suspended ${stamp}`, status: "SUSPENDED" },
    });

    activeUser = await prismaUnscoped.user.create({
        data: {
            organizationId: activeOrg.id,
            name: "Active User",
            email: `active.${stamp}@auth.test`,
            passwordHash,
            role: "ORG_ADMIN",
            status: "ACTIVE",
        },
        select: { id: true, email: true, organizationId: true },
    });

    suspendedUser = await prismaUnscoped.user.create({
        data: {
            organizationId: suspendedOrg.id,
            name: "Suspended Org User",
            email: `suspended.${stamp}@auth.test`,
            passwordHash,
            role: "ORG_ADMIN",
            status: "ACTIVE",
        },
        select: { email: true },
    });

    invitedUser = await prismaUnscoped.user.create({
        data: {
            organizationId: activeOrg.id,
            name: "Invited User",
            email: `invited.${stamp}@auth.test`,
            passwordHash,
            role: "ORG_MEMBER",
            status: "INVITED",
        },
        select: { email: true },
    });

    removedUser = await prismaUnscoped.user.create({
        data: {
            organizationId: activeOrg.id,
            name: "Removed User",
            email: `removed.${stamp}@auth.test`,
            passwordHash,
            role: "ORG_MEMBER",
            status: "REMOVED",
        },
        select: { email: true },
    });
});

afterAll(async () => {
    await prismaUnscoped.user.deleteMany({
        where: { organization: { name: { startsWith: ORG_PREFIX } } },
    });
    await prismaUnscoped.organization.deleteMany({
        where: { name: { startsWith: ORG_PREFIX } },
    });
    await prismaUnscoped.$disconnect();
});

describe("authentication: credentials", () => {
    it("issues an access token and a refresh cookie for valid credentials", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: activeUser.email, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeTruthy();

        // The refresh token must arrive as an httpOnly cookie, never in the
        // body — a body token is readable by any injected script.
        const cookies = res.headers["set-cookie"] as unknown as string[];
        const refreshCookie = cookies?.find((c) => c.startsWith("refreshToken="));
        expect(refreshCookie).toBeDefined();
        expect(refreshCookie).toMatch(/HttpOnly/i);
        expect(JSON.stringify(res.body)).not.toContain("refreshToken");
    });

    it("never returns the password hash", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: activeUser.email, password: PASSWORD });

        // Checked against the serialised body rather than a known key, so a
        // future include/select that drags the hash along is caught too.
        expect(JSON.stringify(res.body)).not.toContain("passwordHash");
        expect(JSON.stringify(res.body)).not.toContain("$argon2");
    });

    it("rejects a wrong password", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: activeUser.email, password: "WrongPassword123" });

        expect(res.status).toBe(401);
    });

    it("gives an unknown email the same answer as a wrong password", async () => {
        const wrongPassword = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: activeUser.email, password: "WrongPassword123" });

        const unknownEmail = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: "nobody@auth.test", password: PASSWORD });

        // Identical status and message, so the endpoint cannot be used to
        // enumerate which addresses have accounts.
        expect(unknownEmail.status).toBe(wrongPassword.status);
        expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    });

    it("refuses a user whose invitation is still outstanding", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: invitedUser.email, password: PASSWORD });

        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("refuses a removed user", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: removedUser.email, password: PASSWORD });

        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("refuses a valid user whose organization is suspended", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: suspendedUser.email, password: PASSWORD });

        // The credentials are correct; the tenant is not permitted to operate.
        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});

describe("authentication: bearer tokens", () => {
    const protectedRoute = "/api/v1/users/me";

    it("rejects a request with no Authorization header", async () => {
        const res = await request(app).get(protectedRoute);
        expect(res.status).toBe(401);
    });

    it("rejects a header that is not a Bearer scheme", async () => {
        const res = await request(app)
            .get(protectedRoute)
            .set("Authorization", "Basic abc123");

        expect(res.status).toBe(401);
    });

    it("rejects a malformed token", async () => {
        const res = await request(app)
            .get(protectedRoute)
            .set("Authorization", "Bearer not-a-real-jwt");

        expect(res.status).toBe(401);
    });

    it("rejects a refresh token presented as an access token", async () => {
        // Access and refresh are signed with different secrets precisely so a
        // stolen refresh token cannot be replayed against protected routes.
        const refreshToken = signRefreshToken({
            userId: activeUser.id,
            organizationId: activeUser.organizationId,
            role: "ORG_ADMIN",
        });

        const res = await request(app)
            .get(protectedRoute)
            .set("Authorization", `Bearer ${refreshToken}`);

        expect(res.status).toBe(401);
    });

    it("rejects a token signed with the wrong secret", async () => {
        const forged = [
            Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
                "base64url",
            ),
            Buffer.from(
                JSON.stringify({
                    userId: activeUser.id,
                    organizationId: activeUser.organizationId,
                    role: "PLATFORM_ADMIN",
                }),
            ).toString("base64url"),
            "forged-signature",
        ].join(".");

        const res = await request(app)
            .get(protectedRoute)
            .set("Authorization", `Bearer ${forged}`);

        // The interesting part is the escalation attempt in the payload: the
        // claim says PLATFORM_ADMIN, and the signature check stops it dead.
        expect(res.status).toBe(401);
    });

    it("accepts a properly signed access token", async () => {
        const accessToken = signAccessToken({
            userId: activeUser.id,
            organizationId: activeUser.organizationId,
            role: "ORG_ADMIN",
        });

        const res = await request(app)
            .get(protectedRoute)
            .set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.email).toBe(activeUser.email);
    });
});

describe("authentication: refresh", () => {
    it("exchanges a refresh cookie for a new access token", async () => {
        const login = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: activeUser.email, password: PASSWORD });

        const cookies = login.headers["set-cookie"] as unknown as string[];

        const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookies);

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeTruthy();
    });

    it("rejects a refresh with no cookie at all", async () => {
        const res = await request(app).post("/api/v1/auth/refresh");
        expect(res.status).toBe(401);
    });

    it("rejects an access token presented at the refresh endpoint", async () => {
        const accessToken = signAccessToken({
            userId: activeUser.id,
            organizationId: activeUser.organizationId,
            role: "ORG_ADMIN",
        });

        const res = await request(app)
            .post("/api/v1/auth/refresh")
            .set("Cookie", [`refreshToken=${accessToken}`]);

        expect(res.status).toBe(401);
    });

    it("stops refreshing once the organization is suspended", async () => {
        const login = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: activeUser.email, password: PASSWORD });

        const cookies = login.headers["set-cookie"] as unknown as string[];

        await prismaUnscoped.organization.update({
            where: { id: activeUser.organizationId },
            data: { status: "SUSPENDED" },
        });

        try {
            const res = await request(app)
                .post("/api/v1/auth/refresh")
                .set("Cookie", cookies);

            // This is what bounds a suspension: the refresh is refused, so an
            // open session dies as soon as its 15-minute access token lapses
            // rather than surviving for the refresh token's seven days.
            expect(res.status).toBeGreaterThanOrEqual(400);
        } finally {
            await prismaUnscoped.organization.update({
                where: { id: activeUser.organizationId },
                data: { status: "ACTIVE" },
            });
        }
    });
});
