-- Migration para adicionar flag de alerta de 2 dias (48h) nos conectores
ALTER TABLE channel_connectors 
ADD COLUMN IF NOT EXISTS alert_48h_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN channel_connectors.alert_48h_sent IS 'Indica se o alerta de 48h (2 dias) contínuas de erro já foi disparado.';
