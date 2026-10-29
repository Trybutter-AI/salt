-- Buyer accounts.
--
-- Deliberately separate from `providers`, which belongs to the seller app: a
-- buyer buys data and a provider sells it, they sign in on different origins,
-- and nothing about one is meaningful to the other. No `google_id` column —
-- buyer sign-in is email + password only for now.

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
);

ALTER TABLE buyers ALTER COLUMN company_name DROP NOT NULL;
ALTER TABLE buyers ALTER COLUMN buyer_type DROP NOT NULL;

-- Addresses are compared case-insensitively at sign-in, so uniqueness has to
-- be too, or two accounts can differ only by capitalisation.
CREATE UNIQUE INDEX IF NOT EXISTS buyers_email_idx ON buyers (lower(email));

CREATE INDEX IF NOT EXISTS buyers_status_created_idx
  ON buyers (status, created_at DESC);
