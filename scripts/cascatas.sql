-- 1. Modificar reviews
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_business_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_business_id_fkey FOREIGN KEY (business_id) REFERENCES monitored_businesses(id) ON DELETE CASCADE;

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_tenant_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- 2. Modificar Eventos e Regras de Alertas
ALTER TABLE alert_events DROP CONSTRAINT IF EXISTS alert_events_business_id_fkey;
ALTER TABLE alert_events ADD CONSTRAINT alert_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES monitored_businesses(id) ON DELETE CASCADE;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_business_id_fkey;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_business_id_fkey FOREIGN KEY (business_id) REFERENCES monitored_businesses(id) ON DELETE CASCADE;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_tenant_id_fkey;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- 3. Modificar Conectores
ALTER TABLE channel_connectors DROP CONSTRAINT IF EXISTS channel_connectors_business_id_fkey;
ALTER TABLE channel_connectors ADD CONSTRAINT channel_connectors_business_id_fkey FOREIGN KEY (business_id) REFERENCES monitored_businesses(id) ON DELETE CASCADE;

-- 4. Modificar Empresas (se o tenant mãe for apagada, tudo sob ela cai junto)
ALTER TABLE monitored_businesses DROP CONSTRAINT IF EXISTS monitored_businesses_tenant_id_fkey;
ALTER TABLE monitored_businesses ADD CONSTRAINT monitored_businesses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- 5. Modificar Papeis de Usuarios
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_tenant_id_fkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
