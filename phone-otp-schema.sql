-- Standalone PostgreSQL development/host setup only.
-- Replit managed production schema changes are applied through Publish.
CREATE TABLE IF NOT EXISTS phone_otp_pairings (
  id text PRIMARY KEY,
  key_hash text NOT NULL UNIQUE,
  browser_hash text NOT NULL UNIQUE,
  device_hash text UNIQUE,
  pair_expires_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  otp_cipher text,
  message_id text,
  received_at bigint,
  seen_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);
