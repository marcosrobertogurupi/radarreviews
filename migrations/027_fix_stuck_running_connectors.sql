-- Migration 027: Fix conectores travados em status 'running'
-- Problema: se o scheduler morrer enquanto um conector está em 'running',
-- o fetchDueConnectors nunca o pega de volta (filtra apenas 'active' | 'error').
-- Esta migration:
--   1. Cria função SQL reset_stuck_connectors() para uso pelo scheduler (watchdog)
--   2. Reseta imediatamente todos os conectores presos em 'running' há mais de 20 min

-- ============================================================================
-- 1. Função de watchdog — chamada periodicamente pelo scheduler
-- ============================================================================
CREATE OR REPLACE FUNCTION reset_stuck_connectors(p_timeout_min int DEFAULT 45)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE channel_connectors
    SET status         = 'error',
        error_message  = 'Reset automático: conector travado em running por mais de ' || p_timeout_min || ' minutos.',
        first_error_at = COALESCE(first_error_at, now()),
        next_sync_at   = now() + interval '5 minutes'
  WHERE status = 'running'
    AND updated_at < now() - (p_timeout_min || ' minutes')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_stuck_connectors(int) TO service_role;

-- ============================================================================
-- 2. Reset imediato dos conectores atualmente travados
--    (qualquer conector em 'running' há mais de 20 minutos)
-- ============================================================================
UPDATE channel_connectors
  SET status         = 'error',
      error_message  = 'Reset automático: conector travado após reinício do scheduler.',
      next_sync_at   = now() + interval '2 minutes'
WHERE status = 'running'
  AND updated_at < now() - interval '20 minutes';
