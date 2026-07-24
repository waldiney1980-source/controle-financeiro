/* ===========================================================
 * config.js — Configuração do FinControl AI
 *
 * MODO OFFLINE (padrão): deixe SUPABASE_URL vazio. O app usa
 * localStorage com dados de demonstração — funciona sem backend.
 *
 * MODO ONLINE: preencha com as credenciais do seu projeto Supabase
 * (Settings → API). A `anon key` é pública por design; a segurança
 * vem do Row Level Security. NUNCA coloque a service_role key aqui.
 *
 * Dica: para não commitar credenciais reais, copie este arquivo
 * como config.local.js (que está no .gitignore) e carregue-o.
 * =========================================================== */
window.FC_CONFIG = {
  SUPABASE_URL: "https://mhqhbnfbfrfsckhcvzis.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ocWhibmZiZnJmc2NraGN2emlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MDk0NjUsImV4cCI6MjEwMDM4NTQ2NX0.47aA6k6SbiXX0iCRasf4Lpd2wP7xuW0U03DP_Q0wzbU",
  MOEDA: "BRL",
  LOCALE: "pt-BR"
};
