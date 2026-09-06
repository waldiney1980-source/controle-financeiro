# FinControl AI — Controle Financeiro Pessoal e Familiar

Sistema completo de gestão financeira pessoal e familiar com dashboard web (PWA),
banco de dados Supabase (PostgreSQL), importação de extratos e inteligência financeira
(previsão de fluxo de caixa, categorização automática e sugestões de economia).

> Status: **MVP em construção** · Stack: HTML5 + CSS3 + JavaScript puro (sem build) + Supabase

---

## 1. Visão geral

O FinControl AI centraliza toda a vida financeira da família em um só lugar:

- **Contas, cartões, investimentos, empréstimos e assinaturas** cadastrados e conciliados.
- **Receitas e despesas** recorrentes e eventuais, com parcelamentos.
- **Importação de extratos** (CSV, XLSX, OFX) e faturas de cartão, com categorização automática.
- **Planejamento**: projeção de saldo para 30/90/180/365 dias, simulação de cenários e alertas de risco.
- **Inteligência financeira**: padrões de consumo, previsão de gastos por categoria e metas automáticas.
- **Dashboards e indicadores**: receita x despesa, evolução patrimonial, taxa de poupança, comprometimento de renda, reserva de emergência.

## 2. Arquitetura (resumo)

```
┌─────────────────────────────────────────────────────────────┐
│  Cliente (PWA) — HTML5 + CSS3 + JS puro                      │
│  • Dashboard, cadastros, importador CSV/OFX, projeções      │
│  • Service Worker (offline) + manifest (instalável)         │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS (supabase-js via CDN)
┌───────────────▼─────────────────────────────────────────────┐
│  Supabase                                                    │
│  • Auth (e-mail/senha, recuperação)                          │
│  • PostgreSQL + Row Level Security (isolamento por usuário)  │
│  • Views e funções SQL (KPIs, projeções, categorização)     │
│  • Storage (comprovantes, arquivos importados)              │
└─────────────────────────────────────────────────────────────┘
```

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## 3. Estrutura de pastas

```
controle-financeiro/
├── README.md                  ← este arquivo
├── .gitignore
├── docs/
│   ├── ARQUITETURA.md         ← arquitetura, decisões técnicas, segurança
│   ├── MODELO-DADOS.md        ← dicionário de dados (tabelas e colunas)
│   ├── DIAGRAMA-ER.md         ← diagrama entidade-relacionamento (Mermaid)
│   └── ROADMAP.md             ← MVP → versão profissional
├── supabase/
│   ├── 01_schema.sql          ← tabelas, tipos, índices
│   ├── 02_rls_policies.sql    ← Row Level Security (isolamento por usuário)
│   ├── 03_functions_views.sql ← funções, views e triggers (KPIs, projeções)
│   └── 04_seed.sql            ← dados iniciais (categorias padrão)
└── web/
    ├── index.html             ← app single-page (PWA)
    ├── manifest.webmanifest
    ├── sw.js                  ← service worker (offline)
    ├── css/app.css
    ├── js/
    │   ├── config.js          ← credenciais Supabase (não commitar as reais)
    │   ├── supabaseClient.js   ← inicialização do cliente
    │   ├── auth.js            ← login (Supabase Auth)
    │   ├── store.js           ← estado + camada de dados (Supabase ou local)
    │   ├── bills.js           ← contas a pagar (competência, vencimento, pago)
    │   ├── fatura.js          ← leitura do PDF da fatura e expansão das parcelas
    │   ├── migrar.js          ← traz os dados do painel-fatura antigo
    │   └── ui.js              ← as três telas
    └── assets/icons/
```

### 3.1 As telas

