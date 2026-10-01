import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires an explicit driver adapter — there is no bundled engine.
 * The SQLite adapter reads the same `DATABASE_URL` the Prisma CLI uses, so the
 * CLI and the app stay pointed at one dev.db.
 */
function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env (see .env.example) before using Prisma.",
    );
  }

  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

/**
 * Cached on globalThis so `next dev` hot reloads reuse one connection instead
 * of leaking a new SQLite handle on every edit.
 */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
