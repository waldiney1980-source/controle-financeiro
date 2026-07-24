-- =============================================================
-- FinControl AI — 05_family_state.sql  (FASE 2)
-- "Cofre" financeiro COMPARTILHADO da família.
--
-- Em vez de isolar dados por usuário, todos os membros da família
-- (usuários autenticados) leem e gravam UMA ÚNICA linha em JSON.
-- Assim, qualquer alteração feita por um aparece para todos.
--
-- Rode este script no SQL Editor do Supabase (uma vez).
-- =============================================================

-- Tabela com uma única linha (id = 1) contendo todo o estado do app.
create table if not exists family_state (
  id          int primary key default 1,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,   -- só informativo (quem editou por último); sem FK de propósito
  constraint family_state_single_row check (id = 1)
);

-- Remove a trava antiga (se a tabela já existia com a foreign key).
-- Ela quebrava a gravação se o usuário logado tivesse sido apagado.
alter table family_state drop constraint if exists family_state_updated_by_fkey;

-- Garante que a linha exista.
insert into family_state (id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Segurança: qualquer usuário AUTENTICADO pode ler e gravar o cofre.
-- (O controle de quem entra é feito fechando o cadastro no painel de Auth.)
alter table family_state enable row level security;

drop policy if exists "family_state_select" on family_state;
drop policy if exists "family_state_insert" on family_state;
drop policy if exists "family_state_update" on family_state;

create policy "family_state_select" on family_state
  for select using (auth.uid() is not null);
create policy "family_state_insert" on family_state
  for insert with check (auth.uid() is not null);
create policy "family_state_update" on family_state
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- Atualiza updated_at/updated_by automaticamente a cada gravação.
create or replace function public.touch_family_state()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

drop trigger if exists trg_touch_family_state on family_state;
create trigger trg_touch_family_state
  before update on family_state
  for each row execute function public.touch_family_state();

-- Habilita sincronização em TEMPO REAL (todos veem mudanças na hora).
do $$
begin
  alter publication supabase_realtime add table family_state;
exception
  when duplicate_object then null;   -- já estava adicionada
  when undefined_object then null;   -- publicação não existe neste projeto
end $$;
