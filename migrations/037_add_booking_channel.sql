-- ============================================================
-- MIGRATION: 037_add_booking_channel
-- Adiciona 'booking' ao enum source_channel e atualiza v_business_summary
-- ============================================================

-- 1. Adicionar 'booking' ao enum source_channel
ALTER TYPE source_channel ADD VALUE IF NOT EXISTS 'booking';

-- 2. Atualizar a view v_business_summary com a contagem de booking
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
  COUNT(r.id) FILTER (WHERE r.channel = 'booking')          AS booking_count,
  COUNT(r.id) FILTER (WHERE r.sentiment = 'positive')       AS positive_count,
  COUNT(r.id) FILTER (WHERE r.sentiment = 'negative')       AS negative_count,
  MAX(r.collected_at)                           AS last_collected_at
FROM monitored_businesses mb
LEFT JOIN reviews r ON r.business_id = mb.id
WHERE mb.is_active = true
GROUP BY mb.id, mb.tenant_id, mb.name;

COMMENT ON VIEW v_business_summary IS 'Resumo consolidado por empresa — todos os canais incluindo booking.';
