/* ===========================================================
 * forecast.js — Inteligência financeira do FinControl AI
 * Projeção de fluxo de caixa, indicadores e sugestões de economia.
 * Puro em JS (heurísticas). Evolui para SQL/serviços na Fase 3.
 * =========================================================== */
window.FC = window.FC || {};

FC.Forecast = (function () {
  const isSameMonth = (dateStr, ref) => {
    const d = new Date(dateStr);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  };

  // Totais do mês corrente
  function monthTotals(tx, ref = new Date()) {
    let receitas = 0, despesas = 0;
    tx.forEach((t) => {
      if (!isSameMonth(t.data, ref)) return;
      if (t.tipo === "receita") receitas += +t.valor || 0;
      else despesas += +t.valor || 0;
    });
    return { receitas, despesas, saldo: receitas - despesas };
  }

  // Saldo atual = saldo inicial das contas + receitas - despesas (todas)
  function currentBalance(tx, accounts) {
    const base = accounts.reduce((s, a) => s + (+a.saldo_inicial || 0), 0);
    const flow = tx.reduce((s, t) => s + (t.tipo === "receita" ? +t.valor : -+t.valor || 0), 0);
    return base + flow;
  }

  // Fluxo recorrente mensal previsto (receitas e despesas marcadas como mensal)
  function monthlyRecurring(tx) {
    let rec = 0, desp = 0;
    tx.forEach((t) => {
      if (t.recorrencia !== "mensal") return;
      if (t.tipo === "receita") rec += +t.valor || 0;
      else desp += +t.valor || 0;
    });
    return { receitas: rec, despesas: desp, liquido: rec - desp };
  }

  // Média mensal de despesas (usa o mês atual como base simples no MVP)
  function avgMonthlyExpense(tx, ref = new Date()) {
    // agrupa por ano-mês
    const byMonth = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa") return;
      const k = t.data.slice(0, 7);
      byMonth[k] = (byMonth[k] || 0) + (+t.valor || 0);
    });
    const vals = Object.values(byMonth);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // Projeção de saldo para uma série de meses à frente
  function projectSeries(tx, accounts, months = 12) {
    const start = currentBalance(tx, accounts);
    const { liquido } = monthlyRecurring(tx);
    const series = [];
    let saldo = start;
    for (let i = 1; i <= months; i++) {
      saldo += liquido;
      series.push({ mes: i, saldo });
    }
    return { start, liquidoMensal: liquido, series };
  }

  // Saldo projetado por horizonte de dias
  function projectByDays(tx, accounts) {
    const { start, liquidoMensal } = projectSeries(tx, accounts, 12);
    const perDay = liquidoMensal / 30;
    const at = (dias) => Math.round((start + perDay * dias) * 100) / 100;
    return { d30: at(30), d90: at(90), d180: at(180), d365: at(365) };
  }

  // Indicadores derivados
  function indicators(tx, accounts, goals, reservaMetaMeses = 6) {
    const mt = monthTotals(tx);
    const saldoAtual = currentBalance(tx, accounts);
    const media = avgMonthlyExpense(tx);
    const taxaPoupanca = mt.receitas > 0 ? (mt.saldo / mt.receitas) * 100 : 0;
    const comprometimento = mt.receitas > 0 ? (mt.despesas / mt.receitas) * 100 : 0;
    const capacidadeInvestir = Math.max(0, mt.saldo);
    const reservaMeta = media * reservaMetaMeses;
    const reservaGoal = goals.find((g) => /reserva/i.test(g.nome));
    const reservaAtual = reservaGoal ? reservaGoal.valor_atual : 0;
    return {
      saldoAtual,
      receitasMes: mt.receitas,
      despesasMes: mt.despesas,
      taxaPoupanca,
      comprometimento,
      mediaMensal: media,
      capacidadeInvestir,
      reservaAtual,
      reservaMeta
    };
  }

  // Sugestões de economia (heurísticas simples sobre o mês)
  function insights(tx, budgets, categoryById) {
    const out = [];
    const ref = new Date();

    // 1) Estouro de orçamento por categoria
    const gastoCat = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa" || !isSameMonth(t.data, ref)) return;
      gastoCat[t.category_id] = (gastoCat[t.category_id] || 0) + (+t.valor || 0);
    });
    budgets.forEach((b) => {
      const gasto = gastoCat[b.category_id] || 0;
      const cat = categoryById(b.category_id);
      if (!cat) return;
      const pct = b.limite > 0 ? (gasto / b.limite) * 100 : 0;
      if (pct >= 100)
        out.push({ level: "bad", text: `${cat.icone} ${cat.nome}: orçamento estourado (${pct.toFixed(0)}% de R$ ${b.limite}).` });
      else if (pct >= 80)
        out.push({ level: "warn", text: `${cat.icone} ${cat.nome}: ${pct.toFixed(0)}% do orçamento usado.` });
    });

    // 2) Concentração de gastos (categoria dominante)
    const total = Object.values(gastoCat).reduce((a, b) => a + b, 0);
    let topId = null, topVal = 0;
    Object.entries(gastoCat).forEach(([id, v]) => { if (v > topVal) { topVal = v; topId = id; } });
    if (topId && total > 0) {
      const share = (topVal / total) * 100;
      if (share >= 35) {
        const cat = categoryById(topId);
        out.push({ level: "warn", text: `${cat ? cat.icone + " " + cat.nome : "Uma categoria"} concentra ${share.toFixed(0)}% dos gastos. Vale rever.` });
      }
    }

    // 3) Assinaturas somadas
    const assinaturas = tx.filter((t) => t.tipo === "despesa" && t.recorrencia === "mensal" && isSameMonth(t.data, ref) && /assinatura|streaming|netflix|spotify|plano/i.test((categoryById(t.category_id)?.nome || "") + " " + t.descricao));
    const somaAss = assinaturas.reduce((s, t) => s + (+t.valor || 0), 0);
    if (somaAss > 0)
      out.push({ level: "info", text: `Você gasta ~R$ ${somaAss.toFixed(2)}/mês em recorrências. Cancelar 1 já economiza no ano.` });

    if (!out.length) out.push({ level: "ok", text: "Tudo sob controle este mês. 👍" });
    return out;
  }

  // Alertas de risco a partir da projeção
  function riskAlerts(tx, accounts, reservaMeta) {
    const alerts = [];
    const { start, liquidoMensal, series } = projectSeries(tx, accounts, 12);
    if (liquidoMensal < 0)
      alerts.push({ level: "bad", text: `Seu fluxo recorrente é negativo (R$ ${liquidoMensal.toFixed(2)}/mês). No ritmo atual o saldo cai continuamente.` });
    const negativo = series.find((s) => s.saldo < 0);
    if (negativo)
      alerts.push({ level: "bad", text: `Projeção indica saldo negativo em ~${negativo.mes} mês(es).` });
    if (start < reservaMeta)
      alerts.push({ level: "warn", text: `Saldo atual abaixo da reserva de emergência recomendada (R$ ${reservaMeta.toFixed(2)}).` });
    if (!alerts.length)
      alerts.push({ level: "ok", text: "Nenhum risco relevante detectado na projeção de 12 meses." });
    return alerts;
  }

  return {
    monthTotals, currentBalance, monthlyRecurring, avgMonthlyExpense,
    projectSeries, projectByDays, indicators, insights, riskAlerts
  };
})();
