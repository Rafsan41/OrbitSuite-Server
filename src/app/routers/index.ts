import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.route.js";

const router = Router();

// Single place to register feature routers. Adding a module means adding one
// row here — app.ts never changes.
const moduleRoutes: { path: string; route: Router }[] = [
    { path: "/auth", route: AuthRoutes },
    // { path: "/organizations", route: OrganizationRoutes },
    // { path: "/users", route: UserRoutes },
    // { path: "/plans", route: PlanRoutes },
    // { path: "/subscriptions", route: SubscriptionRoutes },
    // { path: "/payments", route: PaymentRoutes },
    // { path: "/transactions", route: TransactionRoutes },
];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export const IndexRoutes = router;
