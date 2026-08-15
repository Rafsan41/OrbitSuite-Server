import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // These tests hit a real database; running files in parallel would let
        // them clobber each other's fixtures.
        fileParallelism: false,
        // Generous because these are integration tests against a hosted Postgres:
        // every statement is a network round trip, and the webhook cases run
        // multi-statement transactions twice over to prove idempotency.
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
