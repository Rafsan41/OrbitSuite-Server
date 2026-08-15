import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Seeding deliberately uses its own unscoped client. The application client is
// tenant-scoped and would filter these writes by the current organization.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Shared across every seeded account — documented in the README as the
// test credentials for the review call.
const DEMO_PASSWORD = "Password123!";

const main = async () => {
    const passwordHash = await argon2.hash(DEMO_PASSWORD);

    // Wipe in FK-safe order so the seed is repeatable.
    await prisma.processedWebhookEvent.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.plan.deleteMany();

    // ---------- Plans ----------
    // stripePriceId values are placeholders until real Stripe test prices exist.
    const [starter, professional, enterprise] = await Promise.all([
        prisma.plan.create({
            data: {
                name: "Starter",
                priceCents: 2900,
                billingInterval: "MONTH",
                stripePriceId: "price_starter_placeholder",
                features: ["Up to 5 members", "Email support", "Basic analytics"],
            },
        }),
        prisma.plan.create({
            data: {
                name: "Professional",
                priceCents: 9900,
                billingInterval: "MONTH",
                stripePriceId: "price_professional_placeholder",
                features: ["Up to 50 members", "Priority support", "Advanced analytics"],
            },
        }),
        prisma.plan.create({
            data: {
                name: "Enterprise",
                priceCents: 29900,
                billingInterval: "MONTH",
                stripePriceId: "price_enterprise_placeholder",
                features: ["Unlimited members", "Dedicated support", "SSO", "Audit logs"],
            },
        }),
    ]);

    // ---------- Platform organization ----------
    // User.organizationId is non-null, so the platform admin needs a home org.
    // It carries no subscription and exists only to anchor platform staff.
    const platformOrg = await prisma.organization.create({
        data: {
            name: "OrbitSuite Platform",
            contactEmail: "ops@orbitsuite.test",
            status: "ACTIVE",
        },
    });

    await prisma.user.create({
        data: {
            organizationId: platformOrg.id,
            name: "Platform Admin",
            email: "platform.admin@orbitsuite.test",
            passwordHash,
            role: "PLATFORM_ADMIN",
            status: "ACTIVE",
        },
    });

    // ---------- Tenant organizations ----------
    // Two fully populated tenants — required to prove isolation in tests and
    // to demonstrate it in the code walkthrough video.
    const tenants = [
        {
            name: "Acme Corp",
            slug: "acme",
            plan: professional,
            amountCents: professional.priceCents,
        },
        {
            name: "Globex Inc",
            slug: "globex",
            plan: starter,
            amountCents: starter.priceCents,
        },
    ];

    for (const tenant of tenants) {
        const org = await prisma.organization.create({
            data: {
                name: tenant.name,
                contactEmail: `contact@${tenant.slug}.test`,
                billingEmail: `billing@${tenant.slug}.test`,
                status: "ACTIVE",
            },
        });

        await prisma.user.createMany({
            data: [
                {
                    organizationId: org.id,
                    name: `${tenant.name} Admin`,
                    email: `admin@${tenant.slug}.test`,
                    passwordHash,
                    role: "ORG_ADMIN",
                    status: "ACTIVE",
                },
                {
                    organizationId: org.id,
                    name: `${tenant.name} Member`,
                    email: `member@${tenant.slug}.test`,
                    passwordHash,
                    role: "ORG_MEMBER",
                    status: "ACTIVE",
                },
            ],
        });

        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        const subscription = await prisma.subscription.create({
            data: {
                organizationId: org.id,
                planId: tenant.plan.id,
                status: "ACTIVE",
                currentPeriodEnd: periodEnd,
            },
        });

        const payment = await prisma.payment.create({
            data: {
                organizationId: org.id,
                subscriptionId: subscription.id,
                amountCents: tenant.amountCents,
                currency: "usd",
                status: "SUCCESS",
            },
        });

        await prisma.transaction.create({
            data: {
                organizationId: org.id,
                paymentId: payment.id,
                type: "SUBSCRIPTION_PAYMENT",
                status: "SUCCESS",
                amountCents: tenant.amountCents,
                metadata: { source: "seed", plan: tenant.plan.name },
            },
        });
    }

    console.log(`Seeded ${await prisma.plan.count()} plans, ${await prisma.organization.count()} organizations, ${await prisma.user.count()} users.`);
    console.log(`\nTest credentials (password for all: ${DEMO_PASSWORD}):`);
    console.log("  PLATFORM_ADMIN  platform.admin@orbitsuite.test");
    console.log("  ORG_ADMIN       admin@acme.test        (Acme Corp)");
    console.log("  ORG_MEMBER      member@acme.test       (Acme Corp)");
    console.log("  ORG_ADMIN       admin@globex.test      (Globex Inc)");
    console.log("  ORG_MEMBER      member@globex.test     (Globex Inc)");
};

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
