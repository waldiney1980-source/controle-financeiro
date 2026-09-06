/* ===========================================================
 * migrar.js — traz para dentro do app os dados do painel antigo
 * (o arquivo único painel-fatura-*.html e o que ele guardava no
 * navegador).
 *
 * Regra número um: NADA é apagado. Tudo entra por cima do que já
 * existe, e o que já está lá é pulado. Rodar duas vezes o mesmo
 * arquivo não duplica nada.
 *
 * O que vem de lá, e no que vira aqui:
 *   renda    → prefs.renda (só se ainda não houver receita informada)
 *   fx       → conta a pagar MENSAL (aluguel, faculdade, combustível)
 *   contas   → conta a pagar do mês, com a marca de paga
 *   lanc     → despesa fora do cartão, já gasta
 *   faturas  → lançamentos do cartão + as parcelas dos meses à frente
 * =========================================================== */
window.FC = window.FC || {};

FC.Migrar = (function () {
  const MESL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const pad = (n) => String(n).padStart(2, "0");
  const dinheiro = (n) => +(+n || 0).toFixed(2);

  // "ago/26" → "2026-08"
  function ymDe(mes) {
    const [ab, yy] = String(mes || "").toLowerCase().split("/");
    const i = MESL.indexOf(ab);
    if (i < 0 || !yy) return null;
    return 2000 + Number(yy) + "-" + pad(i + 1);
  }

  // "09/07" dentro da fatura de "ago/26" → "2026-07-09". A compra pode ser
  // do mês anterior ao da fatura, e em janeiro pode ser até do ano anterior.
  function dataDe(mesRef, ddmm, diaPadrao) {
    const base = ymDe(mesRef);
    if (!base) return null;
    const [ay, am] = base.split("-").map(Number);
    const m = String(ddmm || "").match(/^(\d{1,2})[\/.-](\d{1,2})/);
    if (!m) return FC.Fatura.dataNoMes ? FC.Fatura.dataNoMes(base, diaPadrao || 1)
      : base + "-" + pad(Math.min(diaPadrao || 1, FC.Bills.diasNoMes(base)));
    const dia = Number(m[1]), mes = Number(m[2]);
    let ano = ay;
    if (mes - am > 6) ano--;
    else if (am - mes > 6) ano++;
    const alvo = ano + "-" + pad(mes);
    return alvo + "-" + pad(Math.min(dia, FC.Bills.diasNoMes(alvo)));
  }

  function diaDoMes(ym, dia) {
    return ym + "-" + pad(Math.min(dia, FC.Bills.diasNoMes(ym)));
  }

  // ---------- Leitura do arquivo do painel ----------
  // Aceita as duas formas: o .html baixado com "Baixar cópia com meus dados"
  // e o próprio painel original (que carrega a fatura de agosto embutida).
  function lerTexto(texto) {
    const t = String(texto || "").trim();
    const pacote = { renda: null, fx: [], contas: [], lanc: [], faturas: [], copia: null };

    if (t.startsWith("{")) {
      const j = JSON.parse(t);
      // Cópia de segurança do próprio app: outro formato, outro caminho.
      if (j && Array.isArray(j.transactions) && Array.isArray(j.bills)) {
        pacote.copia = j;
        return pacote;
      }
      juntar(pacote, j);
      return pacote;
    }

    const est = t.match(/window\.__ESTADO__\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|$)/m);
    if (est) {
      try { juntar(pacote, JSON.parse(est[1])); } catch (e) {}
    }

    // A fatura que vem escrita no próprio painel (agosto/2026).
    const dat = t.match(/const DATA\s*=\s*(\{.*\});\s*$/m);
    if (dat) {
      try {
        const D = JSON.parse(dat[1]);
        if (D.rows && D.parc) {
          pacote.faturas.push({
            mes: "ago/26", venc: "21/08/2026",
            rows: D.rows, parc: D.parc
          });
        }
        if (!pacote.fx.length && Array.isArray(D.fixosItens)) pacote.fx = D.fixosItens.slice();
      } catch (e) {}
    }
    return pacote;
  }

  function juntar(pacote, snap) {
    const s = (snap && snap.estado) || {};
    if (typeof s.renda === "number") pacote.renda = s.renda;
    if (Array.isArray(s.fx)) pacote.fx = pacote.fx.concat(s.fx);
    if (Array.isArray(s.contas)) pacote.contas = pacote.contas.concat(s.contas);
    if (Array.isArray(s.lanc)) pacote.lanc = pacote.lanc.concat(s.lanc);
    (snap.faturas || []).forEach((f) => pacote.faturas.push(f));
  }

  // O painel guardava tudo no navegador, nesta chave. Só funciona se o app
  // estiver aberto no MESMO endereço em que o painel foi usado.
  function doNavegador() {
    let cru = null;
    try { cru = localStorage.getItem("painel-fatura-v1"); } catch (e) { return null; }
    if (!cru) return null;
    const pacote = { renda: null, fx: [], contas: [], lanc: [], faturas: [] };
    juntar(pacote, JSON.parse(cru));
    return pacote;
  }

  // ---------- Gravação ----------
  const chaveTx = (t) => [String(t.data || "").slice(0, 10),
    String(t.descricao || "").toLowerCase().trim(), dinheiro(t.valor)].join("|");
  const chaveBill = (b) => [String(b.descricao || "").toLowerCase().trim(),
    b.recorrencia === "mensal" ? "mensal" : String(b.vencimento || "").slice(0, 7)].join("|");

  async function acharCartao(nome) {
    const cards = FC.Store.allSync("cards");
    const achado = cards.find((c) => (c.nome || "").toLowerCase() === nome.toLowerCase());
    if (achado) return achado;
    return FC.Store.add("cards", { nome, dia_fechamento: null, dia_vencimento: 21 });
  }

  // Uma fatura do painel vira: os lançamentos do mês + as parcelas que ainda
  // faltam, uma em cada mês seguinte — igual ao que a importação do PDF faz.
  function lancamentosDaFatura(f, card_id) {
    const ym = ymDe(f.mes);
    if (!ym) return [];
    const diaVenc = (f.venc || "").match(/^(\d{2})\//) ? Number(RegExp.$1) : 21;
    const faturaId = card_id + ":" + ym;
    const out = [];

    // Assinatura cobra uma vez por fatura. Se o mesmo estabelecimento aparece
    // duas vezes no mês, é consumo variável — marcar como mensal projetaria
    // o dobro para sempre.
    const vezes = {};
    (f.rows || []).forEach((r) => {
      if (r.tipo === "Parcela" || r.valor < 0) return;
      const k = FC.Fatura.chaveSerie(r.desc);
      if (k) vezes[k] = (vezes[k] || 0) + 1;
    });

    (f.rows || []).forEach((r) => {
      if (r.tipo === "Parcela") return;                 // parcela vem de f.parc
      const valor = dinheiro(r.valor);
      if (!valor) return;
      // O painel novo já marcava o que era recorrente; o antigo não marcava
      // nada, então o reconhecimento é feito aqui.
      const recorrente = r.rec !== undefined ? !!r.rec
        : valor > 0 && vezes[FC.Fatura.chaveSerie(r.desc)] === 1 && FC.Fatura.ehRecorrente(r.desc);
      // A fatura inteira pesa no mês em que ela VENCE, como na importação do
      // PDF. A data da compra fica guardada à parte: uma compra de 9 de
      // julho que caiu na fatura de agosto é gasto de agosto.
      out.push({
        descricao: r.desc, valor, tipo: "despesa", forma: "cartao", card_id,
        category_id: null, recorrencia: recorrente ? "mensal" : "nenhuma", conciliada: true,
        fatura_id: faturaId, data: diaDoMes(ym, diaVenc), projecao: false,
        data_compra: dataDe(f.mes, r.data, diaVenc),
        parcela: null, estorno: valor < 0, pessoa: r.cartao || ""
      });
    });

    (f.parc || []).forEach((p) => {
      const valor = dinheiro(p.valor);
      if (!valor) return;
      const base = {
        valor, tipo: "despesa", forma: "cartao", card_id, category_id: null,
        recorrencia: "nenhuma", conciliada: true, fatura_id: faturaId,
        estorno: false, pessoa: p.cartao || ""
      };
      out.push({ ...base, descricao: `${p.desc} (${p.at}/${p.tot})`,
        data: diaDoMes(ym, diaVenc), projecao: false, parcela: `${p.at}/${p.tot}` });
      for (let k = p.at + 1; k <= p.tot; k++) {
        const m = FC.Bills.ymAdd(ym, k - p.at);
        out.push({ ...base, descricao: `${p.desc} (${k}/${p.tot})`,
          data: diaDoMes(m, diaVenc), projecao: true, parcela: `${k}/${p.tot}` });
      }
    });
    return out.filter((l) => l.data);
  }

  async function aplicar(pacote, opcoes) {
    const opts = opcoes || {};
    const conta = { renda: 0, fixos: 0, contas: 0, gastos: 0, cartao: 0, faturas: 0, pulados: 0 };
    if (!pacote) return conta;
    if (pacote.copia) return restaurar(pacote.copia, conta);

    // Receita: só entra se ainda não houver uma informada, para não passar
    // por cima do que foi digitado aqui.
    if (pacote.renda > 0) {
      const p = FC.Store.allSync("prefs")[0];
      if (!p) { await FC.Store.add("prefs", { renda: pacote.renda }); conta.renda = 1; }
      else if (!(+p.renda > 0)) { await FC.Store.update("prefs", p.id, { renda: pacote.renda }); conta.renda = 1; }
    }

    const vistosBill = new Set(FC.Store.allSync("bills").map(chaveBill));
    const mesBase = (pacote.contas.find((c) => c.mes) || {}).mes
      || (pacote.faturas[0] || {}).mes || null;
    const ymFixos = ymDe(mesBase) || new Date().toISOString().slice(0, 7);

    // Fixos do painel → conta que se repete todo mês.
    for (const f of pacote.fx) {
      const desc = String(f.n || "").trim();
      const valor = dinheiro(f.v);
      if (!desc || valor <= 0) continue;
      const b = { descricao: desc, valor, vencimento: ymFixos + "-01",
        recorrencia: "mensal", pagas: {}, valores: {} };
      if (vistosBill.has(chaveBill(b))) { conta.pulados++; continue; }
      vistosBill.add(chaveBill(b));
      await FC.Store.add("bills", b);
      conta.fixos++;
    }

    // Contas do painel → conta daquele mês, com a marca de paga.
    for (const c of pacote.contas) {
      const desc = String(c.desc || "").trim();
      const valor = dinheiro(c.valor);
      if (!desc || valor <= 0) continue;
      const ym = ymDe(c.mes);
      if (!ym) continue;
      const venc = dataDe(c.mes, c.venc, 10);
      const b = { descricao: desc, valor, vencimento: venc || ym + "-10",
        recorrencia: "nenhuma", pagas: {}, valores: {} };
      if (c.pago) b.pagas[ym] = dataDe(c.mes, c.dataPago, 10) || venc || ym + "-10";
      if (vistosBill.has(chaveBill(b))) { conta.pulados++; continue; }
      vistosBill.add(chaveBill(b));
      await FC.Store.add("bills", b);
      conta.contas++;
    }

    // O que já estava aqui ANTES desta migração. A lista não cresce enquanto
    // gravo: uma fatura pode ter duas cobranças idênticas no mesmo dia (é
    // assim que se enxerga uma duplicidade do banco), e pular a segunda
    // esconderia justamente o que interessa ver.
    const vistosTx = new Set(FC.Store.allSync("transactions").map(chaveTx));

    // Lançamentos avulsos do painel → despesa fora do cartão, já gasta.
    for (const l of pacote.lanc) {
      const desc = String(l.desc || "").trim();
      const valor = dinheiro(l.valor);
      if (!desc || !valor) continue;
      const t = { descricao: desc, valor, tipo: "despesa", forma: "manual",
        category_id: null, recorrencia: "nenhuma",
        data: dataDe(l.mes, l.data, 15) };
      if (!t.data) continue;
      if (vistosTx.has(chaveTx(t))) { conta.pulados++; continue; }
      await FC.Store.add("transactions", t);
      conta.gastos++;
    }

    // Faturas do painel → lançamentos do cartão.
    if (pacote.faturas.length) {
      const card = await acharCartao(opts.cartao || "Ourocard ALTUS LIV VISA");
      const jaTem = new Set(FC.Store.allSync("transactions")
        .map((t) => t.fatura_id).filter(Boolean));
      for (const f of pacote.faturas) {
        const ym = ymDe(f.mes);
        if (!ym) continue;
        if (jaTem.has(card.id + ":" + ym)) { conta.pulados++; continue; }
        const lancs = lancamentosDaFatura(f, card.id);
        if (!lancs.length) continue;
        // A fatura inteira entra ou não entra (o teste é o fatura_id acima).
        // Aqui dentro nada é descartado: cobrança repetida é informação.
        for (const l of lancs) {
          await FC.Store.add("transactions", l);
          conta.cartao++;
        }
        conta.faturas++;
      }
    }
    return conta;
  }

  // ---------- Cópia de segurança do próprio app ----------
  // Devolve o que está guardado, num JSON só. É o que o botão "Baixar meus
  // dados" grava, e o que restaurar() sabe ler de volta.
  function copia() {
    const out = { app: "fincontrol", v: 1, quando: new Date().toISOString() };
    ["cards", "transactions", "bills", "prefs", "categories"].forEach((c) => {
      out[c] = FC.Store.allSync(c);
    });
    return out;
  }

  // Restaurar SOMA: o que já está aqui é pulado, nada é apagado. Serve tanto
  // para trazer de volta uma cópia quanto para juntar o aparelho de casa com
  // o do trabalho.
  async function restaurar(db, conta) {
    conta = conta || { renda: 0, fixos: 0, contas: 0, gastos: 0, cartao: 0, faturas: 0, pulados: 0 };

    // Cartão casa pelo nome: o id da cópia não vale aqui.
    const mapa = {};
    for (const c of db.cards || []) {
      const achado = FC.Store.allSync("cards")
        .find((x) => (x.nome || "").toLowerCase() === (c.nome || "").toLowerCase());
      const novo = achado || await FC.Store.add("cards", {
        nome: c.nome || "Meu cartão",
        dia_fechamento: c.dia_fechamento || null,
        dia_vencimento: c.dia_vencimento || null
      });
      mapa[c.id] = novo.id;
    }

    const vistosTx = new Set(FC.Store.allSync("transactions").map(chaveTx));
    for (const t of db.transactions || []) {
      const novo = { ...t };
      delete novo.id;
      if (novo.card_id && mapa[novo.card_id]) novo.card_id = mapa[novo.card_id];
      if (novo.fatura_id) {
        const [antigo, ym] = String(novo.fatura_id).split(":");
        novo.fatura_id = (mapa[antigo] || antigo) + ":" + ym;
      }
      if (vistosTx.has(chaveTx(novo))) { conta.pulados++; continue; }
      await FC.Store.add("transactions", novo);
      if (novo.card_id) conta.cartao++; else conta.gastos++;
    }

    const vistosBill = new Set(FC.Store.allSync("bills").map(chaveBill));
    for (const b of db.bills || []) {
      const novo = { ...b, pagas: b.pagas || {}, valores: b.valores || {} };
      delete novo.id;
      if (vistosBill.has(chaveBill(novo))) { conta.pulados++; continue; }
      vistosBill.add(chaveBill(novo));
      await FC.Store.add("bills", novo);
      if (novo.recorrencia === "mensal") conta.fixos++; else conta.contas++;
    }

    const rendaCopia = ((db.prefs || [])[0] || {}).renda;
    if (rendaCopia > 0) {
      const p = FC.Store.allSync("prefs")[0];
      if (!p) { await FC.Store.add("prefs", { renda: rendaCopia }); conta.renda = 1; }
      else if (!(+p.renda > 0)) { await FC.Store.update("prefs", p.id, { renda: rendaCopia }); conta.renda = 1; }
    }
    return conta;
  }

  return { lerTexto, doNavegador, aplicar, copia, restaurar, ymDe, dataDe };
})();
