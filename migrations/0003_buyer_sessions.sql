-- Buyer sign-in sessions. Only the hash of the token is stored, so a copy of
-- this table is not a set of working cookies.

CREATE TABLE IF NOT EXISTS buyer_sessions (
  id BIGSERIAL PRIMARY KEY,
  buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS buyer_sessions_token_hash_idx
  ON buyer_sessions (token_hash);

CREATE INDEX IF NOT EXISTS buyer_sessions_buyer_id_idx
  ON buyer_sessions (buyer_id);
