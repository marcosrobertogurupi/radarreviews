-- Seed ticket_categories for support ticketing
INSERT INTO ticket_categories (name, description, active) VALUES 
('Dúvida', 'Dúvidas gerais sobre a plataforma', true),
('Problema Técnico', 'Bugs ou falhas no sistema', true),
('Financeiro', 'Faturamento e assinaturas', true),
('Sugestão', 'Sugestões de melhoria ou novas funcionalidades', true)
ON CONFLICT DO NOTHING;
