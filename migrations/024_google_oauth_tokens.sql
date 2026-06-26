-- Migration 024: Colunas de tokens Google OAuth na tabela tenants
--
-- Armazena os tokens OAuth 2.0 do Google Business Profile por tenant.
-- A coluna google_oauth_tokens é texto (JSON) — no futuro pode ser migrada
-- para pgsodium/Vault quando a infraestrutura estiver configurada.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS google_oauth_tokens        text        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_oauth_connected_at  timestamptz DEFAULT NULL;

COMMENT ON COLUMN tenants.google_oauth_tokens IS
  'JSON com { access_token, refresh_token, expiry_date, token_type, scope } do Google Business Profile OAuth 2.0. Gerenciado via /api/auth/google/*.';

COMMENT ON COLUMN tenants.google_oauth_connected_at IS
  'Timestamp da última conexão OAuth com o Google Business Profile.';
