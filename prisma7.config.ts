import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * `dotenv` is a runtime dependency on purpose. Prisma loads this file on every
 * command — including the ones a host runs during the build (`prisma generate`
 * via postinstall, `prisma migrate deploy`). When a platform installs with
 * NODE_ENV=production, devDependencies are skipped, and a dotenv that only
 * lived in devDependencies made this file fail to load with
 * "Cannot find module 'dotenv/config'", taking the whole build down.
 *
 * dotenv is a no-op when there is no .env file, which is the normal case on a
 * host: the environment variables come from the platform's own settings.
 */
loadDotenv({ quiet: true });

/**
 * Fallback keeps the failure legible. On a host without DATABASE_URL the
 * platform usually mounts a disk and points the variable at it; without this
 * fallback Prisma would instead complain about a `file:./undefined` path, which
 * sends you looking in the wrong place.
 */
const DEFAULT_SQLITE_URL = "file:./prisma/dev.db";

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;

  console.warn(
    "[prisma] DATABASE_URL is not set — falling back to " +
      `${DEFAULT_SQLITE_URL}. On a host with a disk, set DATABASE_URL to the ` +
      "absolute path of the mounted volume, otherwise data is lost on redeploy.",
  );
  return DEFAULT_SQLITE_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
