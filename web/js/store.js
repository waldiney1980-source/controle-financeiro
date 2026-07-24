/* ===========================================================
 * store.js — Camada de dados do FinControl AI
 *
 * Fase 1 (MVP): persiste em localStorage (modo offline) com dados
 * de demonstração. A API é assíncrona de propósito, para que a
 * Fase 2 troque a implementação por chamadas ao Supabase sem
 * mudar o restante do app (app.js/forecast.js).
 * =========================================================== */
window.FC = window.FC || {};

FC.Store = (function () {
  const KEY = "fincontrol_ai_db_v1";
  const uid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  let db = null;

  // ---------- Dados de demonstração ----------
  function seed() {
    const cats = [
      { nome: "Salário", tipo: "receita", cor: "#16a34a", icone: "💼" },
      { nome: "Freelance", tipo: "receita", cor: "#22c55e", icone: "🧑‍💻" },
      { nome: "Moradia", tipo: "despesa", cor: "#ef4444", icone: "🏠" },
      { nome: "Alimentação", tipo: "despesa", cor: "#f97316", icone: "🍽️" },
      { nome: "Transporte", tipo: "despesa", cor: "#eab308", icone: "🚗" },
      { nome: "Saúde", tipo: "despesa", cor: "#ec4899", icone: "⚕️" },
      { nome: "Lazer", tipo: "despesa", cor: "#f43f5e", icone: "🎮" },
      { nome: "Assinaturas", tipo: "despesa", cor: "#a855f7", icone: "📺" },
      { nome: "Contas/Utilidades", tipo: "despesa", cor: "#06b6d4", icone: "💡" },
      { nome: "Outras despesas", tipo: "despesa", cor: "#6b7280", icone: "📦" }
    ].map((c) => ({ id: uid(), ...c }));

    const catId = (n) => cats.find((c) => c.nome === n).id;

    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = (day) => new Date(y, m, day).toISOString().slice(0, 10);

    const accounts = [
      { id: uid(), nome: "Conta Corrente", tipo: "corrente", banco: "Banco X", numero_mascarado: "**** 1234", saldo_inicial: 3200, ativa: true }
    ];
    const cards = [
      { id: uid(), nome: "Cartão Principal", bandeira: "Visa", numero_mascarado: "**** 5678", limite: 6000, dia_fechamento: 20, dia_vencimento: 28 }
    ];

    const tx = [
      { descricao: "Salário", valor: 7500, tipo: "receita", data: d(5), category_id: catId("Salário"), recorrencia: "mensal", forma: "conta", account_id: accounts[0].id },
      { descricao: "Projeto freelance", valor: 1200, tipo: "receita", data: d(12), category_id: catId("Freelance"), recorrencia: "nenhuma", forma: "conta", account_id: accounts[0].id },
      { descricao: "Aluguel", valor: 2200, tipo: "despesa", data: d(6), category_id: catId("Moradia"), recorrencia: "mensal", forma: "conta", account_id: accounts[0].id },
      { descricao: "Supermercado", valor: 850, tipo: "despesa", data: d(8), category_id: catId("Alimentação"), recorrencia: "nenhuma", forma: "cartao", card_id: cards[0].id, estabelecimento: "Mercado Bom Preço" },
      { descricao: "Combustível", valor: 320, tipo: "despesa", data: d(10), category_id: catId("Transporte"), recorrencia: "nenhuma", forma: "cartao", card_id: cards[0].id, estabelecimento: "Posto Shell" },
      { descricao: "Plano de saúde", valor: 480, tipo: "despesa", data: d(9), category_id: catId("Saúde"), recorrencia: "mensal", forma: "conta", account_id: accounts[0].id },
      { descricao: "Cinema + jantar", valor: 210, tipo: "despesa", data: d(14), category_id: catId("Lazer"), recorrencia: "nenhuma", forma: "cartao", card_id: cards[0].id, estabelecimento: "Shopping" },
      { descricao: "Streaming", valor: 55, tipo: "despesa", data: d(15), category_id: catId("Assinaturas"), recorrencia: "mensal", forma: "cartao", card_id: cards[0].id, estabelecimento: "Netflix" },
      { descricao: "Energia elétrica", valor: 240, tipo: "despesa", data: d(11), category_id: catId("Contas/Utilidades"), recorrencia: "mensal", forma: "conta", account_id: accounts[0].id },
      { descricao: "Restaurante", valor: 130, tipo: "despesa", data: d(16), category_id: catId("Alimentação"), recorrencia: "nenhuma", forma: "cartao", card_id: cards[0].id, estabelecimento: "Outback" }
    ].map((t) => ({ id: uid(), conciliada: false, ...t }));

    const budgets = [
      { id: uid(), category_id: catId("Alimentação"), limite: 1200 },
      { id: uid(), category_id: catId("Transporte"), limite: 500 },
      { id: uid(), category_id: catId("Lazer"), limite: 400 },
      { id: uid(), category_id: catId("Assinaturas"), limite: 150 }
    ];

    const goals = [
      { id: uid(), nome: "Reserva de emergência", valor_alvo: 30000, valor_atual: 12000, prazo: `${y + 1}-06-30`, status: "ativa" },
      { id: uid(), nome: "Viagem", valor_alvo: 8000, valor_atual: 2500, prazo: `${y}-12-20`, status: "ativa" }
    ];

    return { categories: cats, accounts, cards, transactions: tx, budgets, goals };
  }

  // ---------- Persistência ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : seed();
    } catch (e) {
      db = seed();
    }
    save();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }

  // ---------- API pública (assíncrona) ----------
  async function init() {
    if (!db) load();
    return true;
  }
  async function all(collection) {
    if (!db) load();
    return (db[collection] || []).slice();
  }
  function allSync(collection) {
    if (!db) load();
    return (db[collection] || []).slice();
  }
  async function add(collection, obj) {
    if (!db) load();
    const item = { id: uid(), ...obj };
    (db[collection] = db[collection] || []).push(item);
    save();
    return item;
  }
  async function update(collection, id, patch) {
    const arr = db[collection] || [];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) { arr[i] = { ...arr[i], ...patch }; save(); return arr[i]; }
    return null;
  }
  async function remove(collection, id) {
    db[collection] = (db[collection] || []).filter((x) => x.id !== id);
    save();
    return true;
  }
  function categoryById(id) {
    return allSync("categories").find((c) => c.id === id) || null;
  }
  function reset() {
    db = seed(); save();
  }

  return { init, all, allSync, add, update, remove, categoryById, reset, mode: window.FC_MODE };
})();
