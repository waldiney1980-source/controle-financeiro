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

  // Saldo atual = saldo inicial das contas + lançamentos ATÉ hoje
  // (lançamentos com data futura não entram no saldo atual)
  function currentBalance(tx, accounts) {
    const today = new Date().toISOString().slice(0, 10);
    const base = accounts.reduce((s, a) => s + (+a.saldo_inicial || 0), 0);
    const flow = tx.reduce((s, t) => {
      if (t.data > today) return s;
      return s + (t.tipo === "receita" ? (+t.valor || 0) : -(+t.valor || 0));
    }, 0);
    return base + flow;
  }

  // Lançamentos futuros pontuais (ex.: parcelas) agrupados por mês à frente
  function futureOneOffByMonth(tx) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const baseIdx = now.getFullYear() * 12 + now.getMonth();
    const buckets = {};
    tx.forEach((t) => {
      if (t.data <= todayStr) return;          // apenas futuro
      if (t.recorrencia === "mensal") return;  // recorrentes tratados à parte
      const d = new Date(t.data + "T00:00:00");
      let off = (d.getFullYear() * 12 + d.getMonth()) - baseIdx;
      if (off < 1) off = 1;                     // ainda este mês → conta no 1º passo
      const val = t.tipo === "receita" ? (+t.valor || 0) : -(+t.valor || 0);
      buckets[off] = (buckets[off] || 0) + val;
    });
    return buckets;
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
  // Cada mês = saldo anterior + fluxo recorrente + parcelas/compromissos daquele mês
  function projectSeries(tx, accounts, months = 12) {
    const start = currentBalance(tx, accounts);
    const { liquido } = monthlyRecurring(tx);
    const future = futureOneOffByMonth(tx);
    const series = [];
    let saldo = start;
    for (let i = 1; i <= months; i++) {
      saldo += liquido + (future[i] || 0);
      series.push({ mes: i, saldo });
    }
    return { start, liquidoMensal: liquido, series };
  }

  // Saldo projetado por horizonte de dias (derivado da série mensal)
  function projectByDays(tx, accounts) {
    const { start, series } = projectSeries(tx, accounts, 12);
    const monthEnd = (m) => (m <= 0 ? start : series[Math.min(m, series.length) - 1].saldo);
    const at = (dias) => {
      const pos = dias / 30;
      const lo = Math.floor(pos), hi = Math.ceil(pos);
      const frac = pos - lo;
      const v = monthEnd(lo) + (monthEnd(hi) - monthEnd(lo)) * frac;
      return Math.round(v * 100) / 100;
    };
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
