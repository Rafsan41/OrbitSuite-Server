import type Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prismaUnscoped } from "../src/app/lib/prisma.js";
import { handleStripeEvent } from "../src/app/modules/webhooks/stripe.handler.js";

/**
 * Builds a checkout.session.completed event without calling Stripe. Only the
 * fields the handler reads are populated — the goal is to exercise our
 * transaction and idempotency logic, not Stripe's SDK.
 */
const checkoutEvent = (
    id: string,
    metadata: Record<string, string>,
    amountCents = 9900,
): Stripe.Event =>
    ({
        id,
        type: "checkout.session.completed",
        data: {
            object: {
                id: `cs_test_${id}`,
                amount_total: amountCents,
                currency: "usd",
                customer: `cus_test_${id}`,
                payment_intent: `pi_test_${id}`,
                metadata,
            },
        },
    }) as unknown as Stripe.Event;

describe("stripe webhook: idempotency and rollback", () => {
    let organizationId: string;
    let subscriptionId: string;
    let planId: string;
    const createdEventIds: string[] = [];

    beforeEach(async () => {
        // A fresh PENDING tenant per test, mirroring a real signup.
        const plan = await prismaUnscoped.plan.findFirstOrThrow({ where: { isActive: true } });
        planId = plan.id;

        const org = await prismaUnscoped.organization.create({
            data: {
                name: `Webhook Test Org ${Date.now()}`,
                billingEmail: "billing@webhook.test",
                status: "PENDING",
            },
        });
        organizationId = org.id;

        const subscription = await prismaUnscoped.subscription.create({
            data: { organizationId, planId, status: "PENDING" },
        });
        subscriptionId = subscription.id;
    });

    afterAll(async () => {
        await prismaUnscoped.processedWebhookEvent.deleteMany({
            where: { stripeEventId: { in: createdEventIds } },
        });
        await prismaUnscoped.transaction.deleteMany({
            where: { organization: { name: { startsWith: "Webhook Test Org" } } },
        });
        await prismaUnscoped.payment.deleteMany({
            where: { organization: { name: { startsWith: "Webhook Test Org" } } },
        });
        await prismaUnscoped.subscription.deleteMany({
            where: { organization: { name: { startsWith: "Webhook Test Org" } } },
        });
        await prismaUnscoped.organization.deleteMany({
            where: { name: { startsWith: "Webhook Test Org" } },
        });
        await prismaUnscoped.$disconnect();
    });

    it("activates the organization, subscription, payment and transaction together", async () => {
        const eventId = `evt_ok_${Date.now()}`;
        createdEventIds.push(eventId);

        const outcome = await handleStripeEvent(
            checkoutEvent(eventId, { organizationId, subscriptionId, planId }),
        );

        expect(outcome.status).toBe("processed");

        const [org, subscription, payments, transactions] = await Promise.all([
            prismaUnscoped.organization.findUniqueOrThrow({ where: { id: organizationId } }),
            prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscriptionId } }),
            prismaUnscoped.payment.findMany({ where: { organizationId } }),
            prismaUnscoped.transaction.findMany({ where: { organizationId } }),
        ]);

        expect(org.status).toBe("ACTIVE");
        expect(subscription.status).toBe("ACTIVE");
        expect(subscription.currentPeriodEnd).not.toBeNull();
        expect(payments).toHaveLength(1);
        expect(payments[0].status).toBe("SUCCESS");
        expect(transactions).toHaveLength(1);
        expect(transactions[0].status).toBe("SUCCESS");
    });

    it("processes a replayed event exactly once", async () => {
        const eventId = `evt_dupe_${Date.now()}`;
        createdEventIds.push(eventId);
        const event = checkoutEvent(eventId, { organizationId, subscriptionId, planId });

        const first = await handleStripeEvent(event);
        const second = await handleStripeEvent(event);
        const third = await handleStripeEvent(event);

        expect(first.status).toBe("processed");
        expect(second.status).toBe("duplicate");
        expect(third.status).toBe("duplicate");

        // The real assertion: the customer was not charged into our books twice.
        expect(await prismaUnscoped.payment.count({ where: { organizationId } })).toBe(1);
        expect(await prismaUnscoped.transaction.count({ where: { organizationId } })).toBe(1);
    });

    it("rolls back every write when a later step fails", async () => {
        const eventId = `evt_rollback_${Date.now()}`;

        // Valid organization, but a subscription id that does not exist — the
        // payment insert succeeds, then the subscription update fails.
        const doomed = checkoutEvent(eventId, {
            organizationId,
            subscriptionId: "00000000-0000-0000-0000-000000000000",
            planId,
        });

        await expect(handleStripeEvent(doomed)).rejects.toThrow();

        // Nothing partial survived.
        expect(await prismaUnscoped.payment.count({ where: { organizationId } })).toBe(0);
        expect(await prismaUnscoped.transaction.count({ where: { organizationId } })).toBe(0);
        expect(
            (await prismaUnscoped.organization.findUniqueOrThrow({ where: { id: organizationId } }))
                .status,
        ).toBe("PENDING");

        // Crucially the idempotency marker rolled back too, so Stripe's retry is
        // not silently swallowed as a duplicate of a failed attempt.
        expect(
            await prismaUnscoped.processedWebhookEvent.findUnique({
                where: { stripeEventId: eventId },
            }),
        ).toBeNull();
    });

    it("lets a retry succeed after an earlier failure rolled back", async () => {
        const eventId = `evt_retry_${Date.now()}`;
        createdEventIds.push(eventId);

        await expect(
            handleStripeEvent(
                checkoutEvent(eventId, {
                    organizationId,
                    subscriptionId: "00000000-0000-0000-0000-000000000000",
                    planId,
                }),
            ),
        ).rejects.toThrow();

        // Same event id, now with correct data — must be treated as unprocessed.
        const outcome = await handleStripeEvent(
            checkoutEvent(eventId, { organizationId, subscriptionId, planId }),
        );

        expect(outcome.status).toBe("processed");
        expect(await prismaUnscoped.payment.count({ where: { organizationId } })).toBe(1);
    });

    it("rejects a session missing its metadata rather than guessing", async () => {
        const eventId = `evt_nometa_${Date.now()}`;

        await expect(handleStripeEvent(checkoutEvent(eventId, {}))).rejects.toThrow(
            /missing required metadata/i,
        );

        expect(
            await prismaUnscoped.processedWebhookEvent.findUnique({
                where: { stripeEventId: eventId },
            }),
        ).toBeNull();
    });
});
