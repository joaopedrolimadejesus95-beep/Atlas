#!/usr/bin/env node
// =============================================================================
// ATLAS — red team automatizado (arquivo único)
// =============================================================================
// Ataca uma cópia de teste do Vendly de vários jeitos e diz onde as defesas
// seguraram e onde há o que corrigir. Tudo mora neste arquivo: configuração,
// semeadura do ambiente, adaptador do alvo, baterias de ataque, relatório e
// a geração do painel visual (painel.html).
//
// PRÉ-REQUISITOS
//   - Uma cópia de TESTE do Vendly rodando (nunca a produção com cliente).
//   - Acesso ao banco de teste (pra criar as empresas fictícias do cenário).
//   - Dependência: o pacote "pg" (o mesmo que o Vendly já usa).
//
// COMO RODAR
//   ALVO_URL=http://127.0.0.1:3000 \
//   DATABASE_URL=postgres://postgres@127.0.0.1:5433/vendly_test \
//   ADMIN_HTML=/caminho/para/public/admin.html \   (opcional: liga o teste de XSS)
//   node atlas.mjs
//
// SAÍDA (na pasta onde rodar)
//   - resumo no terminal
//   - RELATORIO.md   (relatório legível)
//   - findings.json  (dados crus)
//   - painel.html    (interface visual, abre em qualquer navegador)
// =============================================================================

import { scryptSync, randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import pg from "pg";

const ALVO_URL = process.env.ALVO_URL || "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Defina DATABASE_URL apontando pro banco de TESTE do Vendly.");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Credenciais fixas das empresas fictícias do cenário de teste.
const CONTAS = {
  burgerA: { nome: "Burger A", login: "burgera", senha: "burger1234", instancia: "atlas-burger-a", plano: "pro" },
  pizzaB: { nome: "Pizza B", login: "pizzab", senha: "pizza1234", instancia: "atlas-pizza-b", plano: "pro" },
  atendenteA: { nome: "Garçom A1", login: "garcom-a1", senha: "garcom1234" },
};

// -----------------------------------------------------------------------------
// 1) SEMEADURA — cria o cenário direto no banco (mesmo hash de senha do Vendly:
//    scrypt com salt, igual ao src/auth.js). Não depende do código do Vendly.
// -----------------------------------------------------------------------------
function hashSenha(senha, salt) {
  return scryptSync(senha, salt, 64).toString("hex");
}

async function inserirEmpresa(c) {
  const salt = randomBytes(16).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO empresas (nome, login, senha_salt, senha_hash, evolution_instance, plano)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [c.nome, c.login, salt, hashSenha(c.senha, salt), c.instancia, c.plano]
  );
  return rows[0].id;
}

async function inserirProduto(empresaId, p) {
  await pool.query(
    `INSERT INTO produtos (id, empresa_id, nome, preco, descricao, disponivel, estoque, categoria)
     VALUES ($1,$2,$3,$4,$5,true,$6,$7)
     ON CONFLICT (empresa_id, id) DO UPDATE SET nome=$3, preco=$4, estoque=$6`,
    [p.id, empresaId, p.nome, p.preco, p.descricao, p.estoque, p.categoria]
  );
}

async function inserirPedido(empresaId, ped) {
  const { rows } = await pool.query(
    `INSERT INTO pedidos (empresa_id, numero_cliente, itens, total, tipo_entrega, endereco, origem)
     VALUES ($1,$2,$3,$4,$5,$6,'whatsapp') RETURNING id`,
    [empresaId, ped.numeroCliente, JSON.stringify(ped.itens), ped.total, ped.tipoEntrega, ped.endereco]
  );
  return rows[0].id;
}

async function inserirAtendente(empresaId, a) {
  const salt = randomBytes(16).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO atendentes (empresa_id, nome, login, senha_salt, senha_hash)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [empresaId, a.nome, a.login, salt, hashSenha(a.senha, salt)]
  );
  return rows[0].id;
}

