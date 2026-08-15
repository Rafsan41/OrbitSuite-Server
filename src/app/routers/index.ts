import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.route.js";
import { CheckoutRoutes } from "../modules/checkout/checkout.route.js";
import { PlanRoutes } from "../modules/plans/plan.route.js";
import { OrganizationRoutes } from "../modules/organizations/organization.route.js";

const router = Router();

// Single place to register feature routers. Adding a module means adding one
// row here — app.ts never changes.
const moduleRoutes: { path: string; route: Router }[] = [
    { path: "/auth", route: AuthRoutes },
    { path: "/checkout", route: CheckoutRoutes },
    { path: "/plans", route: PlanRoutes },
    { path: "/organizations", route: OrganizationRoutes },
    // NOTE: /webhooks is mounted directly in app.ts, above express.json().
    // { path: "/users", route: UserRoutes },
    // { path: "/plans", route: PlanRoutes },
    // { path: "/subscriptions", route: SubscriptionRoutes },
    // { path: "/payments", route: PaymentRoutes },
    // { path: "/transactions", route: TransactionRoutes },
];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export const IndexRoutes = router;
