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
