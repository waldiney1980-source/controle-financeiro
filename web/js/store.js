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
  const KEY = "fincontrol_ai_db_v2";
  const uid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  let db = null;

  // ---------- Dados iniciais (SEM lançamentos fictícios) ----------
  // Nasce só com as categorias padrão. Contas, cartões, receitas,
  // despesas, metas e orçamentos começam vazios — você cadastra os reais.
  function seed() {
    const cats = [
      // Receitas
      { nome: "Aluguel", tipo: "receita", cor: "#22c55e", icone: "🏠" },
      { nome: "IR", tipo: "receita", cor: "#0ea5e9", icone: "🧾" },
      { nome: "Salário Dani", tipo: "receita", cor: "#16a34a", icone: "💼" },
      { nome: "Outros", tipo: "receita", cor: "#84cc16", icone: "➕" },
      // Despesas
      { nome: "Moradia", tipo: "despesa", cor: "#ef4444", icone: "🏠" },
      { nome: "Alimentação", tipo: "despesa", cor: "#f97316", icone: "🍽️" },
      { nome: "Transporte", tipo: "despesa", cor: "#eab308", icone: "🚗" },
      { nome: "Saúde", tipo: "despesa", cor: "#ec4899", icone: "⚕️" },
      { nome: "Educação", tipo: "despesa", cor: "#8b5cf6", icone: "📚" },
      { nome: "Contas/Utilidades", tipo: "despesa", cor: "#06b6d4", icone: "💡" },
      { nome: "Lazer", tipo: "despesa", cor: "#f43f5e", icone: "🎮" },
      { nome: "Assinaturas", tipo: "despesa", cor: "#a855f7", icone: "📺" },
      { nome: "Compras", tipo: "despesa", cor: "#14b8a6", icone: "🛍️" },
      { nome: "Cartão de crédito", tipo: "despesa", cor: "#64748b", icone: "💳" },
      { nome: "Outras despesas", tipo: "despesa", cor: "#6b7280", icone: "📦" }
    ].map((c) => ({ id: uid(), parent_id: null, ...c }));

    return { categories: cats, accounts: [], cards: [], transactions: [], budgets: [], goals: [], bills: [] };
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

  // Garante categorias de receita padrão sem apagar dados existentes
  function ensureIncomeCategories() {
    const wanted = [
      { nome: "Aluguel", cor: "#22c55e", icone: "🏠" },
      { nome: "IR", cor: "#0ea5e9", icone: "🧾" },
      { nome: "Salário Dani", cor: "#16a34a", icone: "💼" },
      { nome: "Outros", cor: "#84cc16", icone: "➕" }
    ];
    db.categories = db.categories || [];
    let changed = false;
    wanted.forEach((w) => {
      const exists = db.categories.some(
        (c) => c.tipo === "receita" && (c.nome || "").toLowerCase() === w.nome.toLowerCase()
      );
      if (!exists) { db.categories.push({ id: uid(), tipo: "receita", parent_id: null, ...w }); changed = true; }
    });
    if (changed) save();
  }

  // ---------- API pública (assíncrona) ----------
  async function init() {
    if (!db) load();
    ensureIncomeCategories();
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
