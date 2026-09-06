#!/usr/bin/env python3
"""
build-icons.py — desenha os ícones do app.

Os ícones antigos eram um "FC" azul num quadrado quase preto, do visual que
o app tinha antes. Agora o app é claro e o ícone é o mesmo desenho da aba
Futuro: barras brancas num azul do sistema.

    python3 build-icons.py

Gera em web/assets/icons/:
  icon-192.png / icon-512.png       ícone comum, cantos arredondados
  icon-maskable-512.png             para o Android recortar como quiser
  apple-touch-icon.png              180x180, sem transparência (iOS)
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

AZUL = (0, 122, 255, 255)      # azul de ação do iOS
BRANCO = (255, 255, 255, 255)
DESTINO = Path(__file__).resolve().parent / "web" / "assets" / "icons"

# Barras: (x inicial, altura), em fração do lado útil do desenho.
BARRAS = [(0.00, 0.46), (0.37, 0.78), (0.74, 0.62)]
LARGURA_BARRA = 0.26


def desenha(lado: int, escala_glifo: float, raio: float | None) -> Image.Image:
    """Um ícone de `lado` pixels. `escala_glifo` é o quanto o desenho ocupa.
    `raio` None faz o quadrado inteiro, sem cantos arredondados."""
    # Desenha grande e reduz no fim: é o antisserrilhado do pobre, e funciona.
    s = lado * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if raio is None:
        d.rectangle([0, 0, s, s], fill=AZUL)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * raio), fill=AZUL)

    # O glifo vive num quadrado centrado.
    campo = s * escala_glifo
    x0 = (s - campo) / 2
    base = (s + campo) / 2                      # linha do chão das barras
    largura = campo * LARGURA_BARRA
    for fx, altura in BARRAS:
        x = x0 + campo * fx
        topo = base - campo * altura
        d.rounded_rectangle([x, topo, x + largura, base],
                            radius=largura * 0.22, fill=BRANCO)

    return img.resize((lado, lado), Image.LANCZOS)


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    saidas = [
        ("icon-192.png", 192, 0.60, 0.22),
        ("icon-512.png", 512, 0.60, 0.22),
        # Maskable: o Android corta as beiradas, então o desenho encolhe e o
        # azul vai até a borda.
        ("icon-maskable-512.png", 512, 0.44, None),
        # iOS já arredonda sozinho e não aceita transparência.
        ("apple-touch-icon.png", 180, 0.60, None),
    ]
    for nome, lado, glifo, raio in saidas:
        img = desenha(lado, glifo, raio)
        if nome == "apple-touch-icon.png":
            fundo = Image.new("RGB", (lado, lado), AZUL[:3])
            fundo.paste(img, (0, 0), img)
            img = fundo
        img.save(DESTINO / nome)
        print(f"{nome}: {lado}x{lado}")


if __name__ == "__main__":
    main()
