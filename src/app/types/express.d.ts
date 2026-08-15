import type { AuthTokenPayload } from "../utils/jwt.js";

// Populated by requireAuth. Every downstream handler and the tenant-scoping
// middleware read the caller's identity from here.
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthTokenPayload;
        }
    }
}

export {};
