-- Migration 020: Índices de Performance, Métricas de Stats e Trigger de Agregação

-- 1. Criar índices de chaves estrangeiras comumente filtradas e consultas de performance
CREATE INDEX IF NOT EXISTS idx_reviews_business_id
  ON public.reviews (business_id);

CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id
  ON public.reviews (tenant_id);

CREATE INDEX IF NOT EXISTS idx_reviews_published_at_desc
  ON public.reviews (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_business_channel_date
  ON public.reviews (business_id, channel, published_at DESC);

-- Otimização do scheduler de conectores
CREATE INDEX IF NOT EXISTS idx_connectors_next_sync
  ON public.channel_connectors (next_sync_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_connectors_business_id
  ON public.channel_connectors (business_id);

-- Índices operacionais
CREATE INDEX IF NOT EXISTS idx_sync_jobs_connector_id
  ON public.sync_jobs (connector_id);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at_desc
  ON public.sync_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_businesses_tenant_id
  ON public.monitored_businesses (tenant_id);

-- Índices para prospecção outbound
CREATE INDEX IF NOT EXISTS idx_prospect_leads_campaign_id
  ON public.prospect_leads (campaign_id);

CREATE INDEX IF NOT EXISTS idx_prospect_followup_queue_lead_id
  ON public.prospect_followup_queue (lead_id);

CREATE INDEX IF NOT EXISTS idx_prospect_followup_queue_scheduled
  ON public.prospect_followup_queue (scheduled_at)
  WHERE status = 'pending';


-- 2. Atualizar tabela review_stats_daily para incluir critical_count e avg_dissatisfaction_score
ALTER TABLE public.review_stats_daily
  ADD COLUMN IF NOT EXISTS critical_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_dissatisfaction_score NUMERIC(5,2) DEFAULT 0;


-- 3. Recriar função de agregação diária com suporte às novas métricas
CREATE OR REPLACE FUNCTION public.aggregate_daily_stats(
  p_business_id UUID,
  p_channel     public.source_channel,
  p_date        DATE
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Obter tenant_id da empresa correspondente
  SELECT tenant_id INTO v_tenant_id
  FROM public.monitored_businesses
  WHERE id = p_business_id;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.review_stats_daily (
    business_id, tenant_id, channel, date,
    total_reviews, avg_rating, avg_dissatisfaction_score,
    positive_count, neutral_count, negative_count, critical_count, unanalyzed_count
  )
  SELECT
    p_business_id,
    v_tenant_id,
    p_channel,
    p_date,
    COUNT(*)                                            AS total_reviews,
    ROUND(COALESCE(AVG(rating), 0)::numeric, 2)         AS avg_rating,
    ROUND(COALESCE(AVG(dissatisfaction_score), 0)::numeric, 2) AS avg_dissatisfaction_score,
    COUNT(*) FILTER (WHERE sentiment = 'positive')     AS positive_count,
    COUNT(*) FILTER (WHERE sentiment = 'neutral')      AS neutral_count,
    COUNT(*) FILTER (WHERE sentiment = 'negative')     AS negative_count,
    COUNT(*) FILTER (WHERE sentiment = 'critical')     AS critical_count,
    COUNT(*) FILTER (WHERE sentiment = 'unanalyzed')   AS unanalyzed_count
  FROM public.reviews
  WHERE business_id = p_business_id
    AND channel     = p_channel
    AND published_at::date = p_date
  ON CONFLICT (business_id, channel, date)
  DO UPDATE SET
    total_reviews             = EXCLUDED.total_reviews,
    avg_rating                = EXCLUDED.avg_rating,
    avg_dissatisfaction_score = EXCLUDED.avg_dissatisfaction_score,
    positive_count            = EXCLUDED.positive_count,
    neutral_count             = EXCLUDED.neutral_count,
    negative_count            = EXCLUDED.negative_count,
    critical_count            = EXCLUDED.critical_count,
    unanalyzed_count          = EXCLUDED.unanalyzed_count;
END;
$$;


-- 4. Criar trigger de banco na tabela reviews para atualizar agregados automaticamente
CREATE OR REPLACE FUNCTION public.trg_reviews_aggregate_stats_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Processar inserções e atualizações
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.aggregate_daily_stats(NEW.business_id, NEW.channel, NEW.published_at::date);
  END IF;

  -- Se for uma atualização que mudou a data, canal ou business_id, atualizar também o registro antigo
  IF TG_OP = 'UPDATE' AND (
     OLD.business_id IS DISTINCT FROM NEW.business_id OR
     OLD.channel IS DISTINCT FROM NEW.channel OR
     OLD.published_at::date IS DISTINCT FROM NEW.published_at::date
  ) THEN
     PERFORM public.aggregate_daily_stats(OLD.business_id, OLD.channel, OLD.published_at::date);
  END IF;

  -- Processar deleções
  IF TG_OP = 'DELETE' THEN
    PERFORM public.aggregate_daily_stats(OLD.business_id, OLD.channel, OLD.published_at::date);
  END IF;

  RETURN NULL; -- Trigger do tipo AFTER
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_aggregate_stats ON public.reviews;

CREATE TRIGGER trg_reviews_aggregate_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reviews_aggregate_stats_fn();


-- 5. Executar pg_cron de forma tolerante a falhas
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AND
     EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- Remover agendamento se já existir
    BEGIN
      PERFORM cron.unschedule('daily-stats');
    EXCEPTION WHEN OTHERS THEN
      -- Silenciar se o job não existir
    END;
    -- Agendar novamente para 00:05
    PERFORM cron.schedule('daily-stats', '5 0 * * *', 'SELECT run_daily_aggregation()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível agendar o pg_cron: %', SQLERRM;
END$$;
