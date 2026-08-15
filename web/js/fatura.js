/* ===========================================================
 * fatura.js — Leitura da fatura do cartão em PDF
 *
 * A fatura de agosto não é "o que comprei em agosto": é o que
 * VENCE em agosto. Por isso todo lançamento lido aqui recebe a
 * data do VENCIMENTO da fatura, e não a data da compra (que fica
 * guardada em `data_compra`, só para consulta). É assim que o
 * dinheiro sai da conta de verdade — e é assim que o fluxo de
 * caixa e a projeção ficam certos.
 *
 * Compra parcelada: a fatura mostra "3/10". As 7 parcelas que
 * faltam viram lançamentos FUTUROS (`projecao: true`), um por mês,
 * para aparecerem em "Comprometido futuro" na aba Cartões.
 *
 * Reimportar a MESMA fatura não soma de novo: todo lançamento
 * carrega `fatura_id` = "<cartão>:<competência>", e importar
 * substitui o conjunto inteiro daquela competência.
 * =========================================================== */
window.FC = window.FC || {};

FC.Fatura = (function () {
  const pad = (n) => String(n).padStart(2, "0");

  const MESES = {
    JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
    JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12
  };

  // Valor em reais: 1.234,56 · 45,90 · -12,00 · 12,00- (crédito com o sinal atrás)
  const RE_VALOR = /-?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*-?/g;

  // Linhas que existem na fatura mas NÃO são compra: cabeçalho, totais,
  // pagamento da fatura anterior, código de barras. Entram na lista de
  // ignoradas (o usuário vê o que foi descartado e por quê).
  const RE_IGNORAR = new RegExp([
    "^saldo", "^pagamento", "^pgto", "^total", "^subtotal", "^limite",
    "^valor a pagar", "^fatura anterior", "^linha digit", "^vencimento",
    "^encargos", "^juros", "^demonstrativo", "^resumo", "^lan[çc]amentos",
    "^data\\b", "^pontos", "^programa", "^cr[ée]dito rotativo", "^parcelamento da fatura"
  ].join("|"), "i");

  // ---------- Leitura do PDF ----------
  // Uma linha do PDF é um conjunto de pedaços na MESMA altura (y). O pdf.js
  // entrega texto solto com coordenadas, então agrupamos por y e ordenamos
  // por x para reconstruir a linha como ela aparece na tela.
  async function lerLinhas(file) {
    if (typeof pdfjsLib === "undefined")
      throw new Error("A biblioteca de PDF não carregou (precisa de internet na primeira vez).");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const linhas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const mapa = {};
      content.items.forEach((it) => {
        const y = Math.round(it.transform[5]);
        (mapa[y] = mapa[y] || []).push({ x: it.transform[4], s: it.str });
      });
      Object.keys(mapa).map(Number).sort((a, b) => b - a).forEach((y) => {
        const txt = mapa[y].sort((a, b) => a.x - b.x).map((o) => o.s)
          .join(" ").replace(/\s+/g, " ").trim();
        if (txt) linhas.push(txt);
      });
    }
    return linhas;
  }

  // ---------- Números ----------
  function valorBR(bruto) {
    const s = String(bruto || "");
    const negativo = /^\s*-/.test(s) || /-\s*$/.test(s);
    const limpo = s.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", ".");
    const v = Math.abs(parseFloat(limpo) || 0);
    return { valor: v, negativo };
  }

  // ---------- Cabeçalho da fatura ----------
  // O rótulo nem sempre fica colado na data. Na fatura do Banco do Brasil,
  // "Vencimento" é uma linha e a data está três linhas abaixo, sozinha —
  // por isso a busca olha as linhas seguintes, e não só a mesma linha.
  function acharVencimento(linhas) {
    const dataSolta = /(\d{2})\/(\d{2})\/(\d{4})/;
    for (let i = 0; i < linhas.length; i++) {
      if (!/vencimento/i.test(linhas[i])) continue;
      const naMesma = linhas[i].match(/vencimento[^\d]{0,20}(\d{2})\/(\d{2})\/(\d{2,4})/i);
      if (naMesma) return [naMesma[1], naMesma[2], naMesma[3]];
      for (let k = i + 1; k <= i + 4 && k < linhas.length; k++) {
        const m = linhas[k].match(dataSolta);
        if (m && linhas[k].replace(dataSolta, "").trim().length <= 3) return [m[1], m[2], m[3]];
      }
    }
    // Reserva: o fechamento diz a competência mesmo sem o vencimento.
    for (const l of linhas) {
      const m = l.match(/fatura fechada em\s*(\d{2})\/(\d{2})\/(\d{4})/i);
      if (m) return [m[1], m[2], m[3]];
    }
    return null;
  }

  function lerCabecalho(linhas) {
    const texto = linhas.join("\n");
    let vencimento = null, competencia = null, total = null;

    const v = acharVencimento(linhas);
    if (v) {
      const ano = v[2].length === 2 ? "20" + v[2] : v[2];
      vencimento = `${ano}-${v[1]}-${v[0]}`;
      competencia = `${ano}-${v[1]}`;
    }
    // "FATURA DE SETEMBRO/2026" ou "Fatura Setembro 2026"
    if (!competencia) {
      m = texto.match(/fatura\s+(?:de\s+)?([a-zç]{3,9})[\/\s]+(\d{4})/i);
      if (m) {
        const chave = m[1].slice(0, 3).toUpperCase().replace("Ç", "C");
        const mm = MESES[chave];
        if (mm) competencia = `${m[2]}-${pad(mm)}`;
      }
    }
    m = texto.match(/(?:total (?:da fatura|a pagar)|valor total(?: da fatura)?)[^\d-]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (m) total = valorBR(m[1]).valor;

    return { vencimento, competencia, total };
  }

  // ---------- Parcela ----------
  // "PARC 03/10", "3/10", "3 DE 10" — sempre no fim da descrição.
  function acharParcela(desc) {
    const tentativas = [
      /parc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|\s+de\s+)\s*(\d{1,2})/i,
      /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*$/,
      /\b(\d{1,2})\s+de\s+(\d{1,2})\s*$/i
    ];
    for (const re of tentativas) {
      const m = desc.match(re);
      if (!m) continue;
      const i = +m[1], n = +m[2];
      if (!n || n > 99 || i < 1 || i > n) continue;
      const limpa = desc.replace(m[0], "").replace(/\s+/g, " ").trim();
      return { i, n, limpa: limpa || desc };
    }
    return null;
  }

  // ---------- Uma linha vira (ou não) uma compra ----------
  function parseLinha(linha, competencia) {
    if (RE_IGNORAR.test(linha)) return { ignorada: true, motivo: "não é compra (cabeçalho, total ou pagamento)", linha };

    let dia, mes, ano = null, casado;
    let m = linha.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      dia = +m[1]; mes = +m[2];
      if (m[3]) ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      casado = m[0];
    } else {
      m = linha.match(/^(\d{1,2})\s+([A-Za-zç]{3})\b/);
      const chave = m ? m[2].toUpperCase().replace("Ç", "C") : null;
      if (!m || !MESES[chave]) return null;          // sem data no começo: não é lançamento
      dia = +m[1]; mes = MESES[chave]; casado = m[0];
    }
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;

    const resto = linha.slice(casado.length).trim();
    const valores = resto.match(RE_VALOR);
    if (!valores || !valores.length) return null;    // linha com data mas sem valor

    // Fatura em duas moedas (dólar e real) traz dois números: o de VERDADE,
    // o que vai ser cobrado, é o último — em reais.
    const bruto = valores[valores.length - 1];
    const { valor, negativo } = valorBR(bruto);
    if (!valor) return null;

    let desc = resto;
    valores.forEach((v) => { desc = desc.replace(v, " "); });
    // "R$ -300,00": o valor casa a partir do sinal e deixa o "R$" órfão na
    // descrição. Sobra de moeda e o nome do país no fim da linha não são
    // parte do nome do estabelecimento.
    desc = desc.replace(/R\$/g, " ").replace(/\s+/g, " ").trim() || "Compra";

    // Sem ano na linha: o ano vem da competência. Compra de dezembro que
    // aparece na fatura de janeiro é do ano anterior.
    if (!ano) {
      const [cy, cm] = competencia.split("-").map(Number);
      ano = mes > cm ? cy - 1 : cy;
    }

    const parcela = acharParcela(desc);
    return {
      data_compra: `${ano}-${pad(mes)}-${pad(dia)}`,
      descricao: parcela ? parcela.limpa : desc,
      valor,
      credito: negativo,
      parcelaAtual: parcela ? parcela.i : null,
      parcelaTotal: parcela ? parcela.n : null,
      linha
    };
  }

  // ---------- Seções da fatura ----------
  // A fatura já vem separada por ramo ("Restaurantes", "Saúde", "Transporte")
  // e por portador ("Waldiney F Santos (Cartão 7149)"). Isso é classificação
  // feita pelo próprio banco — melhor do que adivinhar pelo nome da loja.
  const SECOES = [
    "restaurantes", "supermercados", "alimentacao", "saude", "farmacias",
    "transporte", "combustivel", "servicos", "vestuario", "viagens",
    "lazer", "entretenimento", "educacao", "eletronicos", "casa", "beleza",
    "diversos", "outros", "pagamentos/creditos", "pagamentos", "creditos"
  ];
  const semAcento = (s) => String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  function ehSecao(linha) {
    const s = semAcento(linha);
    if (s.length > 24) return null;
    return SECOES.indexOf(s) >= 0 ? linha.trim() : null;
  }
  function ehPortador(linha) {
    const m = linha.match(/^(.{2,40}?)\s*\(cart[ãa]o\s*([\d*]{3,6})\)/i);
    return m ? { nome: m[1].trim(), cartao: m[2] } : null;
  }

  // ---------- Fatura inteira ----------
  function analisar(linhas, competenciaPadrao) {
    const cab = lerCabecalho(linhas);
    const competencia = cab.competencia || competenciaPadrao;
    const itens = [], ignoradas = [];
    let secao = "", portador = "";
    linhas.forEach((l) => {
      const s = ehSecao(l);
      if (s) { secao = s; return; }
      const p = ehPortador(l);
      if (p) { portador = p.nome; secao = ""; return; }

      const r = parseLinha(l, competencia);
      if (!r) return;
      if (r.ignorada) { ignoradas.push(r); return; }
      r.secao = secao;
      r.portador = portador;
      // Pagamento da fatura anterior aparece junto dos estornos, mas não é
      // estorno: ele não abate o total desta fatura. Fica de fora da conta.
      r.pagamento = r.credito && /pgto|pagamento/i.test(r.descricao);
      itens.push(r);
    });
    const compras = itens.filter((i) => !i.credito);
    const estornos = itens.filter((i) => i.credito && !i.pagamento);
    const bruto = compras.reduce((s, i) => s + i.valor, 0);
    const abatido = estornos.reduce((s, i) => s + i.valor, 0);
    return {
      competencia,
      vencimento: cab.vencimento,
      totalDeclarado: cab.total,
      itens,
      ignoradas,
      totalCompras: bruto,
      totalEstornos: abatido,
      // O total impresso na fatura já vem com os estornos descontados.
      totalLido: bruto - abatido
    };
  }

  // ---------- Despesa que se repete todo mês ----------
  // Assinatura, mensalidade, seguro e telefonia voltam em toda fatura. Elas
  // entram marcadas como MENSAL, e aí o app já as projeta para a frente
  // sozinho (em "Próximos lançamentos" e na projeção de saldo).
  //
  // Não vira conta a pagar de propósito: a conta seria somada ao gasto do
  // cartão e o mês contaria a mesma despesa duas vezes. Como lançamento
  // mensal do cartão, a repetição cede lugar à linha real assim que a
  // próxima fatura é importada — que é a regra que o app já tem.
  //
  // Compra parcelada NUNCA é recorrente: ela tem fim (3/10 acaba na 10ª).
  const RECORRENTES = [
    /netflix|spotify|disney|hbo|globoplay|deezer|paramount|youtube ?premium|prime ?video/i,
    /apple\.?com|itunes|google ?(one|storage|play)|microsoft|office ?365|adobe|dropbox|icloud/i,
    /anthropic|openai|chatgpt|claude|midjourney|canva|notion|github/i,
    /wellhub|gympass|smart ?fit|bodytech|selfit|panobianco|bluefit/i,
    /\btim\b|\bclaro\b|\bvivo\b|\boi\b|nextel|net ?servi|sky\b/i,
    /seguro|previd|icatu|porto ?seguro|bradesco ?seg|sulamerica|unimed|amil|golden ?cross/i,
    /mensalidade|assinatura|anuidade|plano ?de|clube ?de|smiles|multiplus|livelo/i,
    /uber ?one|ifood ?clube|rappi ?prime|amazon ?prime/i
  ];

  function ehRecorrente(desc, conhecidas) {
    const chave = chaveSerie(desc);
    if (conhecidas && chave && conhecidas.has(chave)) return true;
    return RECORRENTES.some((re) => re.test(desc));
  }

  // Chave estável de uma despesa: ignora número de loja, cidade e acento,
  // para "PANIFICACAO ATLANTICA RIO" casar de uma fatura para a outra.
  function chaveSerie(desc) {
    return String(desc || "").toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\d+/g, " ").replace(/[^a-z ]+/g, " ")
      .replace(/\s+/g, " ").trim()
      .split(" ").filter((p) => p.length > 2).slice(0, 3).join(" ");
  }

  // Descrições que já apareceram em 2 ou mais competências diferentes nas
  // faturas importadas antes. Isso é prova de repetição — vale mais do que
  // qualquer lista fixa, e pega assinatura que a lista não conhece.
  function recorrentesConhecidas(transacoes) {
    const meses = {};
    (transacoes || []).forEach((t) => {
      if (!t.fatura_id || t.projecao) return;
      const k = chaveSerie(t.descricao);
      if (!k) return;
      (meses[k] = meses[k] || new Set()).add(String(t.fatura_id).split(":")[1] || "");
    });
    const out = new Set();
    Object.keys(meses).forEach((k) => { if (meses[k].size >= 2) out.add(k); });
    return out;
  }

  // ---------- Itens viram lançamentos ----------
  // Dia em que a fatura sai da conta. O cadastro do cartão manda; o
  // vencimento impresso no PDF é a reserva.
  function diaVencimento(card, vencPdf) {
    const doCard = parseInt(card && card.dia_vencimento, 10);
    if (doCard >= 1 && doCard <= 31) return doCard;
    const doPdf = vencPdf ? +vencPdf.slice(8, 10) : 0;
    return doPdf >= 1 && doPdf <= 31 ? doPdf : 10;
  }

  function dataNoMes(ym, dia) {
    const ultimo = FC.Bills.diasNoMes(ym);
    return ym + "-" + pad(Math.min(dia, ultimo));
  }

  // Gera os lançamentos: os desta fatura + as parcelas que ainda faltam.
  // `categoriaDe` é injetada pelo app (é lá que mora o aprendizado).
  function expandir(itens, opcoes) {
    const { competencia, card_id, dia_venc, categoriaDe, pessoa, conhecidas } = opcoes;
    const faturaId = card_id + ":" + competencia;

    // Assinatura cobra UMA vez por fatura. Se o mesmo estabelecimento
    // aparece duas vezes no mesmo mês, é consumo variável (uso por demanda),
    // não mensalidade — e marcar como mensal projetaria o dobro para sempre.
    const vezes = {};
    itens.forEach((it) => {
      if (it.credito || it.parcelaTotal) return;
      const k = chaveSerie(it.descricao);
      if (k) vezes[k] = (vezes[k] || 0) + 1;
    });

    const out = [];
    itens.forEach((it) => {
      // Pagamento da fatura anterior não é gasto: é a quitação do mês passado.
      if (it.pagamento) return;
      const cat = categoriaDe ? categoriaDe(it.descricao, it.secao) : null;
      // Estorno entra com valor NEGATIVO. É o que faz o total do mês bater
      // exatamente com o total impresso na fatura, que já vem líquido.
      const valor = it.credito ? -it.valor : it.valor;
      const base = {
        valor, tipo: "despesa", forma: "cartao", card_id,
        category_id: cat ? cat.id : null,
        recorrencia: "nenhuma", conciliada: true,
        fatura_id: faturaId, data_compra: it.data_compra,
        estorno: !!it.credito,
        pessoa: it.portador || pessoa || ""
      };
      const n = it.parcelaTotal, i = it.parcelaAtual;
      const parcelada = n && i && n > 1;
      const sufixo = (k) => (parcelada ? ` (${k}/${n})` : "");
      // Parcelada já tem prazo definido — não é recorrente. Estorno também não.
      const recorrente = !parcelada && !it.credito &&
        vezes[chaveSerie(it.descricao)] === 1 &&
        ehRecorrente(it.descricao, conhecidas);

      // A parcela desta fatura
      out.push({
        ...base,
        descricao: it.descricao + sufixo(i || 1),
        data: dataNoMes(competencia, dia_venc),
        projecao: false,
        parcela: parcelada ? `${i}/${n}` : null,
        recorrencia: recorrente ? "mensal" : "nenhuma",
        recorrente,
        catNome: cat ? cat.nome : "—"
      });

      // As que ainda faltam, uma por mês à frente. Estorno não se projeta:
      // devolver uma parcela não cria parcela nos meses seguintes.
      if (!parcelada || it.credito) return;
      for (let k = i + 1; k <= n; k++) {
        const ym = FC.Bills.ymAdd(competencia, k - i);
        out.push({
          ...base,
          descricao: it.descricao + sufixo(k),
          data: dataNoMes(ym, dia_venc),
          projecao: true,
          parcela: `${k}/${n}`,
          catNome: cat ? cat.nome : "—"
        });
      }
    });
    return out;
  }

  // A fatura é a ÚNICA fonte de verdade do cartão. Importar limpa tudo que
  // está pendurado nele — o que veio de faturas anteriores e também o que foi
  // digitado à mão — e relança do zero. Sem isso o total do cartão vira uma
  // mistura de fatura com sobra de lançamento antigo, e não bate com nada.
  //
  // Só mexe NESTE cartão: outro cartão, receita e despesa geral ficam intactos.
  function substituiveis(transacoes, card_id) {
    return (transacoes || []).filter((t) => t.card_id === card_id);
  }

  // Dos que serão apagados, quais foram digitados à mão (não vieram de
  // fatura). São os únicos que não dá para recuperar reimportando o PDF —
  // por isso a tela avisa antes de apagar.
  function manuaisEmRisco(transacoes, card_id) {
    return substituiveis(transacoes, card_id).filter((t) => !t.fatura_id);
  }

  return {
    lerLinhas, analisar, expandir, substituiveis, manuaisEmRisco, diaVencimento,
    valorBR, acharParcela, ehRecorrente, chaveSerie, recorrentesConhecidas
  };
})();
