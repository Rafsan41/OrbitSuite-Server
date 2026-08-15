import Stripe from "stripe";
import { requireStripeSecretKey, requireStripeWebhookSecret } from "../config/env.js";

let client: Stripe | null = null;

// Constructed lazily so the server still boots without Stripe configured —
// only the payment routes fail, and with a clear message.
export const getStripe = (): Stripe => {
    if (!client) {
        // Pinned rather than floating, so a Stripe-side release cannot change
        // payload shapes under us. Must match the installed SDK's version.
        client = new Stripe(requireStripeSecretKey(), { apiVersion: "2026-07-29.dahlia" });
    }
    return client;
};

/**
 * Verifies that a webhook really came from Stripe. Requires the exact bytes
 * Stripe signed — the route must therefore use express.raw(), because a
 * JSON-parsed and re-serialised body will not match the signature.
 */
export const constructWebhookEvent = (payload: Buffer, signature: string): Stripe.Event =>
    getStripe().webhooks.constructEvent(payload, signature, requireStripeWebhookSecret());

export type PlanPriceInput = {
    /** Stable per-plan key, so re-running setup reuses the price instead of duplicating it. */
    lookupKey: string;
    name: string;
    description?: string;
    priceCents: number;
    billingInterval: "MONTH" | "YEAR";
};

/**
 * Returns the Stripe Price id for a plan, creating the product and recurring
 * price on first use.
 *
 * Idempotent via lookup_key: Stripe enforces uniqueness per account, so seeding
 * repeatedly — or an admin re-saving a plan — reuses the existing price rather
 * than littering the account with duplicates.
 *
 * Prices are immutable in Stripe, so changing a plan's amount means creating a
 * new price; existing subscribers keep billing at the price they signed up on.
 */
export const upsertPlanPrice = async (input: PlanPriceInput): Promise<string> => {
    const stripe = getStripe();

    const existing = await stripe.prices.list({
        lookup_keys: [input.lookupKey],
        active: true,
        limit: 1,
    });

    if (existing.data[0]) {
        return existing.data[0].id;
    }

    const price = await stripe.prices.create({
        currency: "usd",
        unit_amount: input.priceCents,
        recurring: { interval: input.billingInterval === "YEAR" ? "year" : "month" },
        lookup_key: input.lookupKey,
        // Creates the Product inline. Checkout shows this name to the customer.
        product_data: { name: input.name },
    });

    return price.id;
};
