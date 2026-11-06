import postgres from "postgres";

/**
 * Singleton Postgres client.
 *
 * - In production on Railway, the Postgres add-on injects `DATABASE_URL`.
 * - In local dev without `DATABASE_URL`, this exports `null` and callers
 *   should fall back to their dev-only persistence path.
 *
 * We cache the client on `globalThis` so Next.js's dev-server module
 * reloading doesn't leak connections.
 *
 * This module creates and alters nothing. The schema is applied by
 * `scripts/migrate.mjs`, which Railway runs as the pre-deploy command — see
 * `migrations/`. It used to be applied by an `ensureSchema()` that every
 * request awaited, so DDL ran on a buyer's page load, two instances booting
 * together raced each other over the same backfill, and a statement the
 * database rejected was a 500 on the marketplace index rather than a failed
 * deploy. The last of those is how it was found.
 *
 * Only `buyer_interest`, `buyers` and `buyer_sessions` belong to this app.
 * `providers`, `provider_sessions` and `listings` belong to the seller app,
 * which creates and migrates them; here they are read and nothing more.
 */
declare global {
  // eslint-disable-next-line no-var
  var __butterSql: postgres.Sql | null | undefined;
}

function useSsl(url: string): false | "require" {
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return "require";
}

function createClient(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    ssl: useSsl(url),
  });
}

export const sql: postgres.Sql | null =
  globalThis.__butterSql ?? createClient();
if (sql && !globalThis.__butterSql) globalThis.__butterSql = sql;
