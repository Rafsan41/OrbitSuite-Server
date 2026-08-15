import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { upsertPlanPrice } from "../src/app/lib/stripe.js";

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
    // Each plan needs a real Stripe Price before anyone can check out against it.
    // upsertPlanPrice is idempotent on lookup_key, so re-seeding reuses existing
    // prices rather than littering the Stripe account with duplicates.
    const planDefinitions = [
        {
            lookupKey: "orbitsuite_starter_month",
            name: "Starter",
            priceCents: 2900,
            billingInterval: "MONTH" as const,
            features: ["Up to 5 members", "Email support", "Basic analytics"],
        },
        {
            lookupKey: "orbitsuite_professional_month",
            name: "Professional",
            priceCents: 9900,
            billingInterval: "MONTH" as const,
            features: ["Up to 50 members", "Priority support", "Advanced analytics"],
        },
        {
            lookupKey: "orbitsuite_enterprise_month",
            name: "Enterprise",
            priceCents: 29900,
            billingInterval: "MONTH" as const,
            features: ["Unlimited members", "Dedicated support", "SSO", "Audit logs"],
        },
    ];

    // Seeding stays usable without Stripe configured; checkout simply will not
    // work until the seed is re-run with a secret key present.
    const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

    if (!stripeConfigured) {
        console.warn(
            "STRIPE_SECRET_KEY is not set — seeding plans with placeholder price ids.",
        );
    }

    const plans = [];

    for (const definition of planDefinitions) {
        const stripePriceId = stripeConfigured
            ? await upsertPlanPrice({
                  lookupKey: definition.lookupKey,
                  name: `OrbitSuite ${definition.name}`,
                  priceCents: definition.priceCents,
                  billingInterval: definition.billingInterval,
              })
            : `${definition.lookupKey}_placeholder`;

        plans.push(
            await prisma.plan.create({
                data: {
                    name: definition.name,
                    priceCents: definition.priceCents,
                    billingInterval: definition.billingInterval,
                    stripePriceId,
                    features: definition.features,
                },
            }),
        );

        console.log(`  ${definition.name.padEnd(13)} -> ${stripePriceId}`);
    }

    const [starter, professional] = plans;

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
