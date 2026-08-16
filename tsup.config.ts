import { defineConfig } from "tsup";

/**
 * Bundles the Express app into one file for the Vercel serverless function.
 *
 * The plain `tsc` build in `dist/` stays exactly as it is and remains what
 * `npm start` runs. This is a second, separate output that exists for one
 * reason: `moduleResolution: NodeNext` makes every relative import carry a
 * `.js` suffix that points at a `.ts` file on disk, and a platform bundler has
 * to be told how to resolve that. Handing it a single pre-bundled file removes
 * the question entirely, and a serverless cold start opens one file instead of
 * walking a tree of them.
 *
 * Dependencies stay external — tsup's default, and load-bearing here:
 *   - @node-rs/argon2 is a native .node addon and cannot be bundled at all
 *   - pdfkit reads .afm font metrics from disk at runtime, which bundling breaks
 */
export default defineConfig({
    entry: { index: "src/app.ts" },
    outDir: "dist-vercel",
    format: ["esm"],
    // Matches the `target` in tsconfig.json and the Node version pinned in CI.
    target: "node22",
    platform: "node",
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    // Types are checked by `tsc --noEmit` in CI; asking tsup to emit them here
    // would only duplicate that work and slow the build.
    dts: false,
});
