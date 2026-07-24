/* ===========================================================
 * app.js — UI do FinControl AI
 * Navegação, renderização dos dashboards, formulários e importação.
 * =========================================================== */
(function () {
  const { Store, Forecast } = FC;
  const cfg = window.FC_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const money = (v) =>
    (+v || 0).toLocaleString(cfg.LOCALE || "pt-BR", { style: "currency", currency: cfg.MOEDA || "BRL" });
  const pct = (v) => `${(+v || 0).toFixed(0)}%`;
  const fmtDate = (s) => new Date(s + "T00:00:00").toLocaleDateString(cfg.LOCALE || "pt-BR");
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

  // ---------- Gráfico de rosca (categorias) ----------
  function renderDonut(container, rows, catById) {
    if (!rows.length) { container.innerHTML = '<div class="empty">Sem despesas neste mês.</div>'; return; }
    const total = rows.reduce((s, r) => s + r[1], 0);
    const C = 2 * Math.PI * 46;      // circunferência (r=46)
    const gap = rows.length > 1 ? 1.6 : 0;
    let acc = 0;
    const segs = rows.map(([id, val]) => {
      const c = catById(id) || { nome: "Sem categoria", cor: "#94a3b8", icone: "❓" };
      const frac = val / total;
      const seg = frac * C;
      const drawn = Math.max(seg - gap, 0.5);
      const svg = `<circle cx="60" cy="60" r="46" fill="none" stroke="${c.cor}" stroke-width="16"
        stroke-linecap="butt" stroke-dasharray="${drawn.toFixed(2)} ${(C - drawn).toFixed(2)}"
        stroke-dashoffset="${(-acc).toFixed(2)}"><title>${c.icone} ${c.nome}: ${money(val)}</title></circle>`;
      acc += seg;
      return { c, val, frac, svg };
    });
    const legend = segs.map((s) => `
      <div class="row">
        <span class="name" style="color:${s.c.cor}"><span class="dot" style="background:${s.c.cor}"></span>
          <span style="color:var(--text)">${s.c.icone} ${s.c.nome}</span></span>
        <span><b>${money(s.val)}</b><span class="pct">${(s.frac * 100).toFixed(0)}%</span></span>
      </div>`).join("");
    container.innerHTML = `
      <div class="donut-wrap">
        <div class="donut">
          <svg viewBox="0 0 120 120"><g transform="rotate(-90 60 60)">${segs.map((s) => s.svg).join("")}</g></svg>
          <div class="center"><small>Total</small><b>${money(total)}</b></div>
        </div>
        <div class="legend">${legend}</div>
      </div>`;
  }

  // ---------- Gráfico de área (fluxo de caixa) ----------
  function renderArea(container, series) {
    const n = series.length;
    const W = 720, H = 240, padL = 12, padR = 12, padT = 20, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const vals = series.map((s) => s.saldo);
    const maxV = Math.max(...vals, 1), minV = Math.min(0, ...vals);
    const x = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    const y = (v) => padT + (1 - (v - minV) / ((maxV - minV) || 1)) * plotH;
    const pts = series.map((s, i) => [x(i), y(s.saldo)]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const baseY = y(minV).toFixed(1);
    const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${baseY} L ${pts[0][0].toFixed(1)} ${baseY} Z`;
    const zeroY = y(0).toFixed(1);
    const dots = pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#0b1222" stroke="#3b82f6" stroke-width="2" data-i="${i}"/>`).join("");
    const labels = series.map((s, i) => `<text x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="#8ba0c0">M${s.mes}</text>`).join("");
    container.innerHTML = `
      <div class="area-chart">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo projetado para 12 meses">
          <defs>
            <linearGradient id="fcArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.45"/>
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="fcLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
          </defs>
          ${minV < 0 ? `<line x1="${padL}" x2="${W - padR}" y1="${zeroY}" y2="${zeroY}" stroke="rgba(255,255,255,.14)" stroke-dasharray="4 5"/>` : ""}
          <path d="${area}" fill="url(#fcArea)"/>
          <path d="${line}" fill="none" stroke="url(#fcLine)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
          ${dots}
          ${labels}
          <line class="fc-cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="rgba(255,255,255,.25)" opacity="0"/>
        </svg>
        <div class="chart-tip"></div>
      </div>`;
    // Interação (hover / toque)
    const wrap = container.querySelector(".area-chart");
    const svgEl = wrap.querySelector("svg");
    const tip = wrap.querySelector(".chart-tip");
    const cross = wrap.querySelector(".fc-cross");
    const dotEls = Array.from(wrap.querySelectorAll("circle"));
    const move = (ev) => {
      const r = svgEl.getBoundingClientRect();
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const i = Math.round(ratio * (n - 1));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", "0.7");
      dotEls.forEach((d, k) => d.setAttribute("r", k === i ? "5.5" : "3.5"));
      tip.style.left = (x(i) / W) * r.width + "px";
      tip.style.top = (pts[i][1] / H) * r.height + "px";
      tip.style.opacity = "1";
      tip.innerHTML = `<b>${money(series[i].saldo)}</b><small>Mês ${series[i].mes}</small>`;
    };
    const leave = () => { tip.style.opacity = "0"; cross.setAttribute("opacity", "0"); dotEls.forEach((d) => d.setAttribute("r", "3.5")); };
    wrap.addEventListener("mousemove", move);
    wrap.addEventListener("mouseleave", leave);
    wrap.addEventListener("touchmove", move, { passive: true });
    wrap.addEventListener("touchend", leave);
  }

  // ---------- Saldo: ocultar/mostrar (estilo app de banco) ----------
  let hideBal = localStorage.getItem("fc_hidebal") === "1";
  function setMoney(id, val) {
    const e = $("#" + id); if (!e) return;
    e.dataset.real = money(val);
    e.textContent = hideBal ? "R$ ••••••" : e.dataset.real;
  }
  function applyHide() {
    ["kpiSaldo", "kpiReceitas", "kpiDespesas"].forEach((id) => {
      const e = $("#" + id); if (e && e.dataset.real) e.textContent = hideBal ? "R$ ••••••" : e.dataset.real;
    });
    const eye = $("#toggleBalance"); if (eye) eye.textContent = hideBal ? "🙈" : "👁️";
  }
  function hexA(hex, a) {
    const h = (hex || "#64748b").replace("#", "");
    const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    const n = parseInt(f, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------- Próximos lançamentos ----------
  function renderUpcoming(tx, catById) {
    const wrap = $("#upcoming"); if (!wrap) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const items = [];
    tx.filter((t) => t.data > todayStr && t.recorrencia !== "mensal").forEach((t) => {
      items.push({ nome: t.descricao, cat: catById(t.category_id), valor: t.valor, tipo: t.tipo, data: t.data, tag: "Agendado" });
    });
    tx.filter((t) => t.recorrencia === "mensal").forEach((t) => {
      const dia = new Date(t.data + "T00:00:00").getDate();
      let next = new Date(now.getFullYear(), now.getMonth(), dia);
      if (next < new Date(todayStr + "T00:00:00")) next = new Date(now.getFullYear(), now.getMonth() + 1, dia);
      items.push({ nome: t.descricao, cat: catById(t.category_id), valor: t.valor, tipo: t.tipo, data: next.toISOString().slice(0, 10), tag: "Recorrência" });
    });
    items.sort((a, b) => a.data.localeCompare(b.data));
    const top = items.slice(0, 6);
    if (!top.length) { wrap.innerHTML = '<div class="empty">Nenhum lançamento futuro. Cadastre recorrências ou uma compra parcelada.</div>'; return; }
    wrap.innerHTML = top.map((it) => {
      const c = it.cat || { cor: "#64748b", icone: "•", nome: "—" };
      const d = new Date(it.data + "T00:00:00");
      const dstr = d.toLocaleDateString(cfg.LOCALE || "pt-BR", { day: "2-digit", month: "short" });
      return `<div class="up-item">
        <span class="up-ic" style="background:${hexA(c.cor, 0.16)};color:${c.cor}">${c.icone}</span>
        <div class="up-main"><b>${it.nome}</b><small>${c.nome} • ${it.tag}</small></div>
        <div class="up-right"><b class="${it.tipo === "receita" ? "positive" : "negative"}">${it.tipo === "receita" ? "+" : "−"} ${money(it.valor)}</b><small>${dstr}</small></div>
      </div>`;
    }).join("");
  }

  // ---------- Navegação ----------
  function goto(page) {
    $$(".page").forEach((p) => p.classList.add("hidden"));
    $("#page-" + page).classList.remove("hidden");
    $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
    render();
  }

  // ---------- Render principal ----------
  async function render() {
    const [tx, accounts, cards, categories, budgets, goals, bills] = await Promise.all([
      Store.all("transactions"), Store.all("accounts"), Store.all("cards"),
      Store.all("categories"), Store.all("budgets"), Store.all("goals"), Store.all("bills")
    ]);
    const catById = (id) => Store.categoryById(id);

    renderDashboard(tx, accounts, cards, budgets, goals, catById);
    renderExpenses(tx, catById);
    renderIncome(tx, catById);
    renderCards(cards, tx);
    renderBills(bills);
    renderBudget(tx, budgets, catById);
    renderGoals(goals);
    renderForecast(tx, accounts, goals);
  }

  // ---------- Dashboard ----------
  function renderDashboard(tx, accounts, cards, budgets, goals, catById) {
    const ind = Forecast.indicators(tx, accounts, goals);
    setMoney("kpiSaldo", ind.saldoAtual);
    setMoney("kpiReceitas", ind.receitasMes);
    setMoney("kpiDespesas", ind.despesasMes);
    $("#kpiPoupanca").textContent = pct(ind.taxaPoupanca);

    $("#kpiComprometimento").textContent = pct(ind.comprometimento);
    const barC = $("#barComprometimento");
    barC.style.width = Math.min(100, ind.comprometimento) + "%";
    barC.className = "fill " + (ind.comprometimento >= 90 ? "bad" : ind.comprometimento >= 70 ? "warn" : "good");

    $("#kpiReserva").textContent = money(ind.reservaAtual);
    const covPct = ind.reservaMeta > 0 ? (ind.reservaAtual / ind.reservaMeta) * 100 : 0;
    $("#hintReserva").textContent = `${pct(covPct)} da meta (${money(ind.reservaMeta)})`;
    $("#kpiCapacidade").textContent = money(ind.capacidadeInvestir);

    const hu = $("#heroUpdated");
    if (hu) hu.textContent = "Atualizado às " + new Date().toLocaleTimeString(cfg.LOCALE || "pt-BR", { hour: "2-digit", minute: "2-digit" });
    applyHide();
    renderUpcoming(tx, catById);

    // Rosca de despesas por categoria (mês corrente)
    const ref = new Date();
    const byCat = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa") return;
      const d = new Date(t.data);
      if (d.getMonth() !== ref.getMonth() || d.getFullYear() !== ref.getFullYear()) return;
      byCat[t.category_id] = (byCat[t.category_id] || 0) + (+t.valor || 0);
    });
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    renderDonut($("#categoryChart"), rows, catById);

    // Insights
    const ins = Forecast.insights(tx, budgets, catById);
    $("#insights").innerHTML = ins.map((i) =>
      `<div class="alert ${i.level === "bad" ? "bad" : i.level === "ok" ? "ok" : ""}">${i.text}</div>`).join("");

    // Últimos lançamentos
    const recent = tx.slice().sort((a, b) => b.data.localeCompare(a.data)).slice(0, 6);
    $("#recentTx").innerHTML = recent.map((t) => {
      const c = catById(t.category_id);
      return `<div class="row"><span>${c ? c.icone : "•"} ${t.descricao}<div class="muted">${fmtDate(t.data)}</div></span>
        <b class="${t.tipo === "receita" ? "positive" : "negative"}">${t.tipo === "receita" ? "+" : "−"} ${money(t.valor)}</b></div>`;
    }).join("") || '<div class="empty">Sem lançamentos.</div>';

    // Mini projeção
    const p = Forecast.projectByDays(tx, accounts);
    $("#miniForecast").innerHTML = `
      <div class="row"><span>Em 30 dias</span><b>${money(p.d30)}</b></div>
      <div class="row"><span>Em 90 dias</span><b>${money(p.d90)}</b></div>
      <div class="row"><span>Em 180 dias</span><b>${money(p.d180)}</b></div>
      <div class="row"><span>Em 365 dias</span><b>${money(p.d365)}</b></div>`;
  }

  // ---------- Despesas ----------
  function renderExpenses(tx, catById) {
    const list = tx.filter((t) => t.tipo === "despesa").sort((a, b) => b.data.localeCompare(a.data));
    const body = $("#expenseTable");
    $("#expenseEmpty").classList.toggle("hidden", list.length > 0);
    body.innerHTML = list.map((t) => {
      const c = catById(t.category_id);
      return `<tr>
        <td>${fmtDate(t.data)}</td><td>${t.descricao}</td>
        <td>${c ? c.icone + " " + c.nome : "—"}</td>
        <td>${t.forma === "cartao" ? "💳 Cartão" : "🏦 Conta"}</td>
        <td class="right negative">${money(t.valor)}</td>
        <td class="right"><button class="link-danger" data-del="transactions" data-id="${t.id}">excluir</button></td>
      </tr>`;
    }).join("");
  }

  // ---------- Receitas ----------
  function renderIncome(tx, catById) {
    const list = tx.filter((t) => t.tipo === "receita").sort((a, b) => b.data.localeCompare(a.data));
    const body = $("#incomeTable");
    $("#incomeEmpty").classList.toggle("hidden", list.length > 0);
    body.innerHTML = list.map((t) => {
      const c = catById(t.category_id);
      return `<tr>
        <td>${fmtDate(t.data)}</td><td>${t.descricao}</td>
        <td>${c ? c.icone + " " + c.nome : "—"}</td>
        <td>${t.recorrencia === "mensal" ? "🔁 Mensal" : "Única"}</td>
        <td class="right positive">${money(t.valor)}</td>
        <td class="right"><button class="link-danger" data-del="transactions" data-id="${t.id}">excluir</button></td>
      </tr>`;
    }).join("");
  }

  // ---------- Cartões ----------
  function renderCards(cards, tx) {
    const grid = $("#cardsGrid");
    $("#cardsEmpty").classList.toggle("hidden", cards.length > 0);
    const todayStr = new Date().toISOString().slice(0, 10);
    const curKey = todayStr.slice(0, 7);
    const mk = (d) => d.slice(0, 7);
    grid.innerHTML = cards.map((c) => {
      const cardTx = tx.filter((t) => t.card_id === c.id && t.tipo === "despesa");
      const faturaAtual = cardTx.filter((t) => mk(t.data) === curKey).reduce((s, t) => s + (+t.valor || 0), 0);
      const futuro = cardTx.filter((t) => t.data > todayStr).reduce((s, t) => s + (+t.valor || 0), 0);
      const usoPct = c.limite > 0 ? (faturaAtual / c.limite) * 100 : 0;
      const lvl = usoPct >= 90 ? "bad" : usoPct >= 70 ? "warn" : "good";
      const byMonth = {};
      cardTx.filter((t) => t.data > todayStr).forEach((t) => { byMonth[mk(t.data)] = (byMonth[mk(t.data)] || 0) + (+t.valor || 0); });
      const monthsList = Object.keys(byMonth).sort().slice(0, 6).map((k) => {
        const [y, m] = k.split("-");
        const nome = new Date(+y, +m - 1, 1).toLocaleDateString(cfg.LOCALE || "pt-BR", { month: "short", year: "2-digit" });
        return `<div class="row" style="padding:8px 0"><span class="muted">${nome}</span><b>${money(byMonth[k])}</b></div>`;
      }).join("");
      return `<div class="card">
        <div class="section-title">💳 ${c.nome}</div>
        <div class="muted">${c.bandeira || ""} ${c.numero_mascarado ? "• " + c.numero_mascarado : ""}</div>
        <div class="row" style="margin-top:10px"><span>Fatura do mês</span><b>${money(faturaAtual)}</b></div>
        <div class="row"><span>Limite</span><b>${money(c.limite)}</b></div>
        <div class="bar"><div class="fill ${lvl}" style="width:${Math.min(100, usoPct)}%"></div></div>
        <div class="hint" style="margin-top:8px">Fecha dia ${c.dia_fechamento || "—"} • vence dia ${c.dia_vencimento || "—"}</div>
        ${futuro > 0 ? `<div class="row" style="margin-top:12px"><span>🔮 Comprometido futuro</span><b class="negative">${money(futuro)}</b></div>${monthsList}` : ""}
      </div>`;
    }).join("");
  }

  // ---------- Contas a pagar ----------
  function daysOverdue(venc) {
    const t = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
    const v = new Date(venc + "T00:00:00");
    return Math.round((t - v) / 86400000); // >0 = dias em atraso
  }
  function updateBillsBadge(n) {
    const b = $("#billsBadge");
    if (b) { b.textContent = n > 0 ? n : ""; b.style.display = n > 0 ? "inline-flex" : "none"; }
  }
  function renderBills(bills) {
    const body = $("#billsTable"); if (!body) return;
    const cats = Store.allSync("categories").filter((c) => c.tipo === "despesa");
    const sorted = bills.slice().sort((a, b) => {
      if (!!a.paga !== !!b.paga) return a.paga ? 1 : -1;        // não pagas primeiro
      return (a.vencimento || "").localeCompare(b.vencimento || "");
    });
    $("#billsEmpty").classList.toggle("hidden", sorted.length > 0);
    const overdue = sorted.filter((b) => !b.paga && b.vencimento && daysOverdue(b.vencimento) > 5);
    const alertBox = $("#billsAlert");
    alertBox.innerHTML = overdue.length
      ? `<div class="alert bad">🔴 <b>${overdue.length} conta(s) atrasada(s) há mais de 5 dias:</b> ${overdue.map((b) => `${b.descricao} (${daysOverdue(b.vencimento)}d)`).join(", ")}. Total: ${money(overdue.reduce((s, b) => s + (+b.valor || 0), 0))}.</div>`
      : "";
    body.innerHTML = sorted.map((b) => {
      const dOver = b.vencimento ? daysOverdue(b.vencimento) : 0;
      const late = !b.paga && dOver > 5;
      const options = `<option value="">—</option>` + cats.map((c) => `<option value="${c.id}" ${c.id === b.category_id ? "selected" : ""}>${c.icone} ${c.nome}</option>`).join("");
      const status = b.paga
        ? `<span class="badge">✔ Paga</span>`
        : dOver > 5 ? `<span class="badge bad">Atrasada ${dOver}d</span>`
        : dOver >= 0 ? `<span class="badge warn">${dOver === 0 ? "Vence hoje" : "Atrasada " + dOver + "d"}</span>`
        : `<span class="badge warn">Vence em ${-dOver}d</span>`;
      return `<tr class="${late ? "bill-late" : ""}">
        <td>${b.descricao}</td>
        <td><select class="bill-cat" data-id="${b.id}">${options}</select></td>
        <td>${b.vencimento ? fmtDate(b.vencimento) : "—"}</td>
        <td class="right negative">${money(b.valor)}</td>
        <td><label class="chk"><input type="checkbox" class="bill-paid" data-id="${b.id}" ${b.paga ? "checked" : ""}> ${status}</label></td>
        <td class="right"><button class="link-danger" data-del="bills" data-id="${b.id}">excluir</button></td>
      </tr>`;
    }).join("");
    updateBillsBadge(overdue.length);
  }

  // ---------- Orçamento ----------
  function renderBudget(tx, budgets, catById) {
    const ref = new Date();
    const gastoCat = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa") return;
      const d = new Date(t.data);
      if (d.getMonth() !== ref.getMonth() || d.getFullYear() !== ref.getFullYear()) return;
      gastoCat[t.category_id] = (gastoCat[t.category_id] || 0) + (+t.valor || 0);
    });
    const wrap = $("#budgetList");
    if (!budgets.length) { wrap.innerHTML = '<div class="empty">Nenhum teto definido. Clique em “Definir teto”.</div>'; return; }
    wrap.innerHTML = budgets.map((b) => {
      const c = catById(b.category_id) || { nome: "—", icone: "📦", cor: "#94a3b8" };
      const gasto = gastoCat[b.category_id] || 0;
      const p = b.limite > 0 ? (gasto / b.limite) * 100 : 0;
      const lvl = p >= 100 ? "bad" : p >= 80 ? "warn" : "good";
      return `<div style="margin-bottom:16px">
        <div class="row" style="border:0;padding:0 0 6px"><span>${c.icone} ${c.nome}</span>
          <b>${money(gasto)} / ${money(b.limite)}</b></div>
        <div class="bar"><div class="fill ${lvl}" style="width:${Math.min(100, p)}%"></div></div>
      </div>`;
    }).join("");
  }

  // ---------- Metas ----------
  function renderGoals(goals) {
    const grid = $("#goalsGrid");
    $("#goalsEmpty").classList.toggle("hidden", goals.length > 0);
    grid.innerHTML = goals.map((g) => {
      const p = g.valor_alvo > 0 ? (g.valor_atual / g.valor_alvo) * 100 : 0;
      return `<div class="card">
        <div class="section-title">🎯 ${g.nome}</div>
        <div class="row" style="border:0;padding:4px 0"><span>${money(g.valor_atual)}</span><b>${money(g.valor_alvo)}</b></div>
        <div class="bar"><div class="fill good" style="width:${Math.min(100, p)}%"></div></div>
        <div class="hint" style="margin-top:8px">${pct(p)} concluído${g.prazo ? " • até " + fmtDate(g.prazo) : ""}</div>
      </div>`;
    }).join("");
  }

  // ---------- Projeções ----------
  function renderForecast(tx, accounts, goals) {
    const p = Forecast.projectByDays(tx, accounts);
    $("#fc30").textContent = money(p.d30);
    $("#fc90").textContent = money(p.d90);
    $("#fc180").textContent = money(p.d180);
    $("#fc365").textContent = money(p.d365);

    const { series } = Forecast.projectSeries(tx, accounts, 12);
    renderArea($("#forecastChart"), series);

    const ind = Forecast.indicators(tx, accounts, goals);
    const alerts = Forecast.riskAlerts(tx, accounts, ind.reservaMeta);
    $("#riskAlerts").innerHTML = alerts.map((a) =>
      `<div class="alert ${a.level === "bad" ? "bad" : a.level === "ok" ? "ok" : ""}">${a.text}</div>`).join("");
  }

  // ---------- Modal / formulários ----------
  const modal = $("#modal");
  let modalKind = null;

  const fieldsFor = {
    expense: (cats) => [
      { name: "descricao", label: "Descrição", type: "text", full: true, req: true },
      { name: "valor", label: "Valor (R$)", type: "number", req: true },
      { name: "data", label: "Data", type: "date", value: today() },
      { name: "category_id", label: "Categoria", type: "select", options: cats.filter(c => c.tipo === "despesa").map(c => ({ v: c.id, t: c.icone + " " + c.nome })) },
      { name: "forma", label: "Forma", type: "select", options: [{ v: "conta", t: "🏦 Conta" }, { v: "cartao", t: "💳 Cartão" }] },
      { name: "recorrencia", label: "Recorrência", type: "select", options: [{ v: "nenhuma", t: "Única" }, { v: "mensal", t: "🔁 Mensal" }] },
      { name: "estabelecimento", label: "Estabelecimento", type: "text", full: true }
    ],
    income: (cats) => [
      { name: "descricao", label: "Descrição", type: "text", full: true, req: true },
      { name: "valor", label: "Valor (R$)", type: "number", req: true },
      { name: "data", label: "Data", type: "date", value: today() },
      { name: "category_id", label: "Categoria", type: "select", options: cats.filter(c => c.tipo === "receita").map(c => ({ v: c.id, t: c.icone + " " + c.nome })) },
      { name: "recorrencia", label: "Recorrência", type: "select", options: [{ v: "nenhuma", t: "Única" }, { v: "mensal", t: "🔁 Mensal" }] }
    ],
    card: () => [
      { name: "nome", label: "Nome", type: "text", full: true, req: true },
      { name: "bandeira", label: "Bandeira", type: "text" },
      { name: "numero_mascarado", label: "Final (**** 1234)", type: "text" },
      { name: "limite", label: "Limite (R$)", type: "number" },
      { name: "dia_fechamento", label: "Dia fechamento", type: "number" },
      { name: "dia_vencimento", label: "Dia vencimento", type: "number" }
    ],
    budget: (cats) => [
      { name: "category_id", label: "Categoria", type: "select", full: true, options: cats.filter(c => c.tipo === "despesa").map(c => ({ v: c.id, t: c.icone + " " + c.nome })) },
      { name: "limite", label: "Teto mensal (R$)", type: "number", req: true }
    ],
    goal: () => [
      { name: "nome", label: "Nome", type: "text", full: true, req: true },
      { name: "valor_alvo", label: "Valor alvo (R$)", type: "number", req: true },
      { name: "valor_atual", label: "Já acumulado (R$)", type: "number", value: 0 },
      { name: "prazo", label: "Prazo", type: "date" }
    ],
    installment: (cats, cards) => [
      { name: "card_id", label: "Cartão", type: "select", full: true, options: cards.map((c) => ({ v: c.id, t: "💳 " + c.nome })) },
      { name: "descricao", label: "Descrição da compra", type: "text", full: true, req: true },
      { name: "valor", label: "Valor total (R$)", type: "number", req: true },
      { name: "parcelas", label: "Nº de parcelas", type: "number", value: 2 },
      { name: "data", label: "1ª parcela (mês)", type: "date", value: today() },
      { name: "category_id", label: "Categoria", type: "select", options: cats.filter((c) => c.tipo === "despesa").map((c) => ({ v: c.id, t: c.icone + " " + c.nome })) }
    ],
    bill: (cats) => [
      { name: "descricao", label: "Descrição da conta", type: "text", full: true, req: true },
      { name: "valor", label: "Valor (R$)", type: "number", req: true },
      { name: "vencimento", label: "Data de vencimento", type: "date", value: today() },
      { name: "category_id", label: "Categoria", type: "select", full: true, options: cats.filter((c) => c.tipo === "despesa").map((c) => ({ v: c.id, t: c.icone + " " + c.nome })) }
    ]
  };

  function today() { return new Date().toISOString().slice(0, 10); }

  function openModal(kind) {
    const cats = Store.allSync("categories");
    const cards = Store.allSync("cards");
    if (kind === "installment" && !cards.length) {
      alert("Cadastre um cartão primeiro (botão “+ Novo cartão”).");
      return;
    }
    modalKind = kind;
    const titles = { expense: "Nova despesa", income: "Nova receita", card: "Novo cartão", installment: "Compra parcelada no cartão", bill: "Nova conta a pagar", budget: "Definir teto", goal: "Nova meta" };
    $("#modalTitle").textContent = titles[kind] || "Novo";
    const fields = fieldsFor[kind](cats, cards);
    $("#modalForm").innerHTML = fields.map((f) => {
      const wrap = `field${f.full ? " full" : ""}`;
      if (f.type === "select") {
        const opts = (f.options || []).map((o) => `<option value="${o.v}">${o.t}</option>`).join("");
        return `<div class="${wrap}"><label>${f.label}</label><select name="${f.name}">${opts}</select></div>`;
      }
      const val = f.value != null ? ` value="${f.value}"` : "";
      return `<div class="${wrap}"><label>${f.label}</label><input name="${f.name}" type="${f.type}"${val}${f.req ? " required" : ""}></div>`;
    }).join("");
    modal.classList.add("show");
  }
  function closeModal() { modal.classList.remove("show"); modalKind = null; }

  async function saveModal() {
    const form = $("#modalForm");
    const data = {};
    $$("input,select", form).forEach((i) => { data[i.name] = i.value; });
    // Validação mínima
    const numFields = ["valor", "limite", "dia_fechamento", "dia_vencimento", "valor_alvo", "valor_atual"];
    numFields.forEach((n) => { if (data[n] != null && data[n] !== "") data[n] = parseFloat(data[n]); });

    if (modalKind === "expense") {
      if (!data.descricao || !data.valor) return alert("Preencha descrição e valor.");
      await Store.add("transactions", { ...data, tipo: "despesa", conciliada: false });
    } else if (modalKind === "income") {
      if (!data.descricao || !data.valor) return alert("Preencha descrição e valor.");
      await Store.add("transactions", { ...data, tipo: "receita", forma: "conta", conciliada: false });
    } else if (modalKind === "card") {
      await Store.add("cards", data);
    } else if (modalKind === "installment") {
      const total = +data.valor || 0;
      const n = Math.max(1, parseInt(data.parcelas, 10) || 1);
      if (!data.card_id) { alert("Selecione um cartão."); return; }
      if (!data.descricao || !total) { alert("Preencha descrição e valor total."); return; }
      const start = data.data ? new Date(data.data + "T00:00:00") : new Date();
      const parcela = Math.round((total / n) * 100) / 100;
      for (let i = 0; i < n; i++) {
        const dt = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
        await Store.add("transactions", {
          descricao: `${data.descricao} (${i + 1}/${n})`,
          valor: parcela, tipo: "despesa", forma: "cartao",
          card_id: data.card_id, category_id: data.category_id || null,
          data: dt.toISOString().slice(0, 10), recorrencia: "nenhuma", conciliada: false
        });
      }
    } else if (modalKind === "bill") {
      if (!data.descricao || !data.valor) { alert("Preencha descrição e valor."); return; }
      await Store.add("bills", { ...data, paga: false });
    } else if (modalKind === "budget") {
      await Store.add("budgets", data);
    } else if (modalKind === "goal") {
      await Store.add("goals", { ...data, status: "ativa" });
    }
    closeModal();
    render();
  }

  // ---------- Importação (CSV / Excel / PDF) ----------
  function normalizeDate(s) {
    if (!s) return today();
    if (s instanceof Date && !isNaN(s)) return s.toISOString().slice(0, 10);
    s = String(s).trim();
    let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/(\d{2})\/(\d{2})\/(\d{2})(?!\d)/);    if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);            if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return today();
  }

  function parseNumberBR(raw) {
    if (raw == null) return { valor: 0, negativo: false };
    let s = String(raw).trim();
    const negativo = /^-/.test(s) || /-\s*$/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/[()R$\s]/g, "");
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");     // formato BR: 1.234,56
    const valor = Math.abs(parseFloat(s.replace(/[^0-9.\-]/g, "")) || 0);
    return { valor, negativo };
  }

  function guessColumns(header) {
    const h = header.map((x) => String(x || "").toLowerCase());
    const find = (opts) => h.findIndex((c) => opts.some((o) => c.includes(o)));
    return {
      data: find(["data", "date", "dt"]),
      desc: find(["descr", "histor", "lançamento", "lancamento", "memo", "detalhe"]),
      valor: find(["valor", "amount", "montante", "value", "quantia"]),
      tipo: find(["tipo", "type", "natureza"]),
      categoria: find(["categoria", "category", "classe"])
    };
  }

  function suggestCategory(desc) {
    const cats = Store.allSync("categories");
    const rules = [
      { re: /mercado|super|atacad|hortifr|padaria/i, cat: "Alimentação" },
      { re: /posto|combust|shell|ipiranga|uber|99|gasolina/i, cat: "Transporte" },
      { re: /netflix|spotify|prime|disney|hbo|streaming/i, cat: "Assinaturas" },
      { re: /farm|drog|hospital|clinic|saude|plano/i, cat: "Saúde" },
      { re: /aluguel|condominio|imob/i, cat: "Moradia" },
      { re: /energia|luz|agua|internet|telefon|celular/i, cat: "Contas/Utilidades" },
      { re: /cinema|bar|restaurante|ifood|lazer/i, cat: "Lazer" }
    ];
    const hit = rules.find((r) => r.re.test(desc));
    const name = hit ? hit.cat : "Outras despesas";
    return cats.find((c) => c.nome === name && c.tipo === "despesa") || cats.find((c) => c.tipo === "despesa");
  }

  function matrixToTransactions(matrix) {
    matrix = (matrix || []).filter((r) => r && r.some((c) => String(c == null ? "" : c).trim() !== ""));
    if (matrix.length < 2) return { parsed: [], header: matrix[0] || [], erro: true };
    const header = matrix[0].map((x) => String(x || ""));
    const cols = guessColumns(header);
    if (cols.valor < 0 || cols.desc < 0) return { parsed: [], header, erro: true };
    const cats = Store.allSync("categories");
    const byName = (name, tipo) => cats.find((c) => c.tipo === tipo && c.nome.toLowerCase() === String(name || "").toLowerCase());
    const parsed = matrix.slice(1).map((r) => {
      const { valor, negativo } = parseNumberBR(r[cols.valor]);
      if (!valor) return null;
      const desc = String(r[cols.desc] || "—").trim();
      const dataStr = normalizeDate(r[cols.data]);
      let tipo;
      if (cols.tipo > -1 && r[cols.tipo]) {
        tipo = /rec|cred|entrada|^\s*c\s*$/i.test(String(r[cols.tipo])) ? "receita" : "despesa";
      } else {
        tipo = negativo ? "despesa" : "receita";
      }
      let cat = null;
      if (cols.categoria > -1 && r[cols.categoria]) cat = byName(r[cols.categoria], tipo);
      if (!cat) cat = tipo === "despesa" ? suggestCategory(desc) : (byName("Outros", "receita") || cats.find((c) => c.tipo === "receita"));
      return { data: dataStr, descricao: desc, valor, tipo, category_id: cat ? cat.id : null, catNome: cat ? cat.nome : "—", forma: "conta", recorrencia: "nenhuma" };
    }).filter(Boolean);
    return { parsed, header, cols };
  }

  function csvToMatrix(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) return [];
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
    return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
  }

  async function pdfToMatrix(file) {
    if (typeof pdfjsLib === "undefined") throw new Error("A biblioteca de PDF não carregou (precisa de internet).");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const rows = [["Data", "Descrição", "Valor"]];
    const reDate = /(\d{2}\/\d{2}\/\d{2,4})/;
    const reVal = /(-?\(?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\)?\s*-?)/;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const linesMap = {};
      content.items.forEach((it) => {
        const y = Math.round(it.transform[5]);
        (linesMap[y] = linesMap[y] || []).push({ x: it.transform[4], s: it.str });
      });
      Object.keys(linesMap).sort((a, b) => b - a).forEach((y) => {
        const line = linesMap[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(" ").replace(/\s+/g, " ").trim();
        const md = line.match(reDate), mv = line.match(reVal);
        if (md && mv) {
          let desc = line.replace(md[1], "").replace(mv[1], "").replace(/\s+/g, " ").trim() || "Lançamento";
          rows.push([md[1], desc, mv[1]]);
        }
      });
    }
    return rows;
  }

  function renderImportPreview(res) {
    const preview = $("#importPreview");
    if (res.erro) {
      preview.innerHTML = `<div class="alert bad">Não consegui identificar as colunas de <b>descrição</b> e <b>valor</b>.<br>Cabeçalho lido: ${(res.header || []).join(", ") || "(vazio)"}.<br>Confira o modelo ao lado.</div>`;
      return;
    }
    const parsed = res.parsed;
    if (!parsed.length) { preview.innerHTML = `<div class="alert">Nenhum lançamento válido encontrado no arquivo.</div>`; return; }
    const rec = parsed.filter((p) => p.tipo === "receita").length;
    const desp = parsed.length - rec;
    preview.innerHTML = `
      <div class="alert ok">${parsed.length} lançamento(s): ${rec} receita(s) e ${desp} despesa(s). Revise e importe.</div>
      <div style="overflow:auto;max-height:340px">
        <table class="table"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Categoria</th><th class="right">Valor</th></tr></thead>
        <tbody>${parsed.slice(0, 100).map((p) => `<tr><td>${p.data}</td><td>${p.descricao}</td><td>${p.tipo === "receita" ? "🟢" : "🔴"} ${p.tipo}</td><td>${p.catNome}</td><td class="right ${p.tipo === "receita" ? "positive" : "negative"}">${money(p.valor)}</td></tr>`).join("")}</tbody></table>
      </div>
      <div class="actions"><button class="btn" id="confirmImport">Importar ${parsed.length} lançamento(s)</button></div>`;
    $("#confirmImport").onclick = async () => {
      for (const p of parsed) { const { catNome, ...rest } = p; await Store.add("transactions", { ...rest, conciliada: true }); }
      preview.innerHTML = `<div class="alert ok">✅ Importação concluída! ${parsed.length} lançamento(s) adicionado(s).</div>`;
      render();
    };
  }

  async function handleImportFile(file) {
    const preview = $("#importPreview");
    preview.innerHTML = `<div class="alert">⏳ Lendo <b>${file.name}</b>…</div>`;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    try {
      let matrix;
      if (ext === "csv" || file.type === "text/csv") {
        matrix = csvToMatrix(await file.text());
      } else if (ext === "xlsx" || ext === "xls") {
        if (typeof XLSX === "undefined") throw new Error("A biblioteca de Excel não carregou (precisa de internet).");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      } else if (ext === "pdf") {
        matrix = await pdfToMatrix(file);
      } else {
        throw new Error("Formato não suportado. Use CSV, Excel (.xlsx) ou PDF.");
      }
      renderImportPreview(matrixToTransactions(matrix));
    } catch (e) {
      preview.innerHTML = `<div class="alert bad">Erro ao ler o arquivo: ${e.message}</div>`;
    }
  }

  function downloadTemplateCSV() {
    const csv = [
      "Data,Descrição,Valor,Tipo,Categoria",
      "05/07/2026,Salário Dani,7500,receita,Salário Dani",
      "12/07/2026,Aluguel recebido,1200,receita,Aluguel",
      "08/07/2026,Supermercado,-850,despesa,Alimentação",
      "10/07/2026,Combustível,-320,despesa,Transporte"
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo-fincontrol.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Eventos ----------
  function bind() {
    $("#nav").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-page]");
      if (b) goto(b.dataset.page);
    });
    document.body.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-action]");
      if (a) {
        const act = a.dataset.action;
        if (act === "new-expense") openModal("expense");
        if (act === "new-income") openModal("income");
        if (act === "new-card") openModal("card");
        if (act === "new-installment") openModal("installment");
        if (act === "new-bill") openModal("bill");
        if (act === "new-budget") openModal("budget");
        if (act === "new-goal") openModal("goal");
        if (act === "close-modal") closeModal();
        if (act === "save-modal") saveModal();
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        if (confirm("Excluir este lançamento?")) {
          await Store.remove(del.dataset.del, del.dataset.id);
          render();
        }
      }
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    $("#csvFile").addEventListener("change", (e) => { if (e.target.files[0]) handleImportFile(e.target.files[0]); });
    const dt = $("#downloadTemplate");
    if (dt) dt.addEventListener("click", downloadTemplateCSV);
    const eye = $("#toggleBalance");
    if (eye) eye.addEventListener("click", () => {
      hideBal = !hideBal;
      localStorage.setItem("fc_hidebal", hideBal ? "1" : "0");
      applyHide();
    });
    const billsTable = $("#billsTable");
    if (billsTable) billsTable.addEventListener("change", async (e) => {
      const paid = e.target.closest(".bill-paid");
      if (paid) {
        await Store.update("bills", paid.dataset.id, { paga: paid.checked, paga_em: paid.checked ? today() : null });
        render();
        return;
      }
      const cat = e.target.closest(".bill-cat");
      if (cat) { await Store.update("bills", cat.dataset.id, { category_id: cat.value || null }); render(); }
    });
  }

  // ---------- Boot ----------
  async function boot() {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    await Store.init();
    const badge = $("#modeBadge");
    badge.textContent = window.FC_MODE === "online" ? "online" : "offline";
    badge.classList.toggle("online", window.FC_MODE === "online");
    bind();
    goto("dashboard");
    // Registra service worker (só em http/https)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot();
})();