async function semear() {
  // Zera só o cenário de teste (ordem respeita as chaves estrangeiras).
  for (const t of ["lancamentos_mesa", "pedidos", "mesas", "atendentes", "produtos", "empresas"]) {
    await pool.query(`DELETE FROM ${t}`);
  }
  const idA = await inserirEmpresa(CONTAS.burgerA);
  const idB = await inserirEmpresa(CONTAS.pizzaB);
  await inserirProduto(idA, { id: "xb", nome: "X-Burger", preco: 20, descricao: "pão, carne, queijo", estoque: 100, categoria: "comida" });
  await inserirProduto(idA, { id: "refri", nome: "Refrigerante", preco: 6, descricao: "lata 350ml", estoque: 200, categoria: "bebida" });
  await inserirProduto(idB, { id: "marg", nome: "Pizza Margherita", preco: 45, descricao: "molho, muçarela, manjericão", estoque: 50, categoria: "comida" });
  await inserirProduto(idB, { id: "suco", nome: "Suco de Laranja", preco: 10, descricao: "natural 500ml", estoque: 80, categoria: "bebida" });
  const pedidoA = await inserirPedido(idA, { numeroCliente: "5544911110000@s.whatsapp.net", itens: [{ produto_id: "xb", nome: "X-Burger", quantidade: 2, preco: 20 }], total: 40, tipoEntrega: "entrega", endereco: "Rua Secreta da Burger A, 123" });
  const pedidoB = await inserirPedido(idB, { numeroCliente: "5544922220000@s.whatsapp.net", itens: [{ produto_id: "marg", nome: "Pizza Margherita", quantidade: 1, preco: 45 }], total: 45, tipoEntrega: "entrega", endereco: "Av. Confidencial da Pizza B, 999" });
  const atendA = await inserirAtendente(idA, CONTAS.atendenteA);
  return { idA, idB, pedidoA, pedidoB, atendA };
}

