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

  // Valor em reais: 1.234,56 · 45,90 · R$ 45,90 · -12,00 · 12,00- (crédito
  // com o sinal atrás). O "R$" só conta junto com o cifrão: aceitando um "R"
  // solto, a coluna de país "BR" era engolida pelo valor e o estabelecimento
  // ficava com um "B" pendurado no nome.
  const RE_VALOR = /-?\s*(?:R\$)?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*-?/g;

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

  // ---------- Leitura de texto ----------
  // A fatura também chega como texto: copiada do aplicativo do banco,
  // salva como .txt ou colada na mão. Aqui não há coordenada para
  // reconstruir, cada quebra de linha já é uma linha.
  function linhasDeTexto(texto) {
    return String(texto || "")
      .split(/\r?\n/)
      .map((l) => l.replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 1);
  }

  // Escolhe o caminho pelo tipo do arquivo: PDF passa pelo pdf.js, o resto
  // (txt, csv, o que o banco exportar em texto) é lido direto.
  //
  // O texto do Banco do Brasil não vem em UTF-8: vem em ISO-8859-1, o padrão
  // antigo do Windows. Lido como UTF-8, "Transações" vira "Transa��es" e o
  // acento some do nome de todo estabelecimento. Por isso a leitura tenta
  // UTF-8 no modo estrito e, quando ele reclama, cai para a tabela antiga.
  async function lerArquivo(file) {
    const nome = String(file.name || "").toLowerCase();
    const tipo = String(file.type || "").toLowerCase();
    if (nome.endsWith(".pdf") || tipo === "application/pdf") return lerLinhas(file);
    const buf = await file.arrayBuffer();
    let texto;
    try {
      texto = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch (e) {
      texto = new TextDecoder("windows-1252").decode(buf);
    }
    return linhasDeTexto(texto);
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
  // O rótulo do vencimento muda de banco para banco, e a data quase nunca
  // está colada nele: pode vir na mesma linha, na linha seguinte, ou três
  // linhas abaixo. Aqui a busca é tolerante de propósito — perguntar o mês
  // ao usuário é o último recurso, não o primeiro.
  const RE_ROTULO_VENC = /vencimento|vencto|venc\.|vence em|pagar at[ée]|pagamento at[ée]/i;
  const RE_DATA = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;
  const RE_DATA_EXTENSO = /(\d{1,2})\s*(?:de\s+)?([a-zç]{3,9})\.?\s*(?:de\s+)?(\d{4})/i;

  function dataExtenso(linha) {
    const m = linha.match(RE_DATA_EXTENSO);
    if (!m) return null;
    const mm = MESES[m[2].slice(0, 3).toUpperCase().replace("Ç", "C")];
    return mm ? [m[1], pad(mm), m[3]] : null;
  }

  // Devolve { partes:[dia, mes, ano], linha } — o índice da linha é usado
  // depois para NÃO ler o vencimento como se fosse uma compra: quando a data
  // vem junto do valor a pagar, a linha tem cara de lançamento.
  function acharVencimento(linhas) {
    for (let i = 0; i < linhas.length; i++) {
      if (!RE_ROTULO_VENC.test(linhas[i])) continue;
      const naMesma = linhas[i].match(RE_DATA);
      if (naMesma) return { partes: [naMesma[1], naMesma[2], naMesma[3]], linha: i };
      const ext = dataExtenso(linhas[i]);
      if (ext) return { partes: ext, linha: i };
      // Nas seis linhas seguintes, a primeira data que aparecer. Não exijo
      // mais que a linha tenha SÓ a data: em muita fatura ela vem junto do
      // valor a pagar ("21/09/2026 R$ 4.210,55") e a regra antiga desistia.
      for (let k = i + 1; k <= i + 6 && k < linhas.length; k++) {
        const m = linhas[k].match(RE_DATA);
        if (m) return { partes: [m[1], m[2], m[3]], linha: k };
        const e = dataExtenso(linhas[k]);
        if (e) return { partes: e, linha: k };
      }
    }
    // Reserva: o fechamento diz a competência mesmo sem o vencimento.
    for (let i = 0; i < linhas.length; i++) {
      const m = linhas[i].match(/fatura fechada em\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
      if (m) return { partes: [m[1], m[2], m[3]], linha: i };
    }
    return null;
  }

  // Fatura ainda aberta ("lançamentos futuros", "próxima fatura") não traz
  // vencimento, e a última compra pode ser do mês passado: o Elo com compras
  // até 21/08 é a fatura que vence em setembro. Nesse caso vale a data em que
  // o extrato foi tirado, que o cabeçalho traz.
  function competenciaPelaEmissao(linhas) {
    // O extrato escreve o título espaçado, letra por letra:
    // "L A N Ç A M E N T O S    F U T U R O S". Aqui isso volta a ser palavra.
    const texto = linhas.join("\n")
      .replace(/\b(?:[A-Za-zÀ-ÿ]\s){2,}[A-Za-zÀ-ÿ]\b/g, (m) => m.replace(/\s+/g, ""));
    if (!/lan[çc]amentos\s*futuros|pr[óo]xima\s*fatura|fatura\s*em\s*aberto/i.test(texto)) return null;
    for (const l of linhas) {
      const m = l.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
      if (m && (/\d{2}:\d{2}/.test(l) || /auto[- ]?atendimento|extrato|emiss[ãa]o/i.test(l))) {
        return m[3] + "-" + pad(+m[2]);
      }
    }
    return null;
  }

  // Última linha de reserva: a competência pelas próprias compras. A fatura
  // que vence em agosto é a que traz compras até agosto, então o mês da
  // compra mais recente acerta o mês na quase totalidade dos casos — e um
  // palpite que o usuário confere é melhor do que uma tela travada.
  function competenciaPelasCompras(linhas) {
    const agora = new Date();
    const anoHoje = agora.getFullYear(), mesHoje = agora.getMonth() + 1;
    let melhor = null;
    linhas.forEach((l) => {
      if (RE_IGNORAR.test(l)) return;
      const m = l.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
      if (!m) return;
      if (!RE_VALOR.test(l)) return;               // linha sem dinheiro não é compra
      RE_VALOR.lastIndex = 0;
      const mes = +m[2];
      if (mes < 1 || mes > 12) return;
      // Sem ano na linha, o mês que ainda não chegou é do ano passado: uma
      // parcela comprada em 10/12 numa fatura de setembro é de dezembro
      // PASSADO. Sem isso, dezembro vencia a disputa e a fatura inteira
      // caía no mês errado.
      const ano = m[3]
        ? (m[3].length === 2 ? 2000 + +m[3] : +m[3])
        : (mes > mesHoje ? anoHoje - 1 : anoHoje);
      const chave = ano * 12 + mes;
      if (!melhor || chave > melhor.chave) melhor = { chave, ano, mes };
    });
    return melhor ? `${melhor.ano}-${pad(melhor.mes)}` : null;
  }

  function lerCabecalho(linhas) {
    const texto = linhas.join("\n");
    let vencimento = null, competencia = null, total = null;

    let linhaVencimento = -1;
    const v = acharVencimento(linhas);
    if (v) {
      const [d, mm, yy] = v.partes;
      const ano = String(yy).length === 2 ? "20" + yy : String(yy);
      vencimento = `${ano}-${pad(+mm)}-${pad(+d)}`;
      competencia = `${ano}-${pad(+mm)}`;
      linhaVencimento = v.linha;
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
    // O extrato do BB não escreve "Total da Fatura": escreve uma linha
    // "Total" com o valor em reais na frente e o dólar atrás.
    if (total == null) {
      for (const l of linhas) {
        const t = l.match(/^total\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
        if (t) { total = valorBR(t[1]).valor; break; }
      }
    }

    return { vencimento, competencia, total, linhaVencimento };
  }

  // ---------- De qual cartão é esta fatura ----------
  // Sem isso, duas faturas de cartões diferentes caem no mesmo cadastro, e
  // como importar substitui a competência inteira daquele cartão, a segunda
  // apagava a primeira. O arquivo diz de quem ele é: o extrato do BB traz
  // "Nr.Cartão : 6516.****.****.1082" e "Modalidade : OUROCARD ELO NANQUIM".
  function identificarCartao(linhas) {
    const texto = (linhas || []).join("\n");
    let final = null, nome = null, m;

    if ((m = texto.match(/n[ºor]{0,2}\.?\s*cart[ãa]o\s*:?\s*([\d*.\-\s]{6,40})/i))) {
      const digitos = m[1].match(/\d{4}/g);
      if (digitos && digitos.length) final = digitos[digitos.length - 1];
    }
    if (!final && (m = texto.match(/final\s*(?:do\s*cart[ãa]o\s*)?:?\s*(\d{4})/i))) final = m[1];
    if (!final && (m = texto.match(/\(cart[ãa]o\s*(\d{4})\)/i))) final = m[1];

    if ((m = texto.match(/modalidade\s*:?\s*([^\n]{3,40})/i))) nome = m[1].trim();
    if (!nome && (m = texto.match(/\b(ourocard[a-z ]*|elo\b[a-z ]*|visa[a-z ]*|mastercard[a-z ]*|hipercard|american express|amex)\b/i))) {
      nome = m[1].trim().toUpperCase();
    }
    if (nome) nome = nome.replace(/\s{2,}/g, " ").slice(0, 40);
    return { nome, final };
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
  function parseLinha(linha, competencia, opcoes) {
    const rsAntesDeUs = !!(opcoes && opcoes.rsAntesDeUs);
    if (RE_IGNORAR.test(linha)) return { ignorada: true, motivo: "não é compra (cabeçalho, total ou pagamento)", linha };

    let dia, mes, ano = null, casado;
    // Data ao contrário, do jeito que planilha e extrato exportam: 2026-08-09.
    let iso = linha.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
    if (iso) {
      ano = +iso[1]; mes = +iso[2]; dia = +iso[3];
      const resto0 = linha.slice(iso[0].length).trim();
      const vals = resto0.match(RE_VALOR);
      if (!vals || !vals.length) return null;
      const { valor: v0, negativo: n0 } = valorBR(vals[vals.length - 1]);
      if (!v0) return null;
      let d0 = resto0;
      vals.forEach((v) => { d0 = d0.replace(v, " "); });
      d0 = d0.replace(/R\$/g, " ").replace(/[;,|]+/g, " ").replace(/\s+/g, " ").trim() || "Compra";
      const p0 = acharParcela(d0);
      return {
        data_compra: `${ano}-${pad(mes)}-${pad(dia)}`,
        descricao: p0 ? p0.limpa : d0, valor: v0, credito: n0,
        parcelaAtual: p0 ? p0.i : null, parcelaTotal: p0 ? p0.n : null, linha
      };
    }
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

    // Fatura em duas moedas traz dois números na linha. Qual deles é o real
    // depende do banco: o extrato do Banco do Brasil imprime "Valor R$" e
    // depois "Valor US$", então o de verdade é o PENÚLTIMO — o último é o
    // dólar, quase sempre 0,00. Pegar o último zerava a fatura inteira e o
    // app dizia não ter reconhecido nenhuma compra.
    let bruto = valores[valores.length - 1];
    if (valores.length > 1) {
      if (rsAntesDeUs) bruto = valores[valores.length - 2];
      else if (!valorBR(bruto).valor) bruto = valores[valores.length - 2];
    }
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

  // ---------- Leitura tolerante ----------
  // Nem todo PDF entrega a linha inteira: às vezes a data vem sozinha numa
  // linha, a descrição na seguinte e o valor na outra, porque o texto foi
  // extraído por coluna. Este segundo passe remonta isso. Só roda quando o
  // passe normal não achou nada — é palpite, e palpite é o último recurso.
  const RE_SO_DATA = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/;
  const RE_SO_VALOR = /^-?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*-?$/;

  function analisarTolerante(linhas, competencia) {
    const itens = [];
    let dataPendente = null, textoPendente = "";
    const [cy, cm] = competencia.split("-").map(Number);

    const empurra = (desc, bruto, data) => {
      const { valor, negativo } = valorBR(bruto);
      if (!valor) return;
      const limpo = String(desc || "").replace(/R\$/g, " ").replace(/[;|]+/g, " ")
        .replace(/\s+/g, " ").trim();
      if (!limpo || limpo.length < 2) return;
      const parcela = acharParcela(limpo);
      let compra = data;
      if (!compra) compra = `${cy}-${pad(cm)}-01`;
      itens.push({
        data_compra: compra,
        descricao: parcela ? parcela.limpa : limpo,
        valor, credito: negativo,
        parcelaAtual: parcela ? parcela.i : null,
        parcelaTotal: parcela ? parcela.n : null,
        linha: `${data || ""} ${limpo} ${bruto}`.trim()
      });
    };

    linhas.forEach((l) => {
      if (RE_IGNORAR.test(l)) { textoPendente = ""; return; }

      const soData = l.match(RE_SO_DATA);
      if (soData) {
        const mes = +soData[2], dia = +soData[1];
        if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
          const ano = soData[3]
            ? (soData[3].length === 2 ? 2000 + +soData[3] : +soData[3])
            : (mes > cm ? cy - 1 : cy);
          dataPendente = `${ano}-${pad(mes)}-${pad(dia)}`;
        }
        return;
      }

      if (RE_SO_VALOR.test(l)) {                    // valor sozinho: casa com o texto anterior
        if (textoPendente) empurra(textoPendente, l, dataPendente);
        textoPendente = "";
        dataPendente = null;
        return;
      }

      const valores = l.match(RE_VALOR);
      RE_VALOR.lastIndex = 0;
      if (valores && valores.length) {              // texto e valor na mesma linha, sem data
        let desc = l;
        valores.forEach((v) => { desc = desc.replace(v, " "); });
        empurra(desc, valores[valores.length - 1], dataPendente);
        textoPendente = "";
        dataPendente = null;
        return;
      }

      if (/[a-zA-Z]{3}/.test(l) && l.length <= 80) textoPendente = l;
    });
    return itens;
  }

  // ---------- Fatura inteira ----------
  function analisar(linhas, competenciaPadrao, forcada) {
    const cab = lerCabecalho(linhas);
    // Cabeçalho de colunas "... Valor R$   Valor US$": diz que o real vem
    // antes do dólar em cada linha.
    const rsAntesDeUs = linhas.some((l) => /valor\s*r\$[\s\S]{0,40}valor\s*us\$/i.test(l));
    // Ordem: o mês que VOCÊ escolheu na tela manda em tudo. Depois o que está
    // escrito na fatura, depois a data em que o extrato foi tirado (fatura
    // ainda aberta), e só então o mês da compra mais recente.
    const emissao = (forcada || cab.competencia) ? null : competenciaPelaEmissao(linhas);
    const palpite = (forcada || cab.competencia || emissao) ? null : competenciaPelasCompras(linhas);
    const competencia = forcada || cab.competencia || emissao || palpite || competenciaPadrao;
    const itens = [], ignoradas = [];
    let secao = "", portador = "";
    linhas.forEach((l, indice) => {
      if (indice === cab.linhaVencimento) return;   // é o cabeçalho, não uma compra
      const s = ehSecao(l);
      if (s) { secao = s; return; }
      const p = ehPortador(l);
      if (p) { portador = p.nome; secao = ""; return; }

      const r = parseLinha(l, competencia, { rsAntesDeUs });
      if (!r) return;
      if (r.ignorada) { ignoradas.push(r); return; }
      r.secao = secao;
      r.portador = portador;
      // Pagamento da fatura anterior aparece junto dos estornos, mas não é
      // estorno: ele não abate o total desta fatura. Fica de fora da conta.
      r.pagamento = r.credito && /pgto|pagamento/i.test(r.descricao);
      itens.push(r);
    });
    let modo = "normal";
    if (!itens.length) {
      analisarTolerante(linhas, competencia).forEach((i) => {
        i.secao = ""; i.portador = "";
        i.pagamento = i.credito && /pgto|pagamento/i.test(i.descricao);
        itens.push(i);
      });
      if (itens.length) modo = "tolerante";
    }

    const compras = itens.filter((i) => !i.credito);
    const estornos = itens.filter((i) => i.credito && !i.pagamento);
    const bruto = compras.reduce((s, i) => s + i.valor, 0);
    const abatido = estornos.reduce((s, i) => s + i.valor, 0);
    return {
      competencia,
      modo,
      // Amostra do que foi lido, para a tela mostrar quando não reconhecer
      // nada: é a única forma de o usuário entender o que o app está vendo.
      amostra: linhas.slice(0, 8),
      // Lida = estava escrita na fatura. Senão, `competenciaOrigem` diz de
      // onde veio o palpite, para a tela avisar sem travar a importação.
      competenciaDetectada: !!(forcada || cab.competencia),
      competenciaOrigem: forcada ? "escolhida"
        : cab.competencia ? "fatura"
        : emissao ? "emissao"
        : palpite ? "compras" : "tela",
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

  // A fatura é a fonte de verdade do CARTÃO NAQUELE MÊS. Importar limpa:
  //   • tudo daquela competência (inclusive o que foi digitado à mão nela),
  //   • as projeções de faturas mais antigas que caem nesta competência ou
  //     depois — a fatura nova é a notícia mais recente sobre o que segue
  //     em aberto, senão a parcela 4/10 entraria duas vezes.
  //
  // Faturas de OUTROS meses continuam de pé: dá para importar cinco meses
  // seguidos e cada um guarda o seu. Outro cartão e o que está fora do
  // cartão nunca são tocados.
  function substituiveis(transacoes, card_id, competencia) {
    const faturaId = card_id + ":" + competencia;
    return (transacoes || []).filter((t) => {
      if (t.card_id !== card_id) return false;
      const mes = String(t.data || "").slice(0, 7);
      if (t.fatura_id === faturaId) return true;
      if (t.projecao && mes >= competencia) return true;
      return !t.fatura_id && mes === competencia;
    });
  }

  // Dos que serão apagados, quais foram digitados à mão. São os únicos que
  // não voltam reimportando o PDF — por isso a tela avisa antes.
  function manuaisEmRisco(transacoes, card_id, competencia) {
    return substituiveis(transacoes, card_id, competencia).filter((t) => !t.fatura_id);
  }

  return {
    lerLinhas, lerArquivo, linhasDeTexto,
    analisar, analisarTolerante, expandir, acharVencimento, competenciaPelasCompras,
    competenciaPelaEmissao, identificarCartao, substituiveis, manuaisEmRisco, diaVencimento,
    valorBR, acharParcela, ehRecorrente, chaveSerie, recorrentesConhecidas
  };
})();
