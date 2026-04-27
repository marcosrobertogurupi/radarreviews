-- Migração: Suporte a WhatsApp (UAZAPI)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS whatsapp_token_enc TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_base_url TEXT DEFAULT 'https://api.uazapi.com',
  ADD COLUMN IF NOT EXISTS whatsapp_limit_monthly INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_this_month INT DEFAULT 0;

COMMENT ON COLUMN tenants.whatsapp_token_enc IS 'Token da UAZAPI criptografado.';
COMMENT ON COLUMN tenants.whatsapp_limit_monthly IS 'Limite mensal de envios baseado no plano.';

-- RPC para incrementar contador
CREATE OR REPLACE FUNCTION increment_whatsapp_sent(t_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE tenants
  SET whatsapp_sent_this_month = COALESCE(whatsapp_sent_this_month, 0) + 1
  WHERE id = t_id;
END;
$$ LANGUAGE plpgsql;
