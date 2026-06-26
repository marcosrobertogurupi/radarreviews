-- Migration 016: cria a função claim_review_jobs que estava faltando no banco de produção
-- Essa função é usada pelo scheduler para claim atômico de sync_jobs (FOR UPDATE SKIP LOCKED)

-- Adiciona 'running' ao enum connector_status se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'running'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'connector_status')
  ) THEN
    ALTER TYPE connector_status ADD VALUE 'running';
  END IF;
END$$;

-- [APPSEC] C8 — Função SQL claim_review_jobs com FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_review_jobs(
  p_batch_size  int     DEFAULT 10,
  p_worker_id   text    DEFAULT gen_random_uuid()::text,
  p_timeout_min int     DEFAULT 15
)
RETURNS SETOF sync_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  -- Requeue jobs travados há mais de p_timeout_min minutos (crash recovery)
  UPDATE sync_jobs
    SET status = 'pending'
  WHERE status = 'running'
    AND started_at < now() - (p_timeout_min || ' minutes')::interval;

  -- Claim atômico: apenas um worker por linha (FOR UPDATE SKIP LOCKED)
  RETURN QUERY
  UPDATE sync_jobs
    SET status     = 'running',
        started_at = now()
  WHERE id IN (
    SELECT id FROM sync_jobs
    WHERE  status = 'pending'
    ORDER  BY created_at
    LIMIT  p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Concede permissão de execução ao service_role (usado pelo backend)
GRANT EXECUTE ON FUNCTION claim_review_jobs(int, text, int) TO service_role;
