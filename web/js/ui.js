/* ===========================================================
 * ui.js — FinControl
 *
 * Três telas, e nada além disso:
 *
 *   Mês          quanto sobra, para onde vai e o que falta pagar
 *   Lançamentos  tudo do mês numa lista só, e o botão de lançar
 *   Futuro       os próximos meses, as parcelas e o que se repete
 *
 * O motor não mudou: fatura.js lê o PDF, bills.js faz a conta de
 * competência, store.js guarda no cofre da família e migrar.js traz
 * o que estava no painel antigo.
 * =========================================================== */
(function () {
  const APP_VERSION = "v58";
  const MAX_FATURAS = 5;
  const MESES_FUTURO = 12;
  const LISTA_INICIAL = 40;

  const { Store } = FC;
  const Bl = FC.Bills;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const cfg = window.FC_CONFIG || {};

  // Olho fechado: os valores somem da tela, como no aplicativo do banco. É
  // preferência DESTE aparelho, então mora no navegador e não no cofre: você
  // pode querer esconder no computador do trabalho e mostrar no celular.
  let ocultar = false;
  try { ocultar = localStorage.getItem("fc_ocultar") === "1"; } catch (e) {}
  const MASCARA = "R$ ●●●●";

  const moneyReal = (v) => (+v || 0).toLocaleString(cfg.LOCALE || "pt-BR",
    { style: "currency", currency: cfg.MOEDA || "BRL" });
  const money = (v) => (ocultar ? MASCARA : moneyReal(v));
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
  function mesNome(ym) {
    if (!ym) return "—";
    const [y, m] = ym.split("-").map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString(cfg.LOCALE || "pt-BR", { month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const diaCurto = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : "");
  function curto(v) {
    if (ocultar) return "•••";
    const n = Math.abs(+v || 0);
    if (n >= 1000) {
      const k = n / 1000;
      return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10).toLocaleString(cfg.LOCALE || "pt-BR") + "k";
    }
    return String(Math.round(n));
  }

  let tela = "mes";
  let cenario = "sem-novas";
  let busca = "";
  let verTudo = false;
  const abertos = new Set();   // grupos de "Para onde vai" abertos na tela Mês

  // ---------- Leituras do cofre ----------
  const ehCartao = (t) => !!t.card_id || t.forma === "cartao";

  function rendaFixa() {
    const p = Store.allSync("prefs")[0];
    return p && p.renda != null ? (+p.renda || 0) : 0;
  }

  // Receitas lançadas no mês. As marcadas como mensais se repetem para a
  // frente sozinhas, como as despesas.
  function receitasDoMes(ym) {
    return ocorrenciasMensais(Store.allSync("transactions"), ym)
      .filter((t) => t.tipo === "receita")
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  }

  // A renda do mês: o que foi lançado como receita mais, quando não há
  // nenhuma receita que se repita, o valor fixo do campo da aba Conta.
  // Assim quem só tem salário fixo escreve um número e pronto, e quem lança
  // as entradas de verdade não vê o salário contado duas vezes.
  function renda(ym) {
    const mes = ym || mesAtivo();
    const lista = receitasDoMes(mes);
    const soma = lista.reduce((t, r) => t + (+r.valor || 0), 0);
    const temMensal = lista.some((r) => r.recorrencia === "mensal");
    return soma + (temMensal ? 0 : rendaFixa());
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

  // O mês da tela é o corrente, quando há algo nele; senão o da fatura mais
  // recente. Abrir o app no dia 2 e cair em julho passaria por defeito.
  function mesFoco() {
    const atual = hoje().slice(0, 7);
    const ms = mesesDisponiveis();
    if (ms.indexOf(atual) >= 0) return atual;
    // Sem mês corrente na lista, o mais recente que não seja futuro.
    const passados = ms.filter((m) => m <= atual);
    return passados.length ? passados[passados.length - 1] : (ms[0] || atual);
  }

  let mesSel = "";
  function mesAtivo() {
    const ms = mesesDisponiveis();
    if (mesSel && ms.indexOf(mesSel) >= 0) return mesSel;
    return mesFoco();
  }

  // Meses que têm alguma coisa dentro, mais o corrente. Não invento mês
  // vazio: a tela mostraria zero e pareceria defeito. Para a frente vale
  // meio ano, o bastante para conferir a parcela que você acabou de lançar
  // sem encher a régua de meses até 2028.
  const HORIZONTE = 6;
  function mesesDisponiveis() {
    const atual = hoje().slice(0, 7);
    const limite = Bl.ymAdd(atual, HORIZONTE);
    const set = new Set(faturas().map((f) => f.ym));
    Store.allSync("transactions").forEach((t) => {
      const m = String(t.data || "").slice(0, 7);
      if (m && m <= limite) set.add(m);
    });
    Store.allSync("bills").forEach((b) => {
      const m = String(b.vencimento || "").slice(0, 7);
      if (m && b.recorrencia !== "mensal") set.add(m);
    });
    // O mês corrente e os dois seguintes entram sempre: dá para lançar o
    // aluguel do mês que vem, ou conferir o que já cai lá, mesmo que ainda
    // não exista nenhum lançamento real naquele mês.
    set.add(atual);
    set.add(Bl.ymAdd(atual, 1));
    set.add(Bl.ymAdd(atual, 2));
    // Do mais antigo para o mais novo, como o tempo anda.
    return Array.from(set).sort().slice(-24);
  }

  function renderMeses() {
    const ms = mesesDisponiveis();
    const ativo = mesAtivo();
    const html = ms.length < 2 ? "" : ms.map((m) =>
      `<button class="mes${m === ativo ? " on" : ""}" data-mes="${m}">${mesLabel(m)}</button>`).join("");
    ["#mesesMes", "#mesesLanc", "#mesesConta", "#mesesEcon"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.innerHTML = html;
      // A régua começa no passado e vai até meio ano à frente, então o mês
      // aberto pode nascer fora da vista.
      const on = el.querySelector(".mes.on");
      if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
    });
  }

  const chaveTxt = (s) => FC.Fatura.chaveSerie(s);

  // Com um cartão só, dizer o nome dele em toda linha é ruído. Com dois ou
  // mais, é a informação que faltava: de qual cartão saiu cada gasto.
  function apelidoCartao(card_id) {
    const cards = Store.allSync("cards");
    if (cards.length < 2 || !card_id) return "";
    const c = cards.find((x) => x.id === card_id);
    if (!c) return "";
    // "OUROCARD ELO NANQUIM" vira "Elo Nanquim": o que distingue está no fim.
    const bruto = String(c.nome || "").replace(/^ourocard\s+/i, "").trim() || ("final " + (c.final || ""));
    const curto = bruto.length > 18 ? bruto.slice(0, 18).trim() : bruto;
    return curto.toLowerCase().replace(/(^|\s)([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
  }

  // ---------- Nome legível ----------
  // A fatura escreve o estabelecimento cru, com cidade, país e código da
  // maquininha grudados: "ICATUSEGUROS*Icat RIO DE JANEIR BR". Aqui isso
  // vira "Icatu Seguros". É só para MOSTRAR — o texto original continua
  // gravado, porque é ele que casa uma fatura com a outra.
  const CIDADES = new RegExp("(" + [
    // O extrato corta a cidade na largura da coluna: "RIO DE JANEIR",
    // "RIO DE JANEI", "R. DE JANEIRO". Todas viram a mesma coisa aqui.
    "r\\.? ?de jan\\w*", "rio de jan\\w*", "sao paulo", "s ?paulo", "sao goncalo",
    "belo horizonte", "curitiba",
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
    // O sufixo de parcela é informação, não sujeira: sai antes da limpeza
    // e volta no fim.
    const mp = original.match(/\s*\((\d{1,2}\/\d{1,2})\)\s*$/);
    const sufixo = mp ? ` (${mp[1]})` : "";
    let s = semAcento(mp ? original.slice(0, mp.index) : original);

    for (let i = 0; i < 3; i++) s = s.replace(UF_FIM, "");
    s = s.replace(CIDADES, " ");
    s = s.replace(/\s+(rio|sp|rj)\s*$/i, " ");

    if (s.indexOf("*") > -1) {
      const partes = s.split("*").map((p) => p.trim()).filter(Boolean);
      if (partes.length > 1) {
        const primeira = partes[0];
        s = (primeira.split(/\s+/).length === 1 && letras(primeira) >= 4)
          ? primeira
          : partes.reduce((a, b) => (letras(b) > letras(a) ? b : a));
      }
    }

    s = s.replace(/\b[a-z]?\d{3,}\b/gi, " ")
      .replace(/\b(ltda|s\/?a|eireli|epp)\b\.?/gi, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+\d{1,3}\s*$/, "")
      .replace(/[\s.\-_/]+$/g, "")
      .replace(/\s+/g, " ").trim();

    const vistas = new Set();
    s = s.split(" ").filter((p) => {
      const k = p.toLowerCase();
      if (k.length < 3) return true;
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    }).join(" ");

    if (letras(s) < 3) return original;

    const maiusculas = (s.match(/[A-Z]/g) || []).length;
    if (maiusculas >= letras(s) * 0.7) {
      s = s.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    }
    return s + sufixo;
  }

  // Repete no mês `ym` o que é mensal e começou antes. Uma repetição por
  // série: sem isso, a mesma assinatura vinda de duas faturas entraria duas
  // vezes no mesmo mês.
  function ocorrenciasMensais(tx, ym) {
    const out = [];
    const chave = (t) => t.tipo + "|" + chaveTxt(t.descricao);
    const reais = new Set();
    // Cartões cuja fatura DAQUELE mês já foi importada.
    const comFatura = new Set();
    (tx || []).forEach((t) => {
      if (t.fatura_id && String(t.fatura_id).split(":")[1] === ym) {
        comFatura.add(String(t.fatura_id).split(":")[0]);
      }
      if (String(t.data || "").slice(0, 7) !== ym) return;
      out.push({ ...t, repetido: false });
      reais.add(chave(t));
    });
    const cands = {};
    (tx || []).forEach((t) => {
      const m = String(t.data || "").slice(0, 7);
      if (!m || m >= ym || t.recorrencia !== "mensal") return;
      // Chegou a fatura do mês para este cartão? Então ela é a verdade, e
      // repetir a assinatura do mês passado conta a mesma coisa duas vezes.
      // O nome muda de uma fatura para a outra ("ICATUSEGUROS*Icat" numa,
      // "ICATU SEGUROS RIO DE JANEIR BR" na outra), então casar pelo texto
      // não bastava: Icatu e HDI entravam em dobro.
      if (t.card_id && comFatura.has(t.card_id)) return;
      const k = chave(t);
      if (reais.has(k)) return;
      if (!cands[k] || String(t.data) > String(cands[k].data)) cands[k] = t;
    });
    Object.values(cands).forEach((t) => out.push({ ...t, data: ym + String(t.data).slice(7), repetido: true }));
    return out;
  }

  // Contas a pagar do mês: o que sai por boleto, PIX ou débito e ainda pode
  // ser marcado como pago.
  function contasDoMes(ym) {
    return Bl.ocorrenciasDoMes(Store.allSync("bills"), ym)
      .sort((a, b) => String(a.venc || "").localeCompare(String(b.venc || "")));
  }

  // Despesa fora do cartão = conta a pagar do mês + o que foi digitado como
  // já gasto. As duas coisas somam no mês.
  function foraDoMes(ym) {
    const out = [];
    contasDoMes(ym).forEach((o) => out.push({
      col: "bills", id: o.id, ym: o.ym, descricao: o.descricao, valor: o.valor,
      data: o.venc, recorrencia: o.recorrencia, paga: o.paga, pagaEm: o.pagaEm, repetido: false
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
  // mensal; `sugerida` = apareceu em duas faturas ou mais.
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
        chave: g.chave, descricao: recente.descricao, valor: +recente.valor || 0,
        marcada: g.itens.some((t) => t.recorrencia === "mensal"),
        vezes: g.meses.size, ids: g.itens.map((t) => t.id)
      };
    // Entra na lista o que já está valendo como mensal, o que apareceu em
    // duas faturas e o que tem cara de assinatura mesmo com uma fatura só —
    // senão não haveria como ligar o interruptor de uma cobrança nova.
    }).filter((r) => r.marcada || r.vezes >= 2 || FC.Fatura.ehRecorrente(r.descricao))
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

    // Variável = a compra do dia a dia: o que passou no cartão e não é
    // parcela nem assinatura. Some direto, em vez de sair por subtração do
    // total: as assinaturas repetidas nos meses à frente não estão na
    // fatura de nenhum mês, e a subtração comia o gasto novo do mês.
    // Para a frente, repete o nível de hoje — ninguém sabe o gasto de dezembro.
    let variavel;
    if (variavelBase == null) {
      variavel = tx.filter((t) => t.tipo === "despesa" && ehCartao(t) && noMes(t)
        && !t.parcela && t.recorrencia !== "mensal")
        .reduce((s, t) => s + (+t.valor || 0), 0);
    } else {
      variavel = variavelBase;
    }
    return { ym, fixos, parcelas, recorrentes, variavel, total: fixos + parcelas + recorrentes + variavel };
  }

  // De onde sai a estimativa de gasto livre dos meses à frente: o mês da
  // tela, quando já tem compra do dia a dia; senão o último mês que teve.
  // Sem isso, abrir o app num mês cuja fatura ainda não chegou projetava
  // gasto livre zero para o ano inteiro, o que é bonito e mentiroso.
  let refVariavel = null;
  function baseVariavel(ym0) {
    for (let i = 0; i < 12; i++) {
      const m = Bl.ymAdd(ym0, -i);
      const v = fatias(m, null).variavel;
      if (v > 0) return { valor: v, ym: m };
    }
    return { valor: 0, ym: ym0 };
  }

  // Os lançamentos por trás de cada fatia. As regras são as MESMAS de
  // fatias(), senão a lista aberta não fecharia com o número da linha.
  function itensDoGrupo(ym, k) {
    const tx = Store.allSync("transactions");
    const noMes = (t) => String(t.data || "").slice(0, 7) === ym;
    const arruma = (l) => l.map((t) => {
      const dono = apelidoCartao(t.card_id);
      const base = t.parcela ? "parcela " + t.parcela
        : t.repetido ? "repetida deste mês em diante"
        : t.recorrencia === "mensal" ? "todo mês"
        : t.estorno ? "estorno" : "";
      return {
        id: t.id, col: "transactions", apagavel: !t.repetido,
        // Nome digitado por você fica como está: a limpeza serve para o texto
        // cru da fatura, e passar "Feira do mês" por ela tirava o acento.
        desc: t.fatura_id ? nomeBonito(t.descricao) : t.descricao,
        valor: +t.valor || 0, data: t.data,
        tag: [base, dono].filter(Boolean).join(" · ")
      };
    }).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

    if (k === "parcelas") {
      return arruma(tx.filter((t) => t.tipo === "despesa" && ehCartao(t) && t.parcela && noMes(t)));
    }
    if (k === "recorrentes") {
      return arruma(ocorrenciasMensais(tx, ym).filter((t) =>
        t.tipo === "despesa" && ehCartao(t) && t.recorrencia === "mensal" && !t.parcela));
    }
    if (k === "variavel") {
      return arruma(tx.filter((t) => t.tipo === "despesa" && ehCartao(t) && noMes(t)
        && !t.parcela && t.recorrencia !== "mensal"));
    }
    // fora do cartão: contas a pagar e o que foi digitado
    return foraDoMes(ym).map((l) => ({
      id: l.id, col: l.col, apagavel: !l.repetido,
      desc: l.descricao, valor: l.valor, data: l.data,
      tag: l.col === "bills" ? (l.paga ? "conta paga" : "conta a pagar")
        : l.repetido ? "repetida deste mês em diante"
        : l.recorrencia === "mensal" ? "todo mês" : "já lançado"
    })).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  }

  // A previsão começa SEMPRE no mês corrente, não no mês que estiver
  // escolhido na régua das outras telas: futuro que começa em dezembro
  // porque você tinha aberto dezembro em Lançamentos é armadilha.
  function serieFutura(cen) {
    const ym0 = hoje().slice(0, 7);
    const base = fatias(ym0, null);
    const est = baseVariavel(ym0);
    refVariavel = est;
    // O primeiro mês mostra o gasto livre REAL quando ele já existe. Quando
    // ainda é zero (a fatura daquele mês não chegou), vale a estimativa: um
    // mês com zero de gasto do dia a dia não existe, e escrever isso na
    // tabela dava uma sobra que ninguém vai ter.
    if (!(base.variavel > 0) && est.valor > 0) {
      base.variavel = est.valor;
      base.total = base.fixos + base.parcelas + base.recorrentes + base.variavel;
      base.estimado = true;
    }
    const out = [base];
    for (let i = 1; i < MESES_FUTURO; i++) {
      const m = fatias(Bl.ymAdd(ym0, i), est.valor);
      if (cen === "ritmo") m.parcelas = Math.max(m.parcelas, base.parcelas);
      m.total = m.fixos + m.parcelas + m.recorrentes + m.variavel;
      m.estimado = true;
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

  // Dias que ainda faltam no mês da tela. Mês passado não tem "por dia".
  function diasQueFaltam(ym) {
    const atual = hoje().slice(0, 7);
    if (ym < atual) return 0;
    if (ym > atual) return Bl.diasNoMes(ym);
    return Bl.diasNoMes(ym) - new Date().getDate() + 1;
  }

  // ---------- Telas ----------
  function render() {
    const t = tela;
    ["mes", "lancamentos", "conta", "investir", "economia", "futuro"].forEach((k) =>
      $("#tela-" + k).classList.toggle("hidden", k !== t));
    $$("#abas button").forEach((b) => b.classList.toggle("on", b.dataset.tela === t));
    const ym = mesAtivo();
    const titulos = {
      mes: [mesNome(ym), "Quanto sobra e o que ainda falta pagar"],
      lancamentos: ["Lançamentos", "Tudo o que entrou em " + mesLabel(ym)],
      conta: ["Conta", "O que entra e o que sai sem passar no cartão"],
      investir: ["Investimentos", "O que você já guardou e quanto isso segura"],
      economia: ["Economia", "Onde dá para cortar, olhando os seus gastos"],
      futuro: ["Futuro", "Para onde os próximos meses caminham"]
    };
    $("#topoTit").textContent = titulos[t][0];
    $("#topoSub").textContent = titulos[t][1];

    renderMeses();
    if (t === "mes") renderMes();
    setTimeout(pintaOlho, 0);   // os campos são redesenhados a cada render
    if (t === "lancamentos") renderLancamentos();
    if (t === "conta") renderConta();
    if (t === "investir") renderInvestir();
    if (t === "economia") renderEconomia();
    if (t === "futuro") renderFuturo();
  }

  function renderMes() {
    const s = saudeDoMes();   // renda do mês + as quatro fatias do gasto
    const temAlgo = s.total > 0;

    $("#cxSaldo").classList.toggle("ruim", s.sobra < 0 && s.renda > 0);
    $("#saldoRot").textContent = s.renda <= 0 ? "Gasto de " + mesLabel(s.ym)
      : s.sobra < 0 ? "Faltou em " + mesLabel(s.ym) : "Sobra de " + mesLabel(s.ym);
    $("#saldoNum").textContent = money(s.renda <= 0 ? s.total : Math.abs(s.sobra));
    $("#saldoSub").textContent = !temAlgo
      ? "Nada lançado neste mês ainda"
      : s.renda <= 0 ? "Lance sua receita na aba Conta para ver quanto sobra"
      : `${money(s.renda)} de receita · ${money(s.total)} de gasto`;

    // O número mais prático da tela: o que cabe por dia. No mês corrente
    // conta só os dias que ainda faltam; num mês à frente, o mês inteiro.
    const dias = diasQueFaltam(s.ym);
    const atual = hoje().slice(0, 7);
    $("#saldoDia").textContent = (s.renda > 0 && s.sobra > 0 && dias > 0)
      ? (s.ym === atual
          ? `Cabe ${money(s.sobra / dias)} por dia nos ${dias} dias que faltam`
          : s.ym > atual
            ? `Dá ${money(s.sobra / dias)} por dia ao longo de ${mesNome(s.ym).toLowerCase()}`
            : "")
      : "";

    // O mini dash ao lado do saldo: o mês em três números, e cada um leva
    // para a tela onde ele é detalhado.
    const totalCartao = s.variavel + s.parcelas + s.recorrentes;
    const emAberto = contasDoMes(s.ym).filter((c) => !c.paga);
    const somaAberto = emAberto.reduce((t, c) => t + c.valor, 0);
    const fat = faturas().find((f) => f.ym === s.ym);
    $("#saldoMini").innerHTML = `
      <button type="button" class="mini" data-ir="lancamentos">
        <span class="mrot">💳 Cartão</span>
        <span class="mval">${money(totalCartao)}</span>
        <span class="mdet">${(() => {
          const fs = faturas().filter((f) => f.ym === s.ym);
          if (!fs.length) return "sem fatura importada";
          if (fs.length === 1) return "fatura de " + mesLabel(s.ym);
          return fs.length + " faturas somadas";
        })()}</span>
      </button>
      <button type="button" class="mini" data-ir="conta">
        <span class="mrot">🏠 Fora do cartão</span>
        <span class="mval">${money(s.fixos)}</span>
        <span class="mdet">boleto, PIX, débito e dinheiro</span>
      </button>
      ${somaAberto > 0 ? `<button type="button" class="mini" data-ir="conta">
        <span class="mrot">🧾 Ainda a pagar</span>
        <span class="mval">${money(somaAberto)}</span>
        <span class="mdet">${emAberto.length} conta${emAberto.length === 1 ? "" : "s"} em aberto</span>
      </button>` : ""}`;

    // Saúde do mês
    const cx = $("#saude");
    if (!temAlgo) {
      cx.innerHTML = `<div class="vazio"><span class="em">📄</span>
        Importe a fatura do cartão ou lance um gasto — o resto o app monta sozinho.
        <div style="margin-top:16px"><button class="btn" data-acao="importar">Importar fatura</button></div></div>`;
    } else if (s.renda <= 0) {
      cx.innerHTML = `<div class="aviso atencao">Lance sua <b>receita</b> na aba Conta — sem ela não dá para dizer
        se o mês está saudável. <button type="button" class="btn sec mini" data-ir="conta" style="margin-top:8px">Abrir a aba Conta</button></div>`;
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
          <span class="nome">Renda comprometida</span><b>${s.pct.toFixed(0)}%</b>
        </div>
        <div class="barra"><i class="${s.nivel}" style="width:${Math.min(100, s.pct).toFixed(1)}%"></i></div>
        <p class="dica">${frase}</p>`;
    }

    // Para onde vai. Cada linha abre e mostra os lançamentos que a formam:
    // o número sozinho não deixa conferir nada.
    const dentro = [
      { k: "variavel", ic: "💳", nome: "Cartão — gasto livre", v: s.variavel, d: "compras do mês na fatura" },
      { k: "parcelas", ic: "📆", nome: "Cartão — parcelas", v: s.parcelas, d: "compras parceladas em andamento" },
      { k: "recorrentes", ic: "🔁", nome: "Cartão — recorrentes", v: s.recorrentes, d: "assinaturas e mensalidades" },
      { k: "fixos", ic: "🏠", nome: "Fora do cartão", v: s.fixos, d: "boleto, PIX, débito e dinheiro" }
    ];
    const TETO = 12;
    $("#resumoMes").innerHTML = dentro.map((l) => {
      const aberto = abertos.has(l.k);
      const itens = aberto ? itensDoGrupo(s.ym, l.k) : [];
      const mostra = itens.slice(0, TETO);
      const resto = itens.length - mostra.length;
      return `
      <div class="linha grupo-linha${aberto ? " aberta" : ""}" data-grupo="${l.k}" role="button"
        tabindex="0" aria-expanded="${aberto}">
        <span class="esq"><span class="ico">${l.ic}</span>
          <span><span class="nome">${l.nome}</span><div class="desc">${l.d}</div></span></span>
        <span style="display:flex;align-items:center;gap:8px"><b>${money(l.v)}</b>
          <span class="seta">›</span></span>
      </div>
      ${aberto ? `<div class="sublista">${
        mostra.length ? mostra.map((i) => `
          <div class="subitem">
            <span><span class="sn">${esc(i.desc)}</span>
              <span class="sd">${i.data ? diaCurto(i.data) : ""}${i.tag ? " · " + i.tag : ""}</span></span>
            <span style="display:flex;align-items:center;gap:6px">
              <b class="${i.valor < 0 ? "pos" : ""}">${money(i.valor)}</b>
              ${i.apagavel ? `<button type="button" class="btn perigo mini"
                data-del-lanc="${i.col}:${i.id}" aria-label="Apagar">✕</button>` : ""}
            </span>
          </div>`).join("")
          : `<div class="subitem vazio-sub">Nada neste grupo em ${mesLabel(s.ym)}.</div>`}
        ${resto > 0 ? `<div class="subitem mais"><button type="button" class="btn sec mini"
          data-ir="lancamentos">ver os outros ${resto} na aba Lançamentos</button></div>` : ""}
      </div>` : ""}`;
    }).join("") + `
      <div class="linha"><span class="esq"><span class="nome" style="font-weight:800">Total do mês</span></span>
        <b style="font-size:16px">${money(s.total)}</b></div>`;

    // Contas a pagar
    const contas = contasDoMes(s.ym);
    $("#listaContas").innerHTML = htmlListaFora(s.ym);

    const aberto = contas.filter((c) => !c.paga).reduce((t, c) => t + c.valor, 0);
    const jaSaiu = s.fixos - aberto;
    const atrasadas = contas.filter((c) => !c.paga && c.venc && c.venc < hoje());
    $("#contasTotal").innerHTML = foraDoMes(s.ym).length ? `
      <div class="aviso${atrasadas.length ? " ruim" : ""}" style="margin-top:12px">
        <b>${money(aberto)}</b> ainda a pagar · ${money(jaSaiu)} já saiu${
        atrasadas.length ? `<br>⚠️ ${atrasadas.length} vencida${atrasadas.length > 1 ? "s" : ""}.` : ""}
      </div>` : "";

  }

  // A mesma lista serve a tela Mês e a aba Conta: conta a pagar (com a
  // bolinha) e despesa já lançada (o que você digitou e já saiu). Eram duas
  // listas diferentes, e a despesa lançada somava no total sem aparecer em
  // lugar nenhum, o que parecia perda de lançamento.
  function htmlListaFora(ym) {
    const fora = foraDoMes(ym);
    if (!fora.length) {
      return `<div class="vazio" style="padding:22px"><span class="em">🧾</span>Nada fora do cartão em ${mesLabel(ym)}.</div>`;
    }
    return fora.map((l) => {
      const conta = l.col === "bills";
      return `<div class="linha${conta && l.paga ? " paga" : ""}">
        <span class="esq">
          ${conta
            ? `<button type="button" class="check${l.paga ? " on" : ""}" data-pagar="${l.id}:${ym}" aria-label="Marcar como paga">✓</button>`
            : `<span class="ico">💵</span>`}
          <span class="tocavel" ${conta ? `data-edit-conta="${l.id}:${ym}"` : `data-edit-desp="${l.id}"`}>
            <span class="nome">${esc(l.descricao)}</span>
            <div class="desc">${conta
              ? (l.paga ? "pago em " + diaCurto(l.pagaEm) : "vence " + diaCurto(l.data))
              : (l.data ? diaCurto(l.data) + " · " : "") + "já lançado"}${
              l.recorrencia === "mensal" ? " · todo mês" : ""}</div></span></span>
        <span style="display:flex;align-items:center;gap:8px">
          <b>${money(l.valor)}</b>
          ${l.repetido ? "" : `<button type="button" class="btn perigo mini" data-del-lanc="${l.col}:${l.id}">✕</button>`}
        </span>
      </div>`;
    }).join("");
  }

  // ---------- Conta: o que entra e o que sai sem passar no cartão ----------
  function renderConta() {
    const ym = mesAtivo();
    const receitas = receitasDoMes(ym);
    const fora = foraDoMes(ym);
    const entrou = renda(ym);
    const saiu = fora.reduce((t, l) => t + l.valor, 0);
    const temMensal = receitas.some((r) => r.recorrencia === "mensal");
    const fixa = rendaFixa();

    $("#contaKpis").innerHTML = `
      <div class="kpi"><div class="rot">Entrou em ${mesLabel(ym)}</div>
        <div class="val">${money(entrou)}</div>
        <div class="nota">${receitas.length
          ? `${receitas.length} ${receitas.length === 1 ? "receita lançada" : "receitas lançadas"}${
              temMensal ? "" : fixa > 0 ? ` + a receita fixa` : ""}`
          : fixa > 0 ? "só a receita fixa lá embaixo" : "nada lançado ainda"}</div></div>
      <div class="kpi"><div class="rot">Saiu fora do cartão</div>
        <div class="val">${money(saiu)}</div>
        <div class="nota">boleto, PIX, débito e dinheiro</div></div>
      <div class="kpi"><div class="rot">Sobrou na conta</div>
        <div class="val ${entrou - saiu < 0 ? "mal" : ""}">${money(entrou - saiu)}</div>
        <div class="nota">antes de pagar a fatura do cartão</div></div>`;

    $("#listaReceitas").innerHTML = receitas.length ? receitas.map((r) => `
      <div class="linha">
        <span class="esq"><span class="ico">${r.recorrencia === "mensal" ? "🔁" : "💰"}</span>
          <span><span class="nome">${esc(r.descricao)}</span>
          <div class="desc">${diaCurto(r.data)}${r.recorrencia === "mensal" ? " · todo mês" : ""}${
            r.repetido ? " · repetida deste mês em diante" : ""}</div></span></span>
        <span style="display:flex;align-items:center;gap:8px">
          <b class="pos">${money(r.valor)}</b>
          ${r.repetido ? "" : `<button type="button" class="btn perigo mini" data-del-lanc="transactions:${r.id}">✕</button>`}
        </span>
      </div>`).join("")
      : `<div class="vazio" style="padding:22px"><span class="em">💰</span>Nenhuma receita lançada em ${mesLabel(ym)}.
         ${fixa > 0 ? `Vale a receita fixa de ${money(fixa)}.` : ""}</div>`;

    $("#listaFora").innerHTML = htmlListaFora(ym);

    $("#notaFora").textContent = fora.length
      ? "Contas a pagar têm a bolinha para marcar como pagas; toque no nome para corrigir valor ou vencimento."
      : "Aqui entra o que não passa na fatura: aluguel, boleto, PIX, débito e dinheiro.";

    // Receita fixa
    $("#rendaBox").innerHTML = `
      <div class="campo" style="margin-bottom:10px">
        <label>Quanto entra todo mês, já líquido</label>
        <input type="number" id="inRenda" inputmode="decimal" step="0.01" placeholder="0,00"
          value="${fixa > 0 ? fixa : ""}">
      </div>
      <button type="button" class="btn sec" id="btnRenda">Salvar receita fixa</button>
      <p class="dica">${temMensal
        ? "Você já lançou receita marcada como <b>todo mês</b>, então este campo deixou de contar — o valor do mês vem das receitas lançadas."
        : "É o atalho de quem só tem salário: um número que vale para todos os meses. Receitas lançadas acima somam a ele."}</p>`;
  }

  // ---------- Lançamentos: uma lista só ----------
  function lancamentosDoMes(ym) {
    const out = [];
    ocorrenciasMensais(Store.allSync("transactions"), ym).forEach((t) => {
      if (t.tipo !== "despesa") return;      // receita tem tela própria, a aba Conta
      const cartao = ehCartao(t);
      const dono = cartao ? apelidoCartao(t.card_id) : "";
      out.push({
        col: "transactions", id: t.id,
        desc: t.fatura_id ? nomeBonito(t.descricao) : t.descricao,
        valor: +t.valor || 0, data: t.data,
        ico: t.estorno ? "↩️" : t.parcela ? "📆" : cartao ? (t.recorrencia === "mensal" ? "🔁" : "💳") : "💵",
        tag: (t.estorno ? "estorno" : t.parcela ? "parcela " + t.parcela
          : t.recorrencia === "mensal" ? "todo mês" : cartao ? (dono || "cartão") : "fora do cartão")
          + (dono && (t.estorno || t.parcela || t.recorrencia === "mensal") ? " · " + dono : ""),
        apagavel: !t.repetido && !t.projecao,
        futuro: !!t.projecao
      });
    });
    contasDoMes(ym).forEach((c) => out.push({
      col: "bills", id: c.id, desc: c.descricao, valor: c.valor, data: c.venc,
      ico: c.paga ? "✅" : "🧾",
      tag: c.paga ? "conta paga" : "conta a pagar",
      apagavel: true, futuro: false
    }));
    return out.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
  }

  function renderLancamentos() {
    const ym = mesAtivo();
    let lista = lancamentosDoMes(ym);
    const q = busca.trim().toLowerCase();
    if (q) {
      lista = lista.filter((l) =>
        l.desc.toLowerCase().indexOf(q) >= 0);
    }
    const total = lista.reduce((s, l) => s + l.valor, 0);
    const mostrar = verTudo ? lista : lista.slice(0, LISTA_INICIAL);

    $("#listaLanc").innerHTML = mostrar.length ? mostrar.map((l) => `
      <div class="linha">
        <span class="esq"><span class="ico">${l.ico}</span>
          <span><span class="nome">${esc(l.desc)}</span>
          <div class="desc">${l.data ? diaCurto(l.data) + " · " : ""}${l.tag}</div></span></span>
        <span style="display:flex;align-items:center;gap:8px">
          <b class="${l.valor < 0 ? "pos" : ""}">${money(l.valor)}</b>
          ${l.apagavel ? `<button class="btn perigo mini" data-del-lanc="${l.col}:${l.id}">✕</button>` : ""}
        </span>
      </div>`).join("")
      : `<div class="vazio"><span class="em">🔎</span>${q ? "Nada com esse nome em " + mesLabel(ym) + "."
        : "Nada lançado em " + mesLabel(ym) + " ainda."}</div>`;

    $("#lancTotal").innerHTML = `
      ${lista.length > mostrar.length
        ? `<button class="btn sec" data-acao="ver-tudo" style="margin-top:12px">Mostrar os outros ${lista.length - mostrar.length}</button>`
        : ""}
      ${lista.length ? `<div class="aviso" style="margin-top:12px">
        <b>${money(total)}</b> em ${lista.length} lançamento${lista.length > 1 ? "s" : ""} de ${mesLabel(ym)}.</div>` : ""}`;
  }

  // ---------- Investimentos ----------
  // O app não fala com corretora nenhuma: aqui você diz o que tem e quanto
  // vale hoje. O valor de tudo isto é o cruzamento com o resto — quantos
  // meses da SUA vida esse dinheiro cobre se a renda parar.
  const TIPOS_INV = ["Reserva/CDB", "Tesouro Direto", "Poupança", "Fundo",
    "Ações/FII", "Previdência", "Cripto", "Outro"];

  function investimentos() {
    return Store.allSync("investments").slice()
      .sort((a, b) => (+b.atual || 0) - (+a.atual || 0));
  }

  // Gasto de um mês médio: a média dos meses que já têm lançamento de
  // verdade, sem contar os que só têm projeção de parcela.
  function gastoMensalTipico() {
    const meses = mesesDisponiveis().filter((m) => m <= hoje().slice(0, 7));
    const totais = meses.map((m) => fatias(m, null).total).filter((v) => v > 0);
    if (!totais.length) return 0;
    return totais.reduce((a, b) => a + b, 0) / totais.length;
  }

  function renderInvestir() {
    const lista = investimentos();
    const atual = lista.reduce((t, i) => t + (+i.atual || 0), 0);
    const aplicado = lista.reduce((t, i) => t + (+i.aplicado || 0), 0);
    const ganho = atual - aplicado;
    const aportes = lista.reduce((t, i) => t + (+i.aporte || 0), 0);
    const gasto = gastoMensalTipico();
    const meses = gasto > 0 ? atual / gasto : 0;

    $("#invKpis").innerHTML = `
      <div class="kpi"><div class="rot">Guardado hoje</div>
        <div class="val">${money(atual)}</div>
        <div class="nota">${lista.length
          ? `${lista.length} ${lista.length === 1 ? "aplicação" : "aplicações"}${
              aportes > 0 ? ` · ${money(aportes)} por mês de aporte` : ""}`
          : "nada cadastrado ainda"}</div></div>
      <div class="kpi"><div class="rot">Rendimento</div>
        <div class="val ${ganho < 0 ? "mal" : ""}">${ganho >= 0 ? "+" : "−"}${money(Math.abs(ganho))}</div>
        <div class="nota">${aplicado > 0
          ? `sobre ${money(aplicado)} aplicados${ocultar ? "" : ` · ${(ganho / aplicado * 100).toFixed(1).replace(".", ",")}%`}`
          : "informe quanto você aplicou para ver o ganho"}</div></div>
      <div class="kpi"><div class="rot">Segura você por</div>
        <div class="val">${gasto > 0 ? (ocultar ? "•••" : meses.toFixed(1).replace(".", ",") + " meses") : "—"}</div>
        <div class="nota">${gasto > 0
          ? `com o gasto de um mês típico, ${money(gasto)}`
          : "lance um mês de gastos para eu calcular"}</div></div>`;

    $("#listaInvest").innerHTML = lista.length ? lista.map((i) => {
      const g = (+i.atual || 0) - (+i.aplicado || 0);
      return `<div class="linha">
        <span class="esq"><span class="ico">📈</span>
          <span class="tocavel" data-edit-inv="${i.id}">
            <span class="nome">${esc(i.nome)}</span>
            <div class="desc">${esc(i.tipo || "Outro")}${
              i.aporte > 0 ? " · " + money(i.aporte) + " por mês" : ""}${
              i.aplicado > 0 ? " · aplicado " + money(i.aplicado) : ""}</div></span></span>
        <span style="display:flex;align-items:center;gap:8px">
          <span style="text-align:right">
            <b style="display:block;color:var(--label)">${money(i.atual)}</b>
            ${i.aplicado > 0 ? `<span class="sd ${g >= 0 ? "pos" : "neg"}" style="font-size:12.5px">${
              g >= 0 ? "+" : "−"}${money(Math.abs(g))}</span>` : ""}
          </span>
          <button type="button" class="btn perigo mini" data-del-inv="${i.id}">✕</button>
        </span>
      </div>`;
    }).join("")
      : `<div class="vazio"><span class="em">📈</span>Nada cadastrado. Some a poupança, o CDB, o Tesouro,
         o que estiver guardado, e o app diz quantos meses isso cobre.</div>`;

    $("#notaInvest").textContent = lista.length
      ? "Toque no nome para atualizar o valor de hoje. O saldo não se atualiza sozinho: quem sabe quanto rendeu é o seu banco."
      : "";

    // Reserva de emergência
    const alvoMeses = 6;
    const alvo = gasto * alvoMeses;
    const pct = alvo > 0 ? Math.min(atual / alvo, 1) * 100 : 0;
    const nivel = meses >= 6 ? "bom" : meses >= 3 ? "atencao" : "ruim";
    $("#invReserva").innerHTML = gasto <= 0
      ? `<div class="vazio" style="padding:18px">Sem gastos lançados ainda, não dá para dizer quanto é a sua reserva.</div>`
      : `
      <span class="selo ${nivel}">${meses >= 6 ? "Reserva formada" : meses >= 3 ? "Meio caminho" : "Começando"}</span>
      <div class="linha" style="padding-top:0">
        <span class="nome">Meta de ${alvoMeses} meses</span><b>${money(alvo)}</b>
      </div>
      <div class="barra"><i class="${nivel}" style="width:${pct.toFixed(1)}%"></i></div>
      <p class="dica">${meses >= 6
        ? `Você tem ${meses.toFixed(1).replace(".", ",")} meses guardados. O que passa disso pode ir para
           investimento de prazo mais longo, que rende mais e demora a virar dinheiro.`
        : `Faltam ${money(Math.max(0, alvo - atual))} para seis meses de gasto. ${
            aportes > 0
              ? `No ritmo de ${money(aportes)} por mês, dá em ${Math.ceil((alvo - atual) / aportes)} meses.`
              : "Cadastre um aporte mensal na aplicação para eu calcular o prazo."}`}</p>`;
  }

  // ---------- Economia: onde dá para cortar ----------
  // Tudo aqui sai do que ESTÁ lançado. Nenhuma sugestão é chute de média de
  // mercado: ou é uma cobrança repetida que dá para contestar, ou é dinheiro
  // que já saiu e você decide se quer que saia de novo.
  const PADRAO = {
    transporte: /uber|\b99\b|99\*|cabify|t[aá]xi|lamsa|veloe|sem parar|conectcar/i,
    delivery: /ifd\*|ifood|rappi|zedelivery|james ?delivery|delivery/i,
    streaming: /netflix|spotify|disney|hbo|globoplay|deezer|paramount|youtube ?premium|prime ?video|apple\.?com|kindle/i,
    academia: /wellhub|gympass|smart ?fit|bodytech|selfit|panobianco|bluefit/i,
    software: /anthropic|openai|chatgpt|claude|midjourney|canva|notion|github|google ?(one|storage)|microsoft|adobe|dropbox|icloud/i
  };

  function gastosDoCartao(ym) {
    return Store.allSync("transactions").filter((t) =>
      t.tipo === "despesa" && ehCartao(t) && String(t.data || "").slice(0, 7) === ym && !t.estorno);
  }

  function acharEconomias(ym) {
    const achados = [];
    const doMes = gastosDoCartao(ym);
    const oc = ocorrenciasMensais(Store.allSync("transactions"), ym);

    // 1. A mesma cobrança, no mesmo dia, pelo mesmo valor. É o achado mais
    // valioso porque não exige abrir mão de nada: ou é erro do banco, ou é
    // compra feita duas vezes sem querer.
    const pares = {};
    doMes.forEach((t) => {
      const k = [String(t.data_compra || t.data).slice(0, 10), t.descricao.toLowerCase().trim(),
        (+t.valor || 0).toFixed(2)].join("|");
      (pares[k] = pares[k] || []).push(t);
    });
    const repetidas = Object.values(pares).filter((g) => g.length > 1);
    if (repetidas.length) {
      const extra = repetidas.reduce((soma, g) => soma + (g.length - 1) * (+g[0].valor || 0), 0);
      achados.push({
        nivel: "alto", valor: extra, uma_vez: true,
        titulo: repetidas.length === 1 ? "Uma cobrança saiu em dobro" : `${repetidas.length} cobranças saíram em dobro`,
        texto: "Mesma loja, mesmo dia, mesmo valor. Pode ser compra repetida sem querer ou erro da maquininha. "
          + "Peça os comprovantes antes do vencimento: o estorno entra na fatura seguinte.",
        itens: repetidas.map((g) => ({
          desc: nomeBonito(g[0].descricao),
          det: `${g.length}× ${money(g[0].valor)} em ${diaCurto(g[0].data_compra || g[0].data)}`,
          valor: (g.length - 1) * (+g[0].valor || 0)
        }))
      });
    }

    // 2. Dois planos do mesmo lugar valendo ao mesmo tempo.
    const porCasa = {};
    oc.filter((t) => t.tipo === "despesa" && ehCartao(t) && t.recorrencia === "mensal" && !t.parcela)
      .forEach((t) => { const k = chaveTxt(t.descricao); if (k) (porCasa[k] = porCasa[k] || []).push(t); });
    const dobradas = Object.values(porCasa).filter((g) => g.length > 1);
    if (dobradas.length) {
      const solto = dobradas.reduce((soma, g) => {
        const ord = g.slice().sort((a, b) => (+b.valor || 0) - (+a.valor || 0));
        return soma + ord.slice(1).reduce((x, t) => x + (+t.valor || 0), 0);
      }, 0);
      achados.push({
        nivel: "alto", valor: solto,
        titulo: "Assinatura repetida no mesmo lugar",
        texto: "Duas mensalidades do mesmo serviço estão ativas no mesmo mês. Mantendo só a maior, o resto sai da fatura todo mês.",
        itens: dobradas.flatMap((g) => g.map((t) => ({
          desc: nomeBonito(t.descricao), det: "mensal", valor: +t.valor || 0
        })))
      });
    }

    // 3. As assinaturas, do maior para o menor. Cada uma é uma decisão sua.
    const assinaturas = oc.filter((t) => t.tipo === "despesa" && ehCartao(t)
      && t.recorrencia === "mensal" && !t.parcela)
      .sort((a, b) => (+b.valor || 0) - (+a.valor || 0));
    if (assinaturas.length) {
      const total = assinaturas.reduce((x, t) => x + (+t.valor || 0), 0);
      const tres = assinaturas.slice(0, 3).reduce((x, t) => x + (+t.valor || 0), 0);
      achados.push({
        nivel: "medio", valor: tres,
        titulo: "Assinaturas: " + money(total) + " por mês",
        texto: `São ${money(total * 12)} por ano que saem sem nenhuma decisão sua a cada mês. `
          + `As três maiores somam ${money(tres)} por mês. `
          + "Vale abrir uma a uma e perguntar se ainda faz sentido, lembrando que seguro é proteção "
          + "e streaming é entretenimento: cortar não é a mesma conta nos dois casos. "
          + "Na aba Futuro dá para desligar o que não se repete mais.",
        itens: assinaturas.slice(0, 8).map((t) => ({
          desc: nomeBonito(t.descricao), det: money((+t.valor || 0) * 12) + " por ano", valor: +t.valor || 0
        }))
      });
    }

    // 4. Aplicativo de transporte e comida: muitos valores pequenos que
    // ninguém soma, e é justamente onde o corte é indolor.
    [["transporte", "Corrida de aplicativo", "Uber, 99, pedágio e estacionamento"],
     ["delivery", "Comida por aplicativo", "iFood, Rappi e afins"]].forEach(([chave, titulo, quem]) => {
      const itens = doMes.filter((t) => PADRAO[chave].test(t.descricao) && !t.parcela);
      if (itens.length < 3) return;
      const total = itens.reduce((x, t) => x + (+t.valor || 0), 0);
      if (total < 100) return;
      achados.push({
        nivel: "medio", valor: total / 3,
        titulo: `${titulo}: ${money(total)} em ${mesLabel(ym)}`,
        texto: `${itens.length} cobranças (${quem}), média de ${money(total / itens.length)} cada. `
          + `Cortando um terço, sobram ${money(total / 3)} por mês, ${money(total * 4)} por ano.`,
        itens: [...itens].sort((a, b) => b.valor - a.valor).slice(0, 6).map((t) => ({
          desc: nomeBonito(t.descricao), det: diaCurto(t.data_compra || t.data), valor: +t.valor || 0
        }))
      });
    });

    // 5. Onde o dinheiro foi, somando o mesmo lugar. Sem sugestão junto: é
    // o retrato, e a decisão é de quem olha.
    const porLugar = {};
    doMes.filter((t) => !t.parcela && t.recorrencia !== "mensal").forEach((t) => {
      const k = chaveTxt(t.descricao) || t.descricao;
      const g = porLugar[k] || (porLugar[k] = { desc: t.descricao, n: 0, total: 0 });
      g.n++; g.total += +t.valor || 0;
    });
    const lugares = Object.values(porLugar).sort((a, b) => b.total - a.total).slice(0, 6);
    if (lugares.length) {
      achados.push({
        nivel: "info", valor: 0,
        titulo: "Onde o dinheiro foi em " + mesLabel(ym),
        texto: "Mesmo estabelecimento somado, fora parcelas e assinaturas. Serve para enxergar o hábito, não a compra.",
        itens: lugares.map((g) => ({ desc: nomeBonito(g.desc), det: `${g.n}× no mês`, valor: g.total }))
      });
    }

    // 6. Parcela que acaba é aumento de salário, se não for recontratada.
    const serie = serieFutura("sem-novas");
    const hoje0 = serie[0] ? serie[0].parcelas : 0;
    const alivio = serie.slice(1).map((m) => ({ ym: m.ym, cai: hoje0 - m.parcelas }))
      .filter((x) => x.cai > 50);
    if (alivio.length) {
      const primeiro = alivio[0];
      achados.push({
        nivel: "info", valor: 0,
        titulo: `A partir de ${mesLabel(primeiro.ym)} sobram ${money(primeiro.cai)} das parcelas`,
        texto: "Parcela que termina só vira dinheiro no bolso se não for substituída por outra compra parcelada. "
          + "Esse é o momento de guardar, não de trocar de dívida.",
        itens: alivio.slice(0, 5).map((x) => ({
          desc: mesLabel(x.ym), det: "parcelas menores que hoje", valor: x.cai
        }))
      });
    }

    return achados.sort((a, b) => (b.valor || 0) - (a.valor || 0));
  }

  function renderEconomia() {
    const ym = mesAtivo();
    const achados = acharEconomias(ym);
    const porMes = achados.filter((a) => a.valor > 0 && !a.uma_vez).reduce((x, a) => x + a.valor, 0);
    const deVolta = achados.filter((a) => a.uma_vez).reduce((x, a) => x + a.valor, 0);
    const r = renda(ym);

    $("#econTopo").innerHTML = achados.length ? `
      <div class="kpi"><div class="rot">Dá para revisar</div>
        <div class="val">${money(porMes)}<span style="font-size:15px;font-weight:500"> /mês</span></div>
        <div class="nota">${money(porMes * 12)} por ano, somando as sugestões abaixo${
          r > 0 ? ` · ${((porMes / r) * 100).toFixed(0)}% da sua renda` : ""}</div></div>
      ${deVolta > 0 ? `<div class="kpi"><div class="rot">Para conferir agora</div>
        <div class="val mal">${money(deVolta)}</div>
        <div class="nota">cobrança repetida na fatura deste mês</div></div>` : ""}`
      : "";

    $("#econLista").innerHTML = achados.length ? achados.map((a) => `
      <div class="grupo">
        <p class="grupo-tit">${a.nivel === "alto" ? "⚠️ " : a.nivel === "medio" ? "✂️ " : "👁 "}${esc(a.titulo)}</p>
        <div class="card pad">
          <p class="dica" style="margin:0 0 12px">${a.texto}</p>
          ${a.valor > 0 ? `<div class="aviso ${a.nivel === "alto" ? "ruim" : "bom"}" style="margin:0 0 12px">
            <b>${money(a.valor)}</b> ${a.uma_vez ? "para contestar nesta fatura" : "por mês"}</div>` : ""}
          <div class="econitens">${a.itens.map((i) => `
            <div class="subitem"><span><span class="sn">${esc(i.desc)}</span>
              <span class="sd">${esc(i.det)}</span></span><b>${money(i.valor)}</b></div>`).join("")}</div>
        </div>
      </div>`).join("")
      : `<div class="vazio"><span class="em">✂️</span>Importe a fatura do mês para eu procurar onde dá para cortar.</div>`;
  }

  // ---------- Futuro ----------
  // Os números do alto da tela: o que já está comprometido daqui para a
  // frente, o mês que aperta mais e até quando as parcelas pesam.
  function painelFuturo(serie, r) {
    const comprometido = serie.reduce((t, m) => t + m.fixos + m.parcelas + m.recorrentes, 0);
    // A renda pode mudar de mês para mês (13º, aluguel recebido, um extra),
    // então o mês mais apertado é o de menor sobra, não o de maior gasto.
    const sobraDe = (m) => renda(m.ym) - m.total;
    const pior = serie.reduce((a, m) => (sobraDe(m) < sobraDe(a) ? m : a), serie[0]);
    const comParcela = serie.filter((m) => m.parcelas > 0);
    const fim = comParcela.length ? comParcela[comParcela.length - 1] : null;
    const saldoParcelas = Store.allSync("transactions")
      .filter((t) => t.projecao && t.parcela && String(t.data).slice(0, 7) >= serie[0].ym)
      .reduce((t, x) => t + (+x.valor || 0), 0);
    const negativos = serie.filter((m) => renda(m.ym) > 0 && m.total > renda(m.ym)).length;
    return { comprometido, pior, fim, saldoParcelas, negativos };
  }

  function renderFuturo() {
    $$(".cenarios button").forEach((b) => b.classList.toggle("on", b.dataset.cenario === cenario));
    const serie = serieFutura(cenario);
    const outra = serieFutura(cenario === "ritmo" ? "sem-novas" : "ritmo");
    // A renda muda de mês para mês (13º, aluguel recebido, um extra), então
    // aqui ela serve só para saber SE existe receita informada. Cada mês usa
    // a sua, tanto na sobra quanto na linha do gráfico.
    const r = renda(serie[0].ym);
    const wrap = $("#grafico");

    if (!serie.some((m) => m.total > 0)) {
      wrap.innerHTML = `<div class="vazio"><span class="em">📊</span>Importe a fatura ou lance um gasto para ver os próximos meses.</div>`;
      $("#dashKpis").innerHTML = "";
      $("#tabelaPrev").innerHTML = `<div class="vazio" style="padding:22px">Sem nada para projetar ainda.</div>`;
      $("#notaPrev").textContent = "";
      $("#listaParcelas").innerHTML = "";
      $("#listaRecorrentes").innerHTML = "";
      return;
    }

    // ---------- Os cartões do dash ----------
    const k = painelFuturo(serie, r);
    const piorSobra = renda(k.pior.ym) - k.pior.total;
    $("#dashKpis").innerHTML = `
      <div class="kpi">
        <div class="rot">Comprometido em ${serie.length} meses</div>
        <div class="val">${money(k.comprometido)}</div>
        <div class="nota">parcelas, assinaturas e contas fixas, sem contar o gasto do dia a dia</div>
      </div>
      <div class="kpi">
        <div class="rot">Mês mais apertado</div>
        <div class="val">${mesLabel(k.pior.ym)}</div>
        <div class="nota ${r > 0 && piorSobra < 0 ? "mal" : ""}">${r > 0
          ? (piorSobra < 0 ? `faltam ${money(-piorSobra)} para fechar o mês` : `sobra ${money(piorSobra)}`)
          : "informe a receita para saber quanto sobra"}</div>
      </div>
      <div class="kpi">
        <div class="rot">Parcelas ainda a pagar</div>
        <div class="val">${money(k.saldoParcelas)}</div>
        <div class="nota">${k.fim ? `a última cai em ${mesLabel(k.fim.ym)}` : "nenhuma parcela em aberto"}</div>
      </div>`;

    // ---------- A tabela mês a mês ----------
    $("#tabelaPrev").innerHTML = `
      <div class="prevwrap"><table class="prev">
        <thead><tr><th>Mês</th><th>Comprometido</th><th>Gasto livre</th><th>${r > 0 ? "Sobra" : "Total"}</th></tr></thead>
        <tbody>${serie.map((m) => {
          const comp = m.fixos + m.parcelas + m.recorrentes;
          const sobra = renda(m.ym) - m.total;
          return `<tr>
            <td>${mesLabel(m.ym)}</td>
            <td class="n">${money(comp)}</td>
            <td class="n dim">${money(m.variavel)}</td>
            <td class="n ${r > 0 ? (sobra < 0 ? "mal" : "bem") : ""}">${money(r > 0 ? sobra : m.total)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
    const refMes = mesLabel((refVariavel || serie[0]).ym);
    $("#notaPrev").textContent = (r > 0 && k.negativos
      ? `${k.negativos} ${k.negativos === 1 ? "mês fecha" : "meses fecham"} no vermelho se nada mudar. `
      : "Comprometido é o que já está contratado. ")
      + `O gasto livre é estimativa: repete o nível de ${refMes}. `
      + `A conta começa em ${mesLabel(serie[0].ym)}, o mês corrente.`;

    const FAIXAS = [
      { k: "fixos", cor: "#8b8ba3", nome: "Fora do cartão" },
      { k: "parcelas", cor: "#4f46e5", nome: "Parcelas" },
      { k: "recorrentes", cor: "#b07d18", nome: "Recorrentes" },
      { k: "variavel", cor: "#d92d54", nome: "Gasto livre" }
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
      eixo += `<line x1="${padL}" x2="${W - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="currentColor" stroke-opacity=".09"/>
        <text x="${padL - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="currentColor" opacity=".55">${curto(v)}</text>`;
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
          height="${(y(0) - y(alvo)).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity=".35"
          stroke-dasharray="3 3" rx="3"><title>Outro cenário: ${money(alvo)}</title></rect>`;
      }
      corpo += `<text x="${cx.toFixed(1)}" y="${(y(Math.max(m.total, alvo)) - 7).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${curto(m.total)}</text>`;
      const sobra = renda(m.ym) - m.total;
      base += `<text x="${cx.toFixed(1)}" y="${H - 30}" text-anchor="middle" font-size="9.5" font-weight="600" fill="currentColor" opacity=".6">${mesLabel(m.ym).split(".")[0]}</text>`;
      if (r > 0) base += `<text x="${cx.toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="10" font-weight="800" fill="${sobra < 0 ? "#d92d54" : "#0f9d58"}">${sobra < 0 ? "−" : "+"}${curto(sobra)}</text>`;
    });

    // A linha da renda acompanha o mês: uma linha reta com a renda de um mês
    // só dizia "renda 30k" enquanto a tabela mostrava 29.500 no mês ao lado.
    let linhaRenda = "";
    const rendas = serie.map((m) => renda(m.ym));
    if (rendas.some((v) => v > 0)) {
      let d = "";
      rendas.forEach((v, i) => {
        const x0 = padL + step * i, x1 = x0 + step;
        d += `${i === 0 ? "M" : "L"}${x0.toFixed(1)} ${y(v).toFixed(1)} L${x1.toFixed(1)} ${y(v).toFixed(1)} `;
      });
      const varia = rendas.some((v) => Math.abs(v - rendas[0]) > 0.5);
      linhaRenda = `<path d="${d.trim()}" fill="none" stroke="#0f9d58" stroke-width="2" stroke-dasharray="6 4"/>
        <text x="${W - padR}" y="${(y(rendas[rendas.length - 1]) - 6).toFixed(1)}" text-anchor="end"
          font-size="9.5" font-weight="700" fill="#0f9d58">renda ${
            varia ? "mês a mês" : curto(rendas[0])}</text>`;
    }

    wrap.innerHTML = `
      <div class="gr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gastos dos próximos ${n} meses">
        ${eixo}${corpo}${linhaRenda}${base}
      </svg></div>
      <div class="legenda">${FAIXAS.map((f) => `<span><i style="background:${f.cor}"></i>${f.nome}</span>`).join("")}
        <span><i style="background:none;border:1px dashed rgba(255,255,255,.45)"></i>Outro cenário</span></div>
      <p class="dica">Parcelas, recorrentes e contas são valores reais. O gasto livre é estimativa: repete o nível de ${mesLabel((refVariavel || serie[0]).ym)}.</p>`;

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
    // Parcelamento que já acabou não é futuro: sai da lista. Fica o que
    // ainda pesa deste mês em diante, do que acaba primeiro ao que acaba
    // por último.
    const lista = Object.values(porSerie)
      .filter((p) => p.ultima >= mesAtivo())
      .sort((a, b) => a.ultima.localeCompare(b.ultima));
    $("#listaParcelas").innerHTML = lista.length ? lista.map((p) => `
      <div class="linha">
        <span class="esq"><span class="ico">📆</span>
          <span><span class="nome">${esc(nomeBonito(p.nome))}</span>
          <div class="desc">${money(p.valor)} × ${p.total} · termina em ${mesLabel(p.ultima)}</div></span></span>
        <b>${p.falta ? p.falta + " a pagar" : "última"}</b>
      </div>`).join("") : `<div class="vazio" style="padding:22px">Nenhuma parcela em aberto.</div>`;

    // O que se repete todo mês
    const recs = recorrentesCartao();
    const maior = Math.max(...recs.map((x) => x.valor), 1);
    $("#listaRecorrentes").innerHTML = recs.length ? recs.map((x) => `
      <div class="linha" style="align-items:flex-start">
        <span class="esq" style="flex:1">
          <span style="flex:1;min-width:0">
            <span class="nome">${esc(nomeBonito(x.descricao))}</span>
            <div class="desc">${money(x.valor)} por mês${x.vezes >= 2 ? ` · visto em ${x.vezes} faturas` : ""}${x.marcada ? "" : " · sugestão"}</div>
            <div class="item-barra"><i style="width:${((x.valor / maior) * 100).toFixed(1)}%"></i></div>
          </span>
        </span>
        <label class="chave"><input type="checkbox" data-rec="${esc(x.chave)}" ${x.marcada ? "checked" : ""}><i></i></label>
      </div>`).join("") : `<div class="vazio" style="padding:22px">Nada se repetindo ainda. Importe uma fatura.</div>`;
  }

  // ---------- Importar fatura ----------
  // Do arquivo, seja PDF ou texto.
  async function importar(file) {
    const st = $("#fatStatus");
    st.innerHTML = `<div class="aviso">⏳ Lendo ${esc(file.name)}…</div>`;
    try {
      await importarLinhas(await FC.Fatura.lerArquivo(file));
    } catch (e) {
      st.innerHTML = `<div class="aviso ruim">Erro ao ler o arquivo: ${esc(e.message)}</div>`;
    }
    const inp = $("#fatFile");
    if (inp) inp.value = "";
  }

  // Do texto colado: dá para copiar a fatura do aplicativo do banco e jogar
  // aqui, sem baixar PDF nenhum.
  async function importarTexto() {
    const st = $("#fatStatus");
    const cx = $("#fatTexto");
    const linhas = FC.Fatura.linhasDeTexto(cx ? cx.value : "");
    if (linhas.length < 2) {
      st.innerHTML = `<div class="aviso atencao">Cole o texto da fatura na caixa acima, uma linha por lançamento.</div>`;
      return;
    }
    st.innerHTML = `<div class="aviso">⏳ Lendo ${linhas.length} linhas…</div>`;
    try {
      await importarLinhas(linhas);
    } catch (e) {
      st.innerHTML = `<div class="aviso ruim">Erro ao ler o texto: ${esc(e.message)}</div>`;
    }
  }

  // Qual cartão recebe esta fatura. O arquivo tem a palavra final: casa pelo
  // final do número; não achando, cria um cartão com o nome que ele traz. O
  // menu da folha só manda quando você escolhe um cartão à mão.
  async function cartaoDaFatura(linhas) {
    const escolhido = Store.allSync("cards").find((c) => c.id === ($("#fatCard") || {}).value);
    const id = FC.Fatura.identificarCartao(linhas);

    if (id.final) {
      const igual = Store.allSync("cards").find((c) => c.final === id.final);
      if (igual) {
        // Nome melhor no arquivo do que o cadastrado ("Meu cartão").
        if (id.nome && igual.nome !== id.nome) {
          await Store.update("cards", igual.id, { nome: id.nome });
          return { card: { ...igual, nome: id.nome }, novo: false, renomeado: true };
        }
        return { card: igual, novo: false };
      }
      // Primeira fatura de um cartão que ainda não existe aqui. O cartão
      // sem final cadastrado (o "Meu cartão" criado no primeiro lançamento)
      // adota este final em vez de virar um segundo cadastro.
      const semFinal = Store.allSync("cards").find((c) => !c.final);
      if (semFinal && !Store.allSync("transactions").some((t) => t.card_id === semFinal.id && t.fatura_id)) {
        const nome = id.nome || semFinal.nome;
        await Store.update("cards", semFinal.id, { final: id.final, nome });
        return { card: { ...semFinal, final: id.final, nome }, novo: false, renomeado: true };
      }
      const criado = await Store.add("cards", {
        nome: id.nome || ("Cartão " + id.final), final: id.final,
        dia_fechamento: null, dia_vencimento: null
      });
      return { card: criado, novo: true };
    }

    if (escolhido) return { card: escolhido, novo: false };
    return { card: await cartaoPadrao(), novo: false };
  }

  async function importarLinhas(linhas) {
    const st = $("#fatStatus");
    const achado = await cartaoDaFatura(linhas);
    let card = achado.card;
    {
      if (linhas.length < 3) {
        st.innerHTML = `<div class="aviso ruim">Não achei texto neste arquivo. Se for um PDF escaneado
          (uma foto da fatura), ele não tem texto para ler — use o PDF que o banco gera, ou cole o texto.</div>`;
        return;
      }
      const forcado = /^\d{4}-\d{2}$/.test(mesEscolhido) ? mesEscolhido : null;
      const res = FC.Fatura.analisar(linhas, ($("#fatMes") || {}).value || hoje().slice(0, 7), forcado);
      if (!res.itens.length) {
        st.innerHTML = `<div class="aviso ruim">Li o arquivo mas não reconheci nenhuma compra.
          Cada lançamento precisa começar com a data, como <b>09/08 POSTO SHELL 210,40</b>.</div>`;
        return;
      }
      // Mês não escrito na fatura não trava mais a importação: o app decide
      // pelo mês da compra mais recente, importa, e diz qual usou. O campo
      // fica à mostra para corrigir e mandar de novo, se for o caso.
      const campoMes = $("#fatMesCx");
      if (campoMes) campoMes.classList.remove("hidden");
      const campoMesInput = $("#fatMes");
      if (campoMesInput && !mesEscolhido) campoMesInput.value = res.competencia;
      const comp = res.competencia;
      // O dia digitado na folha manda e fica guardado no cartão: quando o
      // arquivo não traz o vencimento, é ele que põe as parcelas no dia certo.
      const diaDigitado = parseInt(($("#fatDia") || {}).value, 10);
      if (diaDigitado >= 1 && diaDigitado <= 31 && diaDigitado !== card.dia_vencimento) {
        await Store.update("cards", card.id, { dia_vencimento: diaDigitado });
        card = { ...card, dia_vencimento: diaDigitado };
      }
      const diaVenc = FC.Fatura.diaVencimento(card, res.vencimento);
      const lancs = FC.Fatura.expandir(res.itens, {
        competencia: comp, card_id: card.id, dia_venc: diaVenc,
        categoriaDe: () => null,
        conhecidas: FC.Fatura.recorrentesConhecidas(Store.allSync("transactions"))
      });
      const soma = lancs.filter((l) => !l.projecao).reduce((s, l) => s + l.valor, 0);
      const bate = res.totalDeclarado != null && Math.abs(res.totalDeclarado - soma) < 0.05;

      // A mesma fatura importada antes no mês errado: mesmo cartão, mesma
      // soma, mesma quantidade, outra competência. Corrigir o mês tem que
      // MOVER a fatura, senão ela apareceria duas vezes, em dois meses.
      const doMes = lancs.filter((l) => !l.projecao);
      const somaNova = +doMes.reduce((x, l) => x + l.valor, 0).toFixed(2);
      const gemeas = faturas().filter((f) => f.card_id === card.id && f.ym !== comp
        && f.qtd === doMes.length && Math.abs(f.total - somaNova) < 0.05);
      for (const g of gemeas) await apagarFatura(g.id, true);

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
      await Store.flush();

      const fut = lancs.filter((l) => l.projecao).length;
      const rec = lancs.filter((l) => l.recorrente).length;
      const semData = res.competenciaOrigem !== "fatura";
      const deQuem = `<br>Cartão: <b>${esc(card.nome)}</b>${card.final ? " (final " + card.final + ")" : ""}${
        achado.novo ? " — cadastrado agora, a partir do próprio arquivo." : ""}${
        gemeas.length ? `<br>Movi esta mesma fatura de ${gemeas.map((g) => mesLabel(g.ym)).join(", ")} para ${mesLabel(comp)}.` : ""}`;
      st.innerHTML = `<div class="aviso ${semData ? "atencao" : "bom"}">${semData ? "⚠️" : "✅"}
        <b>${mesLabel(comp)}</b> lançada — ${lancs.length - fut} do mês${
        fut ? `, ${fut} parcelas nos meses seguintes` : ""}${rec ? `, ${rec} recorrentes` : ""}.
        ${bate ? `<br>Confere com o total impresso: <b>${money(res.totalDeclarado)}</b>.`
               : res.totalDeclarado
                 ? `<br>⚠️ Somei ${money(soma)}, a fatura diz ${money(res.totalDeclarado)}. Confira os lançamentos.`
                 : ""}
        ${deQuem}
        ${semData ? `<br>A fatura não diz o vencimento, então usei <b>${mesLabel(comp)}</b>, ${
          res.competenciaOrigem === "emissao" ? "o mês em que o extrato foi tirado"
          : res.competenciaOrigem === "compras" ? "o mês da compra mais recente"
          : "o mês do campo acima"}.
          Se não for esse, corrija a competência acima e mande o arquivo de novo.` : ""}</div>`;
      const caixa = $("#fatTexto");
      if (caixa) caixa.value = "";
      mesSel = comp;
      render();
      pintarFolhaImportar();
    }
  }

  // Sem cartão cadastrado não dá para lançar no cartão. Em vez de exigir um
  // cadastro antes de qualquer coisa, o app cria um e segue. Sem dia de
  // vencimento de propósito: assim vale o dia impresso em cada fatura, que
  // é o certo, em vez de um número que ninguém escolheu.
  async function cartaoPadrao() {
    const cards = Store.allSync("cards");
    if (cards.length) return cards[0];
    return Store.add("cards", { nome: "Meu cartão", dia_fechamento: null, dia_vencimento: null });
  }

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
    pintarFolhaImportar();
  }

  // ---------- Folhas (modal) ----------
  let modalTipo = null;
  let modalCtx = null;
  // O campo de competência é preenchido pelo app quando ele adivinha o mês.
  // Só o que VOCÊ digita nele manda na importação seguinte, e é isto que
  // separa uma coisa da outra.
  let mesEscolhido = "";
  const CAMPOS = {
    gasto: [
      { n: "onde", l: "Onde passou", t: "seg",
        o: [{ v: "cartao", t: "<span>💳</span> Cartão" }, { v: "fora", t: "<span>💵</span> Despesa" }] },
      { n: "descricao", l: "O que foi", t: "text", req: true },
      { n: "valor", l: "Valor (R$)", t: "number", req: true },
      { n: "data", l: "Quando", t: "date", v: () => hoje() },
      { n: "situacao", l: "E esta despesa", t: "select", esconde: true,
        o: [{ v: "pagar", t: "Ainda vou pagar (vira conta a pagar)" },
            { v: "pago", t: "Já paguei, o dinheiro saiu" }] },
      { n: "repete", l: "E nos meses seguintes?", t: "select",
        o: [{ v: "nenhuma", t: "Não se repete, foi só desta vez" },
            { v: "mensal", t: "Volta todo mês, sem prazo" },
            { v: "parcelado", t: "É parcelado, tem fim" }] },
      { n: "vezes", l: "Em quantas vezes", t: "number", v: () => 12, esconde: true,
        dica: "O valor lá em cima é o de CADA parcela. As que faltam entram sozinhas nos meses seguintes e já contam na previsão." }
    ],
    receita: [
      { n: "descricao", l: "De onde veio", t: "text", req: true },
      { n: "valor", l: "Valor (R$)", t: "number", req: true },
      { n: "data", l: "Quando entrou", t: "date", v: () => hoje() },
      { n: "repete", l: "E nos meses seguintes?", t: "select",
        o: [{ v: "mensal", t: "Entra todo mês" }, { v: "nenhuma", t: "Só desta vez" }] }
    ],
    aplicacao: [
      { n: "nome", l: "Onde está guardado", t: "text", req: true },
      { n: "tipo", l: "Tipo", t: "select", o: [] },
      { n: "atual", l: "Quanto vale hoje (R$)", t: "number", req: true },
      { n: "aplicado", l: "Quanto você colocou (R$)", t: "number",
        dica: "Serve para o app calcular o rendimento. Se não souber, deixe igual ao valor de hoje." },
      { n: "aporte", l: "Aporte por mês (R$)", t: "number",
        dica: "Quanto você guarda ali todo mês. Usado para estimar em quanto tempo a reserva fecha." }
    ],
    aporte: [
      { n: "investimento", l: "Para onde vai", t: "select", o: [] },
      { n: "valor", l: "Valor do aporte (R$)", t: "number", req: true },
      { n: "data", l: "Quando", t: "date", v: () => hoje() },
      { n: "sai", l: "E no caixa do mês", t: "select",
        o: [{ v: "sim", t: "Lançar como saída (o dinheiro sai da conta)" },
            { v: "nao", t: "Não lançar, só somar no investimento" }] }
    ],
    despesa: [
      { n: "descricao", l: "O que é", t: "text", req: true },
      { n: "valor", l: "Valor (R$)", t: "number", req: true },
      { n: "data", l: "Quando", t: "date", v: () => hoje() },
      { n: "situacao", l: "E esta despesa", t: "select",
        o: [{ v: "pago", t: "Já paguei, o dinheiro saiu" },
            { v: "pagar", t: "Ainda vou pagar (vira conta a pagar)" }],
        dica: "Mudando para <b>ainda vou pagar</b>, ela vira conta a pagar e ganha a bolinha de marcar, igual às outras." },
      { n: "repete", l: "E nos meses seguintes?", t: "select",
        o: [{ v: "nenhuma", t: "Não se repete" }, { v: "mensal", t: "Volta todo mês" }] }
    ],
    conta: [
      { n: "descricao", l: "O que é", t: "text", req: true },
      { n: "valor", l: "Valor (R$)", t: "number", req: true },
      { n: "vencimento", l: "Vence em", t: "date", v: () => hoje() },
      { n: "recorrencia", l: "Repete todo mês?", t: "select",
        o: [{ v: "mensal", t: "Sim, todo mês" }, { v: "nenhuma", t: "Não, só neste mês" }] }
    ]
  };
  const TITULOS = { gasto: "Lançar gasto", receita: "Lançar receita",
    despesa: "Editar despesa", conta: "Nova conta a pagar", aplicacao: "Nova aplicação",
    aporte: "Registrar aporte", importar: "Importar" };

  function campoHtml(c) {
    const dica = c.dica ? `<p class="dica" data-de="${c.n}">${c.dica}</p>` : "";
    const oculto = c.esconde ? " hidden" : "";
    if (c.t === "seg") {
      // Dois grupos à mostra, em vez de um menu que esconde a segunda opção:
      // é a primeira decisão do lançamento e ela muda o resto da folha.
      return `<div class="seg" data-campo="${c.n}"${oculto}>${
        c.o.map((o, i) => `<button type="button" data-seg="${c.n}" data-valor="${o.v}"${
          i === 0 ? ' class="on"' : ""}>${o.t}</button>`).join("")}
        <input type="hidden" name="${c.n}" value="${c.o[0].v}"></div>${dica}`;
    }
    if (c.t === "select") {
      return `<div class="campo" data-campo="${c.n}"${oculto}><label>${c.l}</label><select name="${c.n}">${
        c.o.map((o) => `<option value="${o.v}">${o.t}</option>`).join("")}</select></div>${dica}`;
    }
    const val = c.v ? ` value="${c.v()}"` : "";
    return `<div class="campo" data-campo="${c.n}"${oculto}><label>${c.l}</label><input name="${c.n}" type="${c.t}"${val}${
      c.t === "number" ? ' inputmode="decimal" step="0.01"' : ""}></div>${dica}`;
  }

  // Clique num grupo: acende o botão, guarda o valor no campo escondido e
  // avisa quem depende dele (a ajuda do rodapé muda com o grupo).
  function ligaSegmentos() {
    $$('#modalForm [data-seg]').forEach((b) => {
      b.addEventListener("click", () => {
        const campo = b.closest(".seg");
        $$("button", campo).forEach((x) => x.classList.toggle("on", x === b));
        campo.querySelector("input").value = b.dataset.valor;
        pintaAjudaGasto();
      });
    });
  }

  // A mesma folha serve para os dois grupos, então o rodapé diz o que cada
  // um significa — senão "Fora do cartão" vira adivinhação.
  function pintaAjudaGasto() {
    const campo = $('#modalForm [name="onde"]');
    const ajuda = $("#ajudaGasto");
    if (!campo) return;
    const fora = campo.value === "fora";
    // "Ainda vou pagar" só faz sentido fora do cartão: o que passa no cartão
    // é cobrado na fatura, e quem paga a fatura é você, uma vez só.
    const cxSit = $('#modalForm [data-campo="situacao"]');
    if (cxSit) cxSit.hidden = !fora;
    if (!ajuda) return;
    const sit = $('#modalForm [name="situacao"]');
    ajuda.innerHTML = !fora
      ? "Compra que vai <b>cair na fatura</b> do cartão. Some ao gasto do mês do vencimento."
      : (sit && sit.value === "pago")
        ? "Dinheiro que <b>já saiu</b> por PIX, débito ou dinheiro. Entra no gasto do mês, sem virar conta a pagar."
        : "Vira uma <b>conta a pagar</b> na tela Mês, com a bolinha para marcar quando pagar.";
  }

  // "Em quantas vezes" só aparece quando a despesa é parcelada.
  function ligaRepete() {
    const sit = $('#modalForm [name="situacao"]');
    if (sit) sit.addEventListener("change", pintaAjudaGasto);
    const sel = $('#modalForm [name="repete"]');
    if (!sel) return;
    const mostra = () => {
      const parcelado = sel.value === "parcelado";
      const campo = $('#modalForm [data-campo="vezes"]');
      const dica = $('#modalForm [data-de="vezes"]');
      if (campo) campo.hidden = !parcelado;
      if (dica) dica.hidden = !parcelado;
    };
    sel.addEventListener("change", mostra);
    mostra();
  }

  function abrirModal(tipo, ctx) {
    modalTipo = tipo;
    modalCtx = ctx || null;
    $("#modalTit").textContent = (ctx && ctx.id
      ? (tipo === "aplicacao" ? "Editar aplicação"
        : tipo === "despesa" ? "Editar despesa" : "Editar conta")
      : TITULOS[tipo]) || "Novo";
    if (tipo === "gasto" && ctx && ctx.onde === "fora") $("#modalTit").textContent = "Lançar despesa";
    $("#modalBtns").classList.toggle("hidden", tipo === "importar");
    if (tipo === "importar") {
      mesEscolhido = "";
      $("#modalForm").innerHTML = folhaImportarHtml();
      pintarFolhaImportar();
    } else {
      let campos = CAMPOS[tipo];
      if (tipo === "aplicacao") {
        campos = campos.map((c) => c.n === "tipo"
          ? { ...c, o: TIPOS_INV.map((t2) => ({ v: t2, t: t2 })) } : c);
      }
      if (tipo === "aporte") {
        const invs = investimentos();
        campos = campos.map((c) => c.n === "investimento"
          ? { ...c, o: invs.map((i) => ({ v: i.id, t: i.nome })) } : c);
      }
      // Editando uma conta que se repete: o valor da luz muda todo mês, então
      // o app pergunta se a mudança é só deste mês ou de todos.
      if (tipo === "conta" && ctx && ctx.id && ctx.recorrencia === "mensal") {
        campos = campos.concat([{ n: "escopo", l: "Este valor vale para", t: "select",
          o: [{ v: "mes", t: "Só " + mesLabel(ctx.ym) }, { v: "todos", t: "Todos os meses" }] }]);
      }
      $("#modalForm").innerHTML = campos.map(campoHtml).join("")
        + (tipo === "gasto" ? `<p class="dica" id="ajudaGasto"></p>` : "");
      if (ctx && ctx.onde) {
        const onde = $('#modalForm [name="onde"]');
        if (onde) onde.value = ctx.onde;
        $$('#modalForm [data-seg]').forEach((b) =>
          b.classList.toggle("on", b.dataset.valor === ctx.onde));
      }
      ligaSegmentos();
      pintaAjudaGasto();
      ligaRepete();
      if (ctx && ctx.valores) {
        Object.keys(ctx.valores).forEach((k) => {
          const el = $(`#modalForm [name="${k}"]`);
          if (el) el.value = ctx.valores[k];
        });
      }
    }
    $("#modal").classList.add("on");
    const p = $("#modalForm input");
    if (p && tipo !== "importar") setTimeout(() => p.focus(), 60);
  }
  function fecharModal() { $("#modal").classList.remove("on"); modalTipo = null; modalCtx = null; }

  function folhaImportarHtml() {
    return `
      <p class="dica" style="margin:0 0 12px">Mande a fatura em PDF ou em texto: as compras entram no mês do
        vencimento e as parcelas que faltam se espalham sozinhas pelos meses seguintes.</p>
      <div class="campo"><label>Cartão</label><select id="fatCard"></select></div>
      <p class="dica" style="margin-top:0">O app reconhece o cartão pelo número que vem escrito na fatura e
        cadastra sozinho quando é um novo. Escolha um acima só para forçar.</p>
      <div class="campo"><label>Dia do vencimento da fatura</label>
        <input type="number" id="fatDia" min="1" max="31" inputmode="numeric" placeholder="ex.: 21"></div>
      <div class="campo hidden" id="fatMesCx"><label>Competência (não achei na fatura)</label>
        <input type="month" id="fatMes"></div>
      <input type="file" id="fatFile" accept=".pdf,.txt,.csv,text/plain,text/csv,application/pdf" class="arquivo">
      <div style="margin-top:12px"><label class="btn" for="fatFile">Escolher arquivo (PDF ou TXT)</label></div>

      <div class="campo" style="margin-top:14px">
        <label>Ou cole aqui o texto da fatura</label>
        <textarea id="fatTexto" rows="5" placeholder="21/07 POSTO SHELL 210,40&#10;22/07 IFOOD 54,90&#10;23/07 SEPHORA PARC 08/10 69,20"></textarea>
      </div>
      <div style="margin-top:10px"><button type="button" class="btn sec" id="btnTexto">Ler o texto colado</button></div>
      <p class="dica">Uma linha por lançamento, começando pela data. Serve o que você copia do aplicativo
        do banco ou do extrato em .txt.</p>
      <div id="fatStatus" style="margin-top:10px"></div>

      <p class="grupo-tit" style="margin-top:22px">Faturas já importadas</p>
      <div class="card"><div id="listaFaturas"></div></div>

      <p class="grupo-tit" style="margin-top:22px">Cartões</p>
      <div class="card"><div id="listaCartoes"></div></div>

      <p class="grupo-tit" style="margin-top:22px">Trazer de fora</p>
      <div class="card pad">
        <p class="dica" style="margin:0 0 12px">O arquivo <b>painel-fatura-*.html</b>, o .json exportado dele
          ou uma cópia deste app. Nada é apagado: o que já está aqui é pulado.</p>
        <input type="file" id="migFile" accept=".html,.htm,.json" class="arquivo">
        <div class="btn-linha" style="margin:0">
          <label class="btn sec" for="migFile">Escolher arquivo</label>
          <button type="button" class="btn sec" id="btnMigNav">Procurar no navegador</button>
        </div>
        <div id="migStatus" style="margin-top:10px"></div>
      </div>

      <p class="grupo-tit" style="margin-top:22px">Cópia de segurança</p>
      <div class="card pad">
        <p class="dica" style="margin:0 0 12px">Guarda tudo num arquivo .json. Vale fazer de vez em quando:
          limpar os dados do navegador apaga o que está aqui.</p>
        <button type="button" class="btn sec" id="btnBackup">Baixar meus dados</button>
      </div>`;
  }

  function pintarFolhaImportar() {
    if (modalTipo !== "importar") return;
    const cards = Store.allSync("cards");
    const sel = $("#fatCard");
    if (sel) {
      const atual = sel.value;
      sel.innerHTML = `<option value="">Detectar pelo arquivo</option>`
        + cards.map((c) => `<option value="${c.id}">${esc(c.nome)}${
          c.final ? " (final " + c.final + ")" : ""}</option>`).join("");
      if (atual && cards.some((c) => c.id === atual)) sel.value = atual;
    }
    const dia = $("#fatDia");
    if (dia && !dia.value) {
      const c = cards.find((x) => x.id === (sel ? sel.value : "")) || cards[0];
      if (c && c.dia_vencimento) dia.value = c.dia_vencimento;
    }
    const lc = $("#listaCartoes");
    if (lc) {
      lc.innerHTML = cards.length ? cards.map((c) => {
        const qtd = Store.allSync("transactions").filter((t) => t.card_id === c.id).length;
        return `<div class="linha">
          <span class="esq"><span class="ico">💳</span>
            <span><span class="nome">${esc(c.nome)}</span>
            <div class="desc">${c.final ? "final " + c.final + " · " : ""}${qtd} lançamentos${
              c.dia_vencimento ? " · vence dia " + c.dia_vencimento : ""}</div></span></span>
          <button type="button" class="btn perigo mini" data-del-cartao="${c.id}">✕</button>
        </div>`;
      }).join("") : `<div class="vazio" style="padding:20px">Nenhum cartão ainda. O primeiro nasce da primeira fatura.</div>`;
    }
    const fs = faturas();
    const lf = $("#listaFaturas");
    if (lf) {
      lf.innerHTML = fs.length ? fs.map((f) => {
        const c = cards.find((x) => x.id === f.card_id);
        return `<div class="linha">
          <span class="esq"><span class="ico">📄</span>
            <span><span class="nome">${mesLabel(f.ym)}</span>
            <div class="desc">${esc(c ? c.nome : "cartão removido")} · ${f.qtd} lançamentos</div></span></span>
          <span style="display:flex;align-items:center;gap:8px"><b>${money(f.total)}</b>
            <button type="button" class="btn perigo mini" data-del-fatura="${f.id}">✕</button></span>
        </div>`;
      }).join("") : `<div class="vazio" style="padding:20px">Nenhuma fatura importada ainda.</div>`;
    }
  }

  // Trava contra gravação em dobro: no celular o toque duplo acontece, e sem
  // isto a mesma despesa entrava duas vezes.
  let salvando = false;

  async function salvarModal() {
    if (salvando || !modalTipo) return;
    salvando = true;
    const botao = $('.modal [data-acao="salvar"]');
    if (botao) { botao.disabled = true; botao.textContent = "Salvando…"; }
    try { await gravarModal(); }
    finally {
      salvando = false;
      if (botao) { botao.disabled = false; botao.textContent = "Salvar"; }
    }
  }

  async function gravarModal() {
    let aviso = "";
    const d = {};
    $$("#modalForm input,#modalForm select").forEach((i) => { if (i.name) d[i.name] = i.value; });

    if (modalTipo === "gasto") {
      if (!d.descricao || !d.valor) return alert("Preencha o que foi e o valor.");
      const rep = d.repete || "nenhuma";
      const data = d.data || hoje();
      const base = {
        descricao: d.descricao.trim(), valor: parseFloat(d.valor) || 0, tipo: "despesa",
        data, category_id: null, recorrencia: rep === "mensal" ? "mensal" : "nenhuma"
      };
      if (d.onde === "cartao") {
        const card = await cartaoPadrao();
        base.forma = "cartao";
        base.card_id = card.id;
      } else {
        base.forma = "manual";
      }

      aviso = `Lançado em <b>${mesLabel(String(data).slice(0, 7))}</b>: ${esc(base.descricao)}, `
        + `${money(base.valor)}, ${d.onde === "cartao" ? "no cartão" : "fora do cartão"}`
        + (rep === "mensal" ? ", todo mês" : "") + ".";
      // Fora do cartão e ainda não paga: isso é uma CONTA A PAGAR, com
      // vencimento e bolinha para marcar. Era o que faltava para telefone,
      // energia e internet aparecerem onde você procura por elas.
      if (d.onde !== "cartao" && (d.situacao || "pagar") === "pagar") {
        const n = rep === "parcelado" ? Math.max(2, Math.min(72, parseInt(d.vezes, 10) || 2)) : 1;
        const ym0 = data.slice(0, 7), dia = data.slice(8, 10);
        for (let k = 1; k <= n; k++) {
          const ym = Bl.ymAdd(ym0, k - 1);
          await Store.add("bills", {
            descricao: n > 1 ? `${base.descricao} (${k}/${n})` : base.descricao,
            valor: base.valor,
            vencimento: ym + "-" + String(Math.min(+dia, Bl.diasNoMes(ym))).padStart(2, "0"),
            recorrencia: rep === "mensal" ? "mensal" : "nenhuma",
            pagas: {}, valores: {}
          });
        }
        mesSel = ym0;
        aviso = n > 1
          ? `Lançadas <b>${n} contas a pagar</b> de ${money(base.valor)}: ${esc(base.descricao)}, a partir de ${mesLabel(ym0)}.`
          : `Conta a pagar em <b>${mesLabel(ym0)}</b>: ${esc(base.descricao)}, ${money(base.valor)}`
            + (rep === "mensal" ? ", todo mês" : "") + ".";
        await Store.flush();
        fecharModal();
        render();
        avisar(aviso);
        return;
      }

      if (rep === "parcelado") {
        // Parcelado vira uma despesa por mês, com fim marcado. As dos meses
        // à frente entram como projeção: contam na previsão e somem se a
        // fatura daquele mês chegar com o valor real.
        const n = Math.max(2, Math.min(72, parseInt(d.vezes, 10) || 2));
        const ym0 = data.slice(0, 7);
        const dia = +data.slice(8, 10);
        aviso = `Lançadas <b>${n} parcelas</b> de ${money(base.valor)}: ${esc(base.descricao)}, `
          + `a partir de ${mesLabel(String(data).slice(0, 7))}.`;
        for (let k = 1; k <= n; k++) {
          const ym = Bl.ymAdd(ym0, k - 1);
          await Store.add("transactions", {
            ...base,
            descricao: `${base.descricao} (${k}/${n})`,
            data: ym + "-" + String(Math.min(dia, Bl.diasNoMes(ym))).padStart(2, "0"),
            parcela: `${k}/${n}`,
            projecao: k > 1
          });
        }
      } else {
        await Store.add("transactions", base);
      }
      mesSel = String(data).slice(0, 7);
    } else if (modalTipo === "receita") {
      if (!d.descricao || !d.valor) return alert("Preencha de onde veio e o valor.");
      const data = d.data || hoje();
      await Store.add("transactions", {
        descricao: d.descricao.trim(), valor: parseFloat(d.valor) || 0, tipo: "receita",
        forma: "manual", data, category_id: null,
        recorrencia: d.repete === "mensal" ? "mensal" : "nenhuma"
      });
      mesSel = String(data).slice(0, 7);
      aviso = `Receita lançada em <b>${mesLabel(mesSel)}</b>: ${esc(d.descricao.trim())}, `
        + `${money(parseFloat(d.valor) || 0)}${d.repete === "mensal" ? ", todo mês" : ""}.`;
    } else if (modalTipo === "aplicacao") {
      if (!d.nome || !d.atual) return alert("Preencha o nome e quanto vale hoje.");
      const dados = {
        nome: d.nome.trim(), tipo: d.tipo || "Outro",
        atual: parseFloat(d.atual) || 0,
        aplicado: parseFloat(d.aplicado) || parseFloat(d.atual) || 0,
        aporte: parseFloat(d.aporte) || 0
      };
      if (modalCtx && modalCtx.id) {
        await Store.update("investments", modalCtx.id, dados);
        aviso = `Atualizado: ${esc(dados.nome)}, agora vale ${money(dados.atual)}.`;
      } else {
        await Store.add("investments", dados);
        aviso = `Aplicação cadastrada: ${esc(dados.nome)}, ${money(dados.atual)}.`;
      }
    } else if (modalTipo === "aporte") {
      const inv = Store.allSync("investments").find((x) => x.id === d.investimento);
      const valor = parseFloat(d.valor) || 0;
      if (!inv) return alert("Cadastre uma aplicação antes de registrar o aporte.");
      if (!valor) return alert("Informe o valor do aporte.");
      const data = d.data || hoje();
      await Store.update("investments", inv.id, {
        atual: (+inv.atual || 0) + valor,
        aplicado: (+inv.aplicado || 0) + valor
      });
      // Aporte é dinheiro que sai do mês para virar patrimônio. Lançar a
      // saída é o que mantém a sobra do mês honesta.
      if ((d.sai || "sim") === "sim") {
        await Store.add("transactions", {
          descricao: "Aporte em " + inv.nome, valor, tipo: "despesa", forma: "manual",
          data, category_id: null, recorrencia: "nenhuma", aporte: true
        });
      }
      mesSel = String(data).slice(0, 7);
      aviso = `Aporte de ${money(valor)} em ${esc(inv.nome)}`
        + ((d.sai || "sim") === "sim" ? `, lançado como saída de ${mesLabel(mesSel)}.` : ", sem mexer no caixa.");
    } else if (modalTipo === "despesa") {
      if (!modalCtx || !modalCtx.id) return;
      if (!d.descricao || !d.valor) return alert("Preencha o que é e o valor.");
      const valor = parseFloat(d.valor) || 0;
      const data = d.data || hoje();
      const rec = d.repete === "mensal" ? "mensal" : "nenhuma";
      if ((d.situacao || "pago") === "pagar") {
        // Vira conta a pagar: o mesmo dinheiro, agora com vencimento e a
        // bolinha de marcar. Poupa apagar e digitar tudo de novo.
        await Store.remove("transactions", modalCtx.id);
        await Store.add("bills", {
          descricao: d.descricao.trim(), valor, vencimento: data,
          recorrencia: rec, pagas: {}, valores: {}
        });
        aviso = `${esc(d.descricao.trim())} virou <b>conta a pagar</b>, vencendo ${diaCurto(data)}.`;
      } else {
        await Store.update("transactions", modalCtx.id, {
          descricao: d.descricao.trim(), valor, data, recorrencia: rec
        });
        aviso = `Atualizado: ${esc(d.descricao.trim())}, ${money(valor)}.`;
      }
      mesSel = String(data).slice(0, 7);
    } else if (modalTipo === "conta") {
      if (!d.descricao || !d.valor) return alert("Preencha o que é e o valor.");
      const valor = parseFloat(d.valor) || 0;
      const rec = d.recorrencia || "mensal";
      if (modalCtx && modalCtx.id) {
        const b = Store.allSync("bills").find((x) => x.id === modalCtx.id);
        if (b) {
          const patch = { descricao: d.descricao.trim(), recorrencia: rec };
          // Numa conta mensal, o vencimento guarda o PRIMEIRO mês. Mudar o dia
          // não pode empurrar a conta para outro mês e sumir com o passado.
          if (rec === "mensal") {
            patch.vencimento = String(b.vencimento || hoje()).slice(0, 8) + String(d.vencimento || b.vencimento).slice(8, 10);
          } else {
            patch.vencimento = d.vencimento || b.vencimento;
          }
          const valores = { ...(b.valores || {}) };
          if (rec === "mensal" && d.escopo !== "todos") {
            valores[modalCtx.ym] = valor;          // só o mês da tela
          } else {
            patch.valor = valor;
            delete valores[modalCtx.ym];           // o mês volta a seguir o padrão
          }
          patch.valores = valores;
          await Store.update("bills", b.id, patch);
        }
      } else {
        await Store.add("bills", {
          descricao: d.descricao.trim(), valor,
          vencimento: d.vencimento || hoje(), recorrencia: rec,
          pagas: {}, valores: {}
        });
        mesSel = String(d.vencimento || hoje()).slice(0, 7);
        aviso = `Conta lançada em <b>${mesLabel(mesSel)}</b>: ${esc(d.descricao.trim())}, `
          + `${money(valor)}${rec === "mensal" ? ", todo mês" : ""}.`;
      }
    }
    // Grava agora, sem esperar a folga de meio segundo: fechar o app ou
    // perder o sinal nesse intervalo apagaria o que você acabou de lançar.
    await Store.flush();
    fecharModal();
    render();
    if (aviso) avisar(aviso);
  }

  function baixarCopia() {
    const nome = "fincontrol-" + hoje() + ".json";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(FC.Migrar.copia())],
      { type: "application/json" }));
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // Confirmação curta do que acabou de ser lançado. Sem ela, uma despesa com
  // data de outro mês some da tela e parece que não foi gravada.
  function avisar(texto) {
    let el = document.getElementById("aviso-flutuante");
    if (!el) {
      el = document.createElement("div");
      el.id = "aviso-flutuante";
      document.body.appendChild(el);
    }
    el.innerHTML = texto;
    el.classList.add("on");
    clearTimeout(avisar._t);
    avisar._t = setTimeout(() => el.classList.remove("on"), 4200);
  }

  // ---------- Migração do painel antigo ----------
  async function migrar(pacote, origem) {
    const st = $("#migStatus");
    if (!pacote) {
      if (st) st.innerHTML = `<div class="aviso atencao">Não achei dados do painel ${origem === "nav" ? "neste navegador" : "nesse arquivo"}.</div>`;
      return;
    }
    if (st) st.innerHTML = `<div class="aviso">⏳ Trazendo…</div>`;
    try {
      const c = await FC.Migrar.aplicar(pacote, {});
      const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
      const partes = [];
      if (c.cartao) partes.push(`${plural(c.cartao, "lançamento", "lançamentos")} do cartão `
        + `(${plural(c.faturas, "fatura", "faturas")})`);
      if (c.gastos) partes.push(`${plural(c.gastos, "gasto", "gastos")} fora do cartão`);
      if (c.contas) partes.push(plural(c.contas, "conta", "contas"));
      if (c.fixos) partes.push(plural(c.fixos, "conta mensal", "contas mensais"));
      if (c.renda) partes.push("a receita mensal");
      if (st) {
        st.innerHTML = partes.length
          ? `<div class="aviso bom">✅ Trouxe ${partes.join(", ")}.${c.pulados
            ? `<br>${c.pulados === 1 ? "1 já existia aqui e foi pulado" : c.pulados + " já existiam aqui e foram pulados"}.` : ""}</div>`
          : `<div class="aviso">Tudo o que estava lá já está aqui — ${c.pulados} ${c.pulados === 1 ? "item pulado" : "itens pulados"}.</div>`;
      }
      render();
      pintarFolhaImportar();
    } catch (e) {
      if (st) st.innerHTML = `<div class="aviso ruim">Não consegui ler: ${esc(e.message)}</div>`;
    }
  }

  // ---------- Eventos ----------
  function ligar() {
    $("#abas").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tela]");
      if (b) { tela = b.dataset.tela; verTudo = false; window.scrollTo(0, 0); render(); }
    });

    document.body.addEventListener("click", async (e) => {
      const ir = e.target.closest("[data-ir]");
      if (ir) { tela = ir.dataset.ir; window.scrollTo(0, 0); render(); return; }

      const acao = e.target.closest("[data-acao]");
      if (acao) {
        const a = acao.dataset.acao;
        if (a === "novo-gasto") abrirModal("gasto");
        if (a === "nova-receita") abrirModal("receita");
        if (a === "nova-despesa-fora") abrirModal("gasto", { onde: "fora" });
        if (a === "nova-conta") abrirModal("conta");
        if (a === "nova-aplicacao") abrirModal("aplicacao");
        if (a === "novo-aporte") abrirModal("aporte");
        if (a === "importar") abrirModal("importar");
        if (a === "ver-tudo") { verTudo = true; render(); }
        if (a === "fechar") fecharModal();
        if (a === "salvar") salvarModal();
        return;
      }

      const gp = e.target.closest("[data-grupo]");
      if (gp) {
        const k = gp.dataset.grupo;
        if (abertos.has(k)) abertos.delete(k); else abertos.add(k);
        renderMes();
        return;
      }

      const mb = e.target.closest("[data-mes]");
      if (mb) { mesSel = mb.dataset.mes; verTudo = false; render(); return; }

      const cen = e.target.closest("[data-cenario]");
      if (cen) { cenario = cen.dataset.cenario; render(); return; }

      // Marcar conta como paga (ou desmarcar).
      const pg = e.target.closest("[data-pagar]");
      if (pg) {
        const [id, ym] = pg.dataset.pagar.split(":");
        const b = Store.allSync("bills").find((x) => x.id === id);
        if (!b) return;
        const pagas = { ...(b.pagas || {}) };
        if (pagas[ym]) delete pagas[ym]; else pagas[ym] = hoje();
        await Store.update("bills", id, { pagas });
        await Store.flush();
        render();
        return;
      }

      const ec = e.target.closest("[data-edit-conta]");
      if (ec) {
        const [id, ym] = ec.dataset.editConta.split(":");
        const b = Store.allSync("bills").find((x) => x.id === id);
        if (!b) return;
        const o = Bl.ocorrencia(b, ym);
        abrirModal("conta", { id, ym, recorrencia: b.recorrencia, valores: {
          descricao: b.descricao, valor: o.valor, vencimento: o.venc, recorrencia: b.recorrencia
        } });
        return;
      }

      const ed = e.target.closest("[data-edit-desp]");
      if (ed) {
        const t = Store.allSync("transactions").find((x) => x.id === ed.dataset.editDesp);
        if (!t) return;
        abrirModal("despesa", { id: t.id, valores: {
          descricao: t.descricao, valor: t.valor, data: t.data,
          situacao: "pago", repete: t.recorrencia === "mensal" ? "mensal" : "nenhuma"
        } });
        return;
      }

      const dc = e.target.closest("[data-del-conta]");
      if (dc) {
        if (!confirm("Apagar esta conta? Some de todos os meses.")) return;
        await Store.remove("bills", dc.dataset.delConta);
        render();
        return;
      }

      const dl = e.target.closest("[data-del-lanc]");
      if (dl) {
        const [col, id] = dl.dataset.delLanc.split(":");
        if (!confirm("Apagar este lançamento?")) return;
        await Store.remove(col, id);
        await Store.flush();
        render();
        return;
      }

      const ei = e.target.closest("[data-edit-inv]");
      if (ei) {
        const inv = Store.allSync("investments").find((x) => x.id === ei.dataset.editInv);
        if (inv) abrirModal("aplicacao", { id: inv.id, valores: {
          nome: inv.nome, tipo: inv.tipo, atual: inv.atual, aplicado: inv.aplicado, aporte: inv.aporte
        } });
        return;
      }

      const di = e.target.closest("[data-del-inv]");
      if (di) {
        if (!confirm("Apagar esta aplicação? Os aportes já lançados no mês ficam.")) return;
        await Store.remove("investments", di.dataset.delInv);
        await Store.flush();
        render();
        return;
      }

      const dc2 = e.target.closest("[data-del-cartao]");
      if (dc2) {
        const id = dc2.dataset.delCartao;
        const alvo = Store.allSync("transactions").filter((t) => t.card_id === id);
        if (!confirm(`Apagar este cartão e os ${alvo.length} lançamentos dele?`)) return;
        for (const t of alvo) await Store.remove("transactions", t.id);
        await Store.remove("cards", id);
        render();
        pintarFolhaImportar();
        return;
      }

      const df = e.target.closest("[data-del-fatura]");
      if (df) { await apagarFatura(df.dataset.delFatura); return; }

      if (e.target.id === "btnBackup") baixarCopia();
      if (e.target.id === "btnMigArquivo") $("#migFile").click();   // reserva
      // Os dois seletores de arquivo são <label for>, que abre a janela
      // sozinho: input escondido com display:none nem sempre aceita o clique
      // programado no celular, e era assim que o arquivo deixava de subir.
      if (e.target.id === "btnTexto") await importarTexto();
      if (e.target.id === "btnMigArquivo") $("#migFile").click();
      if (e.target.id === "btnMigNav") await migrar(FC.Migrar.doNavegador(), "nav");
      if (e.target.id === "btnRenda") {
        const v = parseFloat($("#inRenda").value) || 0;
        const p = Store.allSync("prefs")[0];
        if (p) await Store.update("prefs", p.id, { renda: v });
        else await Store.add("prefs", { renda: v });
        render();
      }
    });

    document.body.addEventListener("change", async (e) => {
      if (e.target.id === "fatMes") { mesEscolhido = e.target.value || ""; return; }
      if (e.target.id === "fatFile" && e.target.files[0]) { importar(e.target.files[0]); return; }
      if (e.target.id === "migFile" && e.target.files[0]) {
        const texto = await e.target.files[0].text();
        e.target.value = "";
        let pacote = null;
        try { pacote = FC.Migrar.lerTexto(texto); } catch (err) { pacote = null; }
        const vazio = !pacote || (!pacote.copia && !pacote.lanc.length && !pacote.contas.length
          && !pacote.fx.length && !pacote.faturas.length && !pacote.renda);
        await migrar(vazio ? null : pacote, "arquivo");
        return;
      }
      // Interruptor de recorrente: vale para todos os lançamentos da série.
      const sw = e.target.closest("[data-rec]");
      if (sw) {
        const chave = sw.dataset.rec;
        const valor = sw.checked ? "mensal" : "nenhuma";
        const alvo = Store.allSync("transactions").filter((t) =>
          ehCartao(t) && !t.parcela && !t.projecao && chaveTxt(t.descricao) === chave);
        for (const t of alvo) await Store.update("transactions", t.id, { recorrencia: valor });
        render();
      }
    });

    document.body.addEventListener("keydown", (e) => {
      const gp = e.target.closest && e.target.closest("[data-grupo]");
      if (gp && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); gp.click(); }
    });

    document.body.addEventListener("input", (e) => {
      if (e.target.id === "busca") {
        busca = e.target.value;
        verTudo = false;
        renderLancamentos();
      }
    });

    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });
  }

  // Atalhos do ícone do app: segurar o ícone na tela de início abre direto
  // em "Lançar gasto" ou na previsão.
  function abrirAtalho() {
    const alvo = (location.hash || "").replace("#", "");
    if (!alvo) return;
    history.replaceState(null, "", location.pathname + location.search);
    if (alvo === "lancar") { abrirModal("gasto"); return; }
    if (alvo === "receita") { tela = "conta"; render(); abrirModal("receita"); return; }
    if (["futuro", "lancamentos", "conta", "investir", "economia", "mes"].indexOf(alvo) >= 0) {
      tela = alvo;
      render();
    }
  }

  // ---------- Olho: mostrar ou esconder os valores ----------
  function pintaOlho() {
    const b = $("#btnOlho");
    if (!b) return;
    b.setAttribute("aria-pressed", ocultar ? "true" : "false");
    b.setAttribute("aria-label", ocultar ? "Mostrar valores" : "Ocultar valores");
    b.title = b.getAttribute("aria-label");
    b.classList.toggle("fechado", ocultar);
    // O campo da receita guarda o número mesmo escondido: vira campo de
    // senha em vez de perder o valor.
    const r = $("#inRenda");
    if (r) r.type = ocultar ? "password" : "number";
  }

  function ligarOlho() {
    const b = $("#btnOlho");
    if (!b) return;
    b.addEventListener("click", () => {
      ocultar = !ocultar;
      try { localStorage.setItem("fc_ocultar", ocultar ? "1" : "0"); } catch (e) {}
      render();
      pintaOlho();
    });
    pintaOlho();
  }

  // ---------- Versão publicada x versão aberta ----------
  // App instalado abre pelo service worker, que pode entregar a versão
  // guardada de ontem. Dava para ficar dias vendo um número velho sem saber.
  // Aqui o app pergunta ao servidor qual é a versão publicada e, sendo outra,
  // limpa o cache e recarrega uma vez só.
  async function conferirVersao() {
    if (!location.protocol.startsWith("http")) return;
    try {
      const html = await fetch("./index.html?ts=" + Date.now(), { cache: "no-store" }).then((r) => r.text());
      const m = html.match(/js\/ui\.js\?v=(\d+)/);
      if (!m) return;
      const publicada = "v" + m[1];
      if (publicada === APP_VERSION) return;
      // Trava contra laço: tenta uma vez por versão publicada.
      if (sessionStorage.getItem("fc_atualizando") === publicada) return;
      sessionStorage.setItem("fc_atualizando", publicada);
      avisar(`Atualizando para a <b>${publicada}</b>…`);
      if ("serviceWorker" in navigator) {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const ks = await caches.keys();
        await Promise.all(ks.map((k) => caches.delete(k)));
      }
      setTimeout(() => location.reload(), 600);
    } catch (e) {}
  }

  // ---------- Versão ----------
  function marcarVersao() {
    const p = $("#pillVer");
    if (!p) return;
    p.textContent = APP_VERSION;
    p.title = "Versão aberta. Toque para limpar o cache e buscar a mais nova.";
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
    ligarOlho();
    render();
    abrirAtalho();
    conferirVersao();
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
