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

  /* Scoped to the address that signed up, because the migrations seed a
     buyer of their own (Memories.ai) and this test is about the signup. */
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM buyers WHERE lower(email) = 'zoe@trybutter.ai'
  `;
  assert.equal(count, 1);
});

/**
 * The buyer the seller app seeds and this app gives a login to. Both halves
 * of the shared `buyers` row have to be there: the name the seller app
 * points assignments at, and the user id and password the portal signs in.
 */
test("seeds the Memories.ai buyer with a user id it can sign in with", async () => {
  await migrate();

  const [buyer] = await sql`
    SELECT name, username, status, password_hash AS "passwordHash"
    FROM buyers WHERE lower(username) = 'memories_ai_admin'
  `;

  assert.equal(buyer.name, "Memories.ai");
  assert.equal(buyer.status, "approved", "a status other than approved cannot sign in");
  assert.match(buyer.passwordHash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
});

/** An account signing in by user id has no address, so one can't be required. */
test("allows a buyer with a user id and no email", async () => {
  await migrate();

  await sql`
    INSERT INTO buyers (username, password_hash, name, status)
    VALUES ('lab_admin', 'scrypt$aa$bb', 'Some Lab', 'approved')
  `;

  const [row] = await sql`SELECT email FROM buyers WHERE username = 'lab_admin'`;
  assert.equal(row.email, null);
});

/** Two accounts may not differ only by the capitalisation of the user id. */
test("refuses a second account with the same user id", async () => {
  await migrate();

  await sql`
    INSERT INTO buyers (username, password_hash, name) VALUES ('dup', 'scrypt$aa$bb', 'First')
  `;
  await assert.rejects(
    sql`INSERT INTO buyers (username, password_hash, name) VALUES ('DUP', 'scrypt$aa$bb', 'Second')`,
    /duplicate key/
  );
});

/**
 * The buyer portal's own reads, against the seller app's tables.
 *
 * Written out rather than imported for the reason given above — `lib/footage.ts`
 * pulls in `server-only`. They mirror that file; if the two drift, this test
 * stops proving anything about the real query, so change both together.
 */
async function seedFootage() {
  await createExternalTables();

  const [buyer] = await sql`
    SELECT id FROM buyers WHERE lower(username) = 'memories_ai_admin'
  `;
  const [other] = await sql`
    INSERT INTO buyers (username, password_hash, name, status)
    VALUES ('other_lab', 'scrypt$aa$bb', 'Other Lab', 'approved')
    RETURNING id
  `;
  const [org] = await sql`INSERT INTO organizations (name) VALUES ('Crew') RETURNING id`;
  const [site] = await sql`
    INSERT INTO sites (org_id, site_code, description, site_category, city, country)
    VALUES (${org.id}, 'FS-014', 'Bay 2 packing line', 'S26', 'Nairobi', 'KE')
    RETURNING id
  `;
  const [mine] = await sql`
    INSERT INTO assignments (org_id, buyer_id, site_id, task, spec, duration_minutes)
    VALUES (${org.id}, ${buyer.id}, ${site.id}, 'Pack cartons', 'Two hands in frame', 12)
    RETURNING id
  `;
  /* One for another buyer and one for nobody: neither may ever show up. */
  const [theirs] = await sql`
    INSERT INTO assignments (org_id, buyer_id, task) VALUES (${org.id}, ${other.id}, 'Theirs')
    RETURNING id
  `;
  await sql`INSERT INTO assignments (org_id, task) VALUES (${org.id}, 'Self-initiated')`;

  const [episode] = await sql`
    INSERT INTO data_episodes (org_id, assignment_id, capture_id, recorded_at)
    VALUES (${org.id}, ${mine.id}, 'EP-7K2M', now())
    RETURNING id
  `;
  const [clean] = await sql`
    INSERT INTO data_files
      (org_id, episode_id, object_key, filename, size_bytes, content_type,
       duration_seconds, modalities, scan_status)
    VALUES (${org.id}, ${episode.id}, 'keys/video.mp4', 'video.mp4', 842000000,
            'video/mp4', 750, ARRAY['video'], 'clean')
    RETURNING id
  `;
  const [pending] = await sql`
    INSERT INTO data_files
      (org_id, episode_id, object_key, filename, size_bytes, content_type, scan_status)
    VALUES (${org.id}, ${episode.id}, 'keys/motion.csv', 'motion.csv', 3100000,
            'text/csv', 'pending')
    RETURNING id
  `;

  return { buyerId: buyer.id, otherBuyerId: other.id, mine: mine.id, theirs: theirs.id, clean: clean.id, pending: pending.id };
}

/** Mirrors `listBuyerAssignments`. */
function listAssignments(buyerId) {
  return sql`
    SELECT
      a.id, a.task, a.spec, a.status,
      a.duration_minutes AS "durationMinutes",
      a.video, a.sound, a.location,
      a.due_at AS "dueAt", a.created_at AS "createdAt",
      s.site_code AS "siteCode", s.description AS "siteDescription",
      s.site_category AS "siteCategory", s.address, s.city,
      s.state_or_province AS "stateOrProvince", s.country,
      s.business_legal_name AS "businessLegalName", s.headcount,
      totals.episodes, totals.files, totals."durationSeconds", totals."sizeBytes"
    FROM assignments a
    LEFT JOIN sites s ON s.id = a.site_id
    CROSS JOIN LATERAL (
      SELECT
        count(DISTINCT f.episode_id)::int AS episodes,
        count(f.id)::int AS files,
        COALESCE(sum(f.duration_seconds), 0)::int AS "durationSeconds",
        COALESCE(sum(f.size_bytes), 0) AS "sizeBytes"
      FROM data_files f
      LEFT JOIN data_episodes e ON e.id = f.episode_id
      WHERE COALESCE(e.assignment_id, f.assignment_id) = a.id
    ) totals
    WHERE a.buyer_id = ${buyerId}
    ORDER BY a.created_at DESC, a.id DESC
  `;
}

/** Mirrors `getBuyerFootageObject`. */
function footageObject(buyerId, fileId) {
  return sql`
    SELECT f.object_key AS "objectKey", f.filename, f.content_type AS "contentType"
    FROM data_files f
    LEFT JOIN data_episodes e ON e.id = f.episode_id
    JOIN assignments a ON a.id = COALESCE(e.assignment_id, f.assignment_id)
    WHERE f.id = ${fileId} AND a.buyer_id = ${buyerId} AND f.scan_status = 'clean'
    LIMIT 1
  `;
}

test("lists a buyer's assignments with their site and footage totals", async () => {
  await migrate();
  const seeded = await seedFootage();

  const rows = await listAssignments(seeded.buyerId);

  assert.equal(rows.length, 1, "only the assignment collecting for this buyer");
  const [row] = rows;
  assert.equal(row.task, "Pack cartons");
  assert.equal(row.siteCode, "FS-014");
  assert.equal(row.siteCategory, "S26");
  assert.equal(row.city, "Nairobi");
  assert.equal(row.episodes, 1);
  assert.equal(row.files, 2, "every file, whatever the sweep has said");
  assert.equal(row.durationSeconds, 750);
  assert.equal(Number(row.sizeBytes), 845100000);
});

/**
 * An assignment with nothing recorded yet still has to be listed — it is how
 * a buyer sees that work has been set up at all.
 */
test("lists an assignment with no footage against it", async () => {
  await migrate();
  const seeded = await seedFootage();

  await sql`
    INSERT INTO assignments (org_id, buyer_id, task)
    SELECT org_id, ${seeded.buyerId}, 'Nothing yet' FROM assignments WHERE id = ${seeded.mine}
  `;

  const rows = await listAssignments(seeded.buyerId);
  const empty = rows.find((r) => r.task === "Nothing yet");
  assert.ok(empty, "an assignment with no episodes should still appear");
  assert.equal(empty.episodes, 0);
  assert.equal(empty.files, 0);
  assert.equal(Number(empty.sizeBytes), 0);
});

test("hands out an object key only for a clean file on the buyer's own assignment", async () => {
  await migrate();
  const seeded = await seedFootage();

  const [ok] = await footageObject(seeded.buyerId, seeded.clean);
  assert.equal(ok.objectKey, "keys/video.mp4");

  assert.equal(
    (await footageObject(seeded.buyerId, seeded.pending)).length,
    0,
    "a file the malware sweep has not passed has no key to hand back"
  );
  assert.equal(
    (await footageObject(seeded.otherBuyerId, seeded.clean)).length,
    0,
    "another buyer's footage is not theirs to read"
  );
});
