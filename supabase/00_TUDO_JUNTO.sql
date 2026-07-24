-- ============================================================
-- 01_schema.sql
-- ============================================================
-- =============================================================
-- FinControl AI — 01_schema.sql
-- Tabelas, tipos e índices. Rode este script primeiro.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Tipos enumerados ----------
do $$ begin
  create type account_type   as enum ('corrente','poupanca','carteira','digital');
  create type tx_type         as enum ('receita','despesa');
  create type recurrence_type as enum ('nenhuma','semanal','mensal','anual');
  create type invoice_status  as enum ('aberta','fechada','paga');
  create type invest_type     as enum ('renda_fixa','acoes','fii','cripto','fundo','outro');
  create type loan_type       as enum ('emprestimo','financiamento','consignado');
  create type cycle_type      as enum ('mensal','anual');
  create type goal_status     as enum ('ativa','concluida','pausada');
exception when duplicate_object then null; end $$;

-- ---------- profiles (1-1 com auth.users) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  moeda text not null default 'BRL',
  reserva_emergencia_meta numeric(4,1) not null default 6,  -- em meses
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- accounts ----------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo account_type not null default 'corrente',
  banco text,
  numero_mascarado text,
  saldo_inicial numeric(14,2) not null default 0,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- cards ----------
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  nome text not null,
  bandeira text,
  numero_mascarado text,
  limite numeric(14,2) not null default 0,
  dia_fechamento int check (dia_fechamento between 1 and 31),
  dia_vencimento int check (dia_vencimento between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- categories (auto-relacionamento) ----------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo tx_type not null default 'despesa',
  cor text default '#2563eb',
  icone text default '📦',
  parent_id uuid references categories(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- invoices (faturas de cartão) ----------
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  competencia date not null,      -- 1º dia do mês de referência
  fechamento date,
  vencimento date,
  total numeric(14,2) not null default 0,
  status invoice_status not null default 'aberta',
  created_at timestamptz not null default now(),
  unique (card_id, competencia)
);

-- ---------- transactions (receitas e despesas) ----------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  card_id uuid references cards(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  descricao text not null,
  valor numeric(14,2) not null check (valor >= 0),
  tipo tx_type not null,
  data date not null default current_date,
  recorrencia recurrence_type not null default 'nenhuma',
  estabelecimento text,
  conciliada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- loans (empréstimos/financiamentos) ----------
create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo loan_type not null default 'emprestimo',
  valor_total numeric(14,2) not null,
  taxa_juros numeric(6,3) default 0,     -- % a.m.
  parcelas_total int not null,
  parcelas_pagas int not null default 0,
  inicio date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- installments (parcelamentos) ----------
create table if not exists installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  loan_id uuid references loans(id) on delete cascade,
  numero int not null,
  total int not null,
  valor numeric(14,2) not null,
  vencimento date not null,
  paga boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- investments ----------
create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo invest_type not null default 'renda_fixa',
  valor_aplicado numeric(14,2) not null default 0,
  valor_atual numeric(14,2) not null default 0,
  rentabilidade numeric(8,3) default 0,
  data_aplicacao date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- subscriptions (assinaturas) ----------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid references cards(id) on delete set null,
  nome text not null,
  valor numeric(14,2) not null,
  dia_cobranca int check (dia_cobranca between 1 and 31),
  ciclo cycle_type not null default 'mensal',
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- goals (metas) ----------
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  valor_alvo numeric(14,2) not null,
  valor_atual numeric(14,2) not null default 0,
  prazo date,
  status goal_status not null default 'ativa',
  created_at timestamptz not null default now()
);

-- ---------- budgets (orçamento mensal por categoria) ----------
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  competencia date not null,   -- 1º dia do mês
  limite numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (category_id, competencia)
);

-- ---------- Índices ----------
create index if not exists idx_tx_user_data     on transactions(user_id, data);
create index if not exists idx_tx_user_cat      on transactions(user_id, category_id);
create index if not exists idx_tx_user_tipo     on transactions(user_id, tipo);
create index if not exists idx_inst_user_venc   on installments(user_id, vencimento);
create index if not exists idx_inst_paga        on installments(user_id, paga);
create index if not exists idx_budget_user_comp on budgets(user_id, competencia);
create index if not exists idx_invoice_card     on invoices(card_id, competencia);
create index if not exists idx_cat_user         on categories(user_id, tipo);


-- ============================================================
-- 02_rls_policies.sql
-- ============================================================
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


-- ============================================================
-- 03_functions_views.sql
-- ============================================================
-- =============================================================
-- FinControl AI — 03_functions_views.sql
-- Views e funções para KPIs e projeções. Rode após 02_rls_policies.sql.
-- As views herdam o RLS das tabelas base (security_invoker).
-- =============================================================

-- Atualiza updated_at automaticamente
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','cards','transactions']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on %1$s
                    for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ---------- Resumo mensal (receita, despesa, saldo) ----------
