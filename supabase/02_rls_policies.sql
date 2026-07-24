-- =============================================================
-- FinControl AI — 02_rls_policies.sql
-- Row Level Security: cada usuário só acessa os próprios dados.
-- Rode após 01_schema.sql.
-- =============================================================

-- Habilita RLS em todas as tabelas
alter table profiles       enable row level security;
alter table accounts       enable row level security;
alter table cards          enable row level security;
alter table categories     enable row level security;
alter table invoices       enable row level security;
alter table transactions   enable row level security;
alter table loans          enable row level security;
alter table installments   enable row level security;
alter table investments    enable row level security;
alter table subscriptions  enable row level security;
alter table goals          enable row level security;
alter table budgets        enable row level security;

-- ---------- profiles (id = auth.uid()) ----------
create policy "profiles_select" on profiles for select using (auth.uid() = id);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- ---------- Política padrão (user_id = auth.uid()) ----------
-- Aplicada a todas as demais tabelas via bloco dinâmico.
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','cards','categories','invoices','transactions',
    'loans','installments','investments','subscriptions','goals','budgets'
  ]
  loop
    execute format($f$
      create policy "%1$s_select" on %1$s for select using (auth.uid() = user_id);
      create policy "%1$s_insert" on %1$s for insert with check (auth.uid() = user_id);
      create policy "%1$s_update" on %1$s for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
      create policy "%1$s_delete" on %1$s for delete using (auth.uid() = user_id);
    $f$, t);
  end loop;
end $$;

-- ---------- Criação automática de perfil no cadastro ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
