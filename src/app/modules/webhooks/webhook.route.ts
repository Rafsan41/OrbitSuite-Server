import express, { Request, Response, Router } from "express";
import { constructWebhookEvent } from "../../lib/stripe.js";
import { handleStripeEvent } from "./stripe.handler.js";

const router = Router();

/**
 * express.raw is mandatory here. Stripe signs the exact bytes it sent, so the
 * body must reach constructEvent unparsed — running express.json() first would
 * make every signature check fail.
 */
router.post(
    "/stripe",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
        const signature = req.headers["stripe-signature"];

        if (typeof signature !== "string") {
            return res.status(400).json({
                success: false,
                message: "Missing Stripe signature header",
                data: null,
            });
        }

        let event;

        try {
            event = constructWebhookEvent(req.body as Buffer, signature);
        } catch (error) {
            // An unverified payload is not from Stripe. 400 without detail.
            console.error("Stripe signature verification failed:", error);
            return res.status(400).json({
                success: false,
                message: "Webhook signature verification failed",
                data: null,
            });
        }

        try {
            const outcome = await handleStripeEvent(event);
            return res.status(200).json({ success: true, message: outcome.status, data: outcome });
        } catch (error) {
            // 500 makes Stripe retry with backoff. The transaction rolled back,
            // so the retry starts from a clean state.
            console.error(`Failed to process Stripe event ${event.id}:`, error);
            return res.status(500).json({
                success: false,
                message: "Webhook processing failed",
                data: null,
            });
        }
    },
);

export const WebhookRoutes = router;
