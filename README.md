# ATLAS — Automated Red Team Framework for Multi-Tenant SaaS & AI Agents

[![ATLAS Security CI](https://github.com/joaopedrolimadejesus95-beep/Atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/joaopedrolimadejesus95-beep/Atlas/actions/workflows/ci.yml)
![Node.js LTS](https://img.shields.io/badge/Node.js-LTS-339933?logo=node.js&logoColor=white)
![Testes Automatizados](https://img.shields.io/badge/Testes-58%20passando-10B981)
![Dependências Externas UI](https://img.shields.io/badge/Painel_UI-100%25_Offline--First-2563EB)

> **Framework de Red Team automatizado para SaaS Multi-Tenant e Agentes de IA — 3 baterias de ataque (17 sondas), validação direto no banco de dados (*ground truth / verdade absoluta*), histórico de evolução temporal e 58 testes automatizados sem falsos positivos.**

O **ATLAS** executa ataques controlados contra uma cópia de teste isolada de um SaaS (como o [Vendly](https://meuvendly.com.br) ou qualquer outro alvo conectado via adaptador) e comprova matematicamente onde as defesas seguram e onde existem falhas reais de isolamento, AppSec ou segurança de LLMs.

---

## 📸 Preview do Console (`painel.html`)

<!-- ======================================================================= -->
<!-- ESPAÇO PARA SCREENSHOT / GIF DO PAINEL                                  -->
<!-- Substitua o caminho abaixo pelo GIF ou print do novo painel.html:       -->
<!-- ![ATLAS Security Console](./docs/atlas-console-preview.gif)             -->
<!-- ======================================================================= -->

> 🖼️ **[Espaço reservado para GIF / Screenshot do `painel.html`]**  
> *Para visualizar o painel interativo agora mesmo (com Bento Grid, Gráfico SVG de evolução, Abas por Bateria, Tema Claro/Escuro, Modo Apresentação e Exportar PDF), abra o arquivo [`painel.html`](./painel.html) em qualquer navegador.*

---

## ⚡ Leitura de 30 Segundos (Destaques de Engenharia)

- **Veredito pela Verdade do Banco (*Ground Truth*):** Em vez de confiar no status HTTP ou no texto que a API/IA respondeu, o ATLAS consulta o banco de dados diretamente após cada ataque para provar se um registro de outro tenant foi apagado, lido ou adulterado.
- **3 Baterias de Ataque Alinhadas ao OWASP (API Top 10 & LLM Top 10):**
  - **Isolamento Multi-Tenant (`ISO-01` a `ISO-07`):** IDOR em pedidos/estoque, vazamento de catálogo entre empresas, mass assignment em troca de senha e criação de recursos, e falsificação de tokens HMAC (4 variações).
  - **AppSec (`APP-01` a `APP-06`):** Autenticação de webhooks, política de senhas fracas/comuns, vazamento de hashes/segredos em rotas públicas, XSS armazenado (análise estática de sinks `innerHTML` sem escape), força bruta e SQL Injection.
  - **Segurança de IA / LLMs (`IA-01` a `IA-04`):** Prompt injection validado por *canary token*, vazamento de system prompt, exfiltração cross-tenant via conversa e execução não autorizada de ações sensíveis (cancelamento de pedidos por linguagem natural) usando um servidor **Evolution API falso** local.
- **Travas de Segurança Anti-Produção (`src/config.mjs`):** Recusa-se a rodar caso o banco não contenha `test`/`teste`/`atlas` no nome ou caso o alvo não seja `localhost`/rede privada, exigindo confirmação explícita e nominal para overrides.
- **Redação Automática de Segredos (`src/nucleo.mjs`):** Mascaramento automático de Bearer tokens, JWTs, hashes hexadecimais e senhas antes de persistir relatórios ou histórico em disco.
- **Persistência de Histórico & Evolução Temporal (`historico/`):** Cada rodada salva seu snapshot sanitizado em `historico/YYYY-MM-DD_HH-mm-ss.json` e plota a evolução (ex.: `de 8/10 para 10/10`) no Markdown e no gráfico SVG do painel.

---

## 🚀 Como Rodar em 1 Comando

### 1. Executar toda a suíte de testes (sem precisar de Postgres ou servidor externo)
Os **58 testes** sobem servidores HTTP e bots de IA falsos em memória (incluindo modos propositalmente vulneráveis) para provar que cada sonda detecta exatamente o bug para o qual foi desenhada:

```bash
npm test
```

### 2. Executar o segundo adaptador de demonstração em memória
Prova que o núcleo do ATLAS é agnóstico ao Vendly:

```bash
node examples/adaptador-bot-exemplo.mjs
```

### 3. Executar contra uma cópia de teste real do alvo

```bash
ALVO_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgres://postgres@127.0.0.1:5432/vendly_test \
ADMIN_HTML=../vendly/public/admin.html \
WEBHOOK_TOKEN=token-de-teste \
ATLAS_EVOLUTION=on \
node atlas.mjs
```

#### Flags de CLI (`util.parseArgs`)
```bash
node atlas.mjs --ajuda      # Exibe ajuda completa
node atlas.mjs --so-json    # Gera apenas findings.json (ideal para pipelines de CI)
node atlas.mjs --sem-xss    # Pula a análise estática de XSS (APP-04)
node atlas.mjs --sem-ia     # Desativa a bateria de segurança de IA (IA-01 a IA-04)
```

**Códigos de saída para CI/CD:** `0` (100% defendido) · `2` (vulnerabilidade detectada) · `3` (erro de execução).

---

## 🧩 Arquitetura e Como Criar um Novo Adaptador

```text
atlas.mjs                         Runner CLI (parseArgs, semeadura, baterias e saída)
src/
  nucleo.mjs                      Motor de execução (Rodada, limpeza garantida, redação de segredos)
  config.mjs                      Travas de segurança anti-produção e flags de CLI
  relatorios.mjs                  Gerador de RELATORIO.md, findings.json e persistência em historico/
  painel/                         Dashboard SaaS offline-first (gerar.mjs, css.mjs, js.mjs)
  sondas/                         Baterias desacopladas: isolamento.mjs, appsec.mjs, seguranca-ia.mjs
  adaptador-vendly.mjs            Adaptador HTTP + Auth + Webhook para o Vendly
  banco-pg.mjs                    Consultas de ground truth e semeadura transacional no Postgres
  evolution-falsa.mjs             Gateway WhatsApp simulado para capturar respostas assíncronas da IA
examples/
  adaptador-bot-exemplo.mjs       Segundo adaptador completo (ShopBot E-Commerce em memória)
test/
  *.test.mjs                      58 testes unitários e de integração ponta a ponta
```

Para plugar o ATLAS em **outro SaaS ou bot**, as sondas (`src/sondas/*`) e o núcleo (`src/nucleo.mjs`) **não mudam**. Basta criar um adaptador seguindo o exemplo de [`examples/adaptador-bot-exemplo.mjs`](./examples/adaptador-bot-exemplo.mjs) com:
1. `semear()` e métodos de verificação no banco (`pedidoExiste`, `estoqueDe`, `produtoExiste`, `hashSenhaDe`, `segredosDe`);
2. `login(conta)`, `loginBruto(login, senha)`, `forjarTokens(token, tenantAlvo)` e `rotasProtegidas`;
3. `http(metodo, caminho, opcoes)` apontando para as rotas do seu sistema.

---

## ⚖️ Aviso Legal e Uso Ético (Disclaimer)

O **ATLAS** é uma ferramenta de **engenharia de segurança defensiva e verificação contínua (Purple/Red Team autorizado)**, desenvolvida para ser executada **exclusivamente pelo proprietário do software ou mediante autorização expressa e documentada**, sempre contra **ambientes de teste isolados** (nunca contra ambientes de produção ou sistemas de terceiros).

A execução de testes de intrusão ou disparos automatizados contra sistemas sem autorização prévia é ilegal e viola legislações nacionais e internacionais, incluindo:
- **Brasil:** **Lei nº 12.737/2012 (Lei Carolina Dieckmann)** — Art. 154-A do Código Penal Brasileiro (Invasão de dispositivo informático) e Marco Civil da Internet (Lei nº 12.965/2014).
- **Estados Unidos / Internacional:** **Computer Fraud and Abuse Act (CFAA — 18 U.S.C. § 1030)** e legislações equivalentes de crimes cibernéticos.

O autor não se responsabiliza pelo uso indevido, não autorizado ou malicioso deste código. Utilize com responsabilidade ética para construir sistemas mais seguros.
