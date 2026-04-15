-- ============================================================
-- RADAR DE REVIEWS — MIGRATIONS SUPABASE
-- Ordem: extensions > enums > tabelas base > tabelas core
--        > tabelas ops > constraints > índices > RLS > funções
-- ============================================================


-- ------------------------------------------------------------
-- 0. EXTENSIONS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pgsodium";   -- Supabase Vault


-- ------------------------------------------------------------
-- 1. ENUMS
-- ------------------------------------------------------------
CREATE TYPE source_channel AS ENUM (
  'google_maps',
  'facebook',
  'instagram',
  'reclame_aqui',
  'consumidor_gov',
  'tripadvisor',
  'trustpilot',
  'reddit'
);

CREATE TYPE connector_status AS ENUM (
  'active',
  'paused',
  'error',
  'pending_auth'
);

CREATE TYPE job_status AS ENUM (
  'pending',
  'running',
  'done',
  'failed'
);

CREATE TYPE sentiment_type AS ENUM (
  'positive',
  'neutral',
  'negative',
  'unanalyzed'
);

CREATE TYPE user_role AS ENUM (
  'owner',
  'admin',
  'viewer'
);


-- ------------------------------------------------------------
-- 2. CAMADA SAAS — tenants e usuários
-- ------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  slug        text NOT NULL,
  plan        text NOT NULL DEFAULT 'free',  -- free | starter | pro | enterprise
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenants_slug_uq UNIQUE (slug),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9-]+$')
);

COMMENT ON TABLE tenants IS 'Cada cliente do SaaS é um tenant isolado.';


CREATE TABLE tenant_users (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'viewer',
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_users_uq UNIQUE (tenant_id, user_id)
);

COMMENT ON TABLE tenant_users IS 'Relaciona usuários Supabase Auth aos seus tenants e papéis.';


-- ------------------------------------------------------------
-- 3. EMPRESAS MONITORADAS
-- ------------------------------------------------------------
CREATE TABLE monitored_businesses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  cnpj        text,
  category    text,
  is_active   boolean NOT NULL DEFAULT true,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT businesses_cnpj_format CHECK (
    cnpj IS NULL OR cnpj ~ '^\d{14}$'
  )
);

COMMENT ON TABLE monitored_businesses IS 'Empresas cadastradas para monitoramento de reviews.';
COMMENT ON COLUMN monitored_businesses.metadata IS 'Dados extras: endereço, site, logo_url, etc.';
COMMENT ON COLUMN monitored_businesses.cnpj IS 'Apenas dígitos, 14 chars. Chave para cruzar Consumidor.gov.';


-- ------------------------------------------------------------
-- 4. CONECTORES — credenciais e config por canal
-- ------------------------------------------------------------
CREATE TABLE channel_connectors (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     uuid NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  channel         source_channel NOT NULL,
  status          connector_status NOT NULL DEFAULT 'pending_auth',
  external_id     text,                  -- place_id, page_id, location_id, etc.
  -- Tokens OAuth armazenados via Supabase Vault.
  -- Guarda apenas o vault_secret_id (UUID), nunca o token em texto plano.
  vault_secret_id uuid,
  config          jsonb NOT NULL DEFAULT '{}',
  last_sync_at    timestamptz,
  next_sync_at    timestamptz,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT connectors_business_channel_uq UNIQUE (business_id, channel)
);

COMMENT ON TABLE channel_connectors IS 'Um registro por canal por empresa monitorada.';
COMMENT ON COLUMN channel_connectors.external_id IS 'ID da entidade na plataforma externa (place_id, page_id...).';
COMMENT ON COLUMN channel_connectors.vault_secret_id IS 'UUID do segredo no Supabase Vault. Nunca armazenar token direto.';
COMMENT ON COLUMN channel_connectors.config IS
  'Exemplos: {"subreddits": ["r/..."], "keywords": ["marca"], "fetch_limit": 50}';


