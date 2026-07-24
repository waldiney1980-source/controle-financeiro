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
    (uid,'Salário','receita','#16a34a','💼'),
    (uid,'Freelance','receita','#22c55e','🧑‍💻'),
    (uid,'Investimentos','receita','#0ea5e9','📈'),
    (uid,'Outras receitas','receita','#84cc16','➕'),
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
