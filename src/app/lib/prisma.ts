import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getTenantStore } from "./tenant-context.js";
import { env } from "../config/env.js";

// Prisma 7's client generator needs an explicit driver adapter rather than
// reading DATABASE_URL implicitly — this wires it to your Postgres URL.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const base = new PrismaClient({ adapter });

/**
 * The unscoped client. Use ONLY where crossing tenants is the point:
 *   - authentication (a user is found by email before any org is known)
 *   - Stripe webhooks (Stripe knows nothing about our request context)
 *   - Platform Admin endpoints (their job is to see every organization)
 *   - the seed script
 * Every other query should go through the default export.
 */
export const prismaUnscoped = base;

// Models carrying an organizationId column — filtered on that field.
const TENANT_SCOPED_MODELS = new Set(["User", "Subscription", "Payment", "Transaction"]);

// Organization is the tenant itself, so it is constrained by its own primary key.
const ORGANIZATION_MODEL = "Organization";

// Plan is a shared catalogue and ProcessedWebhookEvent is infrastructure —
// neither belongs to a tenant, so neither is ever filtered.

const WHERE_OPERATIONS = new Set([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "update",
    "updateMany",
    "delete",
    "deleteMany",
    "count",
    "aggregate",
    "groupBy",
    "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "upsert"]);

const scopeFieldFor = (model?: string): string | null => {
    if (!model) return null;
    if (model === ORGANIZATION_MODEL) return "id";
    if (TENANT_SCOPED_MODELS.has(model)) return "organizationId";
    return null;
};

/**
 * Tenant isolation is enforced here, once, for every query in the application.
 *
 * The alternative — writing `where: { organizationId }` by hand in each service
 * method — means a single forgotten clause is a cross-tenant data leak. Doing it
 * in the extension makes isolation a property of the data layer rather than a
 * rule developers must remember.
 *
 * When no tenant context is active (login, webhooks, platform admin) queries
 * pass through untouched, which is why those paths use `prismaUnscoped`
 * explicitly and are the only places allowed to see across organizations.
 */
const prisma = base.$extends({
    name: "tenantIsolation",
    query: {
        $allModels: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async $allOperations({ model, operation, args, query }: any) {
                const store = getTenantStore();

                if (!store) {
                    return query(args);
                }

                const field = scopeFieldFor(model);

                if (!field) {
                    return query(args);
                }

                const orgId = store.organizationId;
                const scoped = { ...(args ?? {}) };

                // Constrain reads, updates and deletes. Prisma's WhereUniqueInput
                // accepts non-unique filters alongside the unique key, so this is
                // safe for findUnique/update/delete as well as findMany.
                //
                // Combined with AND rather than assigned, so a caller's own filter
                // on the same field is narrowed instead of replaced. Overwriting
                // would turn "fetch organization X" into "fetch my organization",
                // quietly answering a different question than the one asked.
                if (WHERE_OPERATIONS.has(operation)) {
                    const existing = scoped.where?.AND;
                    const preserved = Array.isArray(existing) ? existing : existing ? [existing] : [];

                    scoped.where = {
                        ...(scoped.where ?? {}),
                        AND: [...preserved, { [field]: orgId }],
                    };
                }

                // Force writes to land in the caller's own organization, so a
                // forged organizationId in a request body cannot plant a row in
                // someone else's tenant.
                if (CREATE_OPERATIONS.has(operation)) {
                    if (operation === "createMany") {
                        const rows = Array.isArray(scoped.data) ? scoped.data : [scoped.data];
                        scoped.data = rows.map((row: Record<string, unknown>) => ({
                            ...row,
                            [field]: orgId,
                        }));
                    } else if (operation === "upsert") {
                        scoped.create = { ...(scoped.create ?? {}), [field]: orgId };
                    } else {
                        scoped.data = { ...(scoped.data ?? {}), [field]: orgId };
                    }
                }

                return query(scoped);
            },
        },
    },
});

export default prisma;
