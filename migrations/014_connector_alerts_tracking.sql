-- Adiciona colunas para rastrear disparos de alertas de falhas críticas (Robôs e Coleta)
ALTER TABLE channel_connectors 
ADD COLUMN alert_6h_sent BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN alert_24h_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN channel_connectors.alert_6h_sent IS 'Indica se o alerta de 6h contínuas de erro já foi disparado.';
COMMENT ON COLUMN channel_connectors.alert_24h_sent IS 'Indica se o alerta de 24h contínuas de erro já foi disparado.';
