#!/usr/bin/env node
/**
 * Applies the SQL files in `migrations/` once each, in filename order.
 *
 * This runs as Railway's pre-deploy command, so a statement that fails fails
 * the deploy and the running version keeps serving. It used to run inside
 * `ensureSchema()` on every render of the marketplace index, where the same
 * failure was a 500 on a buyer-facing page.
 *
 * Only tables this app owns belong here — `buyer_interest`, `buyers`,
 * `buyer_sessions`. Everything else it reads (`providers`, `provider_sessions`,
 * `listings`) belongs to the seller app, which creates and migrates them.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/* Any constant will do, as long as every deploy uses the same one: the point
   is that two instances starting together queue instead of racing. */
const LOCK_KEY = 827344510;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
  /* Nearly every statement is an IF NOT EXISTS, and the skipped-object
     notices bury anything worth reading in the deploy log. */
  onnotice: () => {},
});

try {
  /* Taken before the bookkeeping table is created: two instances doing that
     at the same moment is itself a race worth closing. */
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((row) => row.name)
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");

    /* One transaction per file, with the bookkeeping row written inside it,
       so a migration can never be recorded as applied unless it was. */
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });

    console.log(`migrate: applied ${file}`);
    count += 1;
  }

  console.log(
    count === 0
      ? `migrate: nothing to do (${files.length} already applied)`
      : `migrate: applied ${count} of ${files.length}`
  );
} catch (err) {
  console.error("migrate: failed —", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  /* The lock would go with the connection anyway; released explicitly so the
     intent survives someone adding a reconnect here later. */
  await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
  await sql.end();
}
