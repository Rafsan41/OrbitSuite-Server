import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../dist-vercel/index.js";

/**
 * Vercel serverless entry point.
 *
 * An Express app is a request listener, so exporting it is all a Vercel Node
 * function needs — there is no `listen` here on purpose. Locally the process
 * still boots through `src/server.ts`, which is the only file that binds a port.
 *
 * The import points at the tsup bundle rather than `src/app.ts` because every
 * relative import in the source carries a `.js` suffix that resolves to a `.ts`
 * file on disk (`moduleResolution: NodeNext`). Handing the platform one
 * pre-bundled file removes that question entirely. `npm run build:vercel`
 * produces it, and vercel.json runs that as the build command.
 */

const WEBHOOK_PREFIX = "/api/v1/webhooks/";

/** body-parser marks a request it has already read; Express types omit these. */
type MaybeParsed = IncomingMessage & { body?: unknown; _body?: boolean };

/**
 * Stripe signs the exact bytes it sent, and this platform parses JSON request
 * bodies before the function runs. By the time Express gets the request the
 * stream is spent, so `express.raw()` yields nothing and every signature check
 * fails — which silently breaks payment activation, because the webhook is the
 * only thing that marks an organization paid.
 *
 * So for the webhook path only, the body is restored to a Buffer and flagged as
 * already-read, which is body-parser's own signal to skip the stream it can no
 * longer consume. Every other route keeps the normal express.json() path.
 *
 * The branches are ordered by fidelity: an untouched Buffer is exact, a string
 * is exact once encoded, and re-serialising a parsed object is the last resort —
 * it reproduces Stripe's compact JSON in practice, but it is a reconstruction
 * rather than the original bytes, which is why it comes last.
 */
const restoreRawBody = (req: MaybeParsed): void => {
    if (req.body === undefined || req.body === null) return;
    if (Buffer.isBuffer(req.body)) {
        req._body = true;
        return;
    }

    req.body =
        typeof req.body === "string"
            ? Buffer.from(req.body, "utf8")
            : Buffer.from(JSON.stringify(req.body), "utf8");
    req._body = true;
};

export default function handler(req: IncomingMessage, res: ServerResponse) {
    if (req.url?.startsWith(WEBHOOK_PREFIX)) {
        restoreRawBody(req as MaybeParsed);
    }

    return (app as unknown as (r: IncomingMessage, s: ServerResponse) => void)(req, res);
}
