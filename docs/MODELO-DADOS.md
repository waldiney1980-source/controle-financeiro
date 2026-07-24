# Modelo de Dados — Dicionário

Todas as tabelas têm `id uuid PK`, `user_id uuid` (dono), `created_at` e `updated_at`.
O isolamento é garantido por RLS (`auth.uid() = user_id`). Ver `supabase/01_schema.sql`.

## profiles
Perfil da aplicação, 1-1 com `auth.users`.

| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid PK | = auth.users.id |
| nome | text | Nome de exibição |
| email | text | E-mail |
| moeda | text | Moeda padrão (BRL) |
| reserva_emergencia_meta | numeric | Meta de reserva (nº de meses de despesa) |

## accounts (contas bancárias)
| Coluna | Tipo | Descrição |
|---|---|---|
| nome | text | Apelido da conta |
| tipo | text | corrente / poupanca / carteira / digital |
| banco | text | Instituição |
| numero_mascarado | text | Ex.: `**** 1234` |
| saldo_inicial | numeric | Saldo de abertura |
| ativa | boolean | Conta em uso |

## cards (cartões de crédito)
| Coluna | Tipo | Descrição |
|---|---|---|
| account_id | uuid FK | Conta de débito da fatura (opcional) |
| nome | text | Apelido |
| bandeira | text | Visa/Master/Elo/... |
| numero_mascarado | text | `**** 5678` |
| limite | numeric | Limite total |
| dia_fechamento | int | Dia de fechamento da fatura |
| dia_vencimento | int | Dia de vencimento |

## categories (categorias)
| Coluna | Tipo | Descrição |
|---|---|---|
| nome | text | Nome |
| tipo | text | receita / despesa |
| cor | text | Hex para gráficos |
| icone | text | Emoji/ícone |
| parent_id | uuid FK | Subcategoria (auto-relacionamento) |

## transactions (receitas e despesas)
Entidade central. Uma transação é receita OU despesa (`tipo`).

| Coluna | Tipo | Descrição |
|---|---|---|
| account_id | uuid FK | Conta de origem (se débito/pix) |
| card_id | uuid FK | Cartão (se crédito) |
| category_id | uuid FK | Categoria |
| invoice_id | uuid FK | Fatura, quando compra no crédito |
| descricao | text | Descrição |
| valor | numeric | Sempre positivo; sinal vem de `tipo` |
| tipo | text | receita / despesa |
| data | date | Data do fato |
| recorrencia | text | nenhuma / mensal / semanal / anual |
| estabelecimento | text | Comerciante (para análise por estabelecimento) |
| conciliada | boolean | Bateu com extrato importado |

## installments (parcelamentos)
Parcelas de uma compra parcelada ou de um empréstimo.

| Coluna | Tipo | Descrição |
|---|---|---|
| transaction_id | uuid FK | Compra parcelada de origem |
| loan_id | uuid FK | Empréstimo de origem |
| numero | int | Nº da parcela |
| total | int | Total de parcelas |
| valor | numeric | Valor da parcela |
| vencimento | date | Data de vencimento |
| paga | boolean | Quitada |

## invoices (faturas de cartão)
| Coluna | Tipo | Descrição |
|---|---|---|
| card_id | uuid FK | Cartão |
| competencia | date | Mês de referência (1º dia) |
| fechamento | date | Data de fechamento |
| vencimento | date | Data de vencimento |
| total | numeric | Total da fatura |
| status | text | aberta / fechada / paga |

## investments (investimentos)
| Coluna | Tipo | Descrição |
|---|---|---|
| nome | text | Ativo/produto |
| tipo | text | renda_fixa / acoes / fii / cripto / fundo |
| valor_aplicado | numeric | Aporte |
| valor_atual | numeric | Marcação atual |
| rentabilidade | numeric | % acumulado |
| data_aplicacao | date | Data do aporte |

## loans (empréstimos e financiamentos)
| Coluna | Tipo | Descrição |
|---|---|---|
| nome | text | Descrição |
| tipo | text | emprestimo / financiamento / consignado |
| valor_total | numeric | Valor contratado |
| taxa_juros | numeric | % a.m. |
| parcelas_total | int | Total |
| parcelas_pagas | int | Já pagas |
| inicio | date | Início do contrato |

## subscriptions (assinaturas)
| Coluna | Tipo | Descrição |
|---|---|---|
| card_id | uuid FK | Cartão de cobrança |
| nome | text | Serviço |
| valor | numeric | Valor por ciclo |
| dia_cobranca | int | Dia do mês |
| ciclo | text | mensal / anual |
| ativa | boolean | Vigente |

## goals (metas)
| Coluna | Tipo | Descrição |
|---|---|---|
| nome | text | Objetivo |
| valor_alvo | numeric | Meta |
| valor_atual | numeric | Acumulado |
| prazo | date | Data limite |
| status | text | ativa / concluida / pausada |

## budgets (orçamento mensal por categoria)
| Coluna | Tipo | Descrição |
|---|---|---|
| category_id | uuid FK | Categoria |
| competencia | date | Mês (1º dia) |
| limite | numeric | Teto planejado |

## Views (cálculo no banco)
- `v_monthly_summary` — receitas, despesas e saldo por mês/usuário.
- `v_category_spending` — gasto por categoria no mês corrente.
- `v_projected_balance` — série de saldo projetado (base para 30/90/180/365 dias).

Definições em `supabase/03_functions_views.sql`.