// -----------------------------------------------------------------------------
// 2) ADAPTADOR — a única parte que conhece o Vendly (URL, login, token).
//    Trocar de alvo no futuro = mexer só aqui.
// -----------------------------------------------------------------------------
async function http(metodo, caminho, { token, corpo, headers } = {}) {
  const h = { "content-type": "application/json", ...(headers || {}) };
  if (token) h.authorization = `Bearer ${token}`;
  const resp = await fetch(`${ALVO_URL}${caminho}`, {
    method: metodo, headers: h, body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  let body; try { body = JSON.parse(texto); } catch { body = texto; }
  return { status: resp.status, body };
}
async function login(usuario, senha) {
  const { status, body } = await http("POST", "/api/login", { corpo: { login: usuario, senha } });
  return status === 200 ? body.token : null;
}

// -----------------------------------------------------------------------------
// 3) NÚCLEO — cada sonda registra um achado: defendido (defesa segurou) ou
//    VULNERAVEL (falhou; vira item de correção). "erro" = a sonda quebrou.
// -----------------------------------------------------------------------------
const GRAV = { CRITICA: "crítica", ALTA: "alta", MEDIA: "média", BAIXA: "baixa", INFO: "informativo" };
const ORDEM_GRAV = [GRAV.CRITICA, GRAV.ALTA, GRAV.MEDIA, GRAV.BAIXA, GRAV.INFO];
const achados = [];

function registrar({ id, categoria, titulo, gravidade, seguro, esperado, obtido, correcao, reproduzir }) {
  achados.push({ id, categoria, titulo, gravidade, resultado: seguro ? "defendido" : "VULNERAVEL", esperado, obtido, correcao: seguro ? null : correcao, reproduzir: reproduzir || null });
}
async function sonda(meta, fn) {
  try { await fn(); }
  catch (e) { achados.push({ ...meta, gravidade: GRAV.INFO, resultado: "erro", esperado: meta.esperado || "", obtido: `A sonda quebrou: ${e.message}`, correcao: null, reproduzir: meta.reproduzir || null }); }
}
function resumo() {
  const r = { total: achados.length, vulneravel: 0, defendido: 0, erro: 0, porGravidade: {} };
  for (const a of achados) {
    if (a.resultado === "VULNERAVEL") { r.vulneravel++; r.porGravidade[a.gravidade] = (r.porGravidade[a.gravidade] || 0) + 1; }
    else if (a.resultado === "defendido") r.defendido++; else r.erro++;
  }
  return r;
}

// -----------------------------------------------------------------------------
// 4) BATERIAS DE ATAQUE
// -----------------------------------------------------------------------------
async function bateriaIsolamento(ctx) {
  const tokenA = await login(CONTAS.burgerA.login, CONTAS.burgerA.senha);
  const tokenB = await login(CONTAS.pizzaB.login, CONTAS.pizzaB.senha);
  if (!tokenA || !tokenB) throw new Error("Não consegui logar nas empresas de teste — o seed rodou e o servidor está no ar?");

  await sonda({ id: "ISO-01", categoria: "isolamento", titulo: "Apagar pedido de outra empresa trocando o ID (IDOR)" }, async () => {
    const r = await http("DELETE", `/api/pedidos/${ctx.pedidoB}`, { token: tokenA });
    const comoB = await http("GET", "/api/pedidos", { token: tokenB });
    const aindaExiste = Array.isArray(comoB.body?.pedidos) && comoB.body.pedidos.some((p) => p.id === ctx.pedidoB);
    registrar({ id: "ISO-01", categoria: "isolamento", titulo: "Apagar pedido de outra empresa trocando o ID (IDOR)", gravidade: GRAV.CRITICA,
      seguro: r.body?.ok === false && aindaExiste,
      esperado: "O pedido da Pizza B permanece intacto (DELETE não afeta dados de outra empresa).",
      obtido: `status ${r.status}, ok=${r.body?.ok}; pedido de B ainda existe: ${aindaExiste}`,
      correcao: "Garantir que todo UPDATE/DELETE filtre por empresa_id (padrão atual; manter em rotas novas).",
      reproduzir: `Logado como Burger A, DELETE /api/pedidos/${ctx.pedidoB} (pedido da Pizza B).` });
  });

  await sonda({ id: "ISO-02", categoria: "isolamento", titulo: "Listar produtos vaza itens de outra empresa" }, async () => {
    const r = await http("GET", "/api/produtos", { token: tokenA });
    const nomes = (r.body?.produtos || []).map((p) => p.nome);
    const vazou = nomes.some((n) => /margherita|suco de laranja/i.test(n));
    registrar({ id: "ISO-02", categoria: "isolamento", titulo: "Listar produtos vaza itens de outra empresa", gravidade: GRAV.CRITICA, seguro: !vazou,
      esperado: "A Burger A só vê o próprio cardápio (X-Burger, Refrigerante).",
      obtido: `produtos vistos pela Burger A: ${JSON.stringify(nomes)}`,
      correcao: "Toda query de catálogo deve filtrar por empresa_id (padrão atual mantido).",
      reproduzir: "Logado como Burger A, GET /api/produtos." });
  });

  await sonda({ id: "ISO-03", categoria: "isolamento", titulo: "Alterar estoque de produto de outra empresa" }, async () => {
    await http("PUT", "/api/estoque/marg", { token: tokenA, corpo: { quantidade: 99999 } });
    const comoB = await http("GET", "/api/produtos", { token: tokenB });
    const estoqueMarg = comoB.body?.estoque?.marg;
    registrar({ id: "ISO-03", categoria: "isolamento", titulo: "Alterar estoque de produto de outra empresa", gravidade: GRAV.CRITICA, seguro: estoqueMarg === 50,
      esperado: "O estoque da Pizza B (margherita = 50) não muda com ação da Burger A.",
      obtido: `estoque da margherita após tentativa: ${estoqueMarg}`,
      correcao: "UPDATE de estoque já filtra por empresa_id — 'marg' não pertence à Burger A, nada é afetado.",
      reproduzir: "Logado como Burger A, PUT /api/estoque/marg com quantidade alta." });
  });

  await sonda({ id: "ISO-04", categoria: "isolamento", titulo: "Rota de troca de senha age só sobre a própria empresa" }, async () => {
    await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: CONTAS.burgerA.senha, novaSenha: "novaA123", empresaId: ctx.idB, id: ctx.idB } });
    const pizzaAindaLoga = await login(CONTAS.pizzaB.login, CONTAS.pizzaB.senha);
    registrar({ id: "ISO-04", categoria: "isolamento", titulo: "Rota de troca de senha age só sobre a própria empresa", gravidade: GRAV.CRITICA, seguro: Boolean(pizzaAindaLoga),
      esperado: "Campos extras no corpo (empresaId/id) são ignorados; a senha da Pizza B não muda.",
      obtido: pizzaAindaLoga ? "Pizza B continua logando com a senha original." : "Pizza B NÃO loga mais — senha foi afetada!",
      correcao: "A rota usa req.empresaId do token, nunca um id vindo do corpo — manter.",
      reproduzir: "POST /api/senha com empresaId/id extras no corpo." });
    await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: "novaA123", novaSenha: CONTAS.burgerA.senha } });
  });

  await sonda({ id: "ISO-05", categoria: "autenticação", titulo: "Token adulterado (trocar empresaId sem a chave) é aceito" }, async () => {
    const [payloadB64, assinatura] = tokenA.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    payload.empresaId = ctx.idB;
    const tokenForjado = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${assinatura}`;
    const r = await http("GET", "/api/empresa", { token: tokenForjado });
    registrar({ id: "ISO-05", categoria: "autenticação", titulo: "Token adulterado (trocar empresaId sem a chave) é aceito", gravidade: GRAV.CRITICA, seguro: r.status === 401,
      esperado: "401 — a assinatura HMAC não confere com o payload adulterado.",
      obtido: `status ${r.status}${r.status === 200 ? ` — ACEITOU: ${JSON.stringify(r.body?.nome)}` : ""}`,
      correcao: "verificarToken() recalcula o HMAC do payload e compara — adulterar invalida a assinatura. Manter.",
      reproduzir: "Pegar token da Burger A, trocar empresaId no payload, reenviar sem reassinar." });
  });

  await sonda({ id: "ISO-06", categoria: "autenticação", titulo: "Rota protegida acessível sem token" }, async () => {
    const r = await http("GET", "/api/pedidos");
    registrar({ id: "ISO-06", categoria: "autenticação", titulo: "Rota protegida acessível sem token", gravidade: GRAV.ALTA, seguro: r.status === 401,
      esperado: "401 — sem token, sem acesso.", obtido: `status ${r.status}`,
      correcao: "Middleware exigirLogin cobre /api exceto login e /publico — manter.",
      reproduzir: "GET /api/pedidos sem header Authorization." });
  });
}

async function bateriaAppSec(ctx) {
  const tokenA = await login(CONTAS.burgerA.login, CONTAS.burgerA.senha);
  const ADMIN_HTML = process.env.ADMIN_HTML || null;

  await sonda({ id: "APP-01", categoria: "autenticação", titulo: "Webhook aceita requisição sem token" }, async () => {
    const r = await http("POST", "/webhook/mensagem", { corpo: { instance: CONTAS.burgerA.instancia, data: { key: { remoteJid: "551199999@s.whatsapp.net" }, message: { conversation: "oi" } } } });
    registrar({ id: "APP-01", categoria: "autenticação", titulo: "Webhook aceita requisição sem token", gravidade: GRAV.ALTA, seguro: r.status === 401,
      esperado: "401 — o webhook exige o header x-webhook-token.",
      obtido: `status ${r.status} (WEBHOOK_TOKEN ${process.env.WEBHOOK_TOKEN ? "configurado" : "VAZIO neste ambiente"})`,
      correcao: "Definir WEBHOOK_TOKEN no .env do servidor e reconectar cada instância. Sem ele o webhook fica aberto. Confirmar que a produção tem o token setado.",
      reproduzir: "POST /webhook/mensagem sem x-webhook-token, com o nome da instância de uma empresa." });
  });

  await sonda({ id: "APP-02", categoria: "política de senha", titulo: "Sistema aceita senha fraca (curta)" }, async () => {
    const r = await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: CONTAS.burgerA.senha, novaSenha: "1234" } });
    const aceitou = r.status === 200;
    if (aceitou) await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: "1234", novaSenha: CONTAS.burgerA.senha } });
    registrar({ id: "APP-02", categoria: "política de senha", titulo: "Sistema aceita senha fraca (curta)", gravidade: GRAV.MEDIA, seguro: !aceitou,
      esperado: "Rejeitar senhas com menos de 8 caracteres.",
      obtido: aceitou ? "'1234' foi aceita como senha válida (mínimo atual é 4)." : `rejeitada (status ${r.status}).`,
      correcao: "Subir o mínimo de 4 para 8+ em /api/senha, criarAtendente e criar-empresa; opcionalmente bloquear senhas comuns.",
      reproduzir: "POST /api/senha trocando para '1234'." });
  });

  await sonda({ id: "APP-03", categoria: "exposição de dados", titulo: "Cardápio público vaza campos internos" }, async () => {
    await http("PUT", "/api/empresa", { token: tokenA, corpo: { slug: "burger-a-teste", ofereceCardapioDigital: true } });
    const r = await http("GET", "/api/publico/burger-a-teste");
    const texto = JSON.stringify(r.body || {});
    const campoSensivel = /senha|hash|salt|session|webhook|evolution_?instance|token/i.test(texto);
    const vazouEstoque = /"estoque"\s*:\s*\d/.test(texto);
    registrar({ id: "APP-03", categoria: "exposição de dados", titulo: "Cardápio público vaza campos internos", gravidade: GRAV.ALTA, seguro: !campoSensivel && !vazouEstoque,
      esperado: "Só nome, descrição, preço e 'esgotado' (booleano) — nada de senha, token, instância ou estoque numérico.",
      obtido: (!campoSensivel && !vazouEstoque) ? "Nenhum campo interno presente na resposta pública." : `Campo sensível detectado: ${texto.slice(0, 200)}`,
      correcao: "getEmpresaPublicaPorSlug monta a resposta com lista explícita de campos (sem spread) — manter.",
      reproduzir: "Definir slug público e consultar GET /api/publico/:slug, checando campos internos." });
  });

  await sonda({ id: "APP-04", categoria: "xss", titulo: "XSS armazenado via nome de produto no painel" }, async () => {
    const payload = "<img src=x onerror=alert(1)>";
    await http("POST", "/api/produtos", { token: tokenA, corpo: { id: "xss-teste", nome: payload, preco: 1, descricao: "x", categoria: "comida" } });
    const r = await http("GET", "/api/produtos", { token: tokenA });
    const guardado = (r.body?.produtos || []).find((p) => p.id === "xss-teste");
    let temEsc = false, usaEsc = false, analisou = false;
    if (ADMIN_HTML) {
      try {
        const html = readFileSync(ADMIN_HTML, "utf8");
        temEsc = /function esc\(/.test(html);
        usaEsc = /esc\(\s*p\.nome\s*\)/.test(html) || /\$\{esc\(p\.nome\)\}/.test(html);
        analisou = true;
      } catch {}
    }
    const seguro = temEsc && usaEsc;
    registrar({ id: "APP-04", categoria: "xss", titulo: "XSS armazenado via nome de produto no painel", gravidade: GRAV.ALTA, seguro,
      esperado: "O nome é escapado com esc() antes de ir pro innerHTML do painel.",
      obtido: `API guarda o texto cru (ok): ${guardado?.nome === payload}; esc() existe: ${temEsc}; nome passa por esc(): ${usaEsc}${analisou ? "" : " (ADMIN_HTML não informado — análise de render pulada)"}`,
      correcao: seguro ? null : "Envolver p.nome (e todo campo vindo do cliente) com esc() em TODO innerHTML do admin.html. Verificação manual por sink recomendada.",
      reproduzir: "Salvar produto com nome contendo HTML e inspecionar o render do painel." });
    await http("DELETE", "/api/produtos/xss-teste", { token: tokenA });
  });
}

// -----------------------------------------------------------------------------
// 5) RELATÓRIO (markdown) + findings.json
// -----------------------------------------------------------------------------
function ordenar(lista) {
  const rank = (x) => (x.resultado === "VULNERAVEL" ? 0 : x.resultado === "erro" ? 1 : 2);
  return [...lista].sort((a, b) => rank(a) !== rank(b) ? rank(a) - rank(b) : ORDEM_GRAV.indexOf(a.gravidade) - ORDEM_GRAV.indexOf(b.gravidade));
}
function gerarMarkdown(r) {
  const data = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const L = [];
  L.push("# ATLAS — Relatório de Red Team do Vendly", "");
  L.push(`**Data:** ${data}  `, `**Alvo:** cópia de teste local do Vendly (banco isolado, duas empresas fictícias)  `, `**Escopo:** isolamento entre empresas, autenticação, política de senha, exposição de dados e XSS.`, "");
  L.push("## Resumo", "", `Foram executados **${r.total}** testes de ataque.`, "");
  L.push(`- 🟢 **${r.defendido}** defesas funcionaram (o ataque foi bloqueado)`);
  L.push(`- 🔴 **${r.vulneravel}** vulnerabilidades / pontos a corrigir`);
  if (r.erro) L.push(`- ⚪ **${r.erro}** testes com erro de execução`);
  L.push("");
  L.push("| ID | Teste | Gravidade | Resultado |", "|----|-------|-----------|-----------|");
  for (const a of ordenar(achados)) {
    const ic = a.resultado === "VULNERAVEL" ? "🔴 corrigir" : a.resultado === "erro" ? "⚪ erro" : "🟢 defendido";
    L.push(`| ${a.id} | ${a.titulo} | ${a.gravidade} | ${ic} |`);
  }
  L.push("", "## Detalhes", "");
  for (const a of ordenar(achados)) {
    const ic = a.resultado === "VULNERAVEL" ? "🔴" : a.resultado === "erro" ? "⚪" : "🟢";
    L.push(`### ${ic} ${a.id} — ${a.titulo}`, "");
    L.push(`- **Categoria:** ${a.categoria}`, `- **Gravidade:** ${a.gravidade}`, `- **Resultado:** ${a.resultado === "VULNERAVEL" ? "vulnerável — precisa corrigir" : a.resultado === "erro" ? "erro na execução" : "defendido"}`);
    if (a.reproduzir) L.push(`- **Como reproduzir:** ${a.reproduzir}`);
    L.push(`- **Esperado:** ${a.esperado}`, `- **Obtido:** ${a.obtido}`);
    if (a.correcao) L.push(`- **Correção sugerida:** ${a.correcao}`);
    L.push("");
  }
  L.push("---", "", "_Relatório gerado pelo ATLAS. Testes contra uma cópia de teste isolada — nenhum dado de produção foi tocado._");
  return L.join("\n");
}

