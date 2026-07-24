/* ===========================================================
 * store.js — Camada de dados do FinControl AI
 *
 * FASE 2: "cofre" COMPARTILHADO da família.
 *   • ONLINE  (Supabase + logado): lê/grava UMA linha em JSON na
 *     tabela family_state. Todos os membros compartilham os mesmos
 *     dados, com sincronização em TEMPO REAL.
 *   • OFFLINE (sem Supabase): mantém tudo no localStorage, como antes.
 *
 * A API pública é idêntica à Fase 1, então app.js/forecast.js não
 * precisam mudar.
 * =========================================================== */
window.FC = window.FC || {};

FC.Store = (function () {
  const KEY = "fincontrol_ai_db_v2";
  const sb = window.FC_SUPABASE || null;
  const uid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  let db = null;
  let online = false;
  let saveTimer = null;
  let saving = false;
  let dirtyAgain = false;

  // ---------- Dados iniciais (só categorias padrão) ----------
  function seed() {
    const cats = [
      { nome: "Aluguel", tipo: "receita", cor: "#22c55e", icone: "🏠" },
      { nome: "IR", tipo: "receita", cor: "#0ea5e9", icone: "🧾" },
      { nome: "Salário Dani", tipo: "receita", cor: "#16a34a", icone: "💼" },
      { nome: "Outros", tipo: "receita", cor: "#84cc16", icone: "➕" },
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

  function ensureShape(d) {
    d = d || {};
    ["categories", "accounts", "cards", "transactions", "budgets", "goals", "bills"]
      .forEach((k) => { if (!Array.isArray(d[k])) d[k] = []; });
    return d;
  }

  // Garante categorias de receita padrão sem apagar dados existentes.
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
        (c) => c.tipo === "receita" && (c.nome || "").toLowerCase() === w.nome.toLowerCase());
      if (!exists) { db.categories.push({ id: uid(), tipo: "receita", parent_id: null, ...w }); changed = true; }
    });
    return changed;
  }

  // ---------- Persistência LOCAL (offline) ----------
  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? ensureShape(JSON.parse(raw)) : seed();
    } catch (e) { db = seed(); }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }

  // ---------- Persistência REMOTA (online) ----------
  async function loadRemote() {
    const { data, error } = await sb.from("family_state").select("data").eq("id", 1).maybeSingle();
    if (error) throw error;
    const raw = data && data.data ? data.data : null;
    if (raw && Array.isArray(raw.categories)) {
      db = ensureShape(raw);
      if (ensureIncomeCategories()) scheduleSave();
    } else {
      // Cofre vazio (primeira vez): cria com as categorias padrão.
      db = seed();
      await saveRemoteNow();
    }
  }

  async function saveRemoteNow() {
    if (!online) return;
    saving = true;
    try {
      const { error } = await sb.from("family_state").update({ data: db }).eq("id", 1);
      if (error) throw error;
    } catch (e) {
      console.warn("Falha ao salvar no cofre (tentando de novo):", e && e.message);
      dirtyAgain = true;
    } finally {
      saving = false;
      if (dirtyAgain) { dirtyAgain = false; scheduleSave(); }
    }
  }

  function scheduleSave() {
    if (online) {
      if (saving) { dirtyAgain = true; return; }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveRemoteNow, 600);
    } else {
      saveLocal();
    }
  }

  // ---------- Tempo real ----------
  function subscribeRealtime() {
    if (!online) return;
    let myId = null;
    try { myId = FC.Auth && FC.Auth.user ? FC.Auth.user.id : null; } catch (e) {}
    sb.channel("family_state_changes")
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_state" },
        (payload) => {
          const row = payload.new || {};
          // Ignora o eco das minhas próprias gravações.
          if (row.updated_by && myId && row.updated_by === myId) return;
          if (row.data && Array.isArray(row.data.categories)) {
            db = ensureShape(row.data);
            window.dispatchEvent(new CustomEvent("fc:remote"));
          }
        })
      .subscribe();
  }

  // ---------- API pública (assíncrona) ----------
  let initPromise = null;
  function init() {
    if (initPromise) return initPromise;   // roda só uma vez
    initPromise = (async () => {
      online = !!(sb && FC.Auth && FC.Auth.user);
      window.FC_MODE = online ? "online" : "offline";
      if (online) {
        try {
          await loadRemote();
          subscribeRealtime();
        } catch (e) {
          console.warn("Não foi possível abrir o cofre online, usando modo offline:", e && e.message);
          online = false;
          window.FC_MODE = "offline";
          loadLocal();
          if (ensureIncomeCategories()) saveLocal();
        }
      } else {
        loadLocal();
        if (ensureIncomeCategories()) saveLocal();
      }
      return true;
    })();
    return initPromise;
  }

  async function all(collection) {
    if (!db) await init();
    return (db[collection] || []).slice();
  }
  function allSync(collection) {
    if (!db) loadLocal();
    return (db[collection] || []).slice();
  }
  async function add(collection, obj) {
    if (!db) await init();
    const item = { id: uid(), ...obj };
    (db[collection] = db[collection] || []).push(item);
    scheduleSave();
    return item;
  }
  async function update(collection, id, patch) {
    const arr = db[collection] || [];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) { arr[i] = { ...arr[i], ...patch }; scheduleSave(); return arr[i]; }
    return null;
  }
  async function remove(collection, id) {
    db[collection] = (db[collection] || []).filter((x) => x.id !== id);
    scheduleSave();
    return true;
  }
  function categoryById(id) {
    return allSync("categories").find((c) => c.id === id) || null;
  }
  function reset() {
    db = seed();
    scheduleSave();
  }

  return { init, all, allSync, add, update, remove, categoryById, reset, get mode() { return window.FC_MODE; } };
})();
