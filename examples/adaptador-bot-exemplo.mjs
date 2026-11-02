// =============================================================================
// EXEMPLO DE SEGUNDO ADAPTADOR — Bot Fictício de E-Commerce ("ShopBot SaaS")
// =============================================================================
// Este arquivo prova que o núcleo do ATLAS (Rodada, baterias de sondas e
// geradores de relatório/painel) é desacoplado do Vendly: basta implementar o
// contrato do adaptador traduzindo rotas, tokens e consultas de "verdade
// absoluta" no banco do novo alvo.
//
// Como rodar isoladamente:
//   node examples/adaptador-bot-exemplo.mjs
// =============================================================================
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Rodada } from "../src/nucleo.mjs";
import { gerarContas, PRODUTOS, PEDIDOS } from "../src/cenario.mjs";
import { hashSenha, novoSalt } from "../src/senha.mjs";
import { bateriaIsolamento } from "../src/sondas/isolamento.mjs";
import { bateriaAppSec } from "../src/sondas/appsec.mjs";

const CHAVE_HMAC = "chave-secreta-shopbot-demo-2026";
const SENHAS_FRACAS = new Set(["1234", "password", "aaaaaaaa", "12345678"]);

function assinarToken(tenantId) {
  const payload = Buffer.from(JSON.stringify({ tenantId, iat: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", CHAVE_HMAC).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verificarToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const esperado = createHmac("sha256", CHAVE_HMAC).update(payload).digest("base64url");
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(esperado);
  if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Cria um alvo SaaS multi-tenant fictício 100% em memória (sem precisar de rede
// nem Postgres) + o adaptador compatível com o núcleo e as baterias do ATLAS.
export function criarAdaptadorBotExemplo({ modo = "seguro", webhookToken = "wh-secret-demo" } = {}) {
  const contas = gerarContas();
  const estado = {
    lojas: new Map(),
    catalogo: [],
    pedidos: [],
    tentativasLogin: new Map(),
    seqLoja: 1,
    seqPedido: 100,
  };

  const banco = {
    nomeBanco: "shopbot_memoria_test",
    async semear(c = contas) {
      estado.lojas.clear();
      estado.catalogo = [];
      estado.pedidos = [];
      estado.tentativasLogin.clear();

      const criarLoja = (conta) => {
        const id = estado.seqLoja++;
        const salt = novoSalt();
        estado.lojas.set(id, {
          id,
          nome: conta.nome,
          login: conta.login,
          senha_salt: salt,
          senha_hash: hashSenha(conta.senha, salt),
          evolution_instance: conta.instancia,
          slug: null,
        });
        return id;
      };

      const idA = criarLoja(c.burgerA);
      const idB = criarLoja(c.pizzaB);
      const idVitima = criarLoja(c.vitima);

      for (const p of PRODUTOS.burgerA) estado.catalogo.push({ ...p, empresa_id: idA });
      for (const p of PRODUTOS.pizzaB) estado.catalogo.push({ ...p, empresa_id: idB });

      const pedidoA = estado.seqPedido++;
      const pedidoB = estado.seqPedido++;
      estado.pedidos.push({ id: pedidoA, empresa_id: idA, ...PEDIDOS.burgerA });
      estado.pedidos.push({ id: pedidoB, empresa_id: idB, ...PEDIDOS.pizzaB });

      return {
        idA,
        idB,
        idVitima,
        pedidoA,
        pedidoB,
        atendA: 1,
        produtosA: PRODUTOS.burgerA,
        produtosB: PRODUTOS.pizzaB,
      };
    },
    async pedidoExiste(id) {
      return estado.pedidos.some((p) => p.id === Number(id));
    },
    async estoqueDe(empresaId, produtoId) {
      const item = estado.catalogo.find((p) => p.empresa_id === empresaId && p.id === produtoId);
      return item ? Number(item.estoque) : null;
    },
    async produtoExiste(empresaId, produtoId) {
      return estado.catalogo.some((p) => p.empresa_id === empresaId && p.id === produtoId);
    },
    async removerProduto(produtoId) {
      estado.catalogo = estado.catalogo.filter((p) => p.id !== produtoId);
    },
    async hashSenhaDe(empresaId) {
      return estado.lojas.get(empresaId)?.senha_hash ?? null;
    },
    async redefinirSenha(empresaId, novaSenha) {
      const loja = estado.lojas.get(empresaId);
      if (!loja) return;
      const salt = novoSalt();
      loja.senha_salt = salt;
      loja.senha_hash = hashSenha(novaSenha, salt);
    },
    async segredosDe(empresaId) {
      const l = estado.lojas.get(empresaId);
      return l ? [l.senha_hash, l.senha_salt, l.evolution_instance].filter(Boolean) : [];
    },
    async fechar() {},
  };

  function responder(status, bodyObj) {
    const texto = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
    return { status, body: bodyObj, texto };
  }

  // Simulador HTTP em memória do bot de e-commerce
  async function http(metodo, caminho, { token, corpo, headers } = {}) {
    if (metodo === "GET" && caminho === "/health") return responder(200, { ok: true });

    if (metodo === "POST" && caminho === "/api/login") {
      const login = String(corpo?.login ?? "");
      const senha = String(corpo?.senha ?? "");
      const falhas = estado.tentativasLogin.get(login) || 0;
      if (falhas >= 5 && modo !== "vulneravel-bruteforce") {
        return responder(429, { erro: "Muitas tentativas. Tente novamente mais tarde." });
      }
      const loja = [...estado.lojas.values()].find((l) => l.login === login);
      if (!loja || hashSenha(senha, loja.senha_salt) !== loja.senha_hash) {
        estado.tentativasLogin.set(login, falhas + 1);
        return responder(401, { erro: "Credenciais inválidas" });
      }
      estado.tentativasLogin.set(login, 0);
      return responder(200, { token: assinarToken(loja.id) });
    }

    if (metodo === "POST" && caminho === "/webhook/mensagem") {
      const enviado = headers?.["x-webhook-token"];
      if (modo !== "vulneravel-webhook" && (!enviado || enviado !== webhookToken)) {
        return responder(401, { erro: "Webhook não autorizado" });
      }
      return responder(200, { recebido: true });
    }

    if (metodo === "GET" && caminho.startsWith("/api/publico/")) {
      const slug = caminho.replace("/api/publico/", "");
      const loja = [...estado.lojas.values()].find((l) => l.slug === slug);
      if (!loja) return responder(404, { erro: "Loja não encontrada" });
      const itens = estado.catalogo
        .filter((p) => p.empresa_id === loja.id)
        .map((p) => ({ id: p.id, nome: p.nome, preco: p.preco, esgotado: p.estoque <= 0 }));
      return responder(200, { nome: loja.nome, produtos: itens });
    }

    // Rotas autenticadas
    const sessao = verificarToken(token);
    if (!sessao) return responder(401, { erro: "Token inválido ou ausente" });
    const tenantId = sessao.tenantId;

    if (metodo === "GET" && caminho === "/api/empresa") {
      const loja = estado.lojas.get(tenantId);
      return responder(200, { id: loja.id, nome: loja.nome });
    }

    if (metodo === "PUT" && caminho === "/api/empresa") {
      const loja = estado.lojas.get(tenantId);
      if (corpo?.slug) loja.slug = String(corpo.slug);
      return responder(200, { ok: true });
    }

    if (metodo === "GET" && caminho === "/api/pedidos") {
      const meusPedidos = estado.pedidos.filter((p) => p.empresa_id === tenantId);
      return responder(200, { pedidos: meusPedidos });
    }

    if (metodo === "DELETE" && caminho.startsWith("/api/pedidos/")) {
      const idAlvo = Number(caminho.replace("/api/pedidos/", ""));
      const antes = estado.pedidos.length;
      if (modo === "vulneravel-idor") {
        estado.pedidos = estado.pedidos.filter((p) => p.id !== idAlvo);
      } else {
        estado.pedidos = estado.pedidos.filter((p) => !(p.id === idAlvo && p.empresa_id === tenantId));
      }
      return responder(200, { ok: estado.pedidos.length < antes });
    }

    if (metodo === "GET" && caminho === "/api/produtos") {
      const produtos = estado.catalogo.filter((p) => p.empresa_id === tenantId);
      return responder(200, { produtos });
    }

    if (metodo === "POST" && caminho === "/api/produtos") {
      const dono = modo === "vulneravel-mass-assignment" ? (corpo?.empresaId ?? corpo?.empresa_id ?? tenantId) : tenantId;
      estado.catalogo.push({
        id: corpo.id,
        nome: corpo.nome,
        preco: corpo.preco,
        descricao: corpo.descricao,
        estoque: corpo.estoque ?? 10,
        categoria: corpo.categoria,
        empresa_id: dono,
      });
      return responder(201, { ok: true });
    }

    if (metodo === "PUT" && caminho.startsWith("/api/estoque/")) {
      const prodId = caminho.replace("/api/estoque/", "");
      const item = estado.catalogo.find((p) => p.id === prodId && p.empresa_id === tenantId);
      if (item) item.estoque = Number(corpo?.quantidade ?? item.estoque);
      return responder(200, { ok: Boolean(item) });
    }

    if (metodo === "POST" && caminho === "/api/senha") {
      const loja = estado.lojas.get(tenantId);
      const nova = String(corpo?.novaSenha ?? "");
      if (nova.length < 8 || SENHAS_FRACAS.has(nova.toLowerCase())) {
        return responder(400, { erro: "Senha fraca" });
      }
      await banco.redefinirSenha(loja.id, nova);
      return responder(200, { ok: true });
    }

    return responder(404, { erro: "Rota não encontrada" });
  }

  return {
    nome: "shopbot-ecommerce-exemplo",
    contas,
    banco,
    http,
    webhookTokenConfigurado: true,
    evolutionFalsa: null,
    tentativasForcaBruta: 8,
    semear: () => banco.semear(contas),
    fechar: () => banco.fechar(),
    loginBruto: (login, senha) => http("POST", "/api/login", { corpo: { login, senha } }),
    async login(conta) {
      const r = await http("POST", "/api/login", { corpo: { login: conta.login, senha: conta.senha } });
      if (r.status !== 200 || !r.body?.token) throw new Error(`Falha de login no ShopBot: ${r.status}`);
      return r.body.token;
    },
    rotasProtegidas: [
      ["GET", "/api/pedidos"],
      ["DELETE", "/api/pedidos/100"],
      ["GET", "/api/produtos"],
      ["POST", "/api/produtos"],
      ["PUT", "/api/estoque/marg"],
      ["GET", "/api/empresa"],
      ["PUT", "/api/empresa"],
      ["POST", "/api/senha"],
    ],
    forjarTokens(token, empresaIdAlvo) {
      const [, assinatura] = token.split(".");
      const trocado = Buffer.from(JSON.stringify({ tenantId: empresaIdAlvo })).toString("base64url");
      return [
        { descricao: "payload trocado, assinatura original", token: `${trocado}.${assinatura}` },
        { descricao: "payload trocado, sem assinatura", token: trocado },
        { descricao: "payload trocado, assinatura vazia", token: `${trocado}.` },
        { descricao: "payload trocado, assinatura aleatória", token: `${trocado}.${randomBytes(16).toString("base64url")}` },
      ];
    },
    webhook(headers = {}) {
      return http("POST", "/webhook/mensagem", { headers, corpo: { evento: "mensagem_teste" } });
    },
  };
}

export async function executarDemoBotExemplo(modo = "seguro") {
  const alvo = criarAdaptadorBotExemplo({ modo });
  const ctx = await alvo.semear();
  const rodada = new Rodada();
  await rodada.bateria("isolamento", () => bateriaIsolamento(rodada, alvo, ctx));
  await rodada.bateria("appsec", () => bateriaAppSec(rodada, alvo, ctx));
  await alvo.fechar();
  return rodada;
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDireto) {
  executarDemoBotExemplo().then((rodada) => {
    const r = rodada.resumo();
    console.log(`ATLAS Demo [ShopBot E-Commerce] → ${r.defendido}/${r.total} defendidas (${r.vulneravel} vulneráveis, ${r.pulado} puladas)`);
  });
}