create or replace view v_monthly_summary
with (security_invoker = true) as
select
  user_id,
  date_trunc('month', data)::date as competencia,
  sum(valor) filter (where tipo = 'receita') as receitas,
  sum(valor) filter (where tipo = 'despesa') as despesas,
  coalesce(sum(valor) filter (where tipo='receita'),0)
    - coalesce(sum(valor) filter (where tipo='despesa'),0) as saldo
from transactions
group by user_id, date_trunc('month', data);

-- ---------- Gasto por categoria (mês corrente) ----------
create or replace view v_category_spending
with (security_invoker = true) as
select
  t.user_id,
  t.category_id,
  c.nome as categoria,
  c.cor,
  date_trunc('month', t.data)::date as competencia,
  sum(t.valor) as total
from transactions t
left join categories c on c.id = t.category_id
where t.tipo = 'despesa'
group by t.user_id, t.category_id, c.nome, c.cor, date_trunc('month', t.data);

-- ---------- Saldo atual por conta ----------
create or replace view v_account_balance
with (security_invoker = true) as
select
  a.user_id,
  a.id as account_id,
  a.nome,
  a.saldo_inicial
    + coalesce(sum(t.valor) filter (where t.tipo='receita'),0)
    - coalesce(sum(t.valor) filter (where t.tipo='despesa'),0) as saldo_atual
from accounts a
left join transactions t on t.account_id = a.id
group by a.user_id, a.id, a.nome, a.saldo_inicial;

-- ---------- Função: saldo projetado para N dias ----------
-- Considera saldo atual + parcelas futuras a vencer no período.
create or replace function fn_saldo_projetado(dias int default 30)
returns numeric
language sql stable security invoker as $$
  with saldo as (
    select coalesce(sum(saldo_atual),0) as base
    from v_account_balance where user_id = auth.uid()
  ),
  parcelas as (
    select coalesce(sum(valor),0) as a_pagar
    from installments
    where user_id = auth.uid()
      and paga = false
      and vencimento <= current_date + (dias || ' days')::interval
  )
  select (select base from saldo) - (select a_pagar from parcelas);
$$;

-- ---------- Função: KPIs do dashboard (JSON) ----------
create or replace function fn_dashboard_kpis()
returns json
language sql stable security invoker as $$
  select json_build_object(
    'saldo_atual',      (select coalesce(sum(saldo_atual),0) from v_account_balance where user_id = auth.uid()),
    'receitas_mes',     (select coalesce(receitas,0) from v_monthly_summary where user_id = auth.uid() and competencia = date_trunc('month', current_date)::date),
    'despesas_mes',     (select coalesce(despesas,0) from v_monthly_summary where user_id = auth.uid() and competencia = date_trunc('month', current_date)::date),
    'projecao_30d',     fn_saldo_projetado(30),
    'projecao_90d',     fn_saldo_projetado(90),
    'projecao_180d',    fn_saldo_projetado(180),
    'projecao_365d',    fn_saldo_projetado(365)
  );
$$;


-- ============================================================
-- 04_seed.sql
-- ============================================================
-- =============================================================
-- FinControl AI — 04_seed.sql
-- Categorias padrão. Rode logado (auth.uid() precisa existir) OU
-- adapte para inserir para um usuário específico.
-- =============================================================

-- Insere categorias padrão para o usuário autenticado.
-- Chame após o primeiro login: select seed_default_categories();
create or replace function seed_default_categories()
returns void
language plpgsql security invoker as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Nenhum usuário autenticado';
  end if;

  insert into categories (user_id, nome, tipo, cor, icone) values
    -- Receitas
    (uid,'Aluguel','receita','#22c55e','🏠'),
    (uid,'IR','receita','#0ea5e9','🧾'),
    (uid,'Salário Dani','receita','#16a34a','💼'),
    (uid,'Outros','receita','#84cc16','➕'),
    -- Despesas essenciais
    (uid,'Moradia','despesa','#ef4444','🏠'),
    (uid,'Alimentação','despesa','#f97316','🍽️'),
    (uid,'Transporte','despesa','#eab308','🚗'),
    (uid,'Saúde','despesa','#ec4899','⚕️'),
    (uid,'Educação','despesa','#8b5cf6','📚'),
    (uid,'Contas/Utilidades','despesa','#06b6d4','💡'),
    -- Estilo de vida
    (uid,'Lazer','despesa','#f43f5e','🎮'),
    (uid,'Assinaturas','despesa','#a855f7','📺'),
    (uid,'Compras','despesa','#14b8a6','🛍️'),
    (uid,'Restaurante','despesa','#fb923c','🍔'),
    -- Financeiro
    (uid,'Cartão de crédito','despesa','#64748b','💳'),
    (uid,'Empréstimos','despesa','#dc2626','🏦'),
    (uid,'Impostos/Taxas','despesa','#78716c','🧾'),
    (uid,'Outras despesas','despesa','#6b7280','📦')
  on conflict do nothing;
end $$;


