import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

dotenv.config();

// Prisma 7's client generator needs an explicit driver adapter rather than
// reading DATABASE_URL implicitly — this wires it to your Postgres URL.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Single shared instance — import this everywhere instead of creating new
// PrismaClient() per file, so you don't exhaust your DB connection pool.
const prisma = new PrismaClient({ adapter });

export default prisma;
