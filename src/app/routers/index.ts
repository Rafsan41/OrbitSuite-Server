import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.route.js";
import { CheckoutRoutes } from "../modules/checkout/checkout.route.js";
import { PlanRoutes } from "../modules/plans/plan.route.js";
import { OrganizationRoutes } from "../modules/organizations/organization.route.js";
import { UserRoutes } from "../modules/users/user.route.js";
import { SubscriptionRoutes } from "../modules/subscriptions/subscription.route.js";
import { TransactionRoutes } from "../modules/transactions/transaction.route.js";
import { PaymentRoutes } from "../modules/payments/payment.route.js";
import { StatsRoutes } from "../modules/stats/stats.route.js";
import { DevRoutes } from "../modules/dev/dev.route.js";
import { env } from "../config/env.js";

const router = Router();

// Single place to register feature routers. Adding a module means adding one
// row here — app.ts never changes.
const moduleRoutes: { path: string; route: Router }[] = [
    { path: "/auth", route: AuthRoutes },
    { path: "/checkout", route: CheckoutRoutes },
    { path: "/plans", route: PlanRoutes },
    { path: "/organizations", route: OrganizationRoutes },
    { path: "/users", route: UserRoutes },
    { path: "/subscriptions", route: SubscriptionRoutes },
    { path: "/transactions", route: TransactionRoutes },
    { path: "/payments", route: PaymentRoutes },
    { path: "/stats", route: StatsRoutes },
    // NOTE: /webhooks is mounted directly in app.ts, above express.json().
];

// The reseed helper erases every table, so it is not merely guarded — outside
// development it is never registered, and the path 404s like any unknown route.
if (env.NODE_ENV === "development") {
    moduleRoutes.push({ path: "/dev", route: DevRoutes });
}

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export const IndexRoutes = router;
