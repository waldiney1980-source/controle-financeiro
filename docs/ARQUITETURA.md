# Arquitetura — FinControl AI

## 1. Princípios

1. **Simplicidade primeiro.** Frontend sem build (HTML/CSS/JS puro) — abre no navegador, publica no GitHub Pages, vira PWA sem toolchain.
2. **Backend gerenciado.** Supabase entrega Auth + PostgreSQL + RLS + Storage sem servidor próprio.
3. **Segurança por padrão.** Todo dado é isolado por usuário no banco (RLS), não na aplicação.
4. **Offline-first.** O app funciona sem rede (localStorage + Service Worker) e sincroniza quando o Supabase está configurado.
5. **Inteligência no cliente.** Projeções e categorização começam como heurísticas em JS; evoluem para funções SQL/serviços quando necessário.

## 2. Camadas

### 2.1 Frontend (PWA)
- **HTML/CSS/JS puro**, single-page com navegação por seções.
- `store.js`: camada de dados única. Fala com Supabase **se** `config.js` estiver preenchido; senão usa `localStorage` (modo demo/offline).
- `forecast.js`: motor de inteligência financeira (fluxo de caixa projetado, padrões, metas).
- `app.js`: renderização de dashboards, KPIs e formulários.
- **PWA**: `manifest.webmanifest` (instalável) + `sw.js` (cache offline).

### 2.2 Backend (Supabase)
- **Auth**: e-mail/senha, recuperação de senha, sessão via JWT.
- **PostgreSQL**: tabelas normalizadas (ver `MODELO-DADOS.md`).
- **RLS**: cada linha carrega `user_id`; políticas garantem `auth.uid() = user_id`.
- **Views/Funções**: KPIs mensais, saldo projetado, resumo por categoria — cálculo no banco reduz lógica duplicada no cliente.
- **Storage**: comprovantes e arquivos importados (bucket privado por usuário).

## 3. Fluxos principais

### 3.1 Lançamento de transação
```
Usuário → formulário → store.addTransaction()
        → (Supabase) INSERT em transactions  [RLS valida user_id]
        → recalcula KPIs → re-render dashboard
```

### 3.2 Importação de extrato
```
Arquivo (CSV/OFX/XLSX) → parser no cliente → normaliza { data, descrição, valor }
        → sugere categoria (regras + histórico) → usuário confirma/ajusta
        → store.bulkInsert(transactions) → aprende regra descrição→categoria
```

### 3.3 Projeção de fluxo de caixa
```
saldo_atual + Σ(receitas recorrentes previstas) − Σ(despesas recorrentes + parcelas futuras)
        → série diária para 30/90/180/365 dias
        → detecta datas de saldo negativo → gera alertas de risco
```

## 4. Inteligência financeira (evolução)

| Recurso | MVP (JS, heurística) | Profissional |
|---|---|---|
| Categorização | Regras por palavra-chave + memória de escolhas | Modelo estatístico / embeddings |
| Previsão de gastos | Média móvel + sazonalidade por categoria | Regressão / séries temporais |
| Metas automáticas | % da renda por categoria | Otimização com restrições |
| Alertas de risco | Saldo projetado < reserva | Score de risco multifator |

## 5. Segurança

- **Autenticação**: Supabase Auth (bcrypt/scrypt gerenciado), tokens JWT com expiração.
- **Autorização**: RLS obrigatório em **todas** as tabelas — sem política, sem acesso.
- **Chaves**: só a `anon key` (pública) vai ao cliente; `service_role` nunca sai do servidor. `config.js` real fica fora do Git (`config.local.js` no `.gitignore`).
- **Dados sensíveis**: números de conta/cartão gravados apenas mascarados (ex.: `**** 1234`). Sem armazenar CVV, senha de banco ou credenciais de terceiros.
- **Transporte**: HTTPS ponta a ponta (Supabase + GitHub Pages/host).
- **Recuperação de senha**: fluxo nativo do Supabase por e-mail.
- **Auditoria**: colunas `created_at`/`updated_at` em todas as tabelas.

## 6. Decisões técnicas (ADRs resumidos)

- **JS puro em vez de React**: menor atrito para publicar/instalar, sem Node/build; suficiente para o MVP. Migração para framework é possível na Fase 3.
- **Supabase em vez de backend próprio**: elimina infra; RLS cobre multiusuário.
- **Projeções no cliente**: iteração rápida; migram para SQL quando os dados crescerem.
- **localStorage como fallback**: permite demonstrar o produto sem configurar backend.

## 7. Publicação

- **Frontend**: GitHub Pages (pasta `web/`) ou Netlify/Vercel (estático).
- **Banco**: Supabase (nuvem gerenciada).
- **CI/CD (Fase 2+)**: GitHub Actions para lint e deploy automático do `web/`.
