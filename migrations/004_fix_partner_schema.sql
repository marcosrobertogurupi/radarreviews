-- Remove a coluna "type" que foi criada manualmente e está causando conflito de constraint
ALTER TABLE partners DROP COLUMN IF EXISTS type;
