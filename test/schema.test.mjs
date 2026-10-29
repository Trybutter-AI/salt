/**
 * Schema integrity.
 *
 * `ensureSchema()` is not ordinary startup code: the marketplace index calls
 * it on every render, so anything it rejects is a 500 on the buyer-facing
 * page rather than a failed deploy. It also runs against a database this repo
 * shares with the seller app, which owns most of these tables and changes
 * them on its own schedule. That combination has already taken production
 * down once — the seller app made `providers.email` nullable for phone
 * sign-in, and the personal-org backfill named each org after the email local
 * part into a NOT NULL column.
 *
 * So these tests do not check that the migration is *correct*. They check
 * that it still runs, and still leaves the index's query working, against a
 * database holding the kinds of rows the seller app actually writes.
 *
 * Requires a throwaway Postgres in `DATABASE_URL`. Every test drops and
 * recreates the public schema, so the name has to look like a test database.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

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

/* Imported after the guard so nothing connects to a database we just refused,
   and as `.ts` because Node strips the types directly — the app has no build
   step for anything outside Next. */
const { ensureSchema, sql } = await import("../lib/db.ts");

/** The migration caches its own promise, so a re-run needs the cache cleared. */
async function runEnsureSchema() {
  globalThis.__butterSchemaReady = null;
  await ensureSchema();
}

beforeEach(async () => {
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  globalThis.__butterSchemaReady = null;
});

/**
 * What the seller app has done to the tables it shares with us. Kept as a
 * list of statements rather than a copy of its migration because the point is
 * the *shape* we have to tolerate, not its exact history: columns we never
 * declared, and constraints it has relaxed from under us.
 */
async function applySellerAppDrift() {
  await sql.unsafe(`
    ALTER TABLE providers ALTER COLUMN email DROP NOT NULL;
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS apple_id TEXT;
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS legal_name TEXT;
  `);
}

test("runs against an empty database", async () => {
  await runEnsureSchema();

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('providers', 'listings', 'organizations')
  `;
  assert.equal(count, 3, "expected the core tables to exist after the migration");
});

test("runs twice without drifting", async () => {
  await runEnsureSchema();
  await runEnsureSchema();
});

/**
 * The regression that took the index down. Each of these is an account the
 * seller app creates with no email address at all: `findOrCreateProviderByPhone`
 * writes a number and nothing else, and Sign in with Apple does the same
 * whenever Apple declines to vouch for an address. Neither writes an
 * `organization_members` row, which is exactly what the backfill looks for.
 */
test("runs with providers the seller app created without an email", async () => {
  await runEnsureSchema();
  await applySellerAppDrift();

  await sql`INSERT INTO providers (phone, provider_type) VALUES ('+15555550100', 'individual')`;
  await sql`INSERT INTO providers (apple_id, provider_type) VALUES ('apple-000', 'individual')`;
  await sql`INSERT INTO providers (email, provider_type) VALUES ('zoe@trybutter.ai', 'individual')`;

  await runEnsureSchema();
});

test("gives every provider exactly one organization with a usable name", async () => {
  await runEnsureSchema();
  await applySellerAppDrift();

  await sql`INSERT INTO providers (phone, provider_type) VALUES ('+15555550100', 'individual')`;
  await sql`INSERT INTO providers (apple_id, provider_type) VALUES ('apple-000', 'individual')`;
  await sql`INSERT INTO providers (email, provider_type) VALUES ('zoe@trybutter.ai', 'individual')`;
  /* An empty string is not NULL, so it slips past a plain NOT NULL check and
     would leave an org labelled with nothing at all in the seller portal. */
  await sql`INSERT INTO providers (email, provider_type) VALUES ('', 'individual')`;

  await runEnsureSchema();

  const orphaned = await sql`
    SELECT pr.id FROM providers pr
    LEFT JOIN organization_members m ON m.provider_id = pr.id
    WHERE m.id IS NULL
  `;
  assert.equal(orphaned.length, 0, "every provider should have been given an organization");

  const unnamed = await sql`
    SELECT o.id, o.name FROM organizations o WHERE o.name IS NULL OR btrim(o.name) = ''
  `;
  assert.equal(unnamed.length, 0, "every organization should have a non-empty name");

  const [{ named }] = await sql`
    SELECT count(*)::int AS named FROM organizations WHERE name = 'zoe'
  `;
  assert.equal(named, 1, "a provider with an email should still be named after it");
});

/**
 * The migration succeeding is only half of it — the index still has to be able
 * to read. This is the query `getApprovedListings` issues, and it is written
 * out rather than imported because `lib/listings.ts` pulls in `server-only`,
 * which Next resolves through its bundler and plain Node cannot load.
 */
test("leaves the marketplace index query runnable", async () => {
  await runEnsureSchema();
  await applySellerAppDrift();

  const rows = await sql`
    SELECT
      id, title, category, summary,
      asking_price_cents AS "askingPriceCents",
      parameters, status,
      created_at AS "createdAt"
    FROM listings
    WHERE status = 'approved'
    ORDER BY created_at DESC
  `;
  assert.ok(Array.isArray(rows));
});
