-- Migration 028: Garantir first_error_at no reset_stuck_connectors
-- Problema: A RPC reset_stuck_connectors reseta conectores em 'running' há muito tempo,
-- mas não atualiza first_error_at. Isso faz com que conectores resetados pelo watchdog
-- fiquem de fora do fetchDueConnectors, que exige first_error_at >= ontem para
-- reconsiderar conectores com status 'error'.
-- Esta migration:
--   1. Recria a função reset_stuck_connectors() garantindo a gravação de first_error_at

CREATE OR REPLACE FUNCTION public.reset_stuck_connectors(p_timeout_min int DEFAULT 45)
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

GRANT EXECUTE ON FUNCTION public.reset_stuck_connectors(int) TO service_role;
