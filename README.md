# FinControl AI — Controle Financeiro Pessoal e Familiar

Sistema completo de gestão financeira pessoal e familiar com dashboard web (PWA),
banco de dados Supabase (PostgreSQL), importação de extratos e inteligência financeira
(previsão de fluxo de caixa, categorização automática e sugestões de economia).

> Status: **MVP em construção** · Stack: HTML5 + CSS3 + JavaScript puro (sem build) + Supabase

---

## 1. Visão geral

O FinControl AI centraliza toda a vida financeira da família em um só lugar:

- **Contas, cartões, investimentos, empréstimos e assinaturas** cadastrados e conciliados.
- **Receitas e despesas** recorrentes e eventuais, com parcelamentos.
- **Importação de extratos** (CSV, XLSX, OFX) e faturas de cartão, com categorização automática.
- **Planejamento**: projeção de saldo para 30/90/180/365 dias, simulação de cenários e alertas de risco.
- **Inteligência financeira**: padrões de consumo, previsão de gastos por categoria e metas automáticas.
- **Dashboards e indicadores**: receita x despesa, evolução patrimonial, taxa de poupança, comprometimento de renda, reserva de emergência.

## 2. Arquitetura (resumo)

```
┌─────────────────────────────────────────────────────────────┐
│  Cliente (PWA) — HTML5 + CSS3 + JS puro                      │
│  • Dashboard, cadastros, importador CSV/OFX, projeções      │
│  • Service Worker (offline) + manifest (instalável)         │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS (supabase-js via CDN)
┌───────────────▼─────────────────────────────────────────────┐
│  Supabase                                                    │
│  • Auth (e-mail/senha, recuperação)                          │
│  • PostgreSQL + Row Level Security (isolamento por usuário)  │
│  • Views e funções SQL (KPIs, projeções, categorização)     │
│  • Storage (comprovantes, arquivos importados)              │
└─────────────────────────────────────────────────────────────┘
```

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## 3. Estrutura de pastas

```
controle-financeiro/
├── README.md                  ← este arquivo
├── .gitignore
├── docs/
│   ├── ARQUITETURA.md         ← arquitetura, decisões técnicas, segurança
│   ├── MODELO-DADOS.md        ← dicionário de dados (tabelas e colunas)
│   ├── DIAGRAMA-ER.md         ← diagrama entidade-relacionamento (Mermaid)
│   └── ROADMAP.md             ← MVP → versão profissional
├── supabase/
│   ├── 01_schema.sql          ← tabelas, tipos, índices
│   ├── 02_rls_policies.sql    ← Row Level Security (isolamento por usuário)
│   ├── 03_functions_views.sql ← funções, views e triggers (KPIs, projeções)
│   └── 04_seed.sql            ← dados iniciais (categorias padrão)
└── web/
    ├── index.html             ← app single-page (PWA)
    ├── manifest.webmanifest
    ├── sw.js                  ← service worker (offline)
    ├── css/styles.css
    ├── js/
    │   ├── config.js          ← credenciais Supabase (não commitar as reais)
    │   ├── supabaseClient.js   ← inicialização do cliente
    │   ├── store.js           ← estado + camada de dados (Supabase ou local)
    │   ├── forecast.js        ← projeções e inteligência financeira
    │   └── app.js             ← UI, navegação, render dos dashboards
    └── assets/icons/
```

## 4. Como rodar (MVP local)

O MVP roda **100% no navegador**, sem instalar nada. Por enquanto usa dados de
demonstração em `localStorage` (modo offline). A integração com Supabase é opcional
e ativada preenchendo `web/js/config.js`.

**Windows (recomendado, sem Python/Node):** clique com o botão direito em
`serve.ps1` → *Executar com PowerShell*. Ele sobe um servidor local e abre o
navegador em `http://localhost:5173` automaticamente.

Ou, se tiver Python/Node instalados:

```bash
python -m http.server 5173 --directory web
```

```bash
npx serve web
```

Depois acesse `http://localhost:5173`.

> Abrir o `index.html` com duplo clique também funciona para a maioria das telas,
> mas o Service Worker (offline/PWA) exige servir via `http://` ou `https://`.

## 5. Integração com Supabase (opcional no MVP)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, rode em ordem: `supabase/01_schema.sql`, `02_rls_policies.sql`, `03_functions_views.sql`, `04_seed.sql`.
3. Copie a **Project URL** e a **anon key** (Settings → API) para `web/js/config.js`.
4. Recarregue o app: ele passa a ler/gravar no Supabase com login por e-mail/senha.

> A `anon key` é pública por design — a segurança vem do **Row Level Security** (RLS),
> que garante que cada usuário só enxerga os próprios dados. Nunca exponha a `service_role key`.

## 6. Roadmap

Ver [`docs/ROADMAP.md`](docs/ROADMAP.md). Resumo:

- **Fase 1 — MVP (atual):** dashboard, receitas/despesas, cartões, orçamento, metas, projeção simples, importação CSV.
- **Fase 2 — Integração:** Supabase (auth + RLS), importação OFX/XLSX, categorização com aprendizado, PWA instalável.
- **Fase 3 — Profissional:** investimentos, patrimônio, simulador de cenários, alertas, relatórios avançados, planilha Excel sincronizada.

## 7. Segurança

- Autenticação via Supabase Auth (e-mail/senha + recuperação).
- Isolamento total por usuário via RLS em todas as tabelas.
- Dados sensíveis (nº de conta/cartão) armazenados mascarados; segredos nunca vão ao repositório.
- Ver [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) seção *Segurança*.

## 8. Licença

Uso pessoal. Defina a licença antes de publicar (sugestão: MIT ou privado).
