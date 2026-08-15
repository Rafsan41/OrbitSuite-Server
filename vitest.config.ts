import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // These tests hit a real database; running files in parallel would let
        // them clobber each other's fixtures.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
