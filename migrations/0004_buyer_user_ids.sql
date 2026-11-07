-- A buyer signs in with a user id as well as an email.
--
-- Buyer accounts were email-only, which assumes every buyer is a person who
-- has one. The accounts that matter most are not: a lab's account is held by
-- whoever is on the data team that week, and the id is handed over with the
-- role. So an account may carry a `username` and sign in on that instead,
-- and `email` stops being required.
--
-- `buyers` is shared with the seller app.
--
-- That app's `lib/db.ts` adds `name`, `code` and `next_kit_number` to this
-- same table and drops NOT NULL from the columns declared in 0002 — a buyer
-- is one company to both apps, so there is one row per company and each app
-- reads the half it owns. Nothing here assumes which app reached the table
-- first: the columns this file needs are added IF NOT EXISTS, and the seed
-- below branches on whether `code` is there.

ALTER TABLE buyers ADD COLUMN IF NOT EXISTS username TEXT;

-- Compared case-insensitively at sign-in, so uniqueness has to be too.
-- Partial, because every email-only account has a NULL here.
CREATE UNIQUE INDEX IF NOT EXISTS buyers_username_idx
  ON buyers (lower(username)) WHERE username IS NOT NULL;

-- An account that signs in by user id has no address to require.
ALTER TABLE buyers ALTER COLUMN email DROP NOT NULL;

-- Memories.ai buys footage already: the seller app seeds the company row and
-- points assignments at it. This gives that same row a login, so the buyer
-- can see what was collected for them. One row per company is the whole
-- point of the shared table, so this updates the seeded row rather than
-- adding a second Memories.ai.
--
-- The password is a known starter credential, set once here and only when
-- the row has none. Changing it later is an UPDATE to this row; this file
-- has already run by then and will not put it back.
DO $$
DECLARE
  buyer_id BIGINT;
  starter_hash TEXT := 'scrypt$5ab11cfb91f18a8a0aae85abfc43f477$e644ba5300ba116bbb9473b5ed0b079d69319e9272894e9a0484582ebd0679227532cdeddae55b0df04fb5afad1b95da7df1bea99104342ffbd3d9b9a86ab31f';
  has_code BOOLEAN;
BEGIN
  SELECT id INTO buyer_id FROM buyers WHERE lower(name) = 'memories.ai' LIMIT 1;

  IF buyer_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'buyers' AND column_name = 'code'
    ) INTO has_code;

    /* `code` is NOT NULL once the seller app has been here, and it is what
       kits lent by this buyer are numbered under — MEM, the same value that
       app derives from the name. */
    IF has_code THEN
      EXECUTE $q$
        INSERT INTO buyers (name, code, username, password_hash, status, approved_at)
        VALUES ('Memories.ai', 'MEM', $1, $2, 'approved', now())
      $q$ USING 'memories_ai_admin', starter_hash;
    ELSE
      INSERT INTO buyers (name, username, password_hash, status, approved_at)
      VALUES ('Memories.ai', 'memories_ai_admin', starter_hash, 'approved', now());
    END IF;
  ELSE
    UPDATE buyers SET
      username = COALESCE(username, 'memories_ai_admin'),
      password_hash = CASE
        WHEN password_hash IS NULL OR password_hash = '' THEN starter_hash
        ELSE password_hash
      END,
      status = 'approved',
      approved_at = COALESCE(approved_at, now())
    WHERE id = buyer_id;
  END IF;
END $$;
