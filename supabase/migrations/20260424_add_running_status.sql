-- Migração para adicionar o status 'running' ao enum de conectores
-- Isso permite o bloqueio de coletas duplicadas

ALTER TYPE connector_status ADD VALUE IF NOT EXISTS 'running';
