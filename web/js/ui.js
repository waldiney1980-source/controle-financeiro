/* ===========================================================
 * ui.js — FinControl
 *
 * O app faz uma coisa: você manda a fatura, ele mostra para onde o
 * seu dinheiro vai. Quatro telas, nada além disso.
 *
 *   Início   quanto sobra e como está a saúde do mês
 *   Faturas  mandar o PDF e ver o que já entrou (até 5)
 *   Fixos    o que se repete, no cartão e fora dele
 *   Futuro   os próximos meses, mês a mês
 *
 * O motor é o de sempre: fatura.js lê o PDF, bills.js faz a conta de
 * competência, store.js guarda no cofre da família.
 * =========================================================== */
(function () {
  const APP_VERSION = "v33";
  const MAX_FATURAS = 5;
  const MESES_FUTURO = 9;

  const { Store } = FC;
  const Bl = FC.Bills;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const cfg = window.FC_CONFIG || {};
  const money = (v) => (+v || 0).toLocaleString(cfg.LOCALE || "pt-BR",
    { style: "currency", currency: cfg.MOEDA || "BRL" });
  const hoje = () => new Date().toISOString().slice(0, 10);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function mesLabel(ym) {
    if (!ym) return "—";
    const [y, m] = ym.split("-").map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString(cfg.LOCALE || "pt-BR",
      { month: "short", year: "2-digit" });
    return s.charAt(0).toUpperCase() + s.slice(1).replace(".", "");
  }
  function dataCurta(d) {
    if (!d) return "";
    const [y, m, dia] = d.split("-");
    return `${dia}/${m}`;
  }
  function curto(v) {
    const n = Math.abs(+v || 0);
    if (n >= 1000) {
      const k = n / 1000;
      return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10).toLocaleString(cfg.LOCALE || "pt-BR") + "k";
    }
    return String(Math.round(n));
  }

  let tela = "inicio";
  let cenario = "sem-novas";

  // ---------- Leituras do cofre ----------
  const ehCartao = (t) => !!t.card_id || t.forma === "cartao";

  function renda() {
    const p = Store.allSync("prefs")[0];
    return p && p.renda != null ? (+p.renda || 0) : 0;
  }

  // Uma fatura importada = um grupo de lançamentos com o mesmo fatura_id.
  function faturas() {
    const m = {};
    Store.allSync("transactions").forEach((t) => {
      if (!t.fatura_id || t.projecao) return;
      const [card_id, ym] = String(t.fatura_id).split(":");
      const g = m[t.fatura_id] || (m[t.fatura_id] = { id: t.fatura_id, card_id, ym, qtd: 0, total: 0 });
      g.qtd++;
      g.total += +t.valor || 0;
    });
    return Object.values(m).sort((a, b) => b.ym.localeCompare(a.ym));
  }

  // O mês da tela é o da fatura mais recente. Sem fatura, o mês corrente.
  function mesFoco() {
    const f = faturas();
    return f.length ? f[0].ym : hoje().slice(0, 7);
  }

  // Mês escolhido no filtro. "" = segue a fatura mais recente sozinho, que
  // é o certo logo depois de importar.
  let mesSel = "";
  function mesAtivo() {
    const ms = mesesDisponiveis();
    if (mesSel && ms.indexOf(mesSel) >= 0) return mesSel;
    return mesFoco();
  }

  // Um mês por fatura guardada, mais o mês corrente. Não invento meses que
  // não têm fatura: aí a tela mostraria zero e pareceria defeito.
  function mesesDisponiveis() {
    const set = new Set(faturas().map((f) => f.ym));
    set.add(hoje().slice(0, 7));
    return Array.from(set).sort().reverse();
  }

  function renderMeses() {
    const ms = mesesDisponiveis();
    const ativo = mesAtivo();
    // Com um mês só não há o que filtrar — a barra some em vez de virar
    // enfeite que não faz nada.
    const html = ms.length < 2 ? "" : ms.map((m) =>
      `<button class="mes${m === ativo ? " on" : ""}" data-mes="${m}">${mesLabel(m)}</button>`).join("");
    ["#mesesInicio", "#mesesFixos"].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  const chaveTxt = (s) => FC.Fatura.chaveSerie(s);

  // ---------- Nome legível ----------
  // A fatura escreve o estabelecimento cru, com cidade, país e código da
  // maquininha grudados: "ICATUSEGUROS*Icat RIO DE JANEIR BR". Aqui isso
  // vira "Icatu Seguros". É só para MOSTRAR — o texto original continua
  // gravado, porque é ele que casa uma fatura com a outra.
  const CIDADES = new RegExp("(" + [
    "rio de janeir[oa]?", "sao paulo", "s ?paulo", "belo horizonte", "curitiba",
    "curiti", "porto alegre", "brasilia", "salvador", "recife", "fortaleza",
    "barueri", "osasco", "nilopolis", "niteroi", "campinas", "guarulhos",
    "santo andre", "sao bernardo", "duque de caxias", "nova iguacu", "betim",
    "contagem", "londrina", "maringa", "joinville", "blumenau", "florianopolis",
    "vitoria", "goiania", "manaus", "belem", "natal", "joao pessoa", "maceio",
    "aracaju", "teresina", "cuiaba", "campo grande", "palmas", "santos"
  ].join("|") + ")\\b", "gi");
  const UF_FIM = /\s+(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to|br|us|ca|gb|ie)\s*$/i;

  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const letras = (s) => (String(s).match(/[a-zA-Z]/g) || []).length;

  function nomeBonito(desc) {
    const original = String(desc || "").trim();
    if (!original) return "—";
    let s = semAcento(original);

    // 1. Lugar sai primeiro. A cidade vem colada no nome com frequência
    //    ("FerreirSao Paulo"), então o corte não exige espaço antes.
    for (let i = 0; i < 3; i++) s = s.replace(UF_FIM, "");
    s = s.replace(CIDADES, " ");
    s = s.replace(/\s+(rio|sp|rj)\s*$/i, " ");       // "… ATLANTICA RIO"

    // 2. Só então o "*": antes dele, a cidade inflava o lado errado e
    //    "ICATUSEGUROS*Icat RIO DE JANEIR" virava "Icat".
    if (s.indexOf("*") > -1) {
      const partes = s.split("*").map((p) => p.trim()).filter(Boolean);
      if (partes.length > 1) {
        const primeira = partes[0];
        // Marca costuma ser a primeira, quando é uma palavra só e inteira.
        s = (primeira.split(/\s+/).length === 1 && letras(primeira) >= 4)
          ? primeira
          : partes.reduce((a, b) => (letras(b) > letras(a) ? b : a));
      }
    }

    // 3. Código de loja e forma jurídica. "com" fica de fora da lista de
    //    propósito: cortá-lo quebraria "netflix.com" e "anthropic.com".
    s = s.replace(/\b[a-z]?\d{3,}\b/gi, " ")
      .replace(/\b(ltda|s\/?a|eireli|epp)\b\.?/gi, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+\d{1,3}\s*$/, "")
      .replace(/[\s.\-_/]+$/g, "")
      .replace(/\s+/g, " ").trim();

    // 4. "Smiles Clube Smiles" → "Smiles Clube"
    const vistas = new Set();
    s = s.split(" ").filter((p) => {
      const k = p.toLowerCase();
      if (k.length < 3) return true;
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    }).join(" ");

    if (letras(s) < 3) return original;              // cortou demais: desiste

    // 5. GRITANDO EM MAIÚSCULA vira Capitalizado.
    const maiusculas = (s.match(/[A-Z]/g) || []).length;
    if (maiusculas >= letras(s) * 0.7) {
      s = s.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    }
    return s;
  }

  // Repete no mês `ym` o que é mensal e começou antes. Uma repetição por
  // série: sem isso, a mesma assinatura vinda de duas faturas entraria duas
  // vezes no mesmo mês.
  function ocorrenciasMensais(tx, ym) {
    const out = [];
    const chave = (t) => t.tipo + "|" + chaveTxt(t.descricao);
    const reais = new Set();
    (tx || []).forEach((t) => {
      if (String(t.data || "").slice(0, 7) !== ym) return;
      out.push({ ...t, repetido: false });
      reais.add(chave(t));
    });
    const cands = {};
    (tx || []).forEach((t) => {
      const m = String(t.data || "").slice(0, 7);
      if (!m || m >= ym || t.recorrencia !== "mensal") return;
      const k = chave(t);
      if (reais.has(k)) return;
      if (!cands[k] || String(t.data) > String(cands[k].data)) cands[k] = t;
    });
    Object.values(cands).forEach((t) => out.push({ ...t, data: ym + String(t.data).slice(7), repetido: true }));
    return out;
  }

  // Despesa fora do cartão: o que você digita. Vem de duas coleções por
  // história do app (bills antigo e transactions), mas na tela é uma coisa só.
  function foraDoMes(ym) {
    const out = [];
    Bl.ocorrenciasDoMes(Store.allSync("bills"), ym).forEach((o) => out.push({
      col: "bills", id: o.id, ym: o.ym, descricao: o.descricao, valor: o.valor,
      data: o.venc, recorrencia: o.recorrencia, repetido: false
    }));
    ocorrenciasMensais(Store.allSync("transactions"), ym).forEach((t) => {
      if (t.tipo !== "despesa" || ehCartao(t)) return;
      out.push({
        col: "transactions", id: t.id, ym, descricao: t.descricao, valor: +t.valor || 0,
        data: t.data, recorrencia: t.recorrencia, repetido: t.repetido
      });
    });
    return out.sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  }

  // Cobranças do cartão que voltam todo mês. `marcada` = está valendo como
  // mensal; `sugerida` = apareceu em duas faturas ou mais e ainda não foi
  // confirmada. As duas aparecem na tela com um interruptor.
  function recorrentesCartao() {
    const tx = Store.allSync("transactions");
    const porChave = {};
    tx.forEach((t) => {
      if (t.tipo !== "despesa" || !ehCartao(t) || t.parcela || t.projecao || t.estorno) return;
      const k = chaveTxt(t.descricao);
      if (!k) return;
      const g = porChave[k] || (porChave[k] = { chave: k, itens: [], meses: new Set() });
      g.itens.push(t);
      if (t.fatura_id) g.meses.add(String(t.fatura_id).split(":")[1]);
    });
    return Object.values(porChave).map((g) => {
      const recente = g.itens.slice().sort((a, b) => String(b.data).localeCompare(String(a.data)))[0];
      return {
        chave: g.chave,
        descricao: recente.descricao,
        valor: +recente.valor || 0,
        marcada: g.itens.some((t) => t.recorrencia === "mensal"),
        vezes: g.meses.size,
        ids: g.itens.map((t) => t.id)
      };
    }).filter((r) => r.marcada || r.vezes >= 2)
      .sort((a, b) => b.valor - a.valor);
  }

  // ---------- As quatro fatias de um mês ----------
  function fatias(ym, variavelBase) {
    const tx = Store.allSync("transactions");
    const noMes = (t) => String(t.data || "").slice(0, 7) === ym;

    const parcelas = tx.filter((t) => t.tipo === "despesa" && ehCartao(t) && t.parcela && noMes(t))
      .reduce((s, t) => s + (+t.valor || 0), 0);

    const oc = ocorrenciasMensais(tx, ym);
    const recorrentes = oc.filter((t) =>
      t.tipo === "despesa" && ehCartao(t) && t.recorrencia === "mensal" && !t.parcela)
      .reduce((s, t) => s + (+t.valor || 0), 0);

    const fixos = foraDoMes(ym).reduce((s, l) => s + l.valor, 0);

    // Variável = o resto da fatura. Real no mês importado; para a frente,
    // repete o nível de hoje, porque ninguém sabe o gasto de dezembro.
    let variavel;
    if (variavelBase == null) {
      const totalCartao = tx.filter((t) => t.tipo === "despesa" && ehCartao(t) && noMes(t))
        .reduce((s, t) => s + (+t.valor || 0), 0);
      variavel = Math.max(0, totalCartao - parcelas - recorrentes);
    } else {
      variavel = variavelBase;
    }
    return { ym, fixos, parcelas, recorrentes, variavel, total: fixos + parcelas + recorrentes + variavel };
  }

  function serieFutura(cen) {
    const ym0 = mesAtivo();
    const base = fatias(ym0, null);
    const out = [base];
    for (let i = 1; i < MESES_FUTURO; i++) {
      const m = fatias(Bl.ymAdd(ym0, i), base.variavel);
      // Mantendo o ritmo, a parcela que acaba é reposta por outra.
      if (cen === "ritmo") m.parcelas = Math.max(m.parcelas, base.parcelas);
      m.total = m.fixos + m.parcelas + m.recorrentes + m.variavel;
      out.push(m);
    }
    return out;
  }

  function saudeDoMes() {
    const r = renda();
    const f = fatias(mesAtivo(), null);
    const pct = r > 0 ? (f.total / r) * 100 : 0;
    const nivel = r <= 0 ? "sem" : pct >= 95 ? "ruim" : pct >= 75 ? "atencao" : "bom";
    return { renda: r, ...f, pct, nivel, sobra: r - f.total };
  }

  // ---------- Telas ----------
  function render() {
    const t = tela;
    ["inicio", "faturas", "fixos", "futuro"].forEach((k) =>
      $("#tela-" + k).classList.toggle("hidden", k !== t));
    $$("#abas button").forEach((b) => b.classList.toggle("on", b.dataset.tela === t));
    const titulos = {
      inicio: ["Meu mês", "Como está o mês da fatura"],
      faturas: ["Faturas", "Mande o PDF e o resto é automático"],
      fixos: ["Fixos", "O que se repete todo mês"],
      futuro: ["Futuro", "Para onde os próximos meses caminham"]
    };
    $("#topoTit").textContent = titulos[t][0];
    $("#topoSub").textContent = titulos[t][1];

    renderMeses();
    if (t === "inicio") renderInicio();
    if (t === "faturas") renderFaturas();
    if (t === "fixos") renderFixos();
    if (t === "futuro") renderFuturo();
  }

  function renderInicio() {
    const s = saudeDoMes();
    const temFatura = faturas().length > 0;

    $("#cxSaldo").classList.toggle("ruim", s.sobra < 0 && s.renda > 0);
    $("#saldoRot").textContent = s.renda <= 0 ? "Gasto de " + mesLabel(s.ym)
      : s.sobra < 0 ? "Faltou em " + mesLabel(s.ym) : "Sobra de " + mesLabel(s.ym);
    $("#saldoNum").textContent = money(s.renda <= 0 ? s.total : Math.abs(s.sobra));
    $("#saldoSub").textContent = !temFatura
      ? "Nenhuma fatura importada ainda"
      : s.renda <= 0 ? "Informe sua receita mensal para ver quanto sobra"
      : `${money(s.renda)} de receita · ${money(s.total)} de gasto`;

    // Saúde
    const cx = $("#saude");
    if (!temFatura) {
      cx.innerHTML = `<div class="vazio"><span class="em">📄</span>
        Importe a fatura do cartão e o app monta tudo sozinho.
        <div style="margin-top:16px"><button class="btn" data-ir="faturas">Importar fatura</button></div></div>`;
    } else if (s.renda <= 0) {
      cx.innerHTML = `<div class="aviso atencao">Informe sua <b>receita mensal</b> logo abaixo — sem ela não dá para dizer se o mês está saudável.</div>`;
    } else {
      const rotulo = { bom: "Saudável", atencao: "Atenção", ruim: "Apertado" }[s.nivel];
      const frase = {
        bom: "Seus gastos cabem na renda com folga.",
        atencao: "Está justo. Uma despesa fora do previsto aperta o mês.",
        ruim: "Os gastos comem quase toda a renda — ou passam dela."
      }[s.nivel];
      cx.innerHTML = `
        <span class="selo ${s.nivel}">${rotulo}</span>
        <div class="linha" style="padding-top:0">
          <span class="nome">Renda comprometida</span>
          <b>${s.pct.toFixed(0)}%</b>
        </div>
        <div class="barra"><i class="${s.nivel}" style="width:${Math.min(100, s.pct).toFixed(1)}%"></i></div>
        <p class="dica">${frase}</p>`;
    }

    // O mês por dentro
    const dentro = [
      { ic: "💳", nome: "Cartão — gasto livre", v: s.variavel, d: "compras do mês na fatura" },
      { ic: "📆", nome: "Cartão — parcelas", v: s.parcelas, d: "compras parceladas em andamento" },
      { ic: "🔁", nome: "Cartão — recorrentes", v: s.recorrentes, d: "assinaturas e mensalidades" },
      { ic: "🏠", nome: "Fora do cartão", v: s.fixos, d: "boleto, PIX, débito" }
    ];
    $("#resumoMes").innerHTML = dentro.map((l) => `
      <div class="linha">
        <span class="esq"><span class="ico">${l.ic}</span>
          <span><span class="nome">${l.nome}</span><div class="desc">${l.d}</div></span></span>
        <b>${money(l.v)}</b>
      </div>`).join("") + `
      <div class="linha"><span class="esq"><span class="nome" style="font-weight:800">Total do mês</span></span>
        <b style="font-size:16px">${money(s.total)}</b></div>`;

    // Receita
    $("#rendaBox").innerHTML = `
      <div class="campo" style="margin-bottom:10px">
        <label>Quanto entra por mês, já líquido</label>
        <input type="number" id="inRenda" inputmode="decimal" step="0.01" placeholder="0,00"
          value="${s.renda > 0 ? s.renda : ""}">
      </div>
      <button class="btn sec" id="btnRenda">Salvar receita</button>
      <p class="dica">É a base de tudo: a saúde do mês e a linha da renda no gráfico saem daqui.</p>`;
  }

  function renderFaturas() {
    const fs = faturas();
    const cards = Store.allSync("cards");

    $("#fatAviso").innerHTML = !cards.length
      ? `<div class="aviso atencao">Cadastre um cartão primeiro — é dele que vem o <b>dia de vencimento</b>.</div>`
      : fs.length >= MAX_FATURAS
        ? `<div class="aviso">Você já tem ${fs.length} faturas. Ao importar mais uma, a mais antiga sai para manter ${MAX_FATURAS}.</div>`
        : "";

    const sel = $("#fatCard");
    const atual = sel.value;
    sel.innerHTML = cards.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")
      || `<option value="">— nenhum cartão —</option>`;
    if (atual && cards.some((c) => c.id === atual)) sel.value = atual;
    $("#btnEscolher").disabled = !cards.length;

    $("#listaFaturas").innerHTML = fs.length ? fs.map((f) => {
      const c = cards.find((x) => x.id === f.card_id);
      return `<div class="linha">
        <span class="esq"><span class="ico">📄</span>
          <span><span class="nome">${mesLabel(f.ym)}</span>
          <div class="desc">${esc(c ? c.nome : "cartão removido")} · ${f.qtd} lançamentos</div></span></span>
        <span style="display:flex;align-items:center;gap:10px">
          <b>${money(f.total)}</b>
          <button class="btn perigo mini" data-del-fatura="${f.id}">✕</button>
        </span>
      </div>`;
    }).join("") : `<div class="vazio"><span class="em">📭</span>Nenhuma fatura importada ainda.</div>`;

    $("#listaCartoes").innerHTML = cards.length ? cards.map((c) => `
      <div class="linha">
        <span class="esq"><span class="ico">💳</span>
          <span><span class="nome">${esc(c.nome)}</span>
          <div class="desc">fecha dia ${c.dia_fechamento || "—"} · vence dia ${c.dia_vencimento || "—"}</div></span></span>
        <button class="btn perigo mini" data-del-cartao="${c.id}">✕</button>
      </div>`).join("") : `<div class="vazio" style="padding:20px">Nenhum cartão.</div>`;
  }

  function renderFixos() {
    const recs = recorrentesCartao();
    const maior = Math.max(...recs.map((r) => r.valor), 1);
    $("#listaRecorrentes").innerHTML = recs.length ? recs.map((r) => `
      <div class="linha" style="align-items:flex-start">
        <span class="esq" style="flex:1">
          <span style="flex:1;min-width:0">
            <span class="nome">${esc(nomeBonito(r.descricao))}</span>
            <div class="desc">${money(r.valor)} por mês${r.vezes >= 2 ? ` · visto em ${r.vezes} faturas` : ""}${r.marcada ? "" : " · sugestão"}</div>
            <div class="item-barra"><i style="width:${((r.valor / maior) * 100).toFixed(1)}%"></i></div>
          </span>
        </span>
        <label class="chave"><input type="checkbox" data-rec="${esc(r.chave)}" ${r.marcada ? "checked" : ""}><i></i></label>
      </div>`).join("") : `<div class="vazio"><span class="em">🔁</span>Nenhuma cobrança recorrente encontrada. Importe uma fatura.</div>`;

    const ym = mesAtivo();
    const fora = foraDoMes(ym);
    $("#listaFora").innerHTML = fora.length ? fora.map((l) => `
      <div class="linha">
        <span class="esq"><span class="ico">${l.recorrencia === "mensal" ? "🔁" : "•"}</span>
          <span><span class="nome">${esc(l.descricao)}</span>
          <div class="desc">${l.recorrencia === "mensal" ? "todo mês" : "só em " + mesLabel(ym)}${l.data ? " · dia " + dataCurta(l.data).split("/")[0] : ""}</div></span></span>
        <span style="display:flex;align-items:center;gap:10px">
          <b>${money(l.valor)}</b>
          ${l.repetido ? "" : `<button class="btn perigo mini" data-del-fora="${l.col}:${l.id}">✕</button>`}
        </span>
      </div>`).join("") : `<div class="vazio" style="padding:22px">Nada lançado fora do cartão em ${mesLabel(ym)}.</div>`;
  }

  function renderFuturo() {
    $$(".cenarios button").forEach((b) => b.classList.toggle("on", b.dataset.cenario === cenario));
    const serie = serieFutura(cenario);
    const outra = serieFutura(cenario === "ritmo" ? "sem-novas" : "ritmo");
    const r = renda();
    const wrap = $("#grafico");

    if (!serie.some((m) => m.total > 0)) {
      wrap.innerHTML = `<div class="vazio"><span class="em">📊</span>Importe a fatura para ver os próximos meses.</div>`;
      $("#listaParcelas").innerHTML = "";
      return;
    }

    const FAIXAS = [
      { k: "fixos", cor: "#64748b", nome: "Fora do cartão" },
      { k: "parcelas", cor: "#7c5cff", nome: "Parcelas" },
      { k: "recorrentes", cor: "#f5b23d", nome: "Recorrentes" },
      { k: "variavel", cor: "#ff5f7a", nome: "Gasto livre" }
    ];
    const W = 700, H = 320, padL = 40, padR = 12, padT = 30, padB = 52;
    const plotH = H - padT - padB;
    const n = serie.length;
    const step = (W - padL - padR) / n;
    const barW = Math.min(34, step * 0.52);
    const maxV = Math.max(...serie.map((m) => m.total), ...outra.map((m) => m.total), r, 1) * 1.14;
    const y = (v) => padT + plotH - (v / maxV) * plotH;

    let eixo = "";
    for (let k = 0; k <= 3; k++) {
      const v = (maxV / 3) * k, yy = y(v);
      eixo += `<line x1="${padL}" x2="${W - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="rgba(255,255,255,.055)"/>
        <text x="${padL - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#61728c">${curto(v)}</text>`;
    }

    let corpo = "", base = "";
    serie.forEach((m, i) => {
      const cx = padL + step * i + step / 2, x0 = cx - barW / 2;
      let acc = 0;
      FAIXAS.forEach((f) => {
        const v = m[f.k];
        if (v <= 0) return;
        const yt = y(acc + v), alt = Math.max(1, y(acc) - yt);
        corpo += `<rect x="${x0.toFixed(1)}" y="${yt.toFixed(1)}" width="${barW.toFixed(1)}" height="${alt.toFixed(1)}" fill="${f.cor}" rx="1.5"><title>${mesLabel(m.ym)} · ${f.nome}: ${money(v)}</title></rect>`;
        acc += v;
      });
      const alvo = outra[i].total;
      if (alvo > m.total + 1) {
        corpo += `<rect x="${(x0 - 4).toFixed(1)}" y="${y(alvo).toFixed(1)}" width="${(barW + 8).toFixed(1)}"
          height="${(y(0) - y(alvo)).toFixed(1)}" fill="none" stroke="rgba(255,255,255,.28)"
          stroke-dasharray="3 3" rx="3"><title>Outro cenário: ${money(alvo)}</title></rect>`;
      }
      corpo += `<text x="${cx.toFixed(1)}" y="${(y(Math.max(m.total, alvo)) - 7).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="800" fill="#e9eff8">${curto(m.total)}</text>`;
      const sobra = r - m.total;
      base += `<text x="${cx.toFixed(1)}" y="${H - 30}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#8fa1bb">${mesLabel(m.ym).split(".")[0]}</text>`;
      if (r > 0) base += `<text x="${cx.toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="10" font-weight="800" fill="${sobra < 0 ? "#ff5f7a" : "#19c98a"}">${sobra < 0 ? "−" : "+"}${curto(sobra)}</text>`;
    });

    let linhaRenda = "";
    if (r > 0) {
      linhaRenda = `<line x1="${padL}" x2="${W - padR}" y1="${y(r).toFixed(1)}" y2="${y(r).toFixed(1)}"
        stroke="#19c98a" stroke-width="2" stroke-dasharray="6 4"/>
        <text x="${W - padR}" y="${(y(r) - 6).toFixed(1)}" text-anchor="end" font-size="9.5" font-weight="700" fill="#19c98a">renda ${curto(r)}</text>`;
    }

    wrap.innerHTML = `
      <div class="gr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gastos dos próximos ${n} meses">
        ${eixo}${corpo}${linhaRenda}${base}
      </svg></div>
      <div class="legenda">${FAIXAS.map((f) => `<span><i style="background:${f.cor}"></i>${f.nome}</span>`).join("")}
        <span><i style="background:none;border:1px dashed rgba(255,255,255,.45)"></i>Outro cenário</span></div>
      <p class="dica">Parcelas e recorrentes são valores reais da fatura. O gasto livre é estimativa: repete o nível de ${mesLabel(mesAtivo())}.</p>`;

    // Quando cada parcela acaba
    const porSerie = {};
    Store.allSync("transactions").forEach((t) => {
      if (!t.parcela || !ehCartao(t)) return;
      const nome = t.descricao.replace(/\s*\(\d+\/\d+\)\s*$/, "");
      const k = chaveTxt(nome);
      const [i, tot] = t.parcela.split("/").map(Number);
      const g = porSerie[k] || (porSerie[k] = { nome, total: tot, valor: +t.valor || 0, ultima: "", falta: 0 });
      const ym = String(t.data).slice(0, 7);
      if (ym > g.ultima) { g.ultima = ym; g.i = i; }
      if (t.projecao) g.falta++;
    });
    const lista = Object.values(porSerie).sort((a, b) => a.ultima.localeCompare(b.ultima));
    $("#listaParcelas").innerHTML = lista.length ? lista.map((p) => `
      <div class="linha">
        <span class="esq"><span class="ico">📆</span>
          <span><span class="nome">${esc(nomeBonito(p.nome))}</span>
          <div class="desc">${money(p.valor)} × ${p.total} · termina em ${mesLabel(p.ultima)}</div></span></span>
        <b>${p.falta ? p.falta + " a pagar" : "última"}</b>
      </div>`).join("") : `<div class="vazio" style="padding:22px">Nenhuma compra parcelada.</div>`;
  }

  // ---------- Importar fatura ----------
  async function importar(file) {
    const st = $("#fatStatus");
    const card = Store.allSync("cards").find((c) => c.id === $("#fatCard").value);
    if (!card) { st.innerHTML = `<div class="aviso ruim">Escolha o cartão.</div>`; return; }
    st.innerHTML = `<div class="aviso">⏳ Lendo ${esc(file.name)}…</div>`;
    try {
      const linhas = await FC.Fatura.lerLinhas(file);
      const res = FC.Fatura.analisar(linhas, $("#fatMes").value || hoje().slice(0, 7));
      $("#fatMesCx").classList.toggle("hidden", !!res.competenciaDetectada);
      if (!res.competenciaDetectada) {
        st.innerHTML = `<div class="aviso atencao">Não achei o vencimento no PDF. Informe a competência acima e mande de novo.</div>`;
        return;
      }
      if (!res.itens.length) {
        st.innerHTML = `<div class="aviso ruim">Não encontrei compras neste PDF.</div>`;
        return;
      }
      const comp = res.competencia;
      const diaVenc = FC.Fatura.diaVencimento(card, res.vencimento);
      const lancs = FC.Fatura.expandir(res.itens, {
        competencia: comp, card_id: card.id, dia_venc: diaVenc,
        categoriaDe: () => null,
        conhecidas: FC.Fatura.recorrentesConhecidas(Store.allSync("transactions"))
      });
      const soma = lancs.filter((l) => !l.projecao).reduce((s, l) => s + l.valor, 0);
      const bate = res.totalDeclarado != null && Math.abs(res.totalDeclarado - soma) < 0.05;

      const apagar = FC.Fatura.substituiveis(Store.allSync("transactions"), card.id, comp);
      const manuais = apagar.filter((t) => !t.fatura_id);
      if (manuais.length) {
        const perdido = manuais.reduce((s, t) => s + (+t.valor || 0), 0);
        if (!confirm(`${manuais.length} lançamento(s) digitado(s) à mão em ${mesLabel(comp)}, somando ${money(perdido)}, serão substituídos pela fatura.\n\nContinuar?`)) {
          st.innerHTML = `<div class="aviso">Importação cancelada.</div>`;
          return;
        }
      }

      st.innerHTML = `<div class="aviso">⏳ Lançando ${lancs.length}…</div>`;
      for (const t of apagar) await Store.remove("transactions", t.id);
      for (const l of lancs) {
        const { catNome, recorrente, ...rest } = l;
        await Store.add("transactions", rest);
      }
      await podarFaturas(comp);

      const fut = lancs.filter((l) => l.projecao).length;
      const rec = lancs.filter((l) => l.recorrente).length;
      st.innerHTML = `<div class="aviso bom">✅ <b>${mesLabel(comp)}</b> lançada — ${lancs.length - fut} do mês${
        fut ? `, ${fut} parcelas nos meses seguintes` : ""}${rec ? `, ${rec} recorrentes` : ""}.
        ${bate ? `<br>Confere com o total impresso: <b>${money(res.totalDeclarado)}</b>.`
               : `<br>⚠️ Somei ${money(soma)}, o PDF diz ${money(res.totalDeclarado || 0)}. Confira os lançamentos.`}</div>`;
      $("#fatFile").value = "";
      render();
    } catch (e) {
      st.innerHTML = `<div class="aviso ruim">Erro ao ler o PDF: ${esc(e.message)}</div>`;
    }
  }

  // Mantém no máximo MAX_FATURAS. A mais antiga sai inteira, com as
  // projeções que ela tinha gerado.
  async function podarFaturas(protegida) {
    let fs = faturas();
    while (fs.length > MAX_FATURAS) {
      const velha = fs[fs.length - 1];
      if (velha.ym === protegida) break;
      await apagarFatura(velha.id, true);
      fs = faturas();
    }
  }

  async function apagarFatura(id, silencioso) {
    const [card_id, ym] = String(id).split(":");
    if (!silencioso && !confirm(`Apagar a fatura de ${mesLabel(ym)} e as parcelas que ela lançou?`)) return;
    const alvo = Store.allSync("transactions").filter((t) =>
      t.fatura_id === id || (t.projecao && t.card_id === card_id && String(t.fatura_id).split(":")[1] === ym));
    for (const t of alvo) await Store.remove("transactions", t.id);
    render();
  }

  // ---------- Modal ----------
  let modalTipo = null;
  const CAMPOS = {
    cartao: [
      { n: "nome", l: "Nome do cartão", t: "text", req: true },
      { n: "dia_fechamento", l: "Dia que fecha", t: "number" },
      { n: "dia_vencimento", l: "Dia que vence", t: "number" }
    ],
    fora: [
      { n: "descricao", l: "O que é", t: "text", req: true },
      { n: "valor", l: "Valor (R$)", t: "number", req: true },
      { n: "vencimento", l: "Data", t: "date", v: () => hoje() },
      { n: "recorrencia", l: "Repete todo mês?", t: "select",
        o: [{ v: "mensal", t: "Sim, todo mês" }, { v: "nenhuma", t: "Não, só neste" }] }
    ]
  };

  function abrirModal(tipo) {
    modalTipo = tipo;
    $("#modalTit").textContent = tipo === "cartao" ? "Novo cartão" : "Despesa fora do cartão";
    $("#modalForm").innerHTML = CAMPOS[tipo].map((c) => {
      if (c.t === "select") {
        return `<div class="campo"><label>${c.l}</label><select name="${c.n}">${
          c.o.map((o) => `<option value="${o.v}">${o.t}</option>`).join("")}</select></div>`;
      }
      const val = c.v ? ` value="${c.v()}"` : "";
      return `<div class="campo"><label>${c.l}</label><input name="${c.n}" type="${c.t}"${val}${c.t === "number" ? ' inputmode="decimal" step="0.01"' : ""}></div>`;
    }).join("");
    $("#modal").classList.add("on");
  }
  function fecharModal() { $("#modal").classList.remove("on"); modalTipo = null; }

  async function salvarModal() {
    const d = {};
    $$("#modalForm input,#modalForm select").forEach((i) => { d[i.name] = i.value; });
    if (modalTipo === "cartao") {
      if (!d.nome) return alert("Dê um nome ao cartão.");
      await Store.add("cards", {
        nome: d.nome,
        dia_fechamento: parseInt(d.dia_fechamento, 10) || null,
        dia_vencimento: parseInt(d.dia_vencimento, 10) || null
      });
    } else {
      if (!d.descricao || !d.valor) return alert("Preencha o que é e o valor.");
      await Store.add("bills", {
        descricao: d.descricao, valor: parseFloat(d.valor) || 0,
        vencimento: d.vencimento || hoje(), recorrencia: d.recorrencia || "mensal",
        pagas: {}, valores: {}
      });
    }
    fecharModal();
    render();
  }

  // ---------- Eventos ----------
  function ligar() {
    $("#abas").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tela]");
      if (b) { tela = b.dataset.tela; window.scrollTo(0, 0); render(); }
    });

    document.body.addEventListener("click", async (e) => {
      const ir = e.target.closest("[data-ir]");
      if (ir) { tela = ir.dataset.ir; render(); return; }

      const acao = e.target.closest("[data-acao]");
      if (acao) {
        const a = acao.dataset.acao;
        if (a === "novo-cartao") abrirModal("cartao");
        if (a === "nova-fora") abrirModal("fora");
        if (a === "fechar") fecharModal();
        if (a === "salvar") salvarModal();
        return;
      }
      const mb = e.target.closest("[data-mes]");
      if (mb) { mesSel = mb.dataset.mes; render(); return; }

      const cen = e.target.closest("[data-cenario]");
      if (cen) { cenario = cen.dataset.cenario; render(); return; }

      const df = e.target.closest("[data-del-fatura]");
      if (df) { await apagarFatura(df.dataset.delFatura); return; }

      const dc = e.target.closest("[data-del-cartao]");
      if (dc) {
        if (!confirm("Apagar o cartão e todos os lançamentos dele?")) return;
        const id = dc.dataset.delCartao;
        for (const t of Store.allSync("transactions").filter((t) => t.card_id === id)) {
          await Store.remove("transactions", t.id);
        }
        await Store.remove("cards", id);
        render();
        return;
      }
      const dfo = e.target.closest("[data-del-fora]");
      if (dfo) {
        const [col, id] = dfo.dataset.delFora.split(":");
        if (!confirm("Apagar esta despesa?")) return;
        await Store.remove(col, id);
        render();
        return;
      }
      if (e.target.id === "btnEscolher") $("#fatFile").click();
      if (e.target.id === "btnRenda") {
        const v = parseFloat($("#inRenda").value) || 0;
        const p = Store.allSync("prefs")[0];
        if (p) await Store.update("prefs", p.id, { renda: v });
        else await Store.add("prefs", { renda: v });
        render();
      }
    });

    $("#fatFile").addEventListener("change", (e) => {
      if (e.target.files[0]) importar(e.target.files[0]);
    });

    // Interruptor de recorrente: vale para todos os lançamentos da série.
    document.body.addEventListener("change", async (e) => {
      const sw = e.target.closest("[data-rec]");
      if (!sw) return;
      const chave = sw.dataset.rec;
      const valor = sw.checked ? "mensal" : "nenhuma";
      const alvo = Store.allSync("transactions").filter((t) =>
        ehCartao(t) && !t.parcela && !t.projecao && chaveTxt(t.descricao) === chave);
      for (const t of alvo) await Store.update("transactions", t.id, { recorrencia: valor });
      render();
    });

    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });
  }

  // ---------- Versão ----------
  function marcarVersao() {
    const p = $("#pillVer");
    if (!p) return;
    p.textContent = APP_VERSION;
    p.addEventListener("click", async () => {
      p.textContent = "…";
      try {
        if ("serviceWorker" in navigator) {
          const rs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(rs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const ks = await caches.keys();
          await Promise.all(ks.map((k) => caches.delete(k)));
        }
      } catch (err) {}
      sessionStorage.removeItem("fc_recarregou");
      location.reload();
    });
  }

  // ---------- Boot ----------
  async function boot() {
    marcarVersao();
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    if (FC.Auth && FC.Auth.requireLogin) await FC.Auth.requireLogin();
    await Store.init();

    const modo = $("#pillModo");
    modo.textContent = window.FC_MODE === "online" ? "online" : "offline";
    modo.classList.toggle("on", window.FC_MODE === "online");

    ligar();
    render();
    window.addEventListener("fc:remote", render);

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (sessionStorage.getItem("fc_recarregou") === "1") return;
        sessionStorage.setItem("fc_recarregou", "1");
        location.reload();
      });
    }
  }

  boot();
})();