// -----------------------------------------------------------------------------
// 6) PAINEL VISUAL — monta painel.html inteiro aqui no Node (HTML estático +
//    um pouco de JS só pra expandir cards e filtrar). Sem template no cliente,
//    pra não ter conflito de sintaxe ao guardar tudo num arquivo só.
// -----------------------------------------------------------------------------
function escHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const CLASSE_GRAV = { "crítica": "critica", "alta": "alta", "média": "media", "baixa": "baixa", "informativo": "informativo" };

function gerarPainel(dados) {
  const r = dados.resumo;
  const dataFmt = new Date(dados.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const sevTxt = Object.entries(r.porGravidade).map(([g, n]) => n + " " + g).join(" · ") || "—";
  const lede = r.vulneravel === 0
    ? "<strong>Todos os ataques foram bloqueados.</strong>"
    : "<strong>" + r.defendido + " de " + r.total + " ataques foram bloqueados pelas defesas do Vendly.</strong> Restam " + r.vulneravel + (r.vulneravel === 1 ? " ponto" : " pontos") + " a corrigir.";

  const tiles = [
    { n: r.total, l: "Testes", c: "" },
    { n: r.defendido, l: "Defesas OK", c: "ok" },
    { n: r.vulneravel, l: "A corrigir", c: "fix" },
    { n: sevTxt, l: "Gravidade dos achados", c: "" },
  ].map((t) => '<div class="tile ' + t.c + '"><div class="n">' + t.n + '</div><div class="l">' + t.l + "</div></div>").join("");

  const cards = ordenar(dados.achados).map((a) => {
    const vuln = a.resultado === "VULNERAVEL";
    const erro = a.resultado === "erro";
    const resClass = vuln ? "vuln" : erro ? "erro" : "defendido";
    const resLabel = vuln ? "A corrigir" : erro ? "Erro" : "Defendido";
    return '<div class="card r-' + resClass + '" data-r="' + resClass + '">' +
      '<button class="row" aria-expanded="false">' +
      '<span class="id">' + escHtml(a.id) + "</span>" +
      '<span class="ttl">' + escHtml(a.titulo) + '<span class="cat">' + escHtml(a.categoria) + "</span></span>" +
      '<span class="badges">' +
      '<span class="sev ' + (CLASSE_GRAV[a.gravidade] || "media") + '">' + escHtml(a.gravidade) + "</span>" +
      '<span class="res ' + resClass + '">' + resLabel + "</span>" +
      '<span class="caret">›</span>' +
      "</span></button>" +
      '<div class="detail"><dl>' +
      (a.reproduzir ? "<dt>Reproduzir</dt><dd>" + escHtml(a.reproduzir) + "</dd>" : "") +
      "<dt>Esperado</dt><dd>" + escHtml(a.esperado) + "</dd>" +
      '<dt>Obtido</dt><dd class="out">' + escHtml(a.obtido) + "</dd></dl>" +
      (a.correcao ? '<div class="fix"><b>Correção sugerida</b><br>' + escHtml(a.correcao) + "</div>" : "") +
      "</div></div>";
  }).join("");

  return [
    '<title>ATLAS Console</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    "<style>" + CSS + "</style>",
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">',
    '<div class="wrap">',
    '<header><div class="brand"><div class="mark">A</div><div><h1>ATLAS</h1><p>Red team automatizado — alvo: Vendly</p></div></div>',
    '<div class="meta"><div>rodada: <b>' + dataFmt + "</b></div><div>ambiente: <b>teste isolado</b></div></div></header>",
    '<section class="verdict"><div class="score"><b>' + r.defendido + "</b><span>/" + r.total + '</span></div><div class="lede">' + lede + "</div></section>",
    '<div class="tiles">' + tiles + "</div>",
    '<div class="filters"><span class="cap">Filtrar</span>' +
      '<button class="chip" data-f="todos" aria-pressed="true">Todos</button>' +
      '<button class="chip" data-f="vuln" aria-pressed="false">A corrigir</button>' +
      '<button class="chip" data-f="defendido" aria-pressed="false">Defendidos</button></div>',
    '<div class="list" id="list" data-filtro="todos">' + cards + "</div>",
    '<footer>Os testes rodaram contra uma cópia de teste isolada do Vendly (banco próprio, duas empresas fictícias). Nenhum dado de produção foi tocado. Cada achado traz o esperado, o obtido e, quando falha, a correção sugerida.</footer>',
    "</div>",
    "<script>" + PAINEL_JS + "<\/script>",
  ].join("\n");
}

// CSS do painel (sem ${} nem crase — guardado inteiro aqui).
const CSS = [
  ':root{--bg:#f4f6f8;--surface:#fff;--surface-2:#eef1f5;--line:#d9dee6;--fg:#1b2330;--muted:#5d6b7e;--accent:#0a7ea4;--accent-soft:#d6eef5;--ok:#1a7f52;--ok-soft:#d8efe3;--warn:#b2660b;--crit:#c0392b;--crit-soft:#f6dcd8;--shadow:0 1px 2px rgba(20,30,45,.06),0 6px 20px rgba(20,30,45,.05);--f-display:"Sora",system-ui,sans-serif;--f-body:"IBM Plex Sans",system-ui,sans-serif;--f-mono:"IBM Plex Mono",ui-monospace,monospace}',
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0d1219;--surface:#141c27;--surface-2:#1b2531;--line:#273243;--fg:#e7edf4;--muted:#93a2b5;--accent:#38bdf0;--accent-soft:#10303d;--ok:#45c08a;--ok-soft:#10281f;--warn:#e0a04a;--crit:#f0776a;--crit-soft:#351a18;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);color-scheme:dark}}',
  ':root[data-theme="dark"]{--bg:#0d1219;--surface:#141c27;--surface-2:#1b2531;--line:#273243;--fg:#e7edf4;--muted:#93a2b5;--accent:#38bdf0;--accent-soft:#10303d;--ok:#45c08a;--ok-soft:#10281f;--warn:#e0a04a;--crit:#f0776a;--crit-soft:#351a18;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);color-scheme:dark}',
  '*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font-family:var(--f-body);line-height:1.5}',
  '.wrap{max-width:960px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 48px}',
  'h1{font-family:var(--f-display);text-wrap:balance;margin:0}',
  'header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}',
  '.brand{display:flex;align-items:center;gap:12px;min-width:0}',
  '.brand .mark{width:38px;height:38px;border-radius:9px;flex:none;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--fg)));display:grid;place-items:center;color:#fff;font-family:var(--f-mono);font-weight:700;font-size:18px;box-shadow:var(--shadow)}',
  '.brand h1{font-size:26px;font-weight:700;letter-spacing:-.01em}.brand p{margin:2px 0 0;color:var(--muted);font-size:13px}',
  '.meta{text-align:right;font-size:12px;color:var(--muted);font-family:var(--f-mono);line-height:1.7}.meta b{color:var(--fg);font-weight:600}',
  '.verdict{margin-top:24px;padding:20px 22px;border-radius:14px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);display:flex;flex-wrap:wrap;align-items:center;gap:18px 26px}',
  '.verdict .score{font-family:var(--f-display);font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1}.verdict .score b{color:var(--ok)}.verdict .score span{color:var(--muted);font-size:24px}',
  '.verdict .lede{font-size:14px;color:var(--muted);max-width:46ch;min-width:0}.verdict .lede strong{color:var(--fg);font-weight:600}',
  '.tiles{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
  '.tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow)}',
  '.tile .n{font-family:var(--f-display);font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}.tile .l{margin-top:6px;font-size:12px;color:var(--muted);letter-spacing:.03em;text-transform:uppercase}',
  '.tile.ok .n{color:var(--ok)}.tile.fix .n{color:var(--crit)}',
  '.filters{margin:26px 0 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.filters .cap{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-right:4px}',
  '.chip{font:inherit;font-size:13px;cursor:pointer;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted);transition:.15s}',
  '.chip:hover{border-color:var(--accent);color:var(--fg)}.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}.chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
  '.list{display:flex;flex-direction:column;gap:10px}',
  '.list[data-filtro="vuln"] .card:not([data-r="vuln"]){display:none}.list[data-filtro="defendido"] .card:not([data-r="defendido"]){display:none}',
  '.card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}',
  '.card::before{content:"";position:absolute;inset:0 auto 0 0;width:4px}.card.r-defendido::before{background:var(--ok)}.card.r-vuln::before{background:var(--crit)}.card.r-erro::before{background:var(--muted)}',
  '.row{display:flex;align-items:center;gap:12px;padding:14px 16px 14px 20px;width:100%;background:none;border:0;font:inherit;color:inherit;cursor:pointer;text-align:left}.row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}',
  '.id{font-family:var(--f-mono);font-size:12px;color:var(--muted);flex:none;width:58px}',
  '.ttl{flex:1;min-width:0;font-weight:600;font-size:14.5px}.ttl .cat{display:block;font-weight:400;font-size:12px;color:var(--muted);text-transform:capitalize;margin-top:1px}',
  '.badges{display:flex;align-items:center;gap:8px;flex:none}',
  '.sev{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em}.sev.critica,.sev.alta{background:var(--crit-soft);color:var(--crit)}.sev.media{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.sev.baixa,.sev.informativo{background:var(--surface-2);color:var(--muted)}',
  '.res{font-size:12px;font-weight:600;padding:4px 10px;border-radius:8px;white-space:nowrap}.res.defendido{background:var(--ok-soft);color:var(--ok)}.res.vuln{background:var(--crit-soft);color:var(--crit)}.res.erro{background:var(--surface-2);color:var(--muted)}',
  '.caret{flex:none;color:var(--muted);transition:transform .2s;font-family:var(--f-mono)}.card.open .caret{transform:rotate(90deg)}',
  '.detail{display:none;padding:2px 16px 16px 20px;border-top:1px solid var(--line);margin-top:-1px}.card.open .detail{display:block}',
  '.detail dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13.5px;align-items:start}.detail dt{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding-top:2px}.detail dd{margin:0;min-width:0;overflow-wrap:anywhere}.detail dd.out{font-family:var(--f-mono);font-size:12.5px;background:var(--surface-2);padding:6px 9px;border-radius:7px}',
  '.fix{margin-top:12px;padding:11px 13px;border-radius:9px;background:var(--accent-soft);font-size:13.5px}.fix b{font-family:var(--f-display)}',
  'footer{margin-top:30px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}',
  '@media (max-width:620px){.tiles{grid-template-columns:repeat(2,1fr)}.meta{text-align:left}.detail dl{grid-template-columns:1fr;gap:3px 0}.detail dt{margin-top:8px}.id{width:50px}}',
  '@media (prefers-reduced-motion:reduce){*{transition:none!important}}',
].join("");

// JS do painel: expandir card + filtrar (sem crase nem ${}).
const PAINEL_JS = [
  "document.getElementById('list').addEventListener('click',function(e){",
  "  var row=e.target.closest('.row'); if(!row) return;",
  "  var card=row.closest('.card'); var ab=card.classList.toggle('open');",
  "  row.setAttribute('aria-expanded', ab?'true':'false');",
  "});",
  "document.querySelector('.filters').addEventListener('click',function(e){",
  "  var chip=e.target.closest('.chip'); if(!chip) return;",
  "  document.getElementById('list').setAttribute('data-filtro', chip.dataset.f);",
  "  var chips=document.querySelectorAll('.chip');",
  "  for(var i=0;i<chips.length;i++){ chips[i].setAttribute('aria-pressed', chips[i]===chip?'true':'false'); }",
  "});",
].join("\n");

// -----------------------------------------------------------------------------
// RUNNER
// -----------------------------------------------------------------------------
async function principal() {
  console.log("ATLAS — iniciando rodada de red team\n");
  try { await fetch(`${ALVO_URL}/health`); }
  catch { console.error(`Não alcancei o alvo em ${ALVO_URL}. Suba a cópia de teste do Vendly primeiro.`); process.exit(1); }

  console.log("→ Semeando ambiente de teste...");
  const ctx = await semear();
  console.log(`  Burger A (id ${ctx.idA}) e Pizza B (id ${ctx.idB}) prontas.\n`);

  console.log("→ Bateria: isolamento entre empresas...");
  await bateriaIsolamento(ctx);
  console.log("→ Bateria: segurança da aplicação...");
  await bateriaAppSec(ctx);

  const r = resumo();
  writeFileSync("RELATORIO.md", gerarMarkdown(r));
  const dados = { geradoEm: new Date().toISOString(), resumo: r, achados };
  writeFileSync("findings.json", JSON.stringify(dados, null, 2));
  writeFileSync("painel.html", gerarPainel(dados));

  console.log("\n" + "=".repeat(56));
  console.log(`RESULTADO: ${r.defendido} defesas OK · ${r.vulneravel} a corrigir · ${r.erro} erros`);
  console.log("=".repeat(56));
  for (const a of achados) {
    const ic = a.resultado === "VULNERAVEL" ? "🔴" : a.resultado === "erro" ? "⚪" : "🟢";
    console.log(`${ic} ${a.id} [${a.gravidade}] ${a.titulo}`);
  }
  console.log("\nGerados: RELATORIO.md · findings.json · painel.html");
}

principal().then(() => pool.end()).catch((e) => { console.error("Erro na rodada do ATLAS:", e); pool.end(); process.exit(1); });
