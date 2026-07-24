# Roadmap — FinControl AI

## Fase 1 — MVP (foco atual)
**Objetivo:** provar o valor no navegador, sem backend obrigatório.

- [x] Estrutura do projeto + documentação + modelo de dados
- [x] Scripts SQL do Supabase (schema, RLS, views, seed)
- [x] Dashboard com KPIs (saldo, receita, despesa, taxa de poupança)
- [x] Cadastro de receitas e despesas (com recorrência)
- [x] Cartões, orçamento por categoria e metas
- [x] Projeção de saldo (30/90/180/365 dias) — heurística
- [x] Importação de extrato CSV com sugestão de categoria
- [x] Modo offline (localStorage) + estrutura PWA

**Critério de conclusão:** usuário controla o mês inteiro sem planilha.

## Fase 2 — Integração e dados reais
**Objetivo:** multiusuário seguro e importação robusta.

- [ ] Login/cadastro/recuperação via Supabase Auth
- [ ] Migrar `store.js` para ler/gravar no Supabase com RLS
- [ ] Importação OFX e XLSX (além de CSV)
- [ ] Categorização com aprendizado (memória descrição→categoria por usuário)
- [ ] Conciliação de extrato x lançamentos
- [ ] Gestão de faturas de cartão (fechamento/vencimento automáticos)
- [ ] PWA instalável + sincronização offline→online
- [ ] Deploy: GitHub Pages (web) + Supabase (dados)

## Fase 3 — Versão profissional
**Objetivo:** planejamento e patrimônio.

- [ ] Investimentos e evolução patrimonial
- [ ] Empréstimos/financiamentos com amortização e impacto no fluxo
- [ ] Simulador de cenários ("e se eu cortar X?", "e se a renda cair?")
- [ ] Alertas de risco financeiro e sugestões de economia personalizadas
- [ ] Previsão por categoria com sazonalidade
- [ ] Relatórios avançados (comparativo mensal/anual, tendências)
- [ ] Exportação/So sincronização com planilha Excel
- [ ] Multiusuário familiar (perfis compartilhados com permissões)

## Fase 4 — Escala (futuro)
- [ ] Integração Open Finance (APIs bancárias)
- [ ] App mobile nativo (ou PWA aprimorada)
- [ ] Notificações push (vencimentos, metas, alertas)
- [ ] Backup e exportação de dados (LGPD)

## Entregáveis por fase
| # | Entregável | Fase |
|---|---|---|
| 1 | Arquitetura completa | 1 ✅ |
| 2 | Modelo de banco de dados | 1 ✅ |
| 3 | Diagrama ER | 1 ✅ |
| 4 | Estrutura de pastas | 1 ✅ |
| 5 | Código HTML inicial | 1 ✅ |
| 6 | Estrutura Supabase | 1 ✅ |
| 7 | Scripts SQL | 1 ✅ |
| 8 | Roadmap | 1 ✅ |
| 9 | MVP funcional | 1 ✅ |
| 10 | Evolução profissional | 2–3 |
