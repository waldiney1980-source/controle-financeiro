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

  // ---------- Navegação ----------
  function goto(page) {
    $$(".page").forEach((p) => p.classList.add("hidden"));
    $("#page-" + page).classList.remove("hidden");
    $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
    render();
  }

  // ---------- Render principal ----------
  async function render() {
    const [tx, accounts, cards, categories, budgets, goals] = await Promise.all([
      Store.all("transactions"), Store.all("accounts"), Store.all("cards"),
      Store.all("categories"), Store.all("budgets"), Store.all("goals")
    ]);
    const catById = (id) => Store.categoryById(id);

    renderDashboard(tx, accounts, cards, budgets, goals, catById);
    renderExpenses(tx, catById);
    renderIncome(tx, catById);
    renderCards(cards, tx);
    renderBudget(tx, budgets, catById);
    renderGoals(goals);
    renderForecast(tx, accounts, goals);
  }

  // ---------- Dashboard ----------
  function renderDashboard(tx, accounts, cards, budgets, goals, catById) {
    const ind = Forecast.indicators(tx, accounts, goals);
    $("#kpiSaldo").textContent = money(ind.saldoAtual);
    $("#kpiReceitas").textContent = money(ind.receitasMes);
    $("#kpiDespesas").textContent = money(ind.despesasMes);
    $("#kpiPoupanca").textContent = pct(ind.taxaPoupanca);

    $("#kpiComprometimento").textContent = pct(ind.comprometimento);
    const barC = $("#barComprometimento");
    barC.style.width = Math.min(100, ind.comprometimento) + "%";
    barC.className = "fill " + (ind.comprometimento >= 90 ? "bad" : ind.comprometimento >= 70 ? "warn" : "good");

    $("#kpiReserva").textContent = money(ind.reservaAtual);
    const covPct = ind.reservaMeta > 0 ? (ind.reservaAtual / ind.reservaMeta) * 100 : 0;
    $("#hintReserva").textContent = `${pct(covPct)} da meta (${money(ind.reservaMeta)})`;
    $("#kpiMedia").textContent = money(ind.mediaMensal);
    $("#kpiCapacidade").textContent = money(ind.capacidadeInvestir);

    // Gráfico de barras por categoria (CSS puro)
    const ref = new Date();
    const byCat = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa") return;
      const d = new Date(t.data);
      if (d.getMonth() !== ref.getMonth() || d.getFullYear() !== ref.getFullYear()) return;
      byCat[t.category_id] = (byCat[t.category_id] || 0) + (+t.valor || 0);
    });
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    const chart = $("#categoryChart");
    chart.innerHTML = rows.length ? "" : '<div class="empty">Sem despesas neste mês.</div>';
    rows.forEach(([id, val]) => {
      const c = catById(id) || { nome: "Sem categoria", cor: "#94a3b8", icone: "❓" };
      chart.appendChild(el(`
        <div class="cat-line">
          <span class="cat-dot" style="background:${c.cor}"></span>
          <div class="grow">
            <div class="row" style="border:0;padding:0 0 4px"><span>${c.icone} ${c.nome}</span><b>${money(val)}</b></div>
            <div class="bar"><div class="fill" style="width:${(val / max) * 100}%;background:${c.cor}"></div></div>
          </div>
        </div>`));
    });

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
    grid.innerHTML = cards.map((c) => {
      const usado = tx.filter((t) => t.card_id === c.id && t.tipo === "despesa")
        .reduce((s, t) => s + (+t.valor || 0), 0);
      const usoPct = c.limite > 0 ? (usado / c.limite) * 100 : 0;
      const lvl = usoPct >= 90 ? "bad" : usoPct >= 70 ? "warn" : "good";
      return `<div class="card">
        <div class="section-title">💳 ${c.nome}</div>
        <div class="muted">${c.bandeira || ""} • ${c.numero_mascarado || ""}</div>
        <div class="row" style="margin-top:10px"><span>Fatura atual</span><b>${money(usado)}</b></div>
        <div class="row"><span>Limite</span><b>${money(c.limite)}</b></div>
        <div class="bar"><div class="fill ${lvl}" style="width:${Math.min(100, usoPct)}%"></div></div>
        <div class="hint" style="margin-top:8px">Fecha dia ${c.dia_fechamento || "—"} • vence dia ${c.dia_vencimento || "—"}</div>
      </div>`;
    }).join("");
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
    const vals = series.map((s) => s.saldo);
    const min = Math.min(0, ...vals), max = Math.max(...vals, 1);
    const chart = $("#forecastChart");
    chart.innerHTML = "";
    const wrap = el('<div style="display:flex;align-items:flex-end;gap:6px;height:180px"></div>');
    series.forEach((s) => {
      const h = ((s.saldo - min) / (max - min || 1)) * 160 + 4;
      const bad = s.saldo < 0;
      wrap.appendChild(el(`<div style="flex:1;text-align:center">
        <div title="${money(s.saldo)}" style="height:${h}px;border-radius:6px 6px 0 0;background:${bad ? "var(--bad)" : "var(--accent)"}"></div>
        <div class="muted" style="font-size:11px;margin-top:4px">M${s.mes}</div></div>`));
    });
    chart.appendChild(wrap);

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
    ]
  };

  function today() { return new Date().toISOString().slice(0, 10); }

  function openModal(kind) {
    modalKind = kind;
    const cats = Store.allSync("categories");
    const titles = { expense: "Nova despesa", income: "Nova receita", card: "Novo cartão", budget: "Definir teto", goal: "Nova meta" };
    $("#modalTitle").textContent = titles[kind] || "Novo";
    const fields = fieldsFor[kind](cats);
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
    } else if (modalKind === "budget") {
      await Store.add("budgets", data);
    } else if (modalKind === "goal") {
      await Store.add("goals", { ...data, status: "ativa" });
    }
    closeModal();
    render();
  }

  // ---------- Importação CSV ----------
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { header: [], rows: [] };
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
    const split = (l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const header = split(lines[0]).map((h) => h.toLowerCase());
    const rows = lines.slice(1).map(split);
    return { header, rows };
  }

  function guessColumns(header) {
    const find = (opts) => header.findIndex((h) => opts.some((o) => h.includes(o)));
    return {
      data: find(["data", "date"]),
      desc: find(["descr", "histor", "lançamento", "lancamento", "memo"]),
      valor: find(["valor", "amount", "montante", "value"])
    };
  }

  function suggestCategory(desc) {
    const cats = Store.allSync("categories");
    const rules = [
      { re: /mercado|super|atacad|hortifr/i, cat: "Alimentação" },
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

  function handleCSV(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const { header, rows } = parseCSV(reader.result);
      const cols = guessColumns(header);
      const preview = $("#importPreview");
      if (cols.valor < 0 || cols.desc < 0) {
        preview.innerHTML = `<div class="alert bad">Não consegui identificar as colunas de descrição/valor. Cabeçalho lido: ${header.join(", ")}</div>`;
        return;
      }
      const parsed = rows.map((r) => {
        let raw = (r[cols.valor] || "0").replace(/[R$\s.]/g, "").replace(",", ".");
        const valor = Math.abs(parseFloat(raw) || 0);
        const desc = r[cols.desc] || "—";
        const dataStr = normalizeDate(r[cols.data]);
        const cat = suggestCategory(desc);
        return { data: dataStr, descricao: desc, valor, category_id: cat ? cat.id : null, catNome: cat ? cat.nome : "—", tipo: "despesa", forma: "conta", recorrencia: "nenhuma" };
      }).filter((x) => x.valor > 0);

      preview.innerHTML = `
        <div class="alert ok">${parsed.length} lançamento(s) identificado(s). Revise e importe.</div>
        <table class="table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria sugerida</th><th class="right">Valor</th></tr></thead>
        <tbody>${parsed.slice(0, 50).map((p) => `<tr><td>${p.data}</td><td>${p.descricao}</td><td>${p.catNome}</td><td class="right">${money(p.valor)}</td></tr>`).join("")}</tbody></table>
        <div class="actions"><button class="btn" id="confirmImport">Importar ${parsed.length}</button></div>`;
      $("#confirmImport").onclick = async () => {
        for (const p of parsed) {
          const { catNome, ...rest } = p;
          await Store.add("transactions", { ...rest, conciliada: true });
        }
        preview.innerHTML = `<div class="alert ok">Importação concluída! ${parsed.length} lançamentos adicionados.</div>`;
        render();
      };
    };
    reader.readAsText(file, "utf-8");
  }

  function normalizeDate(s) {
    if (!s) return today();
    s = s.trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // dd/mm/yyyy
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // yyyy-mm-dd
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return today();
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
    $("#csvFile").addEventListener("change", (e) => { if (e.target.files[0]) handleCSV(e.target.files[0]); });
  }

  // ---------- Boot ----------
  async function boot() {
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
