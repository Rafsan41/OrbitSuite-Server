import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma, { prismaUnscoped } from "../src/app/lib/prisma.js";
import { runWithTenant } from "../src/app/lib/tenant-context.js";

/**
 * Proves that tenant isolation is a property of the data layer, not of
 * developer discipline. Every query below is written *without* an
 * organizationId filter — the extension must add it.
 */
describe("tenant isolation", () => {
    let acmeId: string;
    let globexId: string;
    let globexUserId: string;
    let globexPaymentId: string;

    beforeAll(async () => {
        const acme = await prismaUnscoped.organization.findFirstOrThrow({
            where: { name: "Acme Corp" },
        });
        const globex = await prismaUnscoped.organization.findFirstOrThrow({
            where: { name: "Globex Inc" },
        });

        acmeId = acme.id;
        globexId = globex.id;

        globexUserId = (
            await prismaUnscoped.user.findFirstOrThrow({ where: { organizationId: globexId } })
        ).id;
        globexPaymentId = (
            await prismaUnscoped.payment.findFirstOrThrow({ where: { organizationId: globexId } })
        ).id;
    });

    afterAll(async () => {
        await prismaUnscoped.$disconnect();
    });

    const asAcme = <T>(fn: () => Promise<T>) =>
        runWithTenant({ organizationId: acmeId, role: "ORG_ADMIN" }, fn);

    it("findMany returns only the caller's own users", async () => {
        const users = await asAcme(() => prisma.user.findMany());

        expect(users.length).toBeGreaterThan(0);
        expect(users.every((u) => u.organizationId === acmeId)).toBe(true);
    });

    // Regression guard: Prisma promises are lazy, so a scope helper that returns
    // an unawaited query would let it execute outside the tenant context and
    // silently skip filtering. runWithTenant awaits internally to prevent this.
    it("scopes a query that is returned without being awaited inside the scope", async () => {
        const users = await asAcme(() => prisma.user.findMany());

        expect(users.every((u) => u.organizationId === acmeId)).toBe(true);
    });

    it("findUnique by primary key cannot reach another tenant's row", async () => {
        // A valid id, but it belongs to Globex. Acme must not see it.
        const user = await asAcme(() => prisma.user.findUnique({ where: { id: globexUserId } }));

        expect(user).toBeNull();
    });

    it("findUnique by a globally unique field cannot leak across tenants", async () => {
        const user = await asAcme(() =>
            prisma.user.findUnique({ where: { email: "member@globex.test" } }),
        );

        expect(user).toBeNull();
    });

    it("count is scoped, so aggregates cannot reveal other tenants' volume", async () => {
        const scoped = await asAcme(() => prisma.payment.count());
        const total = await prismaUnscoped.payment.count();

        expect(scoped).toBeLessThan(total);
    });

    it("update silently refuses to touch another tenant's row", async () => {
        await expect(
            asAcme(() =>
                prisma.payment.update({
                    where: { id: globexPaymentId },
                    data: { status: "REFUNDED" },
                }),
            ),
        ).rejects.toThrow();

        const untouched = await prismaUnscoped.payment.findUniqueOrThrow({
            where: { id: globexPaymentId },
        });
        expect(untouched.status).toBe("SUCCESS");
    });

    it("deleteMany without a filter cannot wipe another tenant's data", async () => {
        const before = await prismaUnscoped.transaction.count({
            where: { organizationId: globexId },
        });

        // Deliberately unfiltered — the extension must confine the blast radius.
        await asAcme(() => prisma.transaction.deleteMany({ where: { type: "NON_EXISTENT_TYPE" } }));

        const after = await prismaUnscoped.transaction.count({
            where: { organizationId: globexId },
        });
        expect(after).toBe(before);
    });

    it("create forces the caller's organization, ignoring a forged id in the payload", async () => {
        const created = await asAcme(() =>
            prisma.transaction.create({
                data: {
                    // Attacker-supplied: tries to plant a row in Globex.
                    organizationId: globexId,
                    type: "ISOLATION_TEST",
                    status: "PENDING",
                    amountCents: 1,
                },
            }),
        );

        expect(created.organizationId).toBe(acmeId);

        await prismaUnscoped.transaction.delete({ where: { id: created.id } });
    });

    it("the organization record itself is scoped to the caller", async () => {
        const org = await asAcme(() => prisma.organization.findUnique({ where: { id: globexId } }));
        expect(org).toBeNull();

        const own = await asAcme(() => prisma.organization.findUnique({ where: { id: acmeId } }));
        expect(own?.id).toBe(acmeId);
    });

    it("shared catalogue models stay visible to every tenant", async () => {
        const plans = await asAcme(() => prisma.plan.findMany());
        const total = await prismaUnscoped.plan.count();

        expect(plans.length).toBe(total);
    });

    it("without a tenant context queries are unscoped, so webhooks still work", async () => {
        const all = await prisma.user.findMany();
        const total = await prismaUnscoped.user.count();

        expect(all.length).toBe(total);
    });
});
