# ATLAS

Red team automatizado para o [Vendly](https://meuvendly.com.br) — um SaaS multi-empresa de atendimento para restaurantes (pedidos via WhatsApp com IA e gestão de mesas).

O ATLAS ataca uma **cópia de teste** do Vendly de vários jeitos e mede onde as defesas seguram e onde há o que corrigir. Cada ataque vira um achado com gravidade, passo de reprodução e correção sugerida.

> Construído para testar o meu próprio SaaS. O ATLAS se RECUSA a rodar contra um banco ou alvo que não pareçam de teste — ver [Travas de segurança](#travas-de-segurança-embutidas).

---

## Novidade: bateria de segurança de IA

O Vendly responde no WhatsApp com um bot de IA — e até agora o ATLAS só
testava a API, nunca o bot em si. A bateria `IA-01` a `IA-04` manda
**mensagens de texto**, como um cliente mal-intencionado mandaria, e mede se
o bot obedece instrução escondida no texto, se revela as próprias
instruções, se mistura dado de outra empresa na conversa, e se uma ação
sensível (cancelar pedido) pode ser disparada só por linguagem — sempre
conferindo o resultado real no banco, nunca confiando no que o bot *disse*
que fez.

Essa bateria é **opcional** (desligada por padrão) porque precisa de uma
peça a mais: como o bot responde de forma assíncrona (ele manda a resposta
pra Evolution API, que é o gateway de WhatsApp), o ATLAS sobe um **Evolution
falsa** local só pra capturar o que o bot tentaria mandar. Pra ligar:

```bash
ATLAS_EVOLUTION=on ALVO_URL=... DATABASE_URL=... node atlas.mjs
```

Isso sobe a Evolution falsa na porta `4001` (fixa, pra você configurar só
uma vez) e imprime a URL no início da rodada. **Antes de rodar**, aponte a
variável que o Vendly de teste usa pra falar com a Evolution (geralmente
`EVOLUTION_API_URL`) pra essa URL — só no ambiente de teste, nunca em
produção.

> **Suposição a confirmar**: assumi o formato oficial de envio de texto da
> Evolution API (`POST /message/sendText/:instance`). Se o seu Vendly chama
> de outro jeito, o ajuste é de uma linha em `src/evolution-falsa.mjs`
> (função `extrairEnvio`) — o resto da bateria não muda.

Se `ATLAS_EVOLUTION` não estiver ligado, essa bateria aparece como "pulada"
no relatório (com a instrução de como ligar), em vez de travar o ATLAS.

---

## O que mudou nesta versão (v2)

A v1 era um arquivo único (`atlas.mjs`, ~480 linhas). Esta versão reorganiza o mesmo projeto em módulos, corrige bugs reais e adiciona testes automatizados — sem mudar o visual do painel. Resumo rápido (detalhes técnicos em [`MUDANCAS.md`](MUDANCAS.md)):

- **Travas de segurança novas**: o ATLAS agora recusa rodar se `DATABASE_URL` não parecer um banco de teste, ou se `ALVO_URL` não for local/rede privada — evita o erro de rodar sem querer contra produção.
- **Veredito pela verdade do banco, não pela resposta da API**: as sondas de isolamento agora consultam o Postgres direto depois do ataque (em vez de confiar só no `status`/`ok` que a API devolveu).
- **4 sondas novas**: criar produto em outra empresa via mass assignment (`ISO-07`), força bruta sem limite de tentativas (`APP-05`), injeção SQL no login (`APP-06`) — e o webhook agora também é testado com um token *errado*, não só sem token.
- **Redação de segredos**: qualquer coisa que pareça hash, token ou senha é mascarada antes de ir pro relatório — importante porque o repositório é público.
- **Limpeza automática**: toda sonda que altera dado de teste (senha, produto plantado) desfaz a alteração sozinha, mesmo se a sonda quebrar no meio.
- **50 testes automatizados** (`npm test`) — cobrem as travas de segurança, cada sonda (inclusive provando que ela PEGA o bug quando ele existe de propósito), a análise de XSS, a geração do relatório/painel e a bateria de segurança de IA.
- **Código de saída** (0 limpo / 2 há vulnerabilidade / 3 só erro) — dá pra plugar no CI.

---

## Resultado da última rodada (contra o Vendly real)

| | |
|---|---|
| Testes executados | **10** |
| Defesas que seguraram | **10** |
| Pontos a corrigir | **0** |

Veja o relatório completo em [`RELATORIO.md`](RELATORIO.md) e o painel visual em [`painel.html`](painel.html). (Esses três arquivos de saída são gerados pelo `node atlas.mjs`; os que estão aqui no repositório são de uma rodada anterior — rode de novo pra atualizar.)

---

## O que o ATLAS testa

**Isolamento entre empresas (multi-tenant)** — a falha mais grave possível num SaaS: logado como a empresa A, conseguir ver ou mexer nos dados da empresa B.

- `ISO-01` Apagar pedido de outra empresa trocando o ID (IDOR)
- `ISO-02` Listar produtos vazando o cardápio de outra empresa
- `ISO-03` Alterar o estoque de um produto que é de outra empresa
- `ISO-04` Trocar a senha de outra empresa injetando campos no corpo da requisição
- `ISO-05` Forjar um token de sessão trocando o `empresaId` (com e sem assinatura)
- `ISO-06` Acessar rota protegida sem token
- `ISO-07` **(novo)** Criar produto dentro de outra empresa via mass assignment

**Segurança da aplicação**

- `APP-01` Webhook aceitando requisição sem autenticação (e com token errado)
- `APP-02` Política de senha aceitando senha fraca (curta ou comum)
- `APP-03` Cardápio público vazando campos internos (checado contra o banco de verdade)
- `APP-04` XSS armazenado via nome de produto no painel (análise estática aponta a linha)
- `APP-05` **(novo)** Login sem limite de tentativas (força bruta)
- `APP-06` **(novo)** Login com payload de injeção SQL

**Segurança de IA** *(opcional — ver seção acima)*

- `IA-01` Injeção de prompt — o bot obedece uma instrução escondida na mensagem do cliente
- `IA-02` O bot pode ser convencido a revelar seu prompt de sistema
- `IA-03` A conversa vaza dado (endereço, pedido) de outro cliente ou empresa
- `IA-04` Uma ação sensível (cancelar pedido) é executada só por linguagem, sem checar o dono

As categorias seguem o espírito do [OWASP Top 10 para LLM](https://owasp.org/www-project-top-10-for-large-language-model-applications/) e do [OWASP API Security Top 10](https://owasp.org/API-Security/).

---

## Como funciona

```
atlas.mjs                 runner: carrega config, semeia, roda as 2 baterias, grava a saída
src/
  config.mjs               lê o ambiente e aplica as travas de segurança
  senha.mjs                hash de senha (scrypt) e geração de senha aleatória por rodada
  http.mjs                 cliente fetch com timeout, sem seguir redirect
  cenario.mjs               dados do cenário de teste (2 empresas fictícias + 1 "vítima")
  nucleo.mjs                Rodada (registra achados, roda limpeza, calcula resumo), redação de segredos
  analise-estatica.mjs      varre admin.html em busca de innerHTML sem esc()
  adaptador-vendly.mjs      a ÚNICA peça que conhece o Vendly (rotas, login, formato do token)
  banco-pg.mjs              semeadura + consultas de "verdade absoluta" no Postgres de teste
  relatorios.mjs             gera RELATORIO.md e findings.json
  evolution-falsa.mjs        Evolution API falsa (só p/ a bateria de IA — ver seção acima)
  painel/
    css.mjs, js.mjs          visual do painel (idêntico ao da v1)
    gerar.mjs                monta o painel.html
  sondas/
    isolamento.mjs            bateria 1 (ISO-01 a ISO-07)
    appsec.mjs                 bateria 2 (APP-01 a APP-06)
    seguranca-ia.mjs            bateria 3 (IA-01 a IA-04, opcional)
test/
  *.test.mjs                  testes unitários (config, núcleo, análise de XSS, relatórios)
  sondas.integracao.test.mjs   sobe um Vendly falso e prova que cada sonda pega o bug certo
  sondas-ia.integracao.test.mjs igual, mas com bot de IA falso + Evolution falsa
  helpers/                     banco falso + Vendly falso (+ bot de IA) usados só nos testes
```

Para apontar o ATLAS a outro alvo no futuro: reescreva `src/adaptador-vendly.mjs` (e `src/banco-pg.mjs` se o banco não for Postgres). As sondas (`src/sondas/*`) não mudam.

---

## Travas de segurança embutidas

O ATLAS apaga tabelas e dispara ataques de verdade. Duas travas impedem que ele rode sem querer contra algo que não seja uma cópia de teste:

- **Banco**: `DATABASE_URL` precisa apontar pra um banco cujo nome contenha `test`, `teste` ou `atlas`. Pra usar outro nome, repita o nome exato em `ATLAS_CONFIRMO_BANCO=<nome>`.
- **Alvo**: `ALVO_URL` precisa ser `localhost` ou IP de rede privada (10.x, 172.16–31.x, 192.168.x). Pra atacar um host remoto (ex.: uma cópia de teste hospedada), repita o hostname exato em `ATLAS_ALVO_REMOTO_OK=<host>`.

Se qualquer uma falhar, o ATLAS para antes de tocar em qualquer dado e explica como confirmar.

---

## Como rodar

Pré-requisitos: uma cópia de **teste** do Vendly rodando e acesso ao banco de teste.

```bash
npm install

ALVO_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgres://usuario@host:5432/vendly_test \
ADMIN_HTML=../vendly-bot/public/admin.html \
WEBHOOK_TOKEN=token-que-voce-configurou-no-servidor \
node atlas.mjs
```

| Variável | O que é |
|----------|---------|
| `ALVO_URL` | Endereço da cópia de teste do Vendly (local ou rede privada) |
| `DATABASE_URL` | Banco de teste (precisa ter test/teste/atlas no nome) |
| `ADMIN_HTML` | *(opcional)* caminho do `admin.html` do Vendly — liga a checagem de XSS |
| `WEBHOOK_TOKEN` | *(opcional)* o mesmo token configurado no servidor — usado pra testar a variação "token errado" |
| `ATLAS_SAIDA` | *(opcional)* pasta onde gravar os 3 arquivos de saída (padrão: pasta atual) |
| `ATLAS_TENTATIVAS_BRUTE` | *(opcional)* tentativas de login na sonda de força bruta (padrão: 25) |
| `ATLAS_EVOLUTION` | *(opcional)* `on` liga a bateria de segurança de IA — ver seção acima |
| `ATLAS_EVOLUTION_PORTA` | *(opcional)* porta da Evolution falsa (padrão: 4001) |

A saída vai pro terminal e pra três arquivos: `RELATORIO.md`, `findings.json` e `painel.html`. Código de saída: `0` tudo defendido, `2` há vulnerabilidade, `3` só erro de execução.

### Testes

```bash
npm test
```

50 testes, sem precisar de Postgres nem do Vendly real — sobem um Vendly falso em memória (incluindo versões propositalmente vulneráveis, e um bot de IA falso pra bateria `IA-*`) pra provar que cada sonda detecta o bug certo.

---

## Painel visual

O `painel.html` é uma página independente que mostra o placar e a lista de achados (cada um abre com o esperado, o obtido e a correção). Abre em qualquer navegador, sem servidor.

---

## Por que esse projeto existe

Com a IA mudando a forma de programar, saber **atacar o próprio sistema e defendê-lo** vale tanto quanto saber construí-lo. O ATLAS é a minha forma de levar o Vendly a sério como produto: pensar como atacante, achar as falhas antes que alguém de fora ache, corrigir e comprovar.
