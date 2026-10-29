-- The pre-account record of who asked for access. It predates buyer
-- accounts and is kept alongside them: `buyers.interest_id` joins the two so
-- review has the use-case text to hand.

CREATE TABLE IF NOT EXISTS buyer_interest (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company_name TEXT,
  buyer_type TEXT CHECK (buyer_type IN ('frontier_lab', 'neo_lab', 'enterprise_other')),
  use_case TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyer_interest_submitted_at_idx
  ON buyer_interest (submitted_at DESC);

-- Signup stopped asking for either — both are meant to be derived from the
-- work email domain. The columns are declared nullable above, so these only
-- matter to databases created before that change.
ALTER TABLE buyer_interest ALTER COLUMN company_name DROP NOT NULL;
ALTER TABLE buyer_interest ALTER COLUMN buyer_type DROP NOT NULL;
