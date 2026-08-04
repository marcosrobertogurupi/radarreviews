-- ============================================================
-- 039: CORREÇÃO E RESILIÊNCIA DO WIDGET DE REVIEWS (TOKEN & RLS)
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- Adiciona as colunas caso não existam no banco de produção
alter table public.tenants
  add column if not exists widget_token text default gen_random_uuid()::text,
  add column if not exists widget_config jsonb default '{"theme":"light","limit":5,"show_rating":true,"show_channel":true}'::jsonb;

-- Garantir defaults e preenchimento de valores nulos
alter table public.tenants
  alter column widget_token set default gen_random_uuid()::text;

update public.tenants
set widget_token = gen_random_uuid()::text
where widget_token is null;

alter table public.tenants
  alter column widget_config set default
    '{"theme":"light","limit":5,"show_rating":true,"show_channel":true}'::jsonb;

update public.tenants
set widget_config = '{"theme":"light","limit":5,"show_rating":true,"show_channel":true}'::jsonb
where widget_config is null;

alter table public.tenants enable row level security;

drop policy if exists "tenant_members_can_select_tenant" on public.tenants;
create policy "tenant_members_can_select_tenant"
on public.tenants
for select
to authenticated
using (
  id in (select tenant_id from public.tenant_users where user_id = auth.uid())
);

-- Não abrir UPDATE geral via RLS (evita permitir alterar plano, nome etc.).
-- Regeneração de token passa por função SECURITY DEFINER abaixo.
create or replace function public.regenerate_widget_token()
returns table (widget_token text, widget_config jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_token text;
begin
  select tenant_id into v_tenant_id
  from public.tenant_users
  where user_id = auth.uid()
  limit 1;

  if v_tenant_id is null then
    raise exception 'Usuário autenticado sem tenant associado em tenant_users';
  end if;

  v_token := gen_random_uuid()::text;

  update public.tenants
  set widget_token = v_token
  where id = v_tenant_id;

  return query
    select t.widget_token, t.widget_config
    from public.tenants t
    where t.id = v_tenant_id;
end;
$$;

grant execute on function public.regenerate_widget_token() to authenticated;

commit;
