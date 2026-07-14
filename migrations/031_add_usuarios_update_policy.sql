-- Migration 031: Add update policy for usuarios table
-- Permite que usuários alterem seu próprio nome no perfil do portal

CREATE POLICY "usuarios_self_update" ON public.usuarios
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Garante privilégio de update específico nas colunas que o usuário pode atualizar
GRANT UPDATE (nome) ON public.usuarios TO authenticated;
