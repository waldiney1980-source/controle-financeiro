/* ===========================================================
 * supabaseClient.js — Inicializa o cliente Supabase se houver config.
 * Expõe window.FC_SUPABASE (ou null no modo offline).
 * =========================================================== */
(function () {
  const cfg = window.FC_CONFIG || {};
  const hasConfig = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY;
  const hasLib = typeof window.supabase !== "undefined" && window.supabase.createClient;

  if (hasConfig && hasLib) {
    try {
      window.FC_SUPABASE = window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY
      );
      window.FC_MODE = "online";
    } catch (e) {
      console.warn("Falha ao iniciar Supabase, usando modo offline:", e);
      window.FC_SUPABASE = null;
      window.FC_MODE = "offline";
    }
  } else {
    window.FC_SUPABASE = null;
    window.FC_MODE = "offline";
  }
})();
