/* ===========================================================
 * supabaseClient.js — Inicializa o cliente Supabase se houver config.
 * Expõe window.FC_SUPABASE (ou null no modo offline).
 * =========================================================== */
(function () {
  const cfg = window.FC_CONFIG || {};

  // Trava de desenvolvimento: força o modo offline neste aparelho, para
  // testar as telas sem entrar no cofre da família. Ligue no console com
  //   localStorage.setItem("fc_force_offline", "1")
  // e desligue com localStorage.removeItem("fc_force_offline").
  let forcarOffline = false;
  try { forcarOffline = localStorage.getItem("fc_force_offline") === "1"; } catch (e) {}

  const hasConfig = !forcarOffline && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY;
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
