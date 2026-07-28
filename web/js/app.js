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

  // Descrição de lançamento é texto do usuário e vai parar em innerHTML:
  // sem escapar, um "&" ou "<" no meio do nome quebra a tela.
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // ---------- Pessoa (quem lançou) ----------
  function currentPerson() {
    try {
      const u = window.FC && FC.Auth && FC.Auth.user;
      if (u && u.email) {
        const nome = u.email.split("@")[0].replace(/[._-]+/g, " ").trim();
        return nome.charAt(0).toUpperCase() + nome.slice(1);
      }
    } catch (e) {}
    return "";
  }
  function knownPessoas() {
    const set = new Set();
    const cur = currentPerson(); if (cur) set.add(cur);
    Store.allSync("transactions").forEach((t) => { if (t.pessoa) set.add(t.pessoa); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
  function refreshPessoasDatalist() {
    const dl = $("#pessoasList"); if (!dl) return;
    dl.innerHTML = knownPessoas().map((p) => `<option value="${p}"></option>`).join("");
  }

  // ---------- Filtros do dashboard ----------
  const dashFilter = { pessoa: "", mes: "", categoria: "", tipo: "" };

  // Filtros que não são de mês (o mês é resolvido ao gerar as ocorrências).
  function passaNoFiltro(t) {
    if (dashFilter.pessoa && (t.pessoa || "") !== dashFilter.pessoa) return false;
    if (dashFilter.categoria && t.category_id !== dashFilter.categoria) return false;
    if (dashFilter.tipo && t.tipo !== dashFilter.tipo) return false;
    return true;
  }

  // Intervalo que "Todos os meses" cobre: do mês mais antigo ao mais recente
  // que tenham algo — incluindo o que foi lançado para a frente.
  function intervaloDados(tx, bills) {
    let min = "", max = "";
    const marca = (ym) => {
      if (!ym) return;
      if (!min || ym < min) min = ym;
      if (!max || ym > max) max = ym;
    };
    (tx || []).forEach((t) => marca(String(t.data || "").slice(0, 7)));
    (bills || []).forEach((b) => marca(FC.Bills.ymDe(b.vencimento)));
    const atual = today().slice(0, 7);
    return min ? [min, max] : [atual, atual];
  }

  // Um lançamento marcado como MENSAL é um compromisso que se repete, não um
  // evento único: ele vale em todo mês do intervalo, a partir do mês em que
  // foi lançado. Antes só contava no próprio mês, então setembro aparecia
  // zerado mesmo com salário e aluguel recorrentes cadastrados.
  // Se o usuário lançou o mesmo compromisso à mão num mês, a linha real
  // manda e a repetição não entra — senão contaria duas vezes.
  function ocorrenciasTx(tx, deYm, ateYm) {
    const Bl = FC.Bills;
    const serie = (t) => t.tipo + "|" + chaveDesc(t.descricao) + "|" + (t.category_id || "");
    const reais = {};
    (tx || []).forEach((t) => {
      const ym = String(t.data || "").slice(0, 7);
      if (ym) reais[serie(t) + "|" + ym] = true;
    });

    const out = [];
    (tx || []).forEach((t) => {
      const ym = String(t.data || "").slice(0, 7);
      if (!ym) return;
      if (ym >= deYm && ym <= ateYm) out.push({ ...t, ym, repetido: false });
      if (t.recorrencia !== "mensal") return;
      const inicio = ym > deYm ? ym : deYm;
      const n = Bl.ymDiff(inicio, ateYm);
      for (let i = 0; i <= n; i++) {
        const alvo = Bl.ymAdd(inicio, i);
        if (alvo <= ym) continue;                     // não repete para trás
        if (reais[serie(t) + "|" + alvo]) continue;   // já existe lançamento real
        out.push({ ...t, ym: alvo, data: alvo + String(t.data).slice(7), repetido: true });
      }
    });
    return out;
  }
  function mesLabel(ym) {
    const [y, m] = ym.split("-");
    const s = new Date(+y, +m - 1, 1).toLocaleDateString(cfg.LOCALE || "pt-BR", { month: "short", year: "2-digit" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function fillSelect(sel, options, current, placeholder) {
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      options.map((o) => `<option value="${o.v}">${o.t}</option>`).join("");
    sel.value = current || "";
  }
  function populateFilters(tx, bills) {
    const Bl = FC.Bills;
    // Pessoas
    fillSelect($("#fPessoa"), knownPessoas().map((p) => ({ v: p, t: p })), dashFilter.pessoa, "Todos");
    // Meses: do primeiro mês com movimento até 12 meses à frente. O futuro
    // precisa estar na lista porque salário, aluguel e contas são mensais —
    // outubro tem valor previsto mesmo sem nenhum lançamento digitado nele.
    const [de, ate] = intervaloDados(tx, bills);
    const atual = today().slice(0, 7);
    const inicio = de < atual ? de : atual;
    const fim = Bl.ymAdd(ate > atual ? ate : atual, 12);
    const meses = [];
    for (let ym = inicio; Bl.ymDiff(ym, fim) >= 0; ym = Bl.ymAdd(ym, 1)) meses.push({ v: ym, t: mesLabel(ym) });
    meses.reverse();
    fillSelect($("#fMes"), meses, dashFilter.mes, "Todos os meses");
    // Categorias
    const cats = Store.allSync("categories").map((c) => ({ v: c.id, t: c.icone + " " + c.nome }));
    fillSelect($("#fCategoria"), cats, dashFilter.categoria, "Todas");
    // Tipo (opções fixas no HTML)
    const ft = $("#fTipo"); if (ft) ft.value = dashFilter.tipo || "";
    // Fechado, o bloco precisa dizer o que está filtrando.
    const resumo = $("#filtroResumo");
    if (resumo) {
      const ativos = [];
      if (dashFilter.mes) ativos.push(mesLabel(dashFilter.mes));
      if (dashFilter.pessoa) ativos.push(dashFilter.pessoa);
      if (dashFilter.categoria) {
        const c = Store.categoryById(dashFilter.categoria);
        if (c) ativos.push(c.nome);
      }
      if (dashFilter.tipo) ativos.push(dashFilter.tipo === "receita" ? "só receitas" : "só despesas");
      resumo.innerHTML = ativos.length
        ? `Filtros: <span class="filtros-ativos">${esc(ativos.join(" · "))}</span>`
        : "Filtros";
    }
  }
  function filtrosAtivos() {
    return !!(dashFilter.pessoa || dashFilter.mes || dashFilter.categoria || dashFilter.tipo);
  }

  // Mês em que o painel abre: o corrente, se tiver movimento; senão o mais
  // próximo que tenha. Mesmo motivo do seletor de contas — quem já lançou
  // o mês seguinte não pode abrir o app num painel zerado.
  function mesComMovimento(tx, bills) {
    const Bl = FC.Bills;
    const atual = today().slice(0, 7);
    const tem = (ym) =>
      (tx || []).some((t) => String(t.data || "").slice(0, 7) === ym) ||
      Bl.ocorrenciasDoMes(bills, ym).length > 0;
    if (tem(atual)) return atual;
    for (let i = 1; i <= 12; i++) { const f = Bl.ymAdd(atual, i); if (tem(f)) return f; }
    for (let i = 1; i <= 24; i++) { const t = Bl.ymAdd(atual, -i); if (tem(t)) return t; }
    return atual;
  }

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

  // Mês abreviado para o eixo do gráfico: "Ago". Em janeiro entra o ano
  // junto ("Jan 27"), que é onde a virada precisa ficar explícita.
  function mesCurto(ym) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    const nome = d.toLocaleDateString(cfg.LOCALE || "pt-BR", { month: "short" })
      .replace(".", "");
    const cap = nome.charAt(0).toUpperCase() + nome.slice(1);
    return m === 1 ? `${cap} ${String(y).slice(2)}` : cap;
  }

  // Passo i da projeção corresponde à competência: mês corrente + (i − 1).
  const mesDoPasso = (i) => FC.Bills.ymAdd(today().slice(0, 7), i - 1);

  // ---------- Gráfico de área (fluxo de caixa) ----------
  function renderArea(container, series) {
    const n = series.length;
    const W = 720, H = 240, padL = 12, padR = 12, padT = 20, padB = 30;
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
    const labels = series.map((s, i) =>
      `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#a9bdd8">${mesCurto(mesDoPasso(s.mes))}</text>`).join("");
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
      tip.innerHTML = `<b>${money(series[i].saldo)}</b><small>${mesLabel(mesDoPasso(series[i].mes))}</small>`;
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
    ["kpiSaldo", "kpiReceitas", "kpiDespesas", "kpiMediaDia", "kpiPorDia"].forEach((id) => {
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

  // ---------- Gastos: as três origens, somadas à vista ----------
  function renderGastosDetalhe(conta, cartao, contas, total) {
    const wrap = $("#gastosDetalhe"); if (!wrap) return;
    const linha = (icone, nome, valor) => `
      <div class="row"><span>${icone} ${nome}</span><b class="${valor ? "negative" : "muted"}">${money(valor)}</b></div>`;
    wrap.innerHTML =
      linha("🏦", "Despesas na conta", conta) +
      linha("💳", "Despesas no cartão", cartao) +
      linha("📌", "Contas a pagar", contas) +
      `<div class="row" style="border-top:1px solid var(--line-strong);margin-top:4px">
         <span><b>Total de gastos</b></span><b class="negative">${money(total)}</b></div>`;
  }

  // ---------- Gasto dia a dia ----------
  // Barra por dia do mês, somando despesa (conta e cartão) e conta a pagar
  // que vence naquele dia. É a pergunta "quanto saiu hoje, e ontem?".
  function renderDiaADia(tx, bills, ym) {
    const wrap = $("#dailyChart"); if (!wrap) return;
    const Bl = FC.Bills;
    const nDias = Bl.diasNoMes(ym);
    const hoje = today();
    const ehMesCorrente = ym === hoje.slice(0, 7);
    const diaHoje = ehMesCorrente ? +hoje.slice(8, 10) : (ym < hoje.slice(0, 7) ? nDias : 0);

    const porDia = new Array(nDias + 1).fill(0);
    ocorrenciasTx(tx, ym, ym).forEach((t) => {
      if (t.tipo !== "despesa") return;
      const d = +String(t.data || "").slice(8, 10);
      if (d >= 1 && d <= nDias) porDia[d] += +t.valor || 0;
    });
    Bl.ocorrenciasDoMes(bills, ym).forEach((o) => {
      const d = +String(o.venc || "").slice(8, 10);
      if (d >= 1 && d <= nDias) porDia[d] += o.valor;
    });

    const total = porDia.reduce((s, v) => s + v, 0);
    if (!total) {
      wrap.innerHTML = `<div class="empty">Nenhum gasto registrado em ${mesLabel(ym)}.</div>`;
      return;
    }
    const diasCorridos = Math.max(1, Math.min(diaHoje || nDias, nDias));
    const media = total / diasCorridos;
    const maiorDia = porDia.indexOf(Math.max(...porDia));

    // Barras
    const W = 720, H = 150, padT = 8, padB = 18;
    const plotH = H - padT - padB;
    const maxV = Math.max(...porDia, 1);
    const passo = W / nDias;
    const larg = Math.max(3, passo - 3);
    const barras = porDia.map((v, d) => {
      if (d === 0) return "";
      const h = v > 0 ? Math.max(2, (v / maxV) * plotH) : 0;
      const x = (d - 1) * passo + (passo - larg) / 2;
      const y = padT + plotH - h;
      // Azul é o normal. Vermelho fica só para o maior dia do mês — pintar
      // tudo que passa da média deixaria o mês inteiro vermelho, já que a
      // média divide por todos os dias, inclusive os sem gasto nenhum.
      const cor = d === diaHoje ? "#a78bfa" : (d === maiorDia ? "#f87171" : "#60a5fa");
      const op = ehMesCorrente && d > diaHoje ? 0.32 : 1;   // futuro em tom fraco
      return h
        ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${larg.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${cor}" opacity="${op}"><title>Dia ${d}: ${money(v)}</title></rect>`
        : "";
    }).join("");
    // Rótulos a cada 5 dias, mais o último
    const marcas = [];
    for (let d = 1; d <= nDias; d += 5) marcas.push(d);
    if (marcas[marcas.length - 1] !== nDias) marcas.push(nDias);
    const rotulos = marcas.map((d) =>
      `<text x="${((d - 1) * passo + passo / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#8ba0c0">${d}</text>`).join("");
    const linhaMedia = padT + plotH - (media / maxV) * plotH;

    wrap.innerHTML = `
      <div class="dia-resumo">
        <div><small>Total de ${mesLabel(ym)}</small><b class="negative">${money(total)}</b></div>
        <div><small>Média por dia</small><b>${money(media)}</b></div>
        <div><small>Maior gasto</small><b>dia ${maiorDia} • ${money(porDia[maiorDia])}</b></div>
      </div>
      <div class="dia-chart">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto por dia em ${mesLabel(ym)}">
          <line x1="0" x2="${W}" y1="${linhaMedia.toFixed(1)}" y2="${linhaMedia.toFixed(1)}"
                stroke="rgba(255,255,255,.28)" stroke-dasharray="4 5"/>
          ${barras}${rotulos}
        </svg>
      </div>`;
  }

  // ---------- Meta de gastos do mês ----------
  function renderMeta(budgets, gastos, ym) {
    const wrap = $("#metaMes"); if (!wrap) return;
    const meta = (budgets || []).reduce((s, b) => s + (+b.limite || 0), 0);
    if (!meta) {
      wrap.innerHTML = `<div class="hint">Defina quanto você pretende gastar por mês — o app avisa quando estiver perto do limite.</div>
        <button class="btn secondary tiny" data-action="new-budget" style="margin-top:12px">Definir meta do mês</button>`;
      return;
    }
    const p = (gastos / meta) * 100;
    const lvl = p >= 100 ? "bad" : p >= 80 ? "warn" : "good";
    const resta = meta - gastos;
    wrap.innerHTML = `
      <div class="row" style="border:0;padding:0 0 6px"><span>Meta de gastos</span><b>${money(meta)}</b></div>
      <div class="row" style="border:0;padding:0 0 8px"><span>Já gasto em ${mesLabel(ym || today().slice(0, 7))}</span><b class="${resta < 0 ? "negative" : ""}">${money(gastos)}</b></div>
      <div class="bar"><div class="fill ${lvl}" style="width:${Math.min(100, Math.max(0, p))}%"></div></div>
      <div class="hint" style="margin-top:10px">${resta >= 0
        ? `Ainda cabe <b>${money(resta)}</b> (${pct(Math.max(0, 100 - p))} da meta livre).`
        : `Você passou <b>${money(-resta)}</b> da meta.`}</div>
      <div style="margin-top:12px">
        <button class="link" data-edit="budget" data-id="${budgets[0].id}">editar meta</button>
        <button class="link-danger" data-del="budgets" data-del-label="meta" data-id="${budgets[0].id}">remover</button>
      </div>`;
  }

  // ---------- Lançamentos de hoje ----------
  function renderHoje(tx, bills, catById) {
    const wrap = $("#todayList"); if (!wrap) return;
    const hoje = today();
    const itens = [];
    (tx || []).forEach((t) => {
      if (t.data !== hoje) return;
      itens.push({
        nome: t.descricao, cat: catById(t.category_id), valor: +t.valor || 0, tipo: t.tipo,
        tag: t.forma === "cartao" ? "💳 Cartão" : (t.pessoa || "🏦 Conta")
      });
    });
    FC.Bills.ocorrenciasDoMes(bills, hoje.slice(0, 7))
      .filter((o) => o.venc === hoje)
      .forEach((o) => {
        itens.push({
          nome: o.descricao, cat: catById(o.category_id), valor: o.valor, tipo: "despesa",
          tag: o.paga ? "📌 Conta paga" : "📌 Conta vence hoje"
        });
      });

    if (!itens.length) {
      wrap.innerHTML = '<div class="empty">Nada lançado hoje ainda.</div>';
      return;
    }
    const entrou = itens.filter((i) => i.tipo === "receita").reduce((s, i) => s + i.valor, 0);
    const saiu = itens.filter((i) => i.tipo !== "receita").reduce((s, i) => s + i.valor, 0);
    wrap.innerHTML = itens.map((it) => {
      const c = it.cat || { cor: "#64748b", icone: "•", nome: "—" };
      return `<div class="up-item">
        <span class="up-ic" style="background:${hexA(c.cor, 0.16)};color:${c.cor}">${c.icone}</span>
        <div class="up-main"><b>${esc(it.nome)}</b><small>${esc(c.nome)} • ${esc(it.tag)}</small></div>
        <div class="up-right"><b class="${it.tipo === "receita" ? "positive" : "negative"}">${it.tipo === "receita" ? "+" : "−"} ${money(it.valor)}</b></div>
      </div>`;
    }).join("") + `
      <div class="row" style="margin-top:10px"><span>Total de hoje</span>
        <b class="${entrou - saiu < 0 ? "negative" : "positive"}">${money(entrou - saiu)}</b></div>`;
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

    renderDashboard(tx, accounts, cards, budgets, goals, catById, bills);
    renderExpenses(tx, catById);
    renderIncome(tx, catById);
    renderCards(cards, tx);
    renderBills(bills);
    renderGoals(goals);
    renderForecast(tx, accounts, goals, bills);
  }

  // ---------- Dashboard ----------
  function renderDashboard(tx, accounts, cards, budgets, goals, catById, bills) {
    bills = bills || [];
    // KPIs de posição que não dependem do recorte em análise
    const ind = Forecast.indicators(tx, accounts, bills, goals);
    $("#kpiReserva").textContent = money(ind.reservaAtual);
    const covPct = ind.reservaMeta > 0 ? (ind.reservaAtual / ind.reservaMeta) * 100 : 0;
    $("#hintReserva").textContent = `${pct(covPct)} da meta (${money(ind.reservaMeta)})`;

    // ---- Análise filtrada (pessoa, mês, categoria, tipo) ----
    populateFilters(tx, bills);
    const quem = dashFilter.pessoa ? " • " + dashFilter.pessoa : "";

    // O intervalo em análise. Um mês escolhido vira um intervalo de um mês;
    // "Todos os meses" cobre do primeiro ao último mês com movimento.
    const [deYm, ateYm] = dashFilter.mes
      ? [dashFilter.mes, dashFilter.mes]
      : intervaloDados(tx, bills);
    const escopo = dashFilter.mes
      ? mesLabel(dashFilter.mes)
      : (deYm === ateYm ? mesLabel(deYm) : `${mesLabel(deYm)} a ${mesLabel(ateYm)}`);

    // Lançamentos do intervalo, já com as recorrências repetidas mês a mês.
    const ftx = ocorrenciasTx(tx, deYm, ateYm).filter(passaNoFiltro);

    // Contas a pagar do intervalo. Conta é despesa como qualquer outra e
    // SEMPRE entra na soma — inclusive com filtro de pessoa. Ela é da casa,
    // não de um morador, então aparece em qualquer recorte de gastos.
    let contasEscopo = [];
    if (dashFilter.tipo !== "receita") {
      const ocorr = [];
      (bills || []).forEach((b) => FC.Bills.ocorrencias(b, deYm, ateYm).forEach((o) => ocorr.push(o)));
      contasEscopo = ocorr.filter((o) => !dashFilter.categoria || o.category_id === dashFilter.categoria);
    }

    // Gastos = despesa na conta + despesa no cartão + contas a pagar.
    // As duas primeiras já vêm juntas em `ftx`: toda compra no cartão é uma
    // despesa com forma "cartao". Separamos só para poder mostrar a conta.
    const receitas = ftx.filter((t) => t.tipo === "receita").reduce((s, t) => s + (+t.valor || 0), 0);
    const despCartao = ftx.filter((t) => t.tipo === "despesa" && t.forma === "cartao")
      .reduce((s, t) => s + (+t.valor || 0), 0);
    const despConta = ftx.filter((t) => t.tipo === "despesa" && t.forma !== "cartao")
      .reduce((s, t) => s + (+t.valor || 0), 0);
    const despContas = contasEscopo.reduce((s, o) => s + o.valor, 0);
    const despesas = despConta + despCartao + despContas;
    renderGastosDetalhe(despConta, despCartao, despContas, despesas);

    // Saldo do mês = o que entrou − o que saiu.
    // `despesas` já traz conta E cartão (todo gasto no cartão é uma despesa
    // com forma "cartao") mais as contas a pagar — por isso não se soma o
    // cartão de novo aqui, senão ele contaria duas vezes.
    const disponivel = receitas - despesas;
    setMoney("kpiSaldo", disponivel);

    // Ritmo do mês: quanto já saiu por dia e quanto ainda cabe por dia.
    // Num mês futuro nada foi gasto ainda, então "por dia" divide o mês todo.
    const Bl = FC.Bills;
    const mesRitmo = dashFilter.mes || ateYm;
    const hojeStr = today();
    const nDias = Bl.diasNoMes(mesRitmo);
    const ehCorrente = mesRitmo === hojeStr.slice(0, 7);
    const passou = mesRitmo < hojeStr.slice(0, 7);
    const diaAtual = ehCorrente ? +hojeStr.slice(8, 10) : (passou ? nDias : 0);
    const diasCorridos = Math.max(1, diaAtual || nDias);
    const diasRestantes = ehCorrente ? Math.max(1, nDias - diaAtual + 1) : (passou ? 1 : nDias);

    setMoney("kpiMediaDia", despesas / diasCorridos);
    setMoney("kpiPorDia", Math.max(0, disponivel) / diasRestantes);
    // Rótulos curtos: o mês e a pessoa já estão no subtítulo logo acima, e
    // no celular um texto de duas linhas estica os quatro blocos.
    const lmd = $("#lblMediaDia");
    if (lmd) lmd.textContent = ehCorrente ? `Gasto/dia · ${diaAtual}d` : "Gasto por dia";
    const lpd = $("#lblPorDia");
    if (lpd) lpd.textContent = ehCorrente ? `Sobra/dia · ${diasRestantes}d` : "Sobra por dia";

    const hl = $("#heroLabel");
    if (hl) hl.textContent = disponivel < 0 ? "Faltou este mês" : "Disponível para gastar";

    // O cartão muda de cor conforme o mês: azul tranquilo, âmbar quando
    // sobrou pouco para os dias que faltam, vermelho quando já estourou.
    const hero = $(".hero");
    if (hero) {
      const apertado = disponivel >= 0 && receitas > 0 && disponivel < despesas * 0.15;
      hero.classList.toggle("negativo", disponivel < 0);
      hero.classList.toggle("alerta", !(disponivel < 0) && apertado);
    }
    const tilePorDia = $("#kpiPorDia") && $("#kpiPorDia").closest(".tile");
    if (tilePorDia) tilePorDia.classList.toggle("critico", disponivel <= 0);

    // O subtítulo não repete mais os dois números que já estão nos blocos.
    const hu = $("#heroUpdated");
    if (hu) {
      const partes = [];
      if (ehCorrente) partes.push(`Faltam ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""} de ${mesLabel(mesRitmo)}`);
      else partes.push(escopo);
      const teto = (budgets || []).reduce((s, b) => s + (+b.limite || 0), 0);
      if (teto > 0) partes.push(`meta ${pct((despesas / teto) * 100)} usada`);
      if (quem) partes.push(dashFilter.pessoa);
      hu.textContent = partes.join(" · ");
    }

    // Taxa de poupança e comprometimento saem do MESMO recorte mostrado nos
    // cartões acima — antes vinham só do mês corrente e contradiziam a tela.
    const taxaPoupanca = receitas > 0 ? ((receitas - despesas) / receitas) * 100 : 0;
    const comprometimento = receitas > 0 ? (despesas / receitas) * 100 : 0;
    $("#kpiPoupanca").textContent = pct(taxaPoupanca);
    $("#kpiComprometimento").textContent = pct(comprometimento);
    const barC = $("#barComprometimento");
    barC.style.width = Math.min(100, Math.max(0, comprometimento)) + "%";
    barC.className = "fill " + (comprometimento >= 90 ? "bad" : comprometimento >= 70 ? "warn" : "good");

    setMoney("kpiReceitas", receitas);
    setMoney("kpiDespesas", despesas);
    const lr = $("#lblReceitas"); if (lr) lr.textContent = "Ganhos";
    const ld = $("#lblDespesas"); if (ld) ld.textContent = "Gastos";
    applyHide();

    // Meta: sempre o MÊS INTEIRO que está sendo visto, sem os outros filtros
    // — uma meta mensal não muda porque você filtrou por pessoa ou categoria.
    const mesMeta = dashFilter.mes || ateYm;
    const gastosDoMes =
      ocorrenciasTx(tx, mesMeta, mesMeta)
        .filter((t) => t.tipo === "despesa")
        .reduce((s, t) => s + (+t.valor || 0), 0) +
      FC.Bills.ocorrenciasDoMes(bills, mesMeta).reduce((s, o) => s + o.valor, 0);
    renderMeta(budgets, gastosDoMes, mesMeta);
    renderDiaADia(tx, bills, mesMeta);

    renderHoje(tx, bills, catById);
    renderUpcoming(tx, catById);

    // Rosca de despesas por categoria (inclui despesas e contas do escopo)
    const byCat = {};
    ftx.forEach((t) => {
      if (t.tipo !== "despesa") return;
      byCat[t.category_id] = (byCat[t.category_id] || 0) + (+t.valor || 0);
    });
    contasEscopo.forEach((o) => {
      byCat[o.category_id] = (byCat[o.category_id] || 0) + o.valor;
    });
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    renderDonut($("#categoryChart"), rows, catById);

    // Insights (respeita os filtros; conta não é de uma pessoa só)
    const ins = Forecast.insights(ftx, budgets, catById, dashFilter.pessoa ? [] : bills);
    $("#insights").innerHTML = ins.map((i) =>
      `<div class="alert ${i.level === "bad" ? "bad" : i.level === "ok" ? "ok" : ""}">${i.text}</div>`).join("");

    // Últimos lançamentos (respeita os filtros)
    const recent = ftx.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 8);
    $("#recentTx").innerHTML = recent.map((t) => {
      const c = catById(t.category_id);
      const who = t.pessoa ? " • " + t.pessoa : "";
      const rep = t.repetido ? ' <span class="badge warn">🔁 repete</span>' : "";
      return `<div class="row"><span>${c ? c.icone : "•"} ${esc(t.descricao)}${rep}<div class="muted">${fmtDate(t.data)}${esc(who)}</div></span>
        <b class="${t.tipo === "receita" ? "positive" : "negative"}">${t.tipo === "receita" ? "+" : "−"} ${money(t.valor)}</b></div>`;
    }).join("") || `<div class="empty">${filtrosAtivos() ? "Nenhum lançamento com esses filtros." : "Sem lançamentos."}</div>`;

    // Mini projeção
    const p = Forecast.projectByDays(tx, accounts, bills);
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
        <td>${fmtDate(t.data)}</td><td>${esc(t.descricao)}</td>
        <td>${c ? c.icone + " " + esc(c.nome) : "—"}${t.detalhe ? ` <span class="muted">— ${esc(t.detalhe)}</span>` : ""}</td>
        <td>${esc(t.pessoa) || "—"}</td>
        <td>${t.forma === "cartao" ? "💳 Cartão" : "🏦 Conta"}</td>
        <td class="right negative">${money(t.valor)}</td>
        <td class="right nowrap">
          <button class="link" data-edit="expense" data-id="${t.id}">editar</button>
          <button class="link-danger" data-del="transactions" data-del-label="lançamento" data-id="${t.id}">excluir</button>
        </td>
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
        <td>${fmtDate(t.data)}</td><td>${esc(t.descricao)}</td>
        <td>${c ? c.icone + " " + esc(c.nome) : "—"}${t.detalhe ? ` <span class="muted">— ${esc(t.detalhe)}</span>` : ""}</td>
        <td>${esc(t.pessoa) || "—"}</td>
        <td>${t.recorrencia === "mensal" ? "🔁 Mensal" : "Única"}</td>
        <td class="right positive">${money(t.valor)}</td>
        <td class="right nowrap">
          <button class="link" data-edit="income" data-id="${t.id}">editar</button>
          <button class="link-danger" data-del="transactions" data-del-label="lançamento" data-id="${t.id}">excluir</button>
        </td>
      </tr>`;
    }).join("");
  }

  // ---------- Cartões ----------
  const LIMITE_CARTAO = 6;                 // quantos lançamentos aparecem antes do "ver todos"
  const cartoesAbertos = new Set();

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
      // Lista longa entra encurtada, com botão para abrir o resto. Nada de
      // esconder atrás de rolagem invisível.
      const ordenados = cardTx.slice().sort((a, b) => (b.data || "").localeCompare(a.data || ""));
      const aberto = cartoesAbertos.has(c.id);
      const mostrados = aberto ? ordenados : ordenados.slice(0, LIMITE_CARTAO);
      const txRows = mostrados.map((t) =>
        `<div class="ctx-row">
          <span class="ctx-desc"><b>${esc(t.descricao)}</b><small>${fmtDate(t.data)}</small></span>
          <input class="ctx-val" type="number" step="0.01" min="0" value="${(+t.valor || 0)}" data-tx="${t.id}" aria-label="valor de ${esc(t.descricao)}">
          <button class="link-danger ctx-del" data-del="transactions" data-del-label="lançamento" data-id="${t.id}" title="Excluir">✕</button>
        </div>`).join("");
      const botaoMais = ordenados.length > LIMITE_CARTAO
        ? `<button class="btn secondary tiny ctx-more" data-card-toggle="${c.id}">${aberto
            ? "Mostrar menos"
            : `Ver todos os ${ordenados.length} lançamentos`}</button>`
        : "";
      return `<div class="card">
        <div class="section-title">💳 ${c.nome}</div>
        <div class="muted">${c.bandeira || ""} ${c.numero_mascarado ? "• " + c.numero_mascarado : ""}</div>
        <div class="row" style="margin-top:10px"><span>Fatura do mês</span><b>${money(faturaAtual)}</b></div>
        <div class="row"><span>Limite</span><b>${money(c.limite)}</b></div>
        <div class="bar"><div class="fill ${lvl}" style="width:${Math.min(100, usoPct)}%"></div></div>
        <div class="hint" style="margin-top:8px">Fecha dia ${c.dia_fechamento || "—"} • vence dia ${c.dia_vencimento || "—"}</div>
        ${futuro > 0 ? `<div class="row" style="margin-top:12px"><span>🔮 Comprometido futuro</span><b class="negative">${money(futuro)}</b></div>${monthsList}` : ""}
        ${cardTx.length ? `<div class="ctx-title">Lançamentos deste cartão — toque no valor para editar</div><div class="ctx-list">${txRows}</div>${botaoMais}` : ""}
        <div class="row" style="border:0;padding:12px 0 0;margin-top:4px">
          <button class="link" data-edit="card" data-id="${c.id}">editar cartão</button>
          <button class="link-danger" data-del="cards" data-del-label="cartão" data-id="${c.id}">excluir cartão</button>
        </div>
      </div>`;
    }).join("");
  }

  // ---------- Contas a pagar ----------
  // Uma conta mensal não é UM registro pago ou não: cada mês tem seu próprio
  // vencimento, seu próprio valor e seu próprio "pagou?". A tela mostra um
  // mês por vez — as regras estão em bills.js (FC.Bills).
  let billsMes = "";                                   // "" = escolher sozinho

  // Nunca abrir num mês vazio existindo conta em outro. Quem planeja o mês
  // seguinte lança tudo com vencimento à frente — abrir no mês corrente
  // mostrava tela vazia e parecia que os dados tinham sumido.
  function mesComContas(bills) {
    const Bl = FC.Bills;
    const atual = today().slice(0, 7);
    const tem = (ym) => Bl.ocorrenciasDoMes(bills, ym).length > 0;
    if (tem(atual)) return atual;
    for (let i = 1; i <= 12; i++) { const f = Bl.ymAdd(atual, i); if (tem(f)) return f; }
    for (let i = 1; i <= 24; i++) { const t = Bl.ymAdd(atual, -i); if (tem(t)) return t; }
    return atual;
  }

  function updateBillsBadge(n) {
    const b = $("#billsBadge");
    if (b) { b.textContent = n > 0 ? n : ""; b.style.display = n > 0 ? "inline-flex" : "none"; }
  }

  // Meses disponíveis no seletor: da conta mais antiga até 12 meses à frente.
  function opcoesMesContas(bills) {
    const Bl = FC.Bills;
    const atual = today().slice(0, 7);
    let inicio = atual;
    (bills || []).forEach((b) => {
      const ym = Bl.ymDe(b.vencimento);
      if (ym && ym < inicio) inicio = ym;
    });
    const out = [];
    const fim = Bl.ymAdd(atual, 12);
    for (let ym = inicio; Bl.ymDiff(ym, fim) >= 0; ym = Bl.ymAdd(ym, 1)) out.push(ym);
    return out;
  }

  function renderBills(bills) {
    const body = $("#billsTable"); if (!body) return;
    const Bl = FC.Bills;
    const ym = billsMes || mesComContas(bills);
    const hoje = today();
    const cats = Store.allSync("categories").filter((c) => c.tipo === "despesa");

    const sel = $("#billsMes");
    if (sel) {
      const meses = opcoesMesContas(bills);
      if (meses.indexOf(ym) < 0) meses.push(ym);
      sel.innerHTML = meses.sort().map((m) => `<option value="${m}">${mesLabel(m)}</option>`).join("");
      sel.value = ym;
    }

    const ocorrencias = Bl.ocorrenciasDoMes(bills, ym).sort((a, b) => {
      if (!!a.paga !== !!b.paga) return a.paga ? 1 : -1;        // não pagas primeiro
      return (a.venc || "").localeCompare(b.venc || "");
    });
    const vazio = $("#billsEmpty");
    vazio.classList.toggle("hidden", ocorrencias.length > 0);
    if (!ocorrencias.length) {
      const n = (bills || []).length;
      vazio.innerHTML = n
        ? `Nenhuma conta vence em ${mesLabel(ym)}. Você tem <b>${n} conta(s)</b> cadastrada(s) — troque o mês no seletor acima para vê-las.`
        : "Nenhuma conta cadastrada. Clique em “+ Nova conta”.";
    }

    // O alerta olha TODOS os meses, não só o que está na tela — uma conta
    // esquecida em maio precisa aparecer mesmo com julho selecionado.
    const atrasadas = Bl.atrasadas(bills, hoje);
    const graves = atrasadas.filter((o) => o.dias > 5);
    $("#billsAlert").innerHTML = graves.length
      ? `<div class="alert bad">🔴 <b>${graves.length} conta(s) atrasada(s) há mais de 5 dias:</b> ` +
        `${graves.map((o) => `${esc(o.descricao)} ${mesLabel(o.ym)} (${o.dias}d)`).join(", ")}. ` +
        `Total: ${money(graves.reduce((s, o) => s + o.valor, 0))}.</div>`
      : "";

    const total = ocorrencias.reduce((s, o) => s + o.valor, 0);
    const pago = ocorrencias.filter((o) => o.paga).reduce((s, o) => s + o.valor, 0);
    const resumo = $("#billsResumo");
    if (resumo) resumo.innerHTML = ocorrencias.length ? `
      <div class="row" style="border:0;padding:0 0 6px"><span>Total de ${mesLabel(ym)}</span><b>${money(total)}</b></div>
      <div class="row" style="border:0;padding:0 0 6px"><span>Já pago</span><b class="positive">${money(pago)}</b></div>
      <div class="row" style="border:0;padding:0"><span>Falta pagar</span><b class="negative">${money(total - pago)}</b></div>` : "";

    body.innerHTML = ocorrencias.map((o) => {
      const dOver = o.venc ? Bl.diasEntre(o.venc, hoje) : 0;
      const late = !o.paga && dOver > 5;
      const options = `<option value="">—</option>` + cats.map((c) =>
        `<option value="${c.id}" ${c.id === o.category_id ? "selected" : ""}>${c.icone} ${esc(c.nome)}</option>`).join("");
      const status = o.paga
        ? `<span class="badge">✔ Paga${o.pagaEm ? " em " + fmtDate(o.pagaEm) : ""}</span>`
        : dOver > 5 ? `<span class="badge bad">Atrasada ${dOver}d</span>`
        : dOver > 0 ? `<span class="badge warn">Atrasada ${dOver}d</span>`
        : dOver === 0 ? `<span class="badge warn">Vence hoje</span>`
        : `<span class="badge warn">Vence em ${-dOver}d</span>`;
      return `<tr class="${late ? "bill-late" : ""}">
        <td>${esc(o.descricao)}${o.recorrencia === "mensal" ? ' <span class="badge warn">🔁 Mensal</span>' : ""}</td>
        <td><select class="bill-cat" data-id="${o.id}">${options}</select></td>
        <td>${o.venc ? fmtDate(o.venc) : "—"}</td>
        <td class="right"><input class="bill-val" type="number" step="0.01" min="0" value="${o.valor}"
          data-id="${o.id}" data-ym="${o.ym}" aria-label="valor de ${esc(o.descricao)} em ${mesLabel(o.ym)}"></td>
        <td><label class="chk"><input type="checkbox" class="bill-paid" data-id="${o.id}" data-ym="${o.ym}" ${o.paga ? "checked" : ""}> ${status}</label></td>
        <td class="right nowrap">
          <button class="link" data-edit="bill" data-id="${o.id}">editar</button>
          <button class="link-danger" data-del="bills" data-del-label="conta" data-id="${o.id}">excluir</button>
        </td>
      </tr>`;
    }).join("");
    updateBillsBadge(atrasadas.length);
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
        <div class="row" style="border:0;padding:12px 0 0">
          <button class="link" data-edit="goal" data-id="${g.id}">editar</button>
          <button class="link-danger" data-del="goals" data-del-label="meta" data-id="${g.id}">excluir meta</button>
        </div>
      </div>`;
    }).join("");
  }

  // ---------- Projeções ----------
  function renderForecast(tx, accounts, goals, bills) {
    bills = bills || [];
    accounts = accounts || [];

    // Ponto de partida: sem saldo informado, a projeção começa do zero e
    // vira só a soma dos lançamentos — por isso o aviso aparece em destaque.
    const conta = accounts[0] || null;
    const wrap = $("#saldoConta");
    if (wrap) {
      const saldoAtual = Forecast.currentBalance(tx, accounts, bills);
      wrap.innerHTML = conta ? `
        <div class="row" style="border:0;padding:0 0 6px"><span>Saldo informado em ${fmtDate(conta.data_saldo)}</span><b>${money(conta.saldo_inicial)}</b></div>
        <div class="row" style="border:0;padding:0 0 6px"><span>Movimento desde então</span><b>${money(saldoAtual - (+conta.saldo_inicial || 0))}</b></div>
        <div class="row" style="border:0;padding:0"><span><b>Saldo hoje</b></span><b class="${saldoAtual < 0 ? "negative" : "positive"}">${money(saldoAtual)}</b></div>
        <div class="hint" style="margin-top:10px">Toda a projeção parte daqui. Atualize sempre que conferir o extrato.</div>
        <div style="margin-top:12px"><button class="btn secondary tiny" data-edit="account" data-id="${conta.id}">Atualizar saldo</button></div>`
        : `<div class="alert">Informe quanto você <b>tem em conta hoje</b>. Sem isso a projeção parte do zero e só mostra a soma dos lançamentos, não o dinheiro de verdade.</div>
           <button class="btn" data-action="new-account" style="margin-top:12px">Informar saldo em conta</button>`;
    }

    const p = Forecast.projectByDays(tx, accounts, bills);
    $("#fc30").textContent = money(p.d30);
    $("#fc90").textContent = money(p.d90);
    $("#fc180").textContent = money(p.d180);
    $("#fc365").textContent = money(p.d365);

    const { series } = Forecast.projectSeries(tx, accounts, bills, 12);
    renderArea($("#forecastChart"), series);

    const ind = Forecast.indicators(tx, accounts, bills, goals);
    const alerts = Forecast.riskAlerts(tx, accounts, bills, ind.reservaMeta);
    $("#riskAlerts").innerHTML = alerts.map((a) =>
      `<div class="alert ${a.level === "bad" ? "bad" : a.level === "ok" ? "ok" : ""}">${a.text}</div>`).join("");
  }

  // ---------- Modal / formulários ----------
  const modal = $("#modal");
  let modalKind = null;
  let modalId = null;      // preenchido = está EDITANDO um registro existente

  // Em que coleção mora cada tipo de formulário.
  const COLECAO = {
    expense: "transactions", income: "transactions", card: "cards",
    bill: "bills", budget: "budgets", goal: "goals", account: "accounts"
  };

  const fieldsFor = {
    expense: (cats) => [
      { name: "descricao", label: "Descrição", type: "text", full: true, req: true },
      { name: "valor", label: "Valor (R$)", type: "number", req: true },
      { name: "data", label: "Data", type: "date", value: today() },
      { name: "category_id", label: "Categoria", type: "select", options: cats.filter(c => c.tipo === "despesa").map(c => ({ v: c.id, t: c.icone + " " + c.nome })) },
      { name: "detalhe", label: "Especifique o gasto (categoria Outros)", type: "text", full: true },
      { name: "pessoa", label: "Quem lançou", type: "text", list: "pessoasList", value: currentPerson() },
      { name: "forma", label: "Forma", type: "select", options: [{ v: "conta", t: "🏦 Conta" }, { v: "cartao", t: "💳 Cartão" }] },
      { name: "recorrencia", label: "Recorrência", type: "select", options: [{ v: "nenhuma", t: "Única" }, { v: "mensal", t: "🔁 Mensal" }] },
      { name: "estabelecimento", label: "Estabelecimento", type: "text", full: true }
    ],
    income: (cats) => [
      { name: "descricao", label: "Descrição", type: "text", full: true, req: true },
      { name: "valor", label: "Valor (R$)", type: "number", req: true },
      { name: "data", label: "Data", type: "date", value: today() },
      { name: "category_id", label: "Categoria", type: "select", options: cats.filter(c => c.tipo === "receita").map(c => ({ v: c.id, t: c.icone + " " + c.nome })) },
      { name: "detalhe", label: "Especifique a receita (categoria Outros)", type: "text", full: true },
      { name: "pessoa", label: "Quem lançou", type: "text", list: "pessoasList", value: currentPerson() },
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
    budget: () => [
      { name: "limite", label: "Teto mensal total — vale para todas as categorias (R$)", type: "number", full: true, req: true }
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
      { name: "valor", label: "Valor padrão (R$)", type: "number", req: true },
      { name: "vencimento", label: "1º vencimento", type: "date", value: today() },
      { name: "recorrencia", label: "Recorrência", type: "select", options: [{ v: "nenhuma", t: "Única" }, { v: "mensal", t: "🔁 Mensal (repete todo mês)" }] },
      { name: "category_id", label: "Categoria", type: "select", options: cats.filter((c) => c.tipo === "despesa").map((c) => ({ v: c.id, t: c.icone + " " + c.nome })) }
    ],
    account: () => [
      { name: "nome", label: "Onde está o dinheiro (banco, carteira)", type: "text", full: true, value: "Conta corrente" },
      { name: "saldo_inicial", label: "Quanto você tem hoje (R$)", type: "number", req: true },
      { name: "data_saldo", label: "Data desse saldo", type: "date", value: today() }
    ]
  };

  function today() { return new Date().toISOString().slice(0, 10); }

  const TITULOS = {
    expense: ["Nova despesa", "Editar despesa"],
    income: ["Nova receita", "Editar receita"],
    card: ["Novo cartão", "Editar cartão"],
    installment: ["Compra parcelada no cartão", "Compra parcelada no cartão"],
    bill: ["Nova conta a pagar", "Editar conta a pagar"],
    budget: ["Teto mensal total", "Editar teto mensal"],
    goal: ["Nova meta", "Editar meta"],
    account: ["Saldo em conta", "Atualizar saldo em conta"]
  };

  function openModal(kind, id) {
    refreshPessoasDatalist();
    const cats = Store.allSync("categories");
    const cards = Store.allSync("cards");
    if (kind === "installment" && !cards.length) {
      alert("Cadastre um cartão primeiro (botão “+ Novo cartão”).");
      return;
    }
    modalKind = kind;
    modalId = id || null;
    const registro = modalId
      ? Store.allSync(COLECAO[kind] || "").find((x) => x.id === modalId) || null
      : null;
    if (modalId && !registro) { alert("Não encontrei esse registro. Atualize a página."); return; }

    $("#modalTitle").textContent = (TITULOS[kind] || ["Novo", "Editar"])[registro ? 1 : 0];
    const fields = fieldsFor[kind](cats, cards);
    $("#modalForm").innerHTML = fields.map((f) => {
      // Editando: o valor do registro manda; criando: o padrão do campo.
      const atual = registro && registro[f.name] != null ? registro[f.name] : f.value;
      const wrap = `field${f.full ? " full" : ""}`;
      if (f.type === "select") {
        const opts = (f.options || []).map((o) =>
          `<option value="${o.v}"${String(o.v) === String(atual) ? " selected" : ""}>${o.t}</option>`).join("");
        return `<div class="${wrap}"><label>${f.label}</label><select name="${f.name}">${opts}</select></div>`;
      }
      const val = atual != null && atual !== "" ? ` value="${esc(atual)}"` : "";
      const list = f.list ? ` list="${f.list}"` : "";
      return `<div class="${wrap}"><label>${f.label}</label><input name="${f.name}" type="${f.type}"${val}${list}${f.req ? " required" : ""}></div>`;
    }).join("");

    // Campo "Especifique" só aparece quando a categoria for "Outros/Outras" —
    // vale para despesa e receita, e o texto já digitado não se perde ao trocar.
    const form = $("#modalForm");
    const detEl = form.querySelector('[name="detalhe"]');
    if (detEl) {
      const detWrap = detEl.closest(".field");
      const catSel = form.querySelector('select[name="category_id"]');
      const upd = () => {
        const opt = catSel && catSel.options[catSel.selectedIndex];
        const isOutros = /outros|outras/i.test(opt ? opt.textContent : "");
        detWrap.style.display = isOutros ? "" : "none";
        detEl.placeholder = isOutros ? "Ex.: presente de aniversário" : "";
      };
      if (catSel) catSel.addEventListener("change", upd);
      upd();
    }
    modal.classList.add("show");
  }
  function closeModal() { modal.classList.remove("show"); modalKind = null; modalId = null; }

  async function saveModal() {
    const form = $("#modalForm");
    const data = {};
    $$("input,select", form).forEach((i) => { data[i.name] = i.value; });
    // Validação mínima
    const numFields = ["valor", "limite", "dia_fechamento", "dia_vencimento", "valor_alvo", "valor_atual", "saldo_inicial"];
    numFields.forEach((n) => { if (data[n] != null && data[n] !== "") data[n] = parseFloat(data[n]); });

    const editando = !!modalId;

    if (modalKind === "expense") {
      if (!data.descricao || !data.valor) return alert("Preencha descrição e valor.");
      if (editando) await Store.update("transactions", modalId, data);
      else await Store.add("transactions", { ...data, tipo: "despesa", conciliada: false });
      await aprenderCategoria(data.descricao, data.category_id);
    } else if (modalKind === "income") {
      if (!data.descricao || !data.valor) return alert("Preencha descrição e valor.");
      if (editando) await Store.update("transactions", modalId, data);
      else await Store.add("transactions", { ...data, tipo: "receita", forma: "conta", conciliada: false });
    } else if (modalKind === "card") {
      if (editando) await Store.update("cards", modalId, data);
      else await Store.add("cards", data);
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
      if (editando) await Store.update("bills", modalId, data);
      else await Store.add("bills", { ...data, pagas: {}, valores: {} });
    } else if (modalKind === "budget") {
      if (!data.limite) { alert("Informe a meta de gastos do mês."); return; }
      // Meta única: remove as anteriores e grava só uma (vale para o mês todo).
      const atuais = Store.allSync("budgets");
      for (const b of atuais) await Store.remove("budgets", b.id);
      await Store.add("budgets", { limite: data.limite, competencia: today().slice(0, 7) });
    } else if (modalKind === "goal") {
      if (editando) await Store.update("goals", modalId, data);
      else await Store.add("goals", { ...data, status: "ativa" });
    } else if (modalKind === "account") {
      if (data.saldo_inicial == null || data.saldo_inicial === "") { alert("Informe quanto você tem em conta."); return; }
      if (editando) await Store.update("accounts", modalId, data);
      else {
        // Um registro só: o saldo é do conjunto, não de cada banco separado.
        for (const a of Store.allSync("accounts")) await Store.remove("accounts", a.id);
        await Store.add("accounts", data);
      }
    }
    closeModal();
    render();
  }

  // ---------- Categorização com aprendizado ----------
  // O app guarda "o que essa descrição costuma ser" e para de errar depois
  // da primeira correção. A chave joga fora o que muda de uma compra para
  // outra: acentos, números, código da loja, parcela, cidade.
  function chaveCategoria(desc) {
    return String(desc || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\d+/g, " ")
      .replace(/[^a-z ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((p) => p.length > 2)
      .slice(0, 3)
      .join(" ");
  }

  async function aprenderCategoria(desc, categoryId) {
    const chave = chaveCategoria(desc);
    if (!chave || !categoryId) return;
    const existente = Store.allSync("catrules").find((r) => r.chave === chave);
    if (existente) {
      if (existente.category_id !== categoryId)
        await Store.update("catrules", existente.id, { category_id: categoryId });
    } else {
      await Store.add("catrules", { chave, category_id: categoryId });
    }
  }

  function categoriaAprendida(desc) {
    const chave = chaveCategoria(desc);
    if (!chave) return null;
    const r = Store.allSync("catrules").find((x) => x.chave === chave);
    if (!r) return null;
    return Store.allSync("categories").find((c) => c.id === r.category_id) || null;
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
    // O que o usuário já corrigiu antes vale mais que as regras fixas.
    const aprendida = categoriaAprendida(desc);
    if (aprendida && aprendida.tipo === "despesa") return aprendida;
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

  // Extrato de banco brasileiro costuma vir em ISO-8859-1. Lido como UTF-8,
  // os acentos viram "�" — então testamos e reabrimos no outro formato.
  async function lerTexto(file) {
    const buf = await file.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(buf);
    if (utf8.indexOf("\uFFFD") < 0) return utf8;
    try { return new TextDecoder("windows-1252").decode(buf); } catch (e) { return utf8; }
  }

  // ---------- OFX (extrato do banco) ----------
  // OFX é SGML e nem sempre fecha as tags. Em vez de montar uma árvore,
  // isolamos cada <STMTTRN> e lemos os campos por regex.
  function ofxToTransactions(text) {
    const blocos = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
    if (!blocos.length) {
      return { parsed: [], header: [], erro: true, motivo: "Não encontrei lançamentos (<STMTTRN>) neste arquivo OFX." };
    }
    const cats = Store.allSync("categories");
    const byName = (nome, tipo) => cats.find((c) => c.tipo === tipo && c.nome.toLowerCase() === String(nome || "").toLowerCase());
    const campo = (bloco, tag) => {
      const m = bloco.match(new RegExp("<" + tag + ">([^<\\r\\n]*)", "i"));
      return m ? m[1].trim() : "";
    };
    const parsed = blocos.map((b) => {
      const num = parseFloat(campo(b, "TRNAMT").replace(/\s/g, "").replace(",", "."));
      if (!num) return null;
      const dt = campo(b, "DTPOSTED").replace(/[^0-9]/g, "").slice(0, 8);
      const data = dt.length === 8 ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : today();
      const desc = (campo(b, "MEMO") || campo(b, "NAME") || "Lançamento").replace(/\s+/g, " ").trim();
      // O sinal do TRNAMT manda; TRNTYPE só desempata quando vem positivo.
      const tipo = num < 0 || campo(b, "TRNTYPE").toUpperCase() === "DEBIT" ? "despesa" : "receita";
      const cat = tipo === "despesa"
        ? suggestCategory(desc)
        : (byName("Outros", "receita") || cats.find((c) => c.tipo === "receita"));
      return {
        data, descricao: desc, valor: Math.abs(num), tipo,
        category_id: cat ? cat.id : null, catNome: cat ? cat.nome : "—",
        forma: "conta", recorrencia: "nenhuma", fitid: campo(b, "FITID") || null
      };
    }).filter(Boolean);
    return { parsed, header: [] };
  }

  // ---------- Conciliação ----------
  // Importar o mesmo extrato duas vezes duplicava tudo. Agora cada linha
  // é conferida contra o que já está gravado: pelo identificador do banco
  // (FITID) quando existe, senão por valor + data próxima + descrição.
  function chaveDesc(s) {
    return String(s || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function distanciaDias(a, b) {
    return Math.abs(Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000));
  }
  function marcarDuplicatas(parsed) {
    const existentes = Store.allSync("transactions");
    const porFitid = {};
    existentes.forEach((t) => { if (t.fitid) porFitid[t.fitid] = t; });
    return parsed.map((p) => {
      let motivo = "";
      if (p.fitid && porFitid[p.fitid]) {
        motivo = "mesmo identificador do banco";
      } else {
        const chave = chaveDesc(p.descricao);
        const igual = existentes.find((t) =>
          t.tipo === p.tipo &&
          Math.abs((+t.valor || 0) - p.valor) < 0.005 &&
          t.data && distanciaDias(t.data, p.data) <= 3 &&
          chaveDesc(t.descricao) === chave);
        if (igual) motivo = `igual a "${igual.descricao}" de ${fmtDate(igual.data)}`;
      }
      return { ...p, duplicata: !!motivo, motivoDup: motivo };
    });
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
      preview.innerHTML = `<div class="alert bad">${res.motivo
        || `Não consegui identificar as colunas de <b>descrição</b> e <b>valor</b>.<br>Cabeçalho lido: ${esc((res.header || []).join(", ")) || "(vazio)"}.<br>Confira o modelo ao lado.`}</div>`;
      return;
    }
    const linhas = marcarDuplicatas(res.parsed || []);
    if (!linhas.length) { preview.innerHTML = `<div class="alert">Nenhum lançamento válido encontrado no arquivo.</div>`; return; }

    const cats = Store.allSync("categories");
    const dups = linhas.filter((l) => l.duplicata).length;
    const novos = linhas.length - dups;
    const optsDe = (tipo, sel) => cats.filter((c) => c.tipo === tipo)
      .map((c) => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${c.icone} ${esc(c.nome)}</option>`).join("");

    preview.innerHTML = `
      <div class="alert ${dups ? "" : "ok"}">
        ${linhas.length} lançamento(s) lidos — <b>${novos} novo(s)</b>${dups ? ` e <b>${dups} que já estão no app</b>, já desmarcado(s)` : ""}.
        ${dups ? "<br>Corrija a categoria antes de importar: o app aprende com a sua escolha." : ""}
      </div>
      <div style="overflow:auto;max-height:360px">
        <table class="table">
          <thead><tr>
            <th><input type="checkbox" id="impTodos"></th>
            <th>Data</th><th>Descrição</th><th>Categoria</th><th class="right">Valor</th>
          </tr></thead>
          <tbody>${linhas.map((l, i) => `
            <tr class="${l.duplicata ? "bill-late" : ""}">
              <td><input type="checkbox" class="imp-ck" data-i="${i}"${l.duplicata ? "" : " checked"}></td>
              <td>${fmtDate(l.data)}</td>
              <td>${esc(l.descricao)}${l.duplicata ? `<div class="muted">já existe — ${esc(l.motivoDup)}</div>` : ""}</td>
              <td><select class="imp-cat" data-i="${i}">${optsDe(l.tipo, l.category_id)}</select></td>
              <td class="right ${l.tipo === "receita" ? "positive" : "negative"}">${l.tipo === "receita" ? "+" : "−"} ${money(l.valor)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="actions"><button class="btn" id="confirmImport">Importar</button></div>`;

    const marcados = () => $$(".imp-ck", preview).filter((c) => c.checked).map((c) => +c.dataset.i);
    const atualizaBotao = () => { $("#confirmImport").textContent = `Importar ${marcados().length} lançamento(s)`; };
    atualizaBotao();

    // O ouvinte fica na TABELA (elemento novo a cada leitura de arquivo),
    // e não no painel, para não empilhar a cada arquivo importado.
    const tabela = preview.querySelector("table");
    tabela.addEventListener("change", (e) => {
      if (e.target.id === "impTodos") $$(".imp-ck", preview).forEach((c) => { c.checked = e.target.checked; });
      const sel = e.target.closest(".imp-cat");
      if (sel) linhas[+sel.dataset.i].category_id = sel.value || null;
      atualizaBotao();
    });

    $("#confirmImport").onclick = async () => {
      const idx = marcados();
      if (!idx.length) { alert("Marque pelo menos um lançamento para importar."); return; }
      for (const i of idx) {
        const { catNome, duplicata, motivoDup, ...rest } = linhas[i];
        await Store.add("transactions", { ...rest, conciliada: true });
        // A categoria que ficou valendo na revisão vira regra para a próxima vez.
        if (rest.tipo === "despesa") await aprenderCategoria(rest.descricao, rest.category_id);
      }
      preview.innerHTML = `<div class="alert ok">✅ Importação concluída! ${idx.length} lançamento(s) adicionado(s).</div>`;
      render();
    };
  }

  async function handleImportFile(file) {
    const preview = $("#importPreview");
    preview.innerHTML = `<div class="alert">⏳ Lendo <b>${file.name}</b>…</div>`;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    try {
      let matrix;
      if (ext === "ofx" || ext === "qfx") {
        renderImportPreview(ofxToTransactions(await lerTexto(file)));
        return;
      }
      if (ext === "csv" || file.type === "text/csv") {
        matrix = csvToMatrix(await lerTexto(file));
      } else if (ext === "xlsx" || ext === "xls") {
        if (typeof XLSX === "undefined") throw new Error("A biblioteca de Excel não carregou (precisa de internet).");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      } else if (ext === "pdf") {
        matrix = await pdfToMatrix(file);
      } else {
        throw new Error("Formato não suportado. Use OFX, CSV, Excel (.xlsx) ou PDF.");
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
        if (act === "new-account") openModal("account");
        if (act === "close-modal") closeModal();
        if (act === "save-modal") saveModal();
      }
      const ed = e.target.closest("[data-edit]");
      if (ed) openModal(ed.dataset.edit, ed.dataset.id);
      const tog = e.target.closest("[data-card-toggle]");
      if (tog) {
        const id = tog.dataset.cardToggle;
        if (cartoesAbertos.has(id)) cartoesAbertos.delete(id); else cartoesAbertos.add(id);
        render();
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const label = del.dataset.delLabel || "lançamento";
        if (confirm(`Excluir este ${label}? Esta ação não pode ser desfeita.`)) {
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

    // Filtros interativos do dashboard
    const bindFilter = (id, key) => {
      const s = $("#" + id);
      if (s) s.addEventListener("change", () => { dashFilter[key] = s.value; render(); });
    };
    bindFilter("fPessoa", "pessoa");
    bindFilter("fMes", "mes");
    bindFilter("fCategoria", "categoria");
    bindFilter("fTipo", "tipo");
    const limpar = $("#fLimpar");
    if (limpar) limpar.addEventListener("click", () => {
      dashFilter.pessoa = dashFilter.mes = dashFilter.categoria = dashFilter.tipo = "";
      render();
    });

    // Foto de fundo (aparência)
    const bgStatus = (html) => { const s = $("#bgStatus"); if (s) s.innerHTML = html; };
    const bgPhoto = $("#bgPhoto");
    if (bgPhoto) bgPhoto.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f || !window.FC_BG) return;
      bgStatus("⏳ Preparando a foto…");
      window.FC_BG.setFromFile(f, (ok) => {
        bgStatus(ok
          ? '<span style="color:var(--good)">✅ Foto aplicada.</span>'
          : '<span style="color:var(--bad)">Não consegui salvar a foto neste aparelho.</span>');
        // Zera o campo para que escolher a MESMA foto de novo volte a funcionar
        // (o navegador não dispara "change" quando o valor não muda).
        bgPhoto.value = "";
      });
    });
    const bgRemove = $("#bgRemove");
    if (bgRemove) bgRemove.addEventListener("click", () => {
      if (!window.FC_BG) return;
      if (!window.FC_BG.temFoto()) { bgStatus('<span class="muted">Não há foto de fundo para remover.</span>'); return; }
      const ok = window.FC_BG.clear();
      if (bgPhoto) bgPhoto.value = "";
      bgStatus(ok
        ? '<span style="color:var(--good)">✅ Foto de fundo removida.</span>'
        : '<span style="color:var(--bad)">A foto sumiu da tela, mas este navegador não deixou apagá-la do armazenamento — ela volta ao recarregar. Isso costuma acontecer em aba anônima.</span>');
    });

    // Apagar todos os dados (zona de perigo)
    const wipe = $("#wipeAll");
    if (wipe) wipe.addEventListener("click", async () => {
      const st = $("#wipeStatus");
      if (window.FC_MODE !== "online") {
        if (st) st.innerHTML = '<span style="color:var(--warn)">⚠️ Você está em modo offline. Entre na sua conta (online) antes de apagar, senão os dados voltam ao recarregar.</span>';
        return;
      }
      if (!confirm("Tem certeza? Isso apaga TODOS os lançamentos, cartões, contas, orçamentos e metas de TODA a família.\n\nAs categorias são mantidas. Esta ação NÃO pode ser desfeita.")) return;
      if (!confirm("Confirmação final: apagar tudo mesmo?")) return;
      if (st) st.textContent = "Apagando…";
      await Store.reset();
      dashFilter.pessoa = dashFilter.mes = dashFilter.categoria = dashFilter.tipo = "";
      render();
      if (st) st.innerHTML = '<span style="color:var(--good)">✅ Tudo apagado! O cofre da família começou do zero.</span>';
    });
    // Editar o valor de um lançamento direto no cartão
    const cardsGrid = $("#cardsGrid");
    if (cardsGrid) cardsGrid.addEventListener("change", async (e) => {
      const inp = e.target.closest(".ctx-val");
      if (inp) {
        const v = Math.max(0, parseFloat(inp.value) || 0);
        await Store.update("transactions", inp.dataset.tx, { valor: v });
        render();
      }
    });

    // Seletor de mês das contas a pagar
    const selMes = $("#billsMes");
    if (selMes) selMes.addEventListener("change", () => { billsMes = selMes.value; render(); });

    const billsTable = $("#billsTable");
    if (billsTable) billsTable.addEventListener("change", async (e) => {
      // Pagamento é por MÊS: marcar julho não marca agosto.
      const paid = e.target.closest(".bill-paid");
      if (paid) {
        const conta = Store.allSync("bills").find((b) => b.id === paid.dataset.id);
        if (!conta) return;
        const pagas = { ...(conta.pagas || {}) };
        if (paid.checked) pagas[paid.dataset.ym] = today();
        else delete pagas[paid.dataset.ym];
        await Store.update("bills", paid.dataset.id, { pagas });
        render();
        return;
      }
      // Valor também é por mês (luz e água mudam todo mês).
      const val = e.target.closest(".bill-val");
      if (val) {
        const conta = Store.allSync("bills").find((b) => b.id === val.dataset.id);
        if (!conta) return;
        const valores = { ...(conta.valores || {}) };
        valores[val.dataset.ym] = Math.max(0, parseFloat(val.value) || 0);
        await Store.update("bills", val.dataset.id, { valores });
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
    // Exige login quando há Supabase configurado (cofre da família).
    if (FC.Auth && FC.Auth.requireLogin) await FC.Auth.requireLogin();
    await Store.init();
    // Abre no mês que tem movimento — normalmente o corrente.
    dashFilter.mes = mesComMovimento(Store.allSync("transactions"), Store.allSync("bills"));
    // O filtro de Pessoa entra com o usuário logado SÓ se ele já tiver
    // lançamentos com esse nome (senão o painel apareceria vazio).
    // O painel abre com a casa INTEIRA. Antes ele se filtrava sozinho no
    // nome de quem entrou, e o total do mês vinha menor sem explicação.
    // Filtrar por pessoa continua existindo — mas agora é escolha sua.
    const badge = $("#modeBadge");
    badge.textContent = window.FC_MODE === "online" ? "online" : "offline";
    badge.classList.toggle("online", window.FC_MODE === "online");
    bind();
    // Sincronização em tempo real: re-renderiza quando a família altera algo.
    window.addEventListener("fc:remote", () => render());
    goto("dashboard");
    // Registra service worker (só em http/https)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot();
})();
