/* ===========================================================
 * auth.js — Autenticação (FASE 2)
 *
 * Exibe uma tela de login/cadastro e só libera o app depois que
 * o usuário entra. Usa o Supabase Auth. Se não houver Supabase
 * configurado (modo offline), libera direto sem pedir login.
 *
 * Expõe: FC.Auth.requireLogin() -> Promise<user | null>
 *        FC.Auth.user           -> usuário atual (ou null)
 * =========================================================== */
window.FC = window.FC || {};

FC.Auth = (function () {
  const sb = window.FC_SUPABASE || null;
  let user = null;

  // ---------- Tela de login (injetada no DOM) ----------
  function buildOverlay() {
    if (document.getElementById("fcAuth")) return document.getElementById("fcAuth");
    const ov = document.createElement("div");
    ov.id = "fcAuth";
    ov.className = "fc-auth";
    ov.innerHTML = `
      <div class="fc-auth-box">
        <div class="fc-auth-brand">FinControl <span>AI</span></div>
        <p class="fc-auth-sub">Controle financeiro da família</p>
        <div class="fc-auth-tabs">
          <button type="button" class="fc-auth-tab active" data-tab="login">Entrar</button>
          <button type="button" class="fc-auth-tab" data-tab="signup">Criar conta</button>
        </div>
        <form id="fcAuthForm" class="fc-auth-form" autocomplete="on">
          <label>E-mail</label>
          <input name="email" type="email" required placeholder="voce@email.com" autocomplete="email">
          <label>Senha</label>
          <input name="password" type="password" required minlength="6" placeholder="mínimo 6 caracteres" autocomplete="current-password">
          <div class="fc-auth-msg" id="fcAuthMsg"></div>
          <button type="submit" class="btn fc-auth-submit" id="fcAuthSubmit">Entrar</button>
        </form>
        <p class="fc-auth-hint">Peça ao administrador da família para criar sua conta, ou crie a sua na aba “Criar conta”.</p>
      </div>`;
    document.body.appendChild(ov);
    return ov;
  }

  let mode = "login"; // "login" | "signup"

  function setMode(m, ov) {
    mode = m;
    ov.querySelectorAll(".fc-auth-tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === m));
    ov.querySelector("#fcAuthSubmit").textContent = m === "login" ? "Entrar" : "Criar conta";
    const pw = ov.querySelector('input[name="password"]');
    pw.setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
    msg(ov, "");
  }

  function msg(ov, text, kind) {
    const m = ov.querySelector("#fcAuthMsg");
    m.textContent = text || "";
    m.className = "fc-auth-msg" + (kind ? " " + kind : "");
  }

  function show(ov) { ov.classList.add("show"); }
  function hide(ov) { ov.classList.remove("show"); }

  // ---------- Chip do usuário na sidebar ----------
  function renderUserChip() {
    const foot = document.querySelector(".sidebar-foot");
    if (!foot || !user) return;
    let chip = document.getElementById("fcUserChip");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "fcUserChip";
      chip.className = "fc-user-chip";
      foot.appendChild(chip);
    }
    const email = user.email || "usuário";
    const inicial = (email[0] || "?").toUpperCase();
    chip.innerHTML = `
      <span class="fc-user-av">${inicial}</span>
      <span class="fc-user-mail" title="${email}">${email}</span>
      <button type="button" class="fc-user-out" id="fcLogout" title="Sair">Sair</button>`;
    chip.querySelector("#fcLogout").onclick = signOut;
  }

  async function signOut() {
    if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
    location.reload();
  }

  // ---------- Fluxo principal ----------
  async function requireLogin() {
    // Modo offline (sem Supabase): não exige login.
    if (!sb) { user = null; return null; }

    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      user = data.session.user;
      renderUserChip();
      return user;
    }

    // Sem sessão → mostra a tela e espera o login.
    const ov = buildOverlay();
    show(ov);

    return new Promise((resolve) => {
      ov.querySelectorAll(".fc-auth-tab").forEach((t) =>
        t.addEventListener("click", () => setMode(t.dataset.tab, ov)));

      ov.querySelector("#fcAuthForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = ov.querySelector("#fcAuthSubmit");
        const email = ov.querySelector('input[name="email"]').value.trim();
        const password = ov.querySelector('input[name="password"]').value;
        if (!email || password.length < 6) {
          return msg(ov, "Informe um e-mail e uma senha de pelo menos 6 caracteres.", "bad");
        }
        btn.disabled = true;
        msg(ov, mode === "login" ? "Entrando…" : "Criando conta…");
        try {
          let res;
          if (mode === "login") {
            res = await sb.auth.signInWithPassword({ email, password });
          } else {
            res = await sb.auth.signUp({ email, password });
          }
          if (res.error) throw res.error;

          // Cadastro que exige confirmação de e-mail: não vem sessão.
          if (!res.data.session) {
            btn.disabled = false;
            return msg(ov, "Conta criada! Confirme pelo e-mail enviado e depois entre.", "ok");
          }
          user = res.data.session.user;
          renderUserChip();
          hide(ov);
          resolve(user);
        } catch (err) {
          btn.disabled = false;
          msg(ov, traduzErro(err), "bad");
        }
      });
    });
  }

  function traduzErro(err) {
    const m = (err && err.message || "").toLowerCase();
    if (m.includes("invalid login")) return "E-mail ou senha incorretos.";
    if (m.includes("already registered")) return "Este e-mail já tem conta. Use a aba “Entrar”.";
    if (m.includes("signups not allowed") || m.includes("disabled"))
      return "Cadastro fechado. Peça ao administrador da família para criar sua conta.";
    if (m.includes("email") && m.includes("confirm")) return "Confirme seu e-mail antes de entrar.";
    if (m.includes("rate limit")) return "Muitas tentativas. Aguarde um pouco e tente de novo.";
    return err && err.message ? err.message : "Não foi possível concluir. Tente novamente.";
  }

  return { requireLogin, get user() { return user; }, signOut };
})();