-- ------------------------------------------------------------
-- 5. REVIEWS — tabela central
-- ------------------------------------------------------------
CREATE TABLE reviews (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id         uuid NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  connector_id        uuid REFERENCES channel_connectors(id) ON DELETE SET NULL,
  channel             source_channel NOT NULL,

  -- Identificação externa (deduplicação)
  external_id         text NOT NULL,

  -- Conteúdo normalizado
  rating              numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  title               text,
  body                text,
  author_name         text,
  author_external_id  text,
  url                 text,
  language            text DEFAULT 'pt',
  tags                text[] DEFAULT '{}',

  -- Métricas de engajamento (Reddit, Instagram)
  upvotes             integer DEFAULT 0,
  comment_count       integer DEFAULT 0,

  -- Campos específicos de plataformas de reclamação
  is_resolved         boolean,
  response_time_days  integer,

  -- Análise de sentimento
  sentiment           sentiment_type NOT NULL DEFAULT 'unanalyzed',
  sentiment_score     numeric(4,3)
    CHECK (sentiment_score IS NULL OR (sentiment_score >= -1 AND sentiment_score <= 1)),

  -- Controle
  published_at        timestamptz NOT NULL,
  collected_at        timestamptz NOT NULL DEFAULT now(),
  raw_data            jsonb NOT NULL DEFAULT '{}',

  CONSTRAINT reviews_channel_external_uq UNIQUE (channel, external_id)
);

COMMENT ON TABLE reviews IS 'Tabela central — todos os canais normalizados aqui.';
COMMENT ON COLUMN reviews.external_id IS 'ID original na plataforma. Com channel forma chave única.';
COMMENT ON COLUMN reviews.rating IS 'Escala 0–5. NULL para canais sem nota (Reddit, Consumidor.gov).';
COMMENT ON COLUMN reviews.raw_data IS 'JSON original da API. Nunca apagar — permite reprocessamento.';
COMMENT ON COLUMN reviews.sentiment_score IS 'Escala -1 (negativo) a +1 (positivo).';


-- ------------------------------------------------------------
-- 6. ALERTAS
-- ------------------------------------------------------------
CREATE TABLE alert_rules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id     uuid REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  name            text NOT NULL,
  channel         source_channel,          -- NULL = todos os canais
  condition_type  text NOT NULL,           -- 'rating_drop' | 'volume_spike' | 'negative_surge' | 'keyword'
  threshold       numeric,
  keywords        text[],
  notify_email    boolean DEFAULT true,
  notify_webhook  text,                    -- URL para POST
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE alert_rules IS 'Regras de alerta configuráveis por tenant.';


CREATE TABLE alert_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id         uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  business_id     uuid NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  channel         source_channel,
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  detail          jsonb NOT NULL DEFAULT '{}',
  notified        boolean DEFAULT false
);

COMMENT ON TABLE alert_events IS 'Histórico de alertas disparados.';


-- ------------------------------------------------------------
-- 7. OPERAÇÕES — jobs e estatísticas
-- ------------------------------------------------------------
CREATE TABLE sync_jobs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  connector_id     uuid NOT NULL REFERENCES channel_connectors(id) ON DELETE CASCADE,
  status           job_status NOT NULL DEFAULT 'pending',
  started_at       timestamptz,
  finished_at      timestamptz,
  reviews_fetched  integer DEFAULT 0,
  reviews_new      integer DEFAULT 0,
  reviews_updated  integer DEFAULT 0,
  error_detail     jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync_jobs IS 'Log de cada execução de coleta por conector.';


CREATE TABLE review_stats_daily (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      uuid NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel          source_channel NOT NULL,
  date             date NOT NULL,
  total_reviews    integer NOT NULL DEFAULT 0,
  avg_rating       numeric(3,2),
  positive_count   integer NOT NULL DEFAULT 0,
  neutral_count    integer NOT NULL DEFAULT 0,
  negative_count   integer NOT NULL DEFAULT 0,
  unanalyzed_count integer NOT NULL DEFAULT 0,

  CONSTRAINT stats_daily_uq UNIQUE (business_id, channel, date)
);

COMMENT ON TABLE review_stats_daily IS 'Agregados diários pré-computados. Dashboard lê daqui.';


