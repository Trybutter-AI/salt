/**
 * Schema integrity.
 *
 * The schema used to be applied by an `ensureSchema()` that every request
 * awaited. That put DDL on a buyer-facing page load, let two instances race
 * each other over the same backfill, and turned a statement the database
 * rejected into a 500 on the marketplace index instead of a failed deploy.
 * It is now `scripts/migrate.mjs`, run once as Railway's pre-deploy command.
 *
 * So these tests cover the two halves of that: the migrations apply cleanly
 * and repeatably, and the app no longer carries any DDL to run at all.
 *
 * Requires a throwaway Postgres in `DATABASE_URL`. Every test drops and
 * recreates the public schema, so the name has to look like a test database.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, beforeEach, test } from "node:test";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required. Point it at a throwaway Postgres — these tests drop the public schema."
  );
}

/* These tests are destructive, and `npm test` picks up whatever is already in
   the environment, which on a developer's machine is just as likely to be the
   dev database as a scratch one. A production URL has reached a shell this
   way before. Refuse anything that isn't named like a test database. */
const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
if (!/test/i.test(databaseName)) {
  throw new Error(
    `Refusing to run: DATABASE_URL points at "${databaseName}", which is not named like a test ` +
      `database. These tests drop the public schema. Use a database with "test" in its name.`
  );
}

const sql = postgres(url, {
  max: 1,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
  onnotice: () => {},
});

/** Runs the real migration script, the way the deploy does. */
async function migrate() {
  return execFileAsync("node", [path.join(ROOT, "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL: url },
  });
}

/** The tables the seller app owns and this app only reads. */
async function createExternalTables() {
  const fixture = await readFile(path.join(ROOT, "test", "fixtures", "external-tables.sql"), "utf8");
  await sql.unsafe(fixture);
}

beforeEach(async () => {
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});

/* Without this the pooled connection keeps the event loop alive and the
   runner hangs after the last assertion instead of exiting. */
after(async () => {
  await sql.end();
});

test("applies to an empty database", async () => {
  await migrate();

  const tables = (
    await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `
  ).map((r) => r.table_name);

  assert.deepEqual(tables, [
    "buyer_interest",
    "buyer_sessions",
    "buyers",
    "schema_migrations",
  ]);
});

/**
 * The point of a migration step over the old boot-time DDL: each file is
 * applied once and recorded, so a second deploy is a no-op rather than a
 * re-run of every statement against the live database.
 */
test("applies each migration exactly once", async () => {
  await migrate();
  const first = await sql`SELECT name, applied_at FROM schema_migrations ORDER BY name`;

  const { stdout } = await migrate();
  const second = await sql`SELECT name, applied_at FROM schema_migrations ORDER BY name`;

  assert.match(stdout, /nothing to do/);
  assert.deepEqual(
    second.map((r) => r.applied_at.toISOString()),
    first.map((r) => r.applied_at.toISOString()),
    "a second run should not have re-applied anything"
  );

  const files = (await readdir(path.join(ROOT, "migrations"))).filter((f) => f.endsWith(".sql"));
  assert.equal(first.length, files.length, "every migration file should be recorded");
});

/**
 * Production already has these tables — they were created by the old
 * `ensureSchema()` long before `schema_migrations` existed. The first real
 * run of this script happens against that database, not an empty one.
 */
test("applies to a database that already has the tables", async () => {
  const dir = path.join(ROOT, "migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(await readFile(path.join(dir, file), "utf8"));
  }

  await migrate();

  const [{ count }] = await sql`SELECT count(*)::int AS count FROM schema_migrations`;
  assert.ok(count > 0, "migrations should have been recorded against the existing schema");
});

/**
 * The regression guard for the outage itself. Nothing the app imports at
 * request time may carry DDL: if it does, it runs on somebody's page load
 * again, and the next schema mistake is a 500 rather than a red deploy.
 */
test("the app carries no DDL", async () => {
  const offenders = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;

      const source = await readFile(full, "utf8");
      /* Comments discuss the DDL that used to be here, so they are stripped
         before looking. Only whole-line `//` is removed, to avoid cutting a
         line short at the `//` inside a URL. */
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      const match = code.match(/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|CONSTRAINT|COLUMN|SCHEMA)\b/i);
      if (match) offenders.push(`${path.relative(ROOT, full)}: ${match[0]}`);
    }
  }

  await walk(path.join(ROOT, "lib"));
  await walk(path.join(ROOT, "app"));

  assert.deepEqual(
    offenders,
    [],
    "DDL belongs in migrations/, not in code the request path imports"
  );
});

/**
 * The migration succeeding is only half of it — the pages still have to be
 * able to read. These are the queries the app issues, written out rather than
 * imported because `lib/listings.ts` and `lib/buyer-auth.ts` pull in
 * `server-only`, which Next resolves through its bundler and plain Node
 * cannot load.
 */
test("leaves the app's own queries runnable", async () => {
  await migrate();
  await createExternalTables();

  const listings = await sql`
    SELECT
      id, title, category, summary,
      asking_price_cents AS "askingPriceCents",
      parameters, status,
      created_at AS "createdAt"
    FROM listings
    WHERE status = 'approved'
    ORDER BY created_at DESC
  `;
  assert.ok(Array.isArray(listings));

  const session = await sql`
    SELECT b.id AS "buyerId", b.email, b.name, b.company_name AS "companyName", b.status
    FROM buyer_sessions s
    JOIN buyers b ON b.id = s.buyer_id
    WHERE s.token_hash = ${"nonexistent"} AND s.expires_at > now()
    LIMIT 1
  `;
  assert.equal(session.length, 0);

  const provider = await sql`
    SELECT p.id AS "providerId", p.email
    FROM provider_sessions s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.token_hash = ${"nonexistent"} AND s.expires_at > now()
    LIMIT 1
  `;
  assert.equal(provider.length, 0);
});

/**
 * A buyer signing up has to survive the seller app's accounts existing
 * alongside, including the email-less ones that broke the old backfill.
 */
test("accepts a buyer signup alongside email-less provider accounts", async () => {
  await migrate();
  await createExternalTables();

  await sql`INSERT INTO providers (phone, provider_type) VALUES ('+15555550100', 'individual')`;
  await sql`INSERT INTO providers (apple_id, provider_type) VALUES ('apple-000', 'individual')`;

  const [interest] = await sql`
    INSERT INTO buyer_interest (name, email, use_case)
    VALUES ('Zoe', 'zoe@trybutter.ai', 'evaluating')
    RETURNING id
  `;
  await sql`
    INSERT INTO buyers (email, password_hash, name, interest_id)
    VALUES ('zoe@trybutter.ai', 'hash', 'Zoe', ${interest.id})
  `;

  const [{ count }] = await sql`SELECT count(*)::int AS count FROM buyers`;
  assert.equal(count, 1);
});
