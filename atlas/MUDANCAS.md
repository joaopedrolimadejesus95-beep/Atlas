# ATLAS — o que mudou da v1 pra v2

Resumo técnico das mudanças pedidas: corrigir bugs, limpar o código, reduzir
risco de segurança do próprio ATLAS e testar tudo. A v1 inteira virou 1
arquivo de ~480 linhas; aqui está organizada em módulos, mas o comportamento
e o visual do painel continuam os mesmos — só ficou mais seguro e mais fácil
de dar manutenção.

## 1. Bugs reais corrigidos

- **O veredito confiava só na resposta da API.** Em `ISO-01` (apagar pedido)
  e `ISO-03` (alterar estoque), a v1 só olhava o `status`/`ok` que a própria
  API devolvia. Se a rota mentisse (`ok:false` mas apagasse mesmo assim), o
  ATLAS diria "defendido" sem checar o banco. Agora as duas sondas consultam
  o Postgres direto depois do ataque — a mesma fonte de verdade que uma
  investigação de incidente usaria.
- **ISO-05 (token forjado) só testava uma variação.** A v1 só trocava o
  payload mantendo a assinatura original. Um servidor que aceitasse token
  *sem* assinatura, ou com assinatura vazia, passava batido. Agora são 4
  variações.
- **APP-01 (webhook) só testava "sem token".** Não testava "com token
  errado" — um servidor que aceitasse qualquer header, mesmo errado, passava
  no teste da v1. Corrigido.
- **APP-02 (senha fraca) só testava um valor ('1234').** Agora testa várias,
  incluindo senhas "fortes" só na contagem de caracteres (`password`,
  `aaaaaaaa`), que é o erro mais comum de política de senha.
- **APP-03 (exposição pública) comparava só contra uma regex.** Isso
  permitia falso-negativo se o nome de um campo mudasse. Agora compara o
  texto da resposta contra os segredos *reais* do banco (hash, salt,
  instância daquela empresa específica).
- **Credenciais fixas no código-fonte.** A v1 tinha `burger1234`,
  `pizza1234` etc. hardcoded. Se o repositório for público (é — tem link no
  README), isso é uma senha previsível publicada. Agora cada rodada gera
  senha aleatória nova.
- **`semear()` sem transação.** Se o processo caísse no meio do `DELETE`
  das 6 tabelas, o banco de teste ficava pela metade. Agora tudo roda numa
  transação (`BEGIN`/`COMMIT`/`ROLLBACK`).
- **Uma sonda que quebra podia deixar lixo no alvo.** Ex.: `ISO-04` troca a
  senha da Burger A e troca de volta no fim da função — se o `await` do
  meio lançasse exceção, a senha nunca voltava. Agora toda sonda que muda
  estado declara uma função de limpeza que roda sempre, mesmo em erro
  (`try/finally`).

## 2. Falhas de segurança do próprio ATLAS (não do Vendly)

- **Sem trava de alvo/banco.** Nada impedia copiar a variável de ambiente
  errada de outro terminal e rodar `node atlas.mjs` com `DATABASE_URL`
  apontando pro banco de produção. O ATLAS APAGA tabelas antes de semear.
  Agora (`src/config.mjs`): o nome do banco precisa conter `test`, `teste`
  ou `atlas`, e o alvo precisa ser `localhost`/rede privada — cada trava só
  é contornável repetindo o valor exato numa variável de confirmação
  separada (não dá pra copiar isso sem querer).
- **Relatório podia vazar segredo de verdade.** Se uma sonda de exposição de
  dados encontrasse o hash de senha na resposta pública, a v1 colocava esse
  hash cru no `RELATORIO.md`/`findings.json` — que são versionados e podem
  ir pro GitHub. Agora todo texto que vira achado passa por uma função de
  redação que mascara Bearer tokens, tokens tipo JWT, hashes hex longos e
  qualquer `"senha"/"token"/"hash"` em JSON.
- **Nenhum teste de força bruta ou de injeção.** O ATLAS testava isolamento
  e XSS, mas não testava se o login aceita tentativas infinitas nem se
  aceita payload de SQL injection. Adicionados `APP-05` e `APP-06`.
- **Mass assignment só era testado na troca de senha.** A mesma classe de
  bug (campo extra no corpo sobrescrevendo o dono do registro) podia existir
  na criação de produto e não era testada. Adicionado `ISO-07`.
- **Cliente HTTP sem timeout e seguindo redirect.** Um alvo travado
  derrubava a rodada inteira; um redirect malicioso podia levar o próprio
  ATLAS a atacar outro host sem perceber. `src/http.mjs` agora usa
  `AbortSignal.timeout` e `redirect: "manual"`.