-- ------------------------------------------------------------
-- 8. ÍNDICES
-- ------------------------------------------------------------
-- reviews — consultas mais comuns
CREATE INDEX idx_reviews_business_id      ON reviews (business_id);
CREATE INDEX idx_reviews_tenant_id        ON reviews (tenant_id);
CREATE INDEX idx_reviews_channel          ON reviews (channel);
CREATE INDEX idx_reviews_published_at     ON reviews (published_at DESC);
CREATE INDEX idx_reviews_sentiment        ON reviews (sentiment);
CREATE INDEX idx_reviews_rating           ON reviews (rating);
CREATE INDEX idx_reviews_collected_at     ON reviews (collected_at DESC);
-- índice composto para o filtro mais comum no dashboard
CREATE INDEX idx_reviews_business_channel_date
  ON reviews (business_id, channel, published_at DESC);

-- channel_connectors — scheduler busca por next_sync_at
CREATE INDEX idx_connectors_next_sync     ON channel_connectors (next_sync_at)
  WHERE status = 'active';
CREATE INDEX idx_connectors_business      ON channel_connectors (business_id);

-- sync_jobs — monitoramento operacional
CREATE INDEX idx_jobs_connector_id        ON sync_jobs (connector_id);
CREATE INDEX idx_jobs_status              ON sync_jobs (status);
CREATE INDEX idx_jobs_created_at          ON sync_jobs (created_at DESC);

-- review_stats_daily — queries de dashboard
CREATE INDEX idx_stats_business_date      ON review_stats_daily (business_id, date DESC);
CREATE INDEX idx_stats_tenant_date        ON review_stats_daily (tenant_id, date DESC);

-- monitored_businesses
CREATE INDEX idx_businesses_tenant        ON monitored_businesses (tenant_id);
CREATE INDEX idx_businesses_cnpj          ON monitored_businesses (cnpj)
  WHERE cnpj IS NOT NULL;

-- alert_events
CREATE INDEX idx_alert_events_rule        ON alert_events (rule_id);
CREATE INDEX idx_alert_events_triggered   ON alert_events (triggered_at DESC);


-- ------------------------------------------------------------
-- 9. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitored_businesses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_connectors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_stats_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events          ENABLE ROW LEVEL SECURITY;

-- Função helper: retorna o tenant_id do usuário autenticado
CREATE OR REPLACE FUNCTION auth_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT tenant_id
  FROM tenant_users
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- Políticas — padrão de isolamento por tenant
CREATE POLICY "tenant_isolation" ON tenants
  FOR ALL USING (id = auth_tenant_id());

CREATE POLICY "tenant_isolation" ON tenant_users
  FOR ALL USING (tenant_id = auth_tenant_id());

CREATE POLICY "tenant_isolation" ON monitored_businesses
  FOR ALL USING (tenant_id = auth_tenant_id());

CREATE POLICY "tenant_isolation" ON channel_connectors
  FOR ALL USING (
    business_id IN (
      SELECT id FROM monitored_businesses WHERE tenant_id = auth_tenant_id()
    )
  );

CREATE POLICY "tenant_isolation" ON reviews
  FOR ALL USING (tenant_id = auth_tenant_id());

CREATE POLICY "tenant_isolation" ON sync_jobs
  FOR ALL USING (
    connector_id IN (
      SELECT cc.id FROM channel_connectors cc
      JOIN monitored_businesses mb ON mb.id = cc.business_id
      WHERE mb.tenant_id = auth_tenant_id()
    )
  );

CREATE POLICY "tenant_isolation" ON review_stats_daily
  FOR ALL USING (tenant_id = auth_tenant_id());

CREATE POLICY "tenant_isolation" ON alert_rules
  FOR ALL USING (tenant_id = auth_tenant_id());

CREATE POLICY "tenant_isolation" ON alert_events
  FOR ALL USING (
    rule_id IN (
      SELECT id FROM alert_rules WHERE tenant_id = auth_tenant_id()
    )
  );


-- ------------------------------------------------------------
-- 10. FUNÇÕES UTILITÁRIAS
-- ------------------------------------------------------------

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON monitored_businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_connectors_updated_at
  BEFORE UPDATE ON channel_connectors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Agrega stats diárias para uma empresa+canal+data
