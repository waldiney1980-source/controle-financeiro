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
  SUPABASE_URL: "",        // ex.: "https://xxxx.supabase.co"
  SUPABASE_ANON_KEY: "",   // ex.: "eyJhbGciOi..."
  MOEDA: "BRL",
  LOCALE: "pt-BR"
};