| Tela | Para quê |
|---|---|
| **Mês** | Quanto sobra e quanto cabe por dia, com o mês em três números ao lado (cartão, fora do cartão e o que ainda falta pagar), para onde o dinheiro vai e as contas a pagar (com marcar pago). |
| **Lançamentos** | Tudo do mês numa lista só — fatura, parcelas, contas e o que foi digitado. É onde se lança um gasto e se importa a fatura, em PDF, em .txt ou colando o texto. |
| **Conta** | O que entra e o que sai sem passar no cartão: receitas (avulsas ou todo mês), despesas fora da fatura e as contas a pagar, com o saldo do mês. |
| **Investir** | O que você já guardou: aplicações com valor de hoje e valor aplicado, rendimento, aporte mensal e, o número que importa, quantos meses do seu gasto essa reserva cobre. |
| **Economia** | Onde dá para cortar, calculado dos seus próprios lançamentos: cobrança repetida na fatura, assinatura em dobro, o peso das assinaturas por ano, corrida de aplicativo e comida por app, onde o dinheiro foi e quando as parcelas aliviam. |
| **Futuro** | Dash de previsão que começa sempre no mês corrente, não no mês escolhido nas outras telas: quanto já está comprometido em 12 meses, qual mês aperta mais, quanto ainda falta de parcelas, a tabela mês a mês, o gráfico e quando cada parcela acaba. |

A fatura entra de três jeitos, em **Lançamentos → Importar**:

- **PDF**, lido pelo pdf.js.
- **Arquivo .txt** (ou .csv), o extrato salvo em texto.
- **Colando o texto** direto na caixa, o que você copia do aplicativo do banco.

Os três passam pelo mesmo leitor: ele acha o vencimento, separa as compras dos
estornos, reconhece "PARC 08/10" e joga as parcelas que faltam nos meses seguintes.
O que importa é uma linha por lançamento, começando pela data.

Importar uma fatura substitui aquela competência daquele cartão, mas **não** mexe nas
parcelas projetadas por uma fatura mais nova: mandar a fatura de agosto depois da de
setembro não pode varrer as parcelas que setembro já lançou para o ano inteiro.

Cada fatura vai para o **seu** cartão: o app lê o número que vem escrito no arquivo
("Nr.Cartão : 6516.****.****.1082") e casa pelo final; se for um cartão novo, cadastra
sozinho com o nome da modalidade ("OUROCARD ELO NANQUIM"). Sem isso, duas faturas de
cartões diferentes caíam no mesmo cadastro e, como importar substitui a competência
inteira daquele cartão, a segunda apagava a primeira. Com dois ou mais cartões, o nome
aparece ao lado de cada lançamento, e as somas do mês juntam todos.

O extrato do Banco do Brasil (Auto-Atendimento → Fatura do Cartão de Crédito, salvo
em .txt) foi o caso que guiou o leitor, e ele traz três armadilhas já tratadas:

- vem em **ISO-8859-1**, não em UTF-8 (lido como UTF-8, todo acento vira lixo);
- imprime **duas colunas de valor**, "Valor R$" e depois "Valor US$", quase sempre
  zerada — pegar o último número da linha zerava a fatura inteira;
- **não escreve o vencimento** em lugar nenhum. Nesse caso o app não pergunta: para a
  fatura ainda aberta usa o mês em que o extrato foi tirado, senão o mês da compra mais
  recente, importa, e avisa qual mês usou. O campo **Competência** da folha corrige, e
  o que você escolhe ali manda em tudo; reimportar com o mês certo **move** a fatura,
  em vez de deixar duas. O dia do vencimento fica num campo da própria folha e é
  guardado no cartão, para as parcelas caírem no dia certo.

A folha de lançamento abre com os dois grupos à mostra, **Cartão** e **Despesa**, em
vez de um menu que esconde a segunda opção: é a primeira decisão do lançamento, e o
rodapé da folha explica o que cada grupo significa. Cartão vai para a fatura; Despesa
sai da conta por boleto, PIX, débito ou dinheiro.

No grupo Despesa vem a segunda pergunta: **ainda vou pagar** ou **já paguei**. A
primeira vira conta a pagar, com vencimento e a bolinha para marcar; a segunda é
dinheiro que já saiu. Telefone, energia e internet caem no primeiro caso, e era isso
que faltava para eles aparecerem onde se procura por eles.

