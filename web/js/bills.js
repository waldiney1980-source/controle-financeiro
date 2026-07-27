/* ===========================================================
 * bills.js — Regras das contas a pagar
 *
 * Uma conta MENSAL não é um registro só: ela acontece de novo
 * todo mês. Cada ocorrência tem seu próprio vencimento, seu
 * próprio valor (luz e água mudam) e seu próprio "pagou ou não".
 *
 * No registro da conta isso vira:
 *   vencimento  "2026-03-10"        → 1ª ocorrência (o dia vale para os meses seguintes)
 *   recorrencia "mensal" | "nenhuma"
 *   valor       350                 → valor padrão
 *   valores     { "2026-07": 412.8 }→ valor daquele mês, quando difere
 *   pagas       { "2026-07": "2026-07-05" } → competência → data em que foi paga
 * =========================================================== */
window.FC = window.FC || {};

FC.Bills = (function () {
  const pad = (n) => String(n).padStart(2, "0");
  const hojeStr = () => new Date().toISOString().slice(0, 10);
  const ymDe = (dateStr) => String(dateStr || "").slice(0, 7);
  const ymHoje = () => hojeStr().slice(0, 7);

  // ---------- Aritmética de competência (YYYY-MM) ----------
  function ymAdd(ym, n) {
    const [y, m] = ym.split("-").map(Number);
    const idx = y * 12 + (m - 1) + n;
    return Math.floor(idx / 12) + "-" + pad((idx % 12) + 1);
  }
  function ymDiff(de, ate) {
    const [ay, am] = de.split("-").map(Number);
    const [by, bm] = ate.split("-").map(Number);
    return (by * 12 + bm) - (ay * 12 + am);
  }
  function diasNoMes(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }
  function diasEntre(de, ate) {
    return Math.round((new Date(ate + "T00:00:00") - new Date(de + "T00:00:00")) / 86400000);
  }

  // ---------- Uma conta em um mês ----------
  // A conta mensal vale do vencimento em diante; a única, só no mês dela.
  function valeNoMes(b, ym) {
    const inicio = ymDe(b.vencimento);
    if (!inicio || !ym) return false;
    return b.recorrencia === "mensal" ? inicio <= ym : inicio === ym;
  }

  // Vencimento daquele mês. Dia 31 em mês de 30 cai no último dia.
  function vencimentoNoMes(b, ym) {
    const venc = String(b.vencimento || "");
    if (!venc) return null;
    if (b.recorrencia !== "mensal") return venc;
    const dia = Math.min(+venc.slice(8, 10) || 1, diasNoMes(ym));
    return ym + "-" + pad(dia);
  }

  function valorNoMes(b, ym) {
    const v = b.valores ? b.valores[ym] : null;
    return v == null || v === "" ? (+b.valor || 0) : (+v || 0);
  }

  function pagaEm(b, ym) { return (b.pagas && b.pagas[ym]) || null; }
  function estaPaga(b, ym) { return !!pagaEm(b, ym); }

  function ocorrencia(b, ym) {
    return {
      bill: b,
      id: b.id,
      ym,
      descricao: b.descricao,
      category_id: b.category_id,
      recorrencia: b.recorrencia,
      venc: vencimentoNoMes(b, ym),
      valor: valorNoMes(b, ym),
      paga: estaPaga(b, ym),
      pagaEm: pagaEm(b, ym)
    };
  }

  // ---------- Séries de ocorrências ----------
  // Lista as ocorrências de uma conta entre duas competências (inclusive).
  function ocorrencias(b, deYm, ateYm) {
    const inicio = ymDe(b.vencimento);
    if (!inicio || ymDiff(deYm, ateYm) < 0) return [];
    if (b.recorrencia !== "mensal") {
      return inicio >= deYm && inicio <= ateYm ? [ocorrencia(b, inicio)] : [];
    }
    const primeiro = inicio > deYm ? inicio : deYm;
    const n = ymDiff(primeiro, ateYm);
    if (n < 0) return [];
    const out = [];
    for (let i = 0; i <= n; i++) out.push(ocorrencia(b, ymAdd(primeiro, i)));
    return out;
  }

  function ocorrenciasDoMes(bills, ym) {
    return (bills || []).filter((b) => valeNoMes(b, ym)).map((b) => ocorrencia(b, ym));
  }

  // Quanto tempo para trás vale a pena procurar conta esquecida.
  const JANELA_MESES = 24;

  // Ocorrências vencidas e ainda não pagas (inclui o mês corrente).
  function atrasadas(bills, hoje) {
    hoje = hoje || hojeStr();
    const ate = hoje.slice(0, 7);
    const de = ymAdd(ate, -JANELA_MESES);
    const out = [];
    (bills || []).forEach((b) => {
      ocorrencias(b, de, ate).forEach((o) => {
        if (!o.paga && o.venc && o.venc < hoje) out.push({ ...o, dias: diasEntre(o.venc, hoje) });
      });
    });
    return out.sort((a, b) => (a.venc || "").localeCompare(b.venc || ""));
  }

  // Contas não pagas de meses ANTERIORES ao corrente.
  // Separado de atrasadas() porque o mês corrente já entra no fluxo
  // recorrente da projeção — somar os dois contaria o mesmo boleto duas vezes.
  function pendenciaAnterior(bills, hoje) {
    hoje = hoje || hojeStr();
    const atual = hoje.slice(0, 7);
    const de = ymAdd(atual, -JANELA_MESES);
    let total = 0;
    (bills || []).forEach((b) => {
      ocorrencias(b, de, ymAdd(atual, -1)).forEach((o) => { if (!o.paga) total += o.valor; });
    });
    return total;
  }

  // Total já pago até uma data (dinheiro que saiu de verdade).
  // `desde` opcional: ignora o que é anterior à data do saldo informado.
  // A varredura vai 12 meses PARA A FRENTE porque boleto pago adiantado
  // já saiu da conta, mesmo sendo de um mês que ainda não chegou.
  function pagoAte(bills, hoje, desde) {
    hoje = hoje || hojeStr();
    const atual = hoje.slice(0, 7);
    const ate = ymAdd(atual, 12);
    const de = desde ? desde.slice(0, 7) : ymAdd(atual, -JANELA_MESES);
    let total = 0;
    (bills || []).forEach((b) => {
      ocorrencias(b, de, ate).forEach((o) => {
        if (!o.paga) return;
        const quando = o.pagaEm || o.venc;
        if (quando > hoje) return;
        if (desde && quando <= desde) return;
        total += o.valor;
      });
    });
    return total;
  }

  return {
    ymAdd, ymDiff, ymDe, ymHoje, diasNoMes, diasEntre,
    valeNoMes, vencimentoNoMes, valorNoMes, pagaEm, estaPaga,
    ocorrencia, ocorrencias, ocorrenciasDoMes,
    atrasadas, pendenciaAnterior, pagoAte
  };
})();
