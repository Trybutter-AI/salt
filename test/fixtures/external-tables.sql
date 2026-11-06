-- Tables this app reads but does not own.
--
-- `providers`, `provider_sessions` and `listings` are created and migrated by
-- the seller app against the same database. This file is not their definition
-- — it is the subset of their shape this app actually depends on, so the
-- tests have something to read and the dependency is written down somewhere
-- rather than being implicit.
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
