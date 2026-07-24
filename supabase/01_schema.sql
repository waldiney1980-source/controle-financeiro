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
