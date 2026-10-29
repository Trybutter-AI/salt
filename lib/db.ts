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
 */
declare global {
  // eslint-disable-next-line no-var
  var __butterSql: postgres.Sql | null | undefined;
  // eslint-disable-next-line no-var
  var __butterSchemaReady: Promise<void> | null | undefined;
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

/**
 * Idempotently ensures all tables exist (buyer interest, buyer accounts and
 * sessions, provider accounts, kit tracking, and the org-scoped workbench:
 * assets, folders, devices, wallet). Runs once per process.
 */
export function ensureSchema(): Promise<void> {
  if (!sql) return Promise.resolve();
  if (globalThis.__butterSchemaReady) return globalThis.__butterSchemaReady;

  const ready = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS buyer_interest (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company_name TEXT,
        buyer_type TEXT CHECK (buyer_type IN ('frontier_lab', 'neo_lab', 'enterprise_other')),
        use_case TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS buyer_interest_submitted_at_idx ON buyer_interest (submitted_at DESC)
    `;
    /* Company and buyer type are no longer asked for at signup — they get
       derived from the work email domain instead — so both go nullable and
       stay unset until that detection runs. This table predates this app and
       is also written by the seller repo against the same database; dropping
       NOT NULL is safe there because nothing it inserts omits these. */
    await sql`ALTER TABLE buyer_interest ALTER COLUMN company_name DROP NOT NULL`;
    await sql`ALTER TABLE buyer_interest ALTER COLUMN buyer_type DROP NOT NULL`;

    /* ── Buyer accounts ──
       Separate from `providers`: a buyer buys data and a provider sells it,
       they sign in on different origins, and nothing about one is meaningful
       to the other. Deliberately no `google_id` column — buyer sign-in is
       email + password only for now.

       `buyer_interest` stays the pre-account record of who asked for access;
       `buyers` is the account that request turns into, and `interest_id`
       keeps the two joined so review has the use-case text to hand.

       `company_name` and `buyer_type` are nullable: signup asks for neither,
       and both are meant to be derived from the work email domain. */
    await sql`
      CREATE TABLE IF NOT EXISTS buyers (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        company_name TEXT,
        buyer_type TEXT CHECK (buyer_type IN ('frontier_lab', 'neo_lab', 'enterprise_other')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (
          status IN ('pending', 'approved', 'rejected', 'suspended')
        ),
        interest_id BIGINT REFERENCES buyer_interest(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        approved_at TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ
      )
    `;
    await sql`ALTER TABLE buyers ALTER COLUMN company_name DROP NOT NULL`;
    await sql`ALTER TABLE buyers ALTER COLUMN buyer_type DROP NOT NULL`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS buyers_email_idx ON buyers (lower(email))
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS buyers_status_created_idx ON buyers (status, created_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS buyer_sessions (
        id BIGSERIAL PRIMARY KEY,
        buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS buyer_sessions_token_hash_idx ON buyer_sessions (token_hash)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS buyer_sessions_buyer_id_idx ON buyer_sessions (buyer_id)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS providers (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        password_hash TEXT,
        google_id TEXT,
        provider_type TEXT NOT NULL CHECK (provider_type IN ('individual', 'expert')),
        expert_category TEXT CHECK (
          expert_category IS NULL OR expert_category IN
            ('cleaning', 'construction', 'warehouse', 'food_service', 'landscaping')
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      ALTER TABLE providers ALTER COLUMN password_hash DROP NOT NULL
    `;
    await sql`
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS google_id TEXT
    `;
    await sql`
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS business_description TEXT
    `;
    await sql`
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS ai_recommendations JSONB
    `;
    await sql`
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS providers_email_idx ON providers (lower(email))
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS providers_google_id_idx ON providers (google_id)
        WHERE google_id IS NOT NULL
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS provider_sessions (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_sessions_token_hash_idx ON provider_sessions (token_hash)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS provider_sessions_provider_id_idx ON provider_sessions (provider_id)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS kit_requests (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL UNIQUE REFERENCES providers(id) ON DELETE CASCADE,
        variant TEXT NOT NULL DEFAULT 'basic' CHECK (variant IN ('slam', 'basic')),
        status TEXT NOT NULL DEFAULT 'requested' CHECK (
          status IN ('requested', 'shipped', 'delivered', 'collecting', 'uploading', 'submitted')
        ),
        tracking_number TEXT,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        shipped_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      ALTER TABLE kit_requests ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'basic'
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS data_collection_progress (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL UNIQUE REFERENCES providers(id) ON DELETE CASCADE,
        hours_collected NUMERIC(10, 1) NOT NULL DEFAULT 0,
        sessions_collected INTEGER NOT NULL DEFAULT 0,
        last_upload_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS listings (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        summary TEXT NOT NULL,
        asking_price_cents INTEGER NOT NULL,
        parameters JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review' CHECK (
          status IN ('pending_review', 'approved', 'rejected')
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS listings_provider_id_idx ON listings (provider_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS listings_status_created_idx ON listings (status, created_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS data_files (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        listing_id BIGINT REFERENCES listings(id) ON DELETE CASCADE,
        object_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        content_type TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS data_files_provider_id_idx ON data_files (provider_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS data_files_listing_id_idx ON data_files (listing_id)
    `;

    /* ── Tenancy ──
       Every provider belongs to at least one organization; the org is the
       unit that owns assets, listings, devices and wallet entries. Solo
       accounts get a one-member org so there is a single code path. */
    await sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS organization_members (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS organization_members_org_provider_idx
        ON organization_members (org_id, provider_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS organization_members_provider_idx
        ON organization_members (provider_id)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS organization_invites (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
        invited_by BIGINT REFERENCES providers(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_org_email_idx
        ON organization_invites (org_id, lower(email))
        WHERE accepted_at IS NULL
    `;

    /* Backfill: one personal org per provider that has no membership yet.
       A loop rather than a single INSERT..SELECT because the new org id has
       to be paired back to the provider it was created for.

       The name falls back to the provider id because `providers.email` is
       nullable and `organizations.name` is not: the seller app signs
       collectors in by phone number alone, and Apple withholds the address
       often enough that those accounts are real too. Naming the org after
       the email local part alone made the insert fail for every one of
       them, and since this runs on read it took the marketplace down with
       it rather than just skipping the row. */
    await sql`
      DO $$
      DECLARE
        p RECORD;
        new_org BIGINT;
      BEGIN
        FOR p IN
          SELECT pr.id, pr.email
          FROM providers pr
          LEFT JOIN organization_members m ON m.provider_id = pr.id
          WHERE m.id IS NULL
        LOOP
          INSERT INTO organizations (name)
          VALUES (
            COALESCE(NULLIF(split_part(p.email, '@', 1), ''), 'provider-' || p.id)
          )
          RETURNING id INTO new_org;

          INSERT INTO organization_members (org_id, provider_id, role)
          VALUES (new_org, p.id, 'owner');
        END LOOP;
      END $$
    `;

    /* ── Assets ──
       Finder-style folder tree plus the capture metadata the workbench
       lists: when and where it was recorded, which kit recorded it, what
       sensors it carries, and how far SLAM processing has got. */
    await sql`
      CREATE TABLE IF NOT EXISTS asset_folders (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        parent_id BIGINT REFERENCES asset_folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS asset_folders_org_idx ON asset_folders (org_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS asset_folders_parent_idx ON asset_folders (parent_id)
    `;

    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS folder_id BIGINT REFERENCES asset_folders(id) ON DELETE SET NULL`;
    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ`;
    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS location TEXT`;
    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS device_code TEXT`;
    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS modalities TEXT[] NOT NULL DEFAULT '{}'`;
    await sql`ALTER TABLE data_files ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`;
    await sql`
      ALTER TABLE data_files ADD COLUMN IF NOT EXISTS slam_status TEXT NOT NULL DEFAULT 'none'
    `;
    await sql`
      ALTER TABLE data_files DROP CONSTRAINT IF EXISTS data_files_slam_status_check
    `;
    await sql`
      ALTER TABLE data_files ADD CONSTRAINT data_files_slam_status_check
        CHECK (slam_status IN ('none', 'queued', 'processing', 'complete', 'failed'))
    `;
    await sql`
      UPDATE data_files f
      SET org_id = m.org_id
      FROM organization_members m
      WHERE f.org_id IS NULL AND m.provider_id = f.provider_id
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS data_files_org_folder_idx ON data_files (org_id, folder_id)
    `;

    /* ── Devices ──
       A row per physical Butter Kit. `kit_requests` tracks the purchase and
       shipment; this tracks the hardware once it is in the field. */
    await sql`
      CREATE TABLE IF NOT EXISTS devices (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_code TEXT NOT NULL,
        label TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT 'basic' CHECK (variant IN ('slam', 'basic')),
        status TEXT NOT NULL DEFAULT 'offline' CHECK (
          status IN ('online', 'offline', 'recording', 'syncing')
        ),
        firmware TEXT,
        battery_percent INTEGER,
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS devices_org_code_idx ON devices (org_id, device_code)
    `;

    /* ── Wallet ──
       Append-only ledger. The balance is the sum of its entries, so there
       is no denormalised total to drift. */
    await sql`
      CREATE TABLE IF NOT EXISTS wallet_entries (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('sale', 'kit_credit', 'payout', 'adjustment')),
        amount_cents BIGINT NOT NULL,
        memo TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS wallet_entries_org_created_idx
        ON wallet_entries (org_id, created_at DESC)
    `;

    await sql`ALTER TABLE listings ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE`;
    await sql`
      UPDATE listings l
      SET org_id = m.org_id
      FROM organization_members m
      WHERE l.org_id IS NULL AND m.provider_id = l.provider_id
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS listings_org_idx ON listings (org_id)
    `;
  })().catch((err) => {
    console.error("[butter db] schema setup failed", err);
    globalThis.__butterSchemaReady = null;
    throw err;
  });

  globalThis.__butterSchemaReady = ready;
  return ready;
}
