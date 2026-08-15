/**
 * `npm run seed` entry point.
 *
 * The seed itself lives in src/app/lib/seed.ts so the dev-only reseed route can
 * import it — anything under prisma/ is outside tsconfig's rootDir and cannot be
 * imported from src. This file is only the script wrapper: run it, report, exit.
 */
import { disconnectSeedClient, seedDatabase } from "../src/app/lib/seed.js";

seedDatabase()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(disconnectSeedClient);