Tocar no nome abre para editar, tanto a conta quanto a despesa. Na despesa, mudar de
"já paguei" para "ainda vou pagar" a converte em conta a pagar, com vencimento e a
bolinha de marcar: não é preciso apagar e digitar tudo de novo.

Na tela Mês, o bloco "Fora do cartão" mostra as duas coisas na mesma lista, cada linha
com o seu ✕. A lista dentro de "Para onde vai" também apaga, que é onde se enxerga a
despesa lançada em dobro.

Na tela Mês, cada linha de "Para onde vai" abre e mostra os lançamentos que formam
aquele número, com as mesmas regras que somam o total. É como se confere se a conta
fecha, e foi assim que apareceu a assinatura contada duas vezes descrita abaixo.

O olho no alto da tela esconde todos os valores, como no aplicativo do banco: dinheiro
vira `R$ ●●●●` em todas as telas, inclusive no gráfico e na receita fixa (que vira
campo de senha, sem perder o valor). A escolha fica guardada **neste aparelho**, não no
cofre: dá para esconder no computador do trabalho e mostrar no celular.

Ao lançar um gasto dá para dizer o que ele faz nos meses seguintes:

- **Não se repete** — fica só naquele mês.
- **Volta todo mês, sem prazo** — assinatura, mensalidade, academia. Repete sozinho para a frente e entra na previsão.
- **É parcelado, tem fim** — informe em quantas vezes e o valor de cada parcela. O app cria uma despesa por mês até a última, dentro ou fora do cartão.

Todo lançamento é gravado na hora, sem a folga de meio segundo que o app usava para
juntar gravações: fechar a tela logo depois de lançar apagaria o que acabou de ser
feito. E cada lançamento responde com um aviso curto dizendo o que entrou **e em que
mês** — é o que denuncia a despesa que foi para outubro quando você achava que era
setembro.

A aba Investir não fala com corretora nenhuma: você diz o que tem e quanto vale hoje,
e o app cruza com o resto. A reserva de emergência é medida em **meses do seu gasto
típico** (a média dos meses já lançados), com meta de seis meses e o prazo estimado
pelo aporte mensal. Registrar um aporte soma na aplicação e, se você quiser, lança a
saída no mês, que é o que mantém a sobra honesta.

A linha verde da renda no gráfico acompanha o mês, em degraus, porque a renda pode
mudar de um mês para o outro. Uma linha reta com o valor de um mês só dizia "renda 30k"
enquanto a tabela ao lado mostrava 29.500 no mês seguinte.

A receita funciona igual: lançada como **entra todo mês**, ela se repete sozinha para
a frente e entra na previsão; lançada como **só desta vez** (13º, aluguel recebido, um
extra), vale só naquele mês. Quem tem apenas salário fixo pode continuar escrevendo um
número no campo "Receita fixa mensal" da aba Conta — ele vale para todos os meses e
deixa de contar assim que existir uma receita marcada como mensal, para não somar duas
vezes.

Conta a pagar tem o mesmo tratamento: marcada como mensal, ela reaparece todo mês com
o seu vencimento, e o valor pode ser corrigido só no mês que mudou (luz e água) ou em
todos de uma vez.

### 3.2 Instalar no celular e no computador (PWA)

O app em `web/` é um PWA: publicado num endereço `https`, ele instala como
aplicativo, abre em tela cheia sem barra de navegador e continua abrindo sem
internet (o service worker guarda uma cópia dos arquivos).

- **Publicar:** o `netlify.toml` já aponta para `web/`, sem etapa de build. Qualquer
  hospedagem estática serve, desde que seja `https` (exigência do service worker).
- **iPhone/iPad:** abra no Safari, toque em Compartilhar e em *Adicionar à Tela de Início*.
- **Android:** o Chrome oferece *Instalar aplicativo* sozinho.
- **Computador:** ícone de instalar na barra de endereço do Chrome ou do Edge.