## 3. Código limpo / organização

- Arquivo único de 480 linhas → módulos por responsabilidade (ver árvore no
  README). Cada peça dá pra ler, testar e trocar sozinha.
- `src/adaptador-vendly.mjs` continua sendo a ÚNICA peça que conhece rotas e
  formato de token do Vendly — igual a v1 já promovia, só que agora isso é
  garantido pela estrutura dos arquivos, não só por um comentário.
- CSS e JS do painel foram extraídos para `src/painel/css.mjs` e
  `src/painel/js.mjs` **sem alterar uma linha** do conteúdo original — o
  visual do painel é pixel-a-pixel o mesmo.
- `erro` (sonda quebrou) nunca mais é contado como `defendido` no resumo —
  na v1 isso já era separado corretamente, mantido e testado agora.
- Resultado novo `pulado`: quando uma checagem opcional não tem
  pré-requisito (ex.: `APP-04` sem `ADMIN_HTML`), o achado aparece como
  "pulado" em vez de silenciosamente não aparecer ou contar como erro.
- Código de saída do processo (`0`/`2`/`3`) pra integrar com CI.

## 4. Testes (35, `npm test`, sem precisar de Postgres nem do Vendly real)

- `test/config.test.mjs` — as travas de segurança (banco de produção e alvo
  remoto são recusados; overrides exigem o nome exato).
- `test/nucleo.test.mjs` — `Rodada` (defendido/VULNERAVEL/erro/pulado,
  limpeza mesmo com exceção, código de saída), a função de redação de
  segredos e a ordenação do relatório.
- `test/analise-estatica.test.mjs` — o detector de XSS sem `esc()`.
- `test/relatorios.test.mjs` — Markdown, JSON e o painel HTML escapam
  corretamente título/achado malicioso (um teste garante que um XSS *no
  próprio relatório* não quebra o painel).
- `test/sondas.integracao.test.mjs` — o mais importante: sobe um Vendly
  falso de verdade em HTTP (não é mock de `fetch`) em vários modos
  `vulneravel-*` (um bug ligado por vez) e prova que cada sonda PEGA o bug
  quando ele existe — não só que ela passa no caminho feliz.

## 5. Bateria nova: segurança de IA (`IA-01` a `IA-04`, opcional)

Até aqui o ATLAS testava a API, nunca o bot que de fato conversa com o
cliente no WhatsApp — apesar do README já citar o OWASP Top 10 pra LLM.
Adicionei uma terceira bateria que ataca o bot por **mensagem de texto**:

- `IA-01` injeção de prompt (instrução escondida na mensagem do cliente,
  usando uma "senha canário" pra detectar com certeza se o bot obedeceu —
  mais confiável que procurar palavra-chave solta).
- `IA-02` extração do prompt de sistema (heurístico — o relatório já avisa
  que vale revisão manual).
- `IA-03` vazamento de dado de outro cliente/empresa pela conversa.
- `IA-04` ação sensível (cancelar pedido) executada só por linguagem — aqui,
  como em todas as sondas de isolamento, o veredito vem do banco, nunca do
  que o bot respondeu em texto.

Como o bot responde de forma assíncrona (manda a resposta pra Evolution
API, não devolve no corpo da requisição), criei uma **Evolution API falsa**
local (`src/evolution-falsa.mjs`) só pra capturar o que o bot tentaria
mandar — é assim que dá pra testar um bot assíncrono sem precisar de
WhatsApp de verdade. Essa bateria é opcional e desligada por padrão
(`ATLAS_EVOLUTION=on` liga); sem isso, ela aparece como "pulada" no
relatório em vez de quebrar o ATLAS.

**Importante**: eu não tenho o código-fonte do Vendly, só o que as sondas
originais já revelavam (o campo `evolution_instance` e o formato do
webhook). Assumi o formato oficial de envio de texto da Evolution API
(`POST /message/sendText/:instance`) — é o padrão documentado, mas se o seu
bot chamar a Evolution de um jeito diferente, o ajuste é só na função
`extrairEnvio()` de `src/evolution-falsa.mjs`; o resto da bateria (as 4
sondas) não precisa mudar.

## O que eu NÃO mudei

- O visual e o comportamento do painel (`painel.html`) são os mesmos da v1.
- As 10 sondas originais continuam testando exatamente a mesma coisa (com
  os bugs corrigidos acima); só acrescentei 3 novas (`ISO-07`, `APP-05`,
  `APP-06`) e reforcei `ISO-05`/`APP-01`/`APP-02`/`APP-03`.
- O formato de `findings.json` e a estrutura do `RELATORIO.md` continuam
  compatíveis com o que já existia (só ganharam o resultado `pulado`).
