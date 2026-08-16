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
import app from "../dist-vercel/index.js";

export default app;
