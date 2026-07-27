/* ===========================================================
 * forecast.js — Inteligência financeira do FinControl AI
 * Projeção de fluxo de caixa, indicadores e sugestões de economia.
 * Puro em JS (heurísticas). Evolui para SQL/serviços na Fase 3.
 *
 * As contas a pagar entram em TODOS os cálculos daqui — elas são
 * dinheiro que sai igual a qualquer despesa. Por isso quase toda
 * função recebe `bills` junto com `tx`.
 * =========================================================== */
window.FC = window.FC || {};

FC.Forecast = (function () {
  const B = () => FC.Bills;
  const hojeStr = () => new Date().toISOString().slice(0, 10);
  const ymDeData = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

  const isSameMonth = (dateStr, ref) => {
    const d = new Date(dateStr);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  };

  // Chave que identifica uma "série" recorrente: o mesmo compromisso
  // repetido mês a mês (mesmo tipo, mesma descrição, mesma categoria).
  function chaveSerie(t) {
    const desc = String(t.descricao || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return t.tipo + "|" + desc + "|" + (t.category_id || "");
  }

  // Totais do mês corrente (despesas incluem as contas a pagar do mês)
  function monthTotals(tx, bills, ref = new Date()) {
    let receitas = 0, despesas = 0;
    tx.forEach((t) => {
      if (!isSameMonth(t.data, ref)) return;
      if (t.tipo === "receita") receitas += +t.valor || 0;
      else despesas += +t.valor || 0;
    });
    B().ocorrenciasDoMes(bills, ymDeData(ref)).forEach((o) => { despesas += o.valor; });
    return { receitas, despesas, saldo: receitas - despesas };
  }

  // Data de referência do saldo informado: tudo que é anterior a ela já
  // está embutido no número que o usuário digitou, então não conta de novo.
  function refSaldo(accounts) {
    return (accounts || []).reduce((d, a) => {
      const x = String(a.data_saldo || "");
      return x > d ? x : d;
    }, "");
  }

  // Saldo atual = saldo informado em conta + lançamentos ATÉ hoje − contas já pagas
  // (lançamentos com data futura não entram no saldo atual)
  function currentBalance(tx, accounts, bills) {
    const hoje = hojeStr();
    accounts = accounts || [];
    const base = accounts.reduce((s, a) => s + (+a.saldo_inicial || 0), 0);
    const desde = refSaldo(accounts);
    const flow = tx.reduce((s, t) => {
      if (t.data > hoje) return s;
      if (desde && t.data <= desde) return s;
      return s + (t.tipo === "receita" ? (+t.valor || 0) : -(+t.valor || 0));
    }, 0);
    return base + flow - B().pagoAte(bills, hoje, desde);
  }

  // Lançamentos futuros pontuais (ex.: parcelas) agrupados por mês à frente
  function futureOneOffByMonth(tx, bills) {
    const now = new Date();
    const todayStr = hojeStr();
    const baseIdx = now.getFullYear() * 12 + now.getMonth();
    const buckets = {};
    const offsetDe = (dataStr) => {
      const d = new Date(dataStr + "T00:00:00");
      const off = (d.getFullYear() * 12 + d.getMonth()) - baseIdx;
      return off < 1 ? 1 : off;   // ainda este mês → conta no 1º passo
    };

    tx.forEach((t) => {
      if (t.data <= todayStr) return;          // apenas futuro
      if (t.recorrencia === "mensal") return;  // recorrentes tratados à parte
      const val = t.tipo === "receita" ? (+t.valor || 0) : -(+t.valor || 0);
      const off = offsetDe(t.data);
      buckets[off] = (buckets[off] || 0) + val;
    });

    // Contas ÚNICAS com vencimento à frente
    (bills || []).forEach((b) => {
      if (b.recorrencia === "mensal") return;
      const ym = B().ymDe(b.vencimento);
      if (!b.vencimento || b.vencimento <= todayStr) return;
      if (B().estaPaga(b, ym)) return;
      const off = offsetDe(b.vencimento);
      buckets[off] = (buckets[off] || 0) - B().valorNoMes(b, ym);
    });

    // Contas de meses ANTERIORES que ficaram sem pagar: pesam no 1º mês.
    // (O mês corrente fica de fora aqui — ele já entra no fluxo recorrente.)
    const atraso = B().pendenciaAnterior(bills, todayStr);
    if (atraso) buckets[1] = (buckets[1] || 0) - atraso;

    // Mês de conta mensal já PAGO: o fluxo recorrente cobra esse mês de
    // qualquer jeito e o saldo inicial já desconta o pagamento. Devolvemos
    // o valor no passo correspondente para não descontar duas vezes.
    // (passo i ↔ competência atual + i − 1)
    const atualYm = todayStr.slice(0, 7);
    (bills || []).forEach((b) => {
      if (b.recorrencia !== "mensal") return;
      for (let i = 1; i <= 12; i++) {
        const ym = B().ymAdd(atualYm, i - 1);
        if (B().estaPaga(b, ym)) buckets[i] = (buckets[i] || 0) + B().valorNoMes(b, ym);
      }
    });

    return buckets;
  }

  // Fluxo recorrente mensal previsto.
  // Uma recorrência é uma SÉRIE, não uma linha: se o salário foi lançado
  // como "mensal" em março, abril e maio, isso é UM salário por mês — não
  // três. Conta-se só a ocorrência mais recente de cada série.
  function monthlyRecurring(tx, bills) {
    const series = {};
    (tx || []).forEach((t) => {
      if (t.recorrencia !== "mensal") return;
      const k = chaveSerie(t);
      const atual = series[k];
      if (!atual || String(t.data || "") > String(atual.data || "")) series[k] = t;
    });

    let rec = 0, desp = 0;
    Object.keys(series).forEach((k) => {
      const t = series[k];
      if (t.tipo === "receita") rec += +t.valor || 0;
      else desp += +t.valor || 0;
    });

    // Conta a pagar mensal já é um registro único por compromisso.
    const ym = B().ymHoje();
    (bills || []).forEach((b) => {
      if (b.recorrencia !== "mensal") return;
      desp += B().valorNoMes(b, ym);
    });

    return { receitas: rec, despesas: desp, liquido: rec - desp };
  }

  // Média mensal de despesas (transações + contas), por mês com movimento
  function avgMonthlyExpense(tx, bills) {
    const byMonth = {};
    (tx || []).forEach((t) => {
      if (t.tipo !== "despesa") return;
      const k = String(t.data || "").slice(0, 7);
      if (!k) return;
      byMonth[k] = (byMonth[k] || 0) + (+t.valor || 0);
    });
    // Cada conta contribui nos meses em que existiu, do início até hoje.
    const ate = B().ymHoje();
    (bills || []).forEach((b) => {
      const inicio = B().ymDe(b.vencimento);
      if (!inicio || inicio > ate) return;
      B().ocorrencias(b, inicio, ate).forEach((o) => {
        byMonth[o.ym] = (byMonth[o.ym] || 0) + o.valor;
      });
    });
    const vals = Object.keys(byMonth).map((k) => byMonth[k]);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // Projeção de saldo para uma série de meses à frente
  // Cada mês = saldo anterior + fluxo recorrente + parcelas/compromissos daquele mês
  function projectSeries(tx, accounts, bills, months = 12) {
    const start = currentBalance(tx, accounts, bills);
    const { liquido } = monthlyRecurring(tx, bills);
    const future = futureOneOffByMonth(tx, bills);
    const series = [];
    let saldo = start;
    for (let i = 1; i <= months; i++) {
      saldo += liquido + (future[i] || 0);
      series.push({ mes: i, saldo });
    }
    return { start, liquidoMensal: liquido, series };
  }

  // Saldo projetado por horizonte de dias (derivado da série mensal)
  function projectByDays(tx, accounts, bills) {
    const { start, series } = projectSeries(tx, accounts, bills, 12);
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
  function indicators(tx, accounts, bills, goals, reservaMetaMeses = 6) {
    goals = goals || [];
    const mt = monthTotals(tx, bills);
    const saldoAtual = currentBalance(tx, accounts, bills);
    const media = avgMonthlyExpense(tx, bills);
    const taxaPoupanca = mt.receitas > 0 ? (mt.saldo / mt.receitas) * 100 : 0;
    const comprometimento = mt.receitas > 0 ? (mt.despesas / mt.receitas) * 100 : 0;
    const capacidadeInvestir = Math.max(0, mt.saldo);
    const reservaMeta = media * reservaMetaMeses;
    const reservaGoal = goals.find((g) => /reserva/i.test(g.nome));
    const reservaAtual = reservaGoal ? +reservaGoal.valor_atual || 0 : 0;
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
  function insights(tx, budgets, categoryById, bills) {
    const out = [];
    const ref = new Date();
    const ym = ymDeData(ref);

    // Gasto do mês por categoria — despesas e contas juntas
    const gastoCat = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa" || !isSameMonth(t.data, ref)) return;
      gastoCat[t.category_id] = (gastoCat[t.category_id] || 0) + (+t.valor || 0);
    });
    B().ocorrenciasDoMes(bills, ym).forEach((o) => {
      gastoCat[o.category_id] = (gastoCat[o.category_id] || 0) + o.valor;
    });
    const total = Object.keys(gastoCat).reduce((s, k) => s + gastoCat[k], 0);

    // 1) Teto mensal do orçamento (hoje é um teto único, não por categoria)
    const teto = (budgets || []).reduce((s, b) => s + (+b.limite || 0), 0);
    if (teto > 0) {
      const p = (total / teto) * 100;
      if (p >= 100)
        out.push({ level: "bad", text: `Teto do mês estourado: ${money(total)} de ${money(teto)} (${p.toFixed(0)}%).` });
      else if (p >= 80)
        out.push({ level: "warn", text: `Você já usou ${p.toFixed(0)}% do teto do mês. Restam ${money(teto - total)}.` });
    }

    // 2) Concentração de gastos (categoria dominante)
    let topId = null, topVal = 0;
    Object.keys(gastoCat).forEach((id) => { if (gastoCat[id] > topVal) { topVal = gastoCat[id]; topId = id; } });
    if (topId && total > 0) {
      const share = (topVal / total) * 100;
      if (share >= 35) {
        const cat = categoryById(topId);
        out.push({ level: "warn", text: `${cat ? cat.icone + " " + cat.nome : "Uma categoria"} concentra ${share.toFixed(0)}% dos gastos. Vale rever.` });
      }
    }

    // 3) Recorrências somadas
    const assinaturas = tx.filter((t) => t.tipo === "despesa" && t.recorrencia === "mensal" && isSameMonth(t.data, ref) &&
      /assinatura|streaming|netflix|spotify|plano/i.test(((categoryById(t.category_id) || {}).nome || "") + " " + t.descricao));
    const somaAss = assinaturas.reduce((s, t) => s + (+t.valor || 0), 0);
    if (somaAss > 0)
      out.push({ level: "info", text: `Você gasta ~${money(somaAss)}/mês em recorrências. Cancelar 1 já economiza no ano.` });

    if (!out.length) out.push({ level: "ok", text: "Tudo sob controle este mês. 👍" });
    return out;
  }

  function money(v) {
    const cfg = window.FC_CONFIG || {};
    return (+v || 0).toLocaleString(cfg.LOCALE || "pt-BR", { style: "currency", currency: cfg.MOEDA || "BRL" });
  }

  // Alertas de risco a partir da projeção
  function riskAlerts(tx, accounts, bills, reservaMeta) {
    const alerts = [];
    const { start, liquidoMensal, series } = projectSeries(tx, accounts, bills, 12);

    const atrasadas = B().atrasadas(bills, hojeStr());
    if (atrasadas.length) {
      const soma = atrasadas.reduce((s, o) => s + o.valor, 0);
      alerts.push({ level: "bad", text: `${atrasadas.length} conta(s) vencida(s) sem pagar, somando ${money(soma)}.` });
    }
    if (liquidoMensal < 0)
      alerts.push({ level: "bad", text: `Seu fluxo recorrente é negativo (${money(liquidoMensal)}/mês). No ritmo atual o saldo cai continuamente.` });
    const negativo = series.find((s) => s.saldo < 0);
    if (negativo)
      alerts.push({ level: "bad", text: `Projeção indica saldo negativo em ~${negativo.mes} mês(es).` });
    if (reservaMeta > 0 && start < reservaMeta)
      alerts.push({ level: "warn", text: `Saldo atual abaixo da reserva de emergência recomendada (${money(reservaMeta)}).` });
    if (!alerts.length)
      alerts.push({ level: "ok", text: "Nenhum risco relevante detectado na projeção de 12 meses." });
    return alerts;
  }

  return {
    monthTotals, currentBalance, monthlyRecurring, avgMonthlyExpense,
    projectSeries, projectByDays, indicators, insights, riskAlerts, refSaldo
  };
})();
