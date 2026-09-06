#!/usr/bin/env python3
"""
build-html.py — junta o app de web/ num arquivo HTML só.

O app mora em web/ (index.html + css + js), que é o que vai para o ar.
Este script gera controle-financeiro.html: mesmo app, tudo dentro de um
arquivo, para abrir com dois cliques, mandar por e-mail ou guardar no
celular. Aberto assim (file://) ele roda sozinho, guardando os dados no
próprio navegador, sem login.

    python3 build-html.py

Só o pdf.js e o supabase-js continuam vindo da internet: são grandes
demais para embutir, e sem eles o resto do app funciona igual.
"""
import re
import base64
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
WEB = RAIZ / "web"
SAIDA = RAIZ / "controle-financeiro.html"


def le(caminho: Path) -> str:
    return caminho.read_text(encoding="utf-8")


def main() -> None:
    html = le(WEB / "index.html")

    # A folha de estilo vira <style> no lugar do <link>.
    css = le(WEB / "css" / "app.css")
    html = re.sub(
        r'<link rel="stylesheet" href="css/app\.css[^"]*">',
        "<style>\n" + css + "\n</style>",
        html,
    )

    # Sem manifest: ele só faz sentido servido por um endereço, e num arquivo
    # local daria erro no console. (O service worker já se cala sozinho fora
    # do http, então não precisa de corte.)
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)

    # Os ícones viram data: URI, senão o arquivo solto apontaria para uma
    # pasta assets/ que não viajou com ele.
    def embute_icone(m):
        rel, arquivo = m.group(1), WEB / m.group(2)
        dados = base64.b64encode(arquivo.read_bytes()).decode("ascii")
        return f'<link rel="{rel}" href="data:image/png;base64,{dados}"' + (
            ' type="image/png">' if rel == "icon" else ">")

    html = re.sub(r'<link rel="(apple-touch-icon|icon)" href="(assets/[^"]+)"[^>]*>',
                  embute_icone, html)

    # Cada <script src="js/..."> vira o próprio código.
    #
    # O config sai sem as credenciais do Supabase de propósito: o arquivo
    # solto é uma cópia que roda sozinha, guardando tudo no navegador. Com as
    # credenciais dentro, abri-lo por um endereço http faria aparecer a tela
    # de login por cima de tudo — e ainda mandaria a chave junto em cada
    # cópia que você compartilha.
    def embute(m):
        arquivo = WEB / m.group(1)
        codigo = le(arquivo).rstrip()
        if arquivo.name == "config.js":
            codigo = re.sub(r'(SUPABASE_URL|SUPABASE_ANON_KEY):\s*"[^"]*"',
                            r'\1: ""', codigo)
        return "<script>\n" + codigo + "\n</script>"

    html = re.sub(r'<script src="(js/[^"?]+)[^"]*"></script>', embute, html)

    # Marca de onde saiu, para não confundir com o painel antigo.
    html = html.replace(
        "<title>FinControl</title>",
        "<title>FinControl</title>\n"
        "<!-- Gerado por build-html.py a partir de web/. Não edite aqui: edite web/ e gere de novo. -->",
    )

    SAIDA.write_text(html, encoding="utf-8")
    kb = SAIDA.stat().st_size / 1024
    print(f"{SAIDA.name}: {kb:.0f} KB")


if __name__ == "__main__":
    main()
