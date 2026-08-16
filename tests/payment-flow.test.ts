import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The payment flow up to the point Stripe takes over.
 *
 * Stripe is mocked, deliberately. What is worth testing here is ours: that a
 * tenant stays locked until payment, that a session cannot be opened against an
 * already-paid subscription, that creating one grants nothing, and that the
 * metadata handed to Stripe is exactly what the webhook later reads back.
 * Stripe's own SDK is not under test.
 *
 * The mock is declared before the app is imported, because the route modules
 * resolve their Stripe client at import time.
 */
const createSession = vi.fn();

vi.mock("../src/app/lib/stripe.js", () => ({
    getStripe: () => ({ checkout: { sessions: { create: createSession } } }),
    upsertPlanPrice: vi.fn(async () => "price_test_mock"),
}));

const { default: app } = await import("../src/app.js");
const { prismaUnscoped } = await import("../src/app/lib/prisma.js");
const { signAccessToken } = await import("../src/app/utils/jwt.js");

const ORG_PREFIX = "Payment Flow Org";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A PENDING tenant with an admin — exactly what registration leaves behind. */
const makePendingTenant = async () => {
    const plan = await prismaUnscoped.plan.findFirstOrThrow({ where: { isActive: true } });
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const organization = await prismaUnscoped.organization.create({
        data: {
            name: `${ORG_PREFIX} ${stamp}`,
            billingEmail: "billing@payment.test",
            status: "PENDING",
        },
    });

    const subscription = await prismaUnscoped.subscription.create({
        data: { organizationId: organization.id, planId: plan.id, status: "PENDING" },
    });

    const user = await prismaUnscoped.user.create({
        data: {
            organizationId: organization.id,
            name: "Billing Admin",
            email: `admin.${stamp}@payment.test`,
            passwordHash: "unused-in-this-suite",
            role: "ORG_ADMIN",
            status: "ACTIVE",
        },
    });

    return {
        organization,
        subscription,
        plan,
        token: signAccessToken({
            userId: user.id,
            organizationId: organization.id,
            role: "ORG_ADMIN",
        }),
    };
};

beforeEach(() => {
    createSession.mockReset();
    createSession.mockResolvedValue({
        id: "cs_test_mocked",
        url: "https://checkout.stripe.com/c/pay/cs_test_mocked",
    });
});

afterAll(async () => {
    const scope = { organization: { name: { startsWith: ORG_PREFIX } } };

    await prismaUnscoped.transaction.deleteMany({ where: scope });
    await prismaUnscoped.payment.deleteMany({ where: scope });
    await prismaUnscoped.user.deleteMany({ where: scope });
    await prismaUnscoped.subscription.deleteMany({ where: scope });
    await prismaUnscoped.organization.deleteMany({
        where: { name: { startsWith: ORG_PREFIX } },
    });
    await prismaUnscoped.$disconnect();
});

