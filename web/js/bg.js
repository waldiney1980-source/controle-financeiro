/* ===========================================================
 * bg.js — Foto de fundo personalizada (canvas), bem discreta.
 *
 * A foto fica salva SÓ neste aparelho (localStorage), reduzida
 * e com baixa opacidade, desenhada num <canvas> atrás de tudo.
 * Expõe: window.FC_BG.setFromFile(file) / FC_BG.clear()
 * =========================================================== */
(function () {
  const KEY = "fc_bg_photo";
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let img = null;

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!img) return;
    // "cover": preenche a tela mantendo proporção
    const ir = img.width / img.height, cr = w / h;
    let dw, dh;
    if (ir > cr) { dh = h; dw = h * ir; } else { dw = w; dh = w / ir; }
    const dx = (w - dw) / 2, dy = (h - dh) / 2;
    ctx.globalAlpha = 0.10;           // bem fraca
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
  }

  function load(dataUrl) {
    if (!dataUrl) { img = null; draw(); return; }
    const i = new Image();
    i.onload = () => { img = i; draw(); };
    i.src = dataUrl;
  }

  window.addEventListener("resize", draw);

  window.FC_BG = {
    set(dataUrl) {
      try { localStorage.setItem(KEY, dataUrl); } catch (e) {
        alert("A foto ficou grande demais para salvar. Tente uma imagem menor.");
        return;
      }
      load(dataUrl);
    },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} load(null); },
    // Reduz a imagem antes de salvar (evita estourar o armazenamento)
    setFromFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        const i = new Image();
        i.onload = () => {
          const max = 1280;
          let w = i.width, h = i.height;
          if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(i, 0, 0, w, h);
          window.FC_BG.set(c.toDataURL("image/jpeg", 0.72));
        };
        i.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  };

  // Carrega a foto salva (se houver)
  try { const saved = localStorage.getItem(KEY); load(saved || null); } catch (e) { draw(); }
})();
