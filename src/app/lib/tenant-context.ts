import { AsyncLocalStorage } from "node:async_hooks";
import type { UserRole } from "../../generated/prisma/enums.js";

export type TenantStore = {
    organizationId: string;
    role: UserRole;
};

// AsyncLocalStorage carries the caller's organization through the whole async
// call chain of a request, so the Prisma extension can read it without every
// service function having to thread an orgId parameter down to each query.
//
// Pinned to globalThis deliberately. Test runners and dev-time hot reloading can
// evaluate a module more than once; a second AsyncLocalStorage instance would
// mean the middleware writes to one store while the Prisma extension reads
// another — silently disabling isolation. One instance per process, always.
const globalRef = globalThis as typeof globalThis & {
    __orbitsuiteTenantStorage?: AsyncLocalStorage<TenantStore>;
};

const storage =
    globalRef.__orbitsuiteTenantStorage ??
    (globalRef.__orbitsuiteTenantStorage = new AsyncLocalStorage<TenantStore>());

/**
 * Runs `fn` — and everything it awaits — scoped to one organization.
 *
 * IMPORTANT: Prisma methods return a lazy PrismaPromise; the query, and with it
 * the tenant-scoping extension, executes on await rather than on call. A callback
 * that *returns* a PrismaPromise without awaiting it hands back an unexecuted
 * query, which then runs in whatever context awaited it — silently unscoped.
 * Awaiting inside `storage.run` here makes that mistake impossible.
 *
 * In Express this is moot: the entire request chain descends from the call
 * inside run(), so every query it makes inherits the context either way.
 */
export const runWithTenant = <T>(
    store: TenantStore,
    fn: () => T | Promise<T>,
): Promise<T> => storage.run(store, async () => await fn());

/**
 * Synchronous variant for middleware, where `next()` returns nothing and the
 * request chain continues inside the opened scope.
 */
export const runWithTenantSync = (store: TenantStore, fn: () => void): void =>
    storage.run(store, fn);

export const getTenantStore = (): TenantStore | undefined => storage.getStore();

/**
 * Escape hatch for work that legitimately spans tenants: Stripe webhooks,
 * login (which looks up a user before any organization is known), and the
 * seed script. Prefer `prismaUnscoped` for those instead of calling this.
 */
export const runWithoutTenant = <T>(fn: () => T): T =>
    storage.exit(fn);