describe("payment flow: creating a checkout session", () => {
    it("returns the Stripe URL for a pending subscription", async () => {
        const { token } = await makePendingTenant();

        const res = await request(app).post("/api/v1/checkout/session").set(auth(token));

        // 201, not 200: a Checkout Session is a resource this request creates.
        expect(res.status).toBe(201);
        expect(res.body.data.checkoutUrl).toContain("checkout.stripe.com");
        expect(res.body.data.sessionId).toBe("cs_test_mocked");
    });

    it("grants nothing — the tenant is still locked after a session is opened", async () => {
        const { token, organization, subscription } = await makePendingTenant();

        await request(app).post("/api/v1/checkout/session").set(auth(token));

        // The invariant the whole design rests on: opening a checkout session
        // is not payment, and only the webhook may activate anything.
        const org = await prismaUnscoped.organization.findUniqueOrThrow({
            where: { id: organization.id },
        });
        const sub = await prismaUnscoped.subscription.findUniqueOrThrow({
            where: { id: subscription.id },
        });

        expect(org.status).toBe("PENDING");
        expect(sub.status).toBe("PENDING");
        expect(
            await prismaUnscoped.payment.count({
                where: { organizationId: organization.id },
            }),
        ).toBe(0);
    });

    it("sends the exact metadata the webhook handler reads back", async () => {
        const { token, organization, subscription, plan } = await makePendingTenant();

        await request(app).post("/api/v1/checkout/session").set(auth(token));

        const [params] = createSession.mock.calls[0] as [
            {
                mode: string;
                metadata: Record<string, string>;
                subscription_data: { metadata: Record<string, string> };
            },
        ];

        const expected = {
            organizationId: organization.id,
            subscriptionId: subscription.id,
            planId: plan.id,
        };

        // These three keys are the contract between the two halves of the
        // payment flow: the handler throws when any is missing, so renaming one
        // here would break activation silently in production.
        expect(params.metadata).toMatchObject(expected);

        // Repeated on the subscription because renewal invoices arrive without
        // the originating Checkout Session attached.
        expect(params.subscription_data.metadata).toMatchObject(expected);

        // Subscription mode, or Stripe never emits the recurring lifecycle
        // events the handler depends on.
        expect(params.mode).toBe("subscription");
    });

    it("refuses to open a second session for an already-active subscription", async () => {
        const { token, subscription } = await makePendingTenant();

        await prismaUnscoped.subscription.update({
            where: { id: subscription.id },
            data: { status: "ACTIVE" },
        });

        const res = await request(app).post("/api/v1/checkout/session").set(auth(token));

        // A paid customer must not be able to start another checkout — that is
        // a double charge waiting to happen.
        expect(res.status).toBe(409);
        expect(createSession).not.toHaveBeenCalled();
    });

    it("does not call Stripe when the caller has no subscription", async () => {
        const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const organization = await prismaUnscoped.organization.create({
            data: { name: `${ORG_PREFIX} Orphan ${stamp}`, status: "PENDING" },
        });
        const user = await prismaUnscoped.user.create({
            data: {
                organizationId: organization.id,
                name: "Orphan Admin",
                email: `orphan.${stamp}@payment.test`,
                passwordHash: "unused-in-this-suite",
                role: "ORG_ADMIN",
                status: "ACTIVE",
            },
        });

        const token = signAccessToken({
            userId: user.id,
            organizationId: organization.id,
            role: "ORG_ADMIN",
        });

        const res = await request(app).post("/api/v1/checkout/session").set(auth(token));

        expect(res.status).toBe(404);
        expect(createSession).not.toHaveBeenCalled();
    });
});

describe("payment flow: checkout status", () => {
    it("offers a retry while the subscription is unpaid", async () => {
        const { token } = await makePendingTenant();

        const res = await request(app).get("/api/v1/checkout/status").set(auth(token));

        expect(res.status).toBe(200);
        expect(res.body.data.subscriptionStatus).toBe("PENDING");
        expect(res.body.data.organizationStatus).toBe("PENDING");
        expect(res.body.data.canRetry).toBe(true);
    });

    it("withdraws the retry once the subscription is active", async () => {
        const { token, subscription } = await makePendingTenant();

        await prismaUnscoped.subscription.update({
            where: { id: subscription.id },
            data: { status: "ACTIVE" },
        });

        const res = await request(app).get("/api/v1/checkout/status").set(auth(token));

        expect(res.body.data.canRetry).toBe(false);
    });
});

describe("payment flow: who may pay", () => {
    it("refuses a member, so payment stays with the billing owner", async () => {
        const { organization } = await makePendingTenant();
        const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const member = await prismaUnscoped.user.create({
            data: {
                organizationId: organization.id,
                name: "Ordinary Member",
                email: `member.${stamp}@payment.test`,
                passwordHash: "unused-in-this-suite",
                role: "ORG_MEMBER",
                status: "ACTIVE",
            },
        });

        const memberToken = signAccessToken({
            userId: member.id,
            organizationId: organization.id,
            role: "ORG_MEMBER",
        });

        const res = await request(app)
            .post("/api/v1/checkout/session")
            .set(auth(memberToken));

        expect(res.status).toBe(403);
        expect(createSession).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller", async () => {
        const res = await request(app).post("/api/v1/checkout/session");

        expect(res.status).toBe(401);
        expect(createSession).not.toHaveBeenCalled();
    });
});
