-- Tables this app reads but does not own.
--
-- `providers`, `provider_sessions`, `listings`, and the footage tables below
-- (`organizations`, `sites`, `assignments`, `data_episodes`, `data_files`,
-- `asset_consents`) are created and migrated by the seller app against the
-- same database. This file is not their definition — it is the subset of
-- their shape this app actually depends on, so the tests have something to
-- read and the dependency is written down somewhere rather than being
-- implicit.
--
-- `providers.email` is nullable on purpose: the seller app signs collectors
-- in by phone number alone, and Apple withholds the address often enough that
-- those accounts are real too. Assuming otherwise is what took the index down.

CREATE TABLE IF NOT EXISTS providers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT,
  phone TEXT,
  apple_id TEXT,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('individual', 'expert')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_sessions (
  id BIGSERIAL PRIMARY KEY,
  provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
);

-- ── Footage, as the buyer portal reads it ──
--
-- The chain is buyer → assignment → episode → file. An assignment names the
-- work and the site it was done at and points at the buyer it collects for;
-- an episode is one recording session answering that assignment; a file is
-- one of the several the session produced (video, motion, pose, manifest).
--
-- `assignments.buyer_id` is the whole link, and it is nullable in the seller
-- app: null means the workspace recorded it on its own account to list
-- later, so it belongs to no buyer and the portal must never show it.

CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  site_category TEXT,
  venue_type TEXT,
  address TEXT,
  city TEXT,
  state_or_province TEXT,
  country TEXT,
  business_legal_name TEXT,
  headcount INTEGER,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  buyer_id BIGINT REFERENCES buyers(id) ON DELETE SET NULL,
  site_id BIGINT REFERENCES sites(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  video BOOLEAN NOT NULL DEFAULT true,
  sound BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS data_episodes (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id BIGINT REFERENCES assignments(id) ON DELETE SET NULL,
  capture_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, capture_id)
);

-- `scan_status` is the malware sweep's verdict. A file is `pending` until
-- something has looked at it, and the portal hands out bytes for 'clean'
-- and nothing else.
CREATE TABLE IF NOT EXISTS data_files (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES data_episodes(id) ON DELETE SET NULL,
  assignment_id BIGINT REFERENCES assignments(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  content_type TEXT,
  duration_seconds INTEGER,
  modalities TEXT[] NOT NULL DEFAULT '{}',
  recorded_at TIMESTAMPTZ,
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    scan_status IN ('pending', 'clean', 'infected', 'skipped', 'failed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_consents (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL UNIQUE REFERENCES data_files(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES data_episodes(id) ON DELETE CASCADE,
  regime TEXT NOT NULL DEFAULT 'review',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'awaiting_signatures', 'complete', 'blocked')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
