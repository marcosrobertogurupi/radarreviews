-- Remover todos os reviews cujo business_id não exista mais na tabela principal
DELETE FROM public.reviews
WHERE business_id NOT IN (SELECT id FROM public.monitored_businesses);

-- Remover todos os eventos de alerta cujo business_id não exista mais na tabela principal
DELETE FROM public.alert_events
WHERE business_id NOT IN (SELECT id FROM public.monitored_businesses);

-- Remover conectores fantasmas
DELETE FROM public.channel_connectors
WHERE business_id NOT IN (SELECT id FROM public.monitored_businesses);
