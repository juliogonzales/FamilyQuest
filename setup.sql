-- =====================================================================
-- FamilyQuest — estrutura do banco no Supabase
-- Rode UMA vez: Supabase → SQL Editor → New query → cole tudo → Run.
-- (Pode rodar de novo sem problemas; ele não apaga dados.)
-- =====================================================================

-- ---------- Tabelas ----------
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  state      jsonb not null default '{}'::jsonb,   -- todos os dados da casa (tarefas, pontos, prêmios...)
  rev        integer not null default 0,           -- sobe a cada gravação (controle de conflito)
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'manager',    -- 'owner' (quem criou) ou 'manager'
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.invites (
  code         text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '7 days')
);

-- ---------- Segurança (RLS): cada usuário só vê as casas das quais é membro ----------
alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.invites    enable row level security;

create or replace function public.is_member(h uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.members m where m.household_id = h and m.user_id = auth.uid());
$$;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated using (public.is_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated using (user_id = auth.uid() or public.is_member(household_id));

-- Convites: nenhuma policy → ninguém acessa a tabela direto; só pelas funções abaixo.
-- Inserir/remover membros e casas também só pelas funções.

-- O app só pode alterar a coluna "state" (não o nome, dono, etc.)
revoke all on public.households from anon, authenticated;
grant select on public.households to authenticated;
grant update (state) on public.households to authenticated;
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;
revoke all on public.invites from anon, authenticated;

-- ---------- Controle de versão automático a cada gravação ----------
create or replace function public.bump_rev()
returns trigger language plpgsql as $$
begin
  new.rev := old.rev + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists households_bump on public.households;
create trigger households_bump before update on public.households
  for each row execute function public.bump_rev();

-- ---------- Funções chamadas pelo app ----------
-- Criar uma casa (quem cria vira "owner")
create or replace function public.create_household(p_name text, p_state jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  insert into public.households (name, state)
  values (coalesce(nullif(trim(p_name), ''), 'Minha casa'), coalesce(p_state, '{}'::jsonb))
  returning id into v_id;
  insert into public.members (household_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

-- Gerar código de convite (uso único, vale 7 dias) para outro gestor
create or replace function public.create_invite(p_household uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_code text;
begin
  if not public.is_member(p_household) then raise exception 'Sem permissão'; end if;
  delete from public.invites where expires_at < now();
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, household_id, created_by) values (v_code, p_household, auth.uid());
  return v_code;
end $$;

-- Entrar numa casa usando um código de convite
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_h uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select household_id into v_h from public.invites
   where code = upper(trim(p_code)) and expires_at > now();
  if v_h is null then raise exception 'Convite inválido ou expirado'; end if;
  insert into public.members (household_id, user_id, role) values (v_h, auth.uid(), 'manager')
  on conflict do nothing;
  delete from public.invites where code = upper(trim(p_code));
  return v_h;
end $$;

revoke execute on function public.create_household(text, jsonb) from public, anon;
revoke execute on function public.create_invite(uuid)            from public, anon;
revoke execute on function public.join_household(text)           from public, anon;
grant  execute on function public.create_household(text, jsonb) to authenticated;
grant  execute on function public.create_invite(uuid)            to authenticated;
grant  execute on function public.join_household(text)           to authenticated;

-- ---------- Tempo real (avisos chegam sem recarregar) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'households'
  ) then
    alter publication supabase_realtime add table public.households;
  end if;
end $$;
