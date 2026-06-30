-- Migration para adicionar flag de alerta de 3 dias (72h) nos conectores
ALTER TABLE channel_connectors 
ADD COLUMN IF NOT EXISTS alert_72h_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN channel_connectors.alert_72h_sent IS 'Indica se o alerta de 72h (3 dias) contínuas de erro já foi disparado.';
