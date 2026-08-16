import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { prismaUnscoped } from "../src/app/lib/prisma.js";
import { signAccessToken } from "../src/app/utils/jwt.js";

/**
 * Role authorization, over HTTP.
 *
 * The client hides nav items a role cannot use, but that is presentation, not
 * access control — every one of these requests is what a curious user gets by
 * typing the URL, or what an attacker gets with a valid token for the wrong
 * role. The tokens here are signed with the real secret and are entirely valid;
 * the only thing standing between them and the data is requireRole.
 *
 * Both directions are asserted deliberately. A gate that returns 403 to
 * everybody would pass a deny-only suite while breaking the product.
 */

const ORG_PREFIX = "Role Test Org";

let platformAdminToken: string;
let orgAdminToken: string;
let memberToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
    const stamp = Date.now();

    const org = await prismaUnscoped.organization.create({
        data: { name: `${ORG_PREFIX} ${stamp}`, status: "ACTIVE" },
    });

    // Signed directly rather than through login: this file is about what a role
    // may reach once authenticated, and going through the credential flow would
    // couple these cases to the login tests.
    const users = await Promise.all(
        (
            [
                ["PLATFORM_ADMIN", "platform"],
                ["ORG_ADMIN", "admin"],
                ["ORG_MEMBER", "member"],
            ] as const
        ).map(([role, slug]) =>
            prismaUnscoped.user.create({
                data: {
                    organizationId: org.id,
                    name: `${slug} user`,
                    email: `${slug}.${stamp}@role.test`,
                    passwordHash: "unused-in-this-suite",
                    role,
                    status: "ACTIVE",
                },
                select: { id: true, role: true, organizationId: true },
            }),
        ),
    );

    [platformAdminToken, orgAdminToken, memberToken] = users.map((user) =>
        signAccessToken({
            userId: user.id,
            organizationId: user.organizationId,
            role: user.role,
        }),
    );
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

describe("role authorization: platform-admin-only routes", () => {
    // Every route here is unscoped by design — reaching across tenants is the
    // whole purpose of the role, which is exactly why the gate has to hold.
    const routes = [
        "/api/v1/organizations",
        "/api/v1/stats",
        "/api/v1/transactions/all",
    ];

    it.each(routes)("%s admits a platform admin", async (route) => {
        const res = await request(app).get(route).set(auth(platformAdminToken));
        expect(res.status).toBe(200);
    });

    it.each(routes)("%s refuses an org admin", async (route) => {
        const res = await request(app).get(route).set(auth(orgAdminToken));
        expect(res.status).toBe(403);
    });

    it.each(routes)("%s refuses a member", async (route) => {
        const res = await request(app).get(route).set(auth(memberToken));
        expect(res.status).toBe(403);
    });

    it("refuses an org admin trying to suspend an organization", async () => {
        const target = await prismaUnscoped.organization.findFirstOrThrow({
            where: { name: { startsWith: ORG_PREFIX } },
        });

        const res = await request(app)
            .patch(`/api/v1/organizations/${target.id}/suspend`)
            .set(auth(orgAdminToken));

        expect(res.status).toBe(403);

        // The refusal must be total, not cosmetic: nothing may have changed.
        const after = await prismaUnscoped.organization.findUniqueOrThrow({
            where: { id: target.id },
        });
        expect(after.status).toBe("ACTIVE");
    });

    it("refuses a member creating a plan, and writes nothing", async () => {
        const before = await prismaUnscoped.plan.count();

        const res = await request(app)
            .post("/api/v1/plans")
            .set(auth(memberToken))
            .send({
                name: "Smuggled Plan",
                priceCents: 1,
                billingInterval: "MONTH",
                features: [],
            });

        expect(res.status).toBe(403);
        expect(await prismaUnscoped.plan.count()).toBe(before);
    });
});

describe("role authorization: org-admin-only routes", () => {
    const routes = [
        "/api/v1/organizations/me",
        "/api/v1/users",
        "/api/v1/payments",
        "/api/v1/transactions",
    ];

    it.each(routes)("%s admits an org admin", async (route) => {
        const res = await request(app).get(route).set(auth(orgAdminToken));
        expect(res.status).toBe(200);
    });

    it.each(routes)("%s refuses a member", async (route) => {
        // The brief gives members no access to billing, member management or
        // transaction data — this is that boundary, enforced server-side.
        const res = await request(app).get(route).set(auth(memberToken));
        expect(res.status).toBe(403);
    });

    it("refuses a member inviting another member, and creates no user", async () => {
        const before = await prismaUnscoped.user.count();

        const res = await request(app)
            .post("/api/v1/users/invite")
            .set(auth(memberToken))
            .send({ name: "Smuggled User", email: "smuggled@role.test", role: "ORG_ADMIN" });

        expect(res.status).toBe(403);
        expect(await prismaUnscoped.user.count()).toBe(before);
    });

    it("refuses a member cancelling the subscription", async () => {
        const res = await request(app)
            .post("/api/v1/subscriptions/cancel")
            .set(auth(memberToken))
            .send({});

        expect(res.status).toBe(403);
    });
});

describe("role authorization: routes every authenticated role may reach", () => {
    it("lets all three roles read their own profile", async () => {
        for (const token of [platformAdminToken, orgAdminToken, memberToken]) {
            const res = await request(app).get("/api/v1/users/me").set(auth(token));
            expect(res.status).toBe(200);
        }
    });

    it("lets a member read the reduced organization summary", async () => {
        const res = await request(app)
            .get("/api/v1/organizations/me/summary")
            .set(auth(memberToken));

        expect(res.status).toBe(200);

        // The reduction happens server-side, so the financial fields are absent
        // from the payload rather than merely unrendered by the client.
        expect(res.body.data).not.toHaveProperty("billingEmail");
        expect(res.body.data).not.toHaveProperty("payments");
        expect(res.body.data).not.toHaveProperty("subscription");
    });
});

describe("role authorization: privilege escalation is refused", () => {
    it("cannot be bypassed by claiming a higher role in the request body", async () => {
        // The role is read from the signed token, never from the payload.
        const res = await request(app)
            .patch("/api/v1/users/me")
            .set(auth(memberToken))
            .send({ name: "Escalation Attempt", role: "PLATFORM_ADMIN" });

        expect(res.status).toBe(200);

        const after = await prismaUnscoped.user.findFirstOrThrow({
            where: { name: "Escalation Attempt" },
        });
        expect(after.role).toBe("ORG_MEMBER");
    });

    it("still refuses platform routes after that attempt", async () => {
        const res = await request(app).get("/api/v1/stats").set(auth(memberToken));
        expect(res.status).toBe(403);
    });
});