Segurando o ícone na tela de início aparecem dois atalhos: **Lançar gasto**, que já
abre a folha de lançamento, e **Futuro**, que abre a previsão.

Ao abrir, o app pergunta ao servidor qual é a versão publicada. Sendo outra, ele limpa
o cache, descarta o service worker antigo e recarrega uma vez, avisando na tela. Isso
existe porque dava para ficar dias olhando uma versão guardada sem perceber, achando
que um defeito não tinha sido corrigido. A etiqueta da versão no alto continua servindo
para forçar na mão.

### 3.3 Arquivo único, para abrir com dois cliques

O app de verdade é o PWA em `web/` (é ele que vai para o ar e sincroniza com o
Supabase). Para ter o mesmo app num arquivo só, que abre com dois cliques e roda
sem servidor e sem login:

```bash
python3 build-html.py
```

Isso gera `controle-financeiro.html` juntando `web/index.html`, o CSS e os scripts.
Aberto assim ele guarda tudo no navegador daquele aparelho, sem Supabase: é uma
cópia solta, não o cofre da família. A fonte continua sendo `web/` — edite lá e
gere de novo.

Quem usava o painel de arquivo único (`painel-fatura-*.html`) traz tudo para cá em
**Lançamentos → Importar → Trazer de fora**: aceita o `.html` (ou o `.json` exportado
dele) e também procura o que ficou guardado no navegador. Nada é apagado: o que já
está no app é pulado, e rodar duas vezes não duplica. A mesma tela tem **Baixar meus
dados**, que grava um `.json` com tudo e volta pelo mesmo caminho.

## 4. Como rodar (MVP local)

O MVP roda **100% no navegador**, sem instalar nada. Por enquanto usa dados de
demonstração em `localStorage` (modo offline). A integração com Supabase é opcional
e ativada preenchendo `web/js/config.js`.

**Windows (recomendado, sem Python/Node):** clique com o botão direito em
`serve.ps1` → *Executar com PowerShell*. Ele sobe um servidor local e abre o
navegador em `http://localhost:5173` automaticamente.

Ou, se tiver Python/Node instalados:

```bash
python -m http.server 5173 --directory web
```

```bash
npx serve web
```

Depois acesse `http://localhost:5173`.

> Abrir o `index.html` com duplo clique também funciona para a maioria das telas,
> mas o Service Worker (offline/PWA) exige servir via `http://` ou `https://`.

## 5. Integração com Supabase (opcional no MVP)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, rode em ordem: `supabase/01_schema.sql`, `02_rls_policies.sql`, `03_functions_views.sql`, `04_seed.sql`.
3. Copie a **Project URL** e a **anon key** (Settings → API) para `web/js/config.js`.
4. Recarregue o app: ele passa a ler/gravar no Supabase com login por e-mail/senha.

> A `anon key` é pública por design — a segurança vem do **Row Level Security** (RLS),
> que garante que cada usuário só enxerga os próprios dados. Nunca exponha a `service_role key`.

## 6. Roadmap

Ver [`docs/ROADMAP.md`](docs/ROADMAP.md). Resumo:

- **Fase 1 — MVP (atual):** dashboard, receitas/despesas, cartões, orçamento, metas, projeção simples, importação CSV.
- **Fase 2 — Integração:** Supabase (auth + RLS), importação OFX/XLSX, categorização com aprendizado, PWA instalável.
- **Fase 3 — Profissional:** investimentos, patrimônio, simulador de cenários, alertas, relatórios avançados, planilha Excel sincronizada.

## 7. Segurança

- Autenticação via Supabase Auth (e-mail/senha + recuperação).
- Isolamento total por usuário via RLS em todas as tabelas.
- Dados sensíveis (nº de conta/cartão) armazenados mascarados; segredos nunca vão ao repositório.
- Ver [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) seção *Segurança*.

## 8. Licença

Uso pessoal. Defina a licença antes de publicar (sugestão: MIT ou privado).