CREATE OR REPLACE FUNCTION aggregate_daily_stats(
  p_business_id uuid,
  p_channel     source_channel,
  p_date        date
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM monitored_businesses WHERE id = p_business_id;

  INSERT INTO review_stats_daily (
    business_id, tenant_id, channel, date,
    total_reviews, avg_rating,
    positive_count, neutral_count, negative_count, unanalyzed_count
  )
  SELECT
    p_business_id,
    v_tenant_id,
    p_channel,
    p_date,
    COUNT(*)                                            AS total_reviews,
    ROUND(AVG(rating)::numeric, 2)                     AS avg_rating,
    COUNT(*) FILTER (WHERE sentiment = 'positive')     AS positive_count,
    COUNT(*) FILTER (WHERE sentiment = 'neutral')      AS neutral_count,
    COUNT(*) FILTER (WHERE sentiment = 'negative')     AS negative_count,
    COUNT(*) FILTER (WHERE sentiment = 'unanalyzed')   AS unanalyzed_count
  FROM reviews
  WHERE business_id = p_business_id
    AND channel     = p_channel
    AND published_at::date = p_date
  ON CONFLICT (business_id, channel, date)
  DO UPDATE SET
    total_reviews    = EXCLUDED.total_reviews,
    avg_rating       = EXCLUDED.avg_rating,
    positive_count   = EXCLUDED.positive_count,
    neutral_count    = EXCLUDED.neutral_count,
    negative_count   = EXCLUDED.negative_count,
    unanalyzed_count = EXCLUDED.unanalyzed_count;
END;
$$;


-- Job diário via pg_cron: agrega stats do dia anterior para todos os negócios
CREATE OR REPLACE FUNCTION run_daily_aggregation()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT business_id, channel
    FROM reviews
    WHERE published_at::date = CURRENT_DATE - INTERVAL '1 day'
  LOOP
    PERFORM aggregate_daily_stats(
      r.business_id,
      r.channel,
      (CURRENT_DATE - INTERVAL '1 day')::date
    );
  END LOOP;
END;
$$;

-- Agendar via pg_cron (rodar após habilitar a extension)
-- SELECT cron.schedule('daily-stats', '5 0 * * *', 'SELECT run_daily_aggregation()');


-- ------------------------------------------------------------
-- 11. VIEWS AUXILIARES
-- ------------------------------------------------------------

-- Visão consolidada por empresa (útil para o dashboard de overview)
CREATE OR REPLACE VIEW v_business_summary AS
SELECT
  mb.id                                         AS business_id,
  mb.tenant_id,
  mb.name                                       AS business_name,
  COUNT(r.id)                                   AS total_reviews,
  ROUND(AVG(r.rating)::numeric, 2)              AS avg_rating,
  COUNT(r.id) FILTER (WHERE r.channel = 'google_maps')      AS google_maps_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'facebook')         AS facebook_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'instagram')        AS instagram_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'reclame_aqui')     AS reclame_aqui_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'consumidor_gov')   AS consumidor_gov_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'tripadvisor')      AS tripadvisor_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'trustpilot')       AS trustpilot_count,
  COUNT(r.id) FILTER (WHERE r.channel = 'reddit')           AS reddit_count,
  COUNT(r.id) FILTER (WHERE r.sentiment = 'positive')       AS positive_count,
  COUNT(r.id) FILTER (WHERE r.sentiment = 'negative')       AS negative_count,
  MAX(r.collected_at)                           AS last_collected_at
FROM monitored_businesses mb
LEFT JOIN reviews r ON r.business_id = mb.id
WHERE mb.is_active = true
GROUP BY mb.id, mb.tenant_id, mb.name;

COMMENT ON VIEW v_business_summary IS 'Resumo consolidado por empresa — todos os canais.';


-- Status dos conectores por empresa
CREATE OR REPLACE VIEW v_connector_status AS
SELECT
  mb.id           AS business_id,
  mb.name         AS business_name,
  mb.tenant_id,
  cc.channel,
  cc.status,
  cc.last_sync_at,
  cc.next_sync_at,
  cc.error_message,
  sj.reviews_new  AS last_job_new_reviews,
  sj.finished_at  AS last_job_finished_at
FROM monitored_businesses mb
JOIN channel_connectors cc ON cc.business_id = mb.id
LEFT JOIN LATERAL (
  SELECT reviews_new, finished_at
  FROM sync_jobs
  WHERE connector_id = cc.id
  ORDER BY created_at DESC
  LIMIT 1
) sj ON true;

COMMENT ON VIEW v_connector_status IS 'Estado atual de cada conector com info do último job.';

