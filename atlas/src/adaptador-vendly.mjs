// =============================================================================
// ADAPTADOR — a ÚNICA parte que conhece o Vendly: rotas, formato do login,
// formato do token. Para apontar o ATLAS a outro bot, reescreva este arquivo
// (e o banco, se não for Postgres). As sondas só falam com esta interface.
// =============================================================================
import { randomBytes } from "node:crypto";
import { criarCliente } from "./http.mjs";
import { gerarContas } from "./cenario.mjs";

const b64u = (texto) => Buffer.from(texto).toString("base64url");

export function criarAdaptadorVendly({ alvoUrl, banco, webhookToken = null, timeoutMs = 10_000, evolutionFalsa = null }) {
  const http = criarCliente(alvoUrl, { timeoutMs });
  const contas = gerarContas();

  return {
    nome: "vendly",
    contas,
    banco, // verdade absoluta (ver banco-pg.mjs)
    http,
    webhookTokenConfigurado: Boolean(webhookToken),
    // Presença opcional (ver src/evolution-falsa.mjs): liga a bateria de
    // segurança de IA (src/sondas/seguranca-ia.mjs). Sem isso, essa bateria
    // pula com instrução de como habilitar.
    evolutionFalsa,

    async verificarNoAr() {
      try {
        await http("GET", "/health");
      } catch {
        throw new Error(`Não alcancei o alvo em ${alvoUrl}. Suba a cópia de teste do Vendly primeiro.`);
      }
    },

    semear: () => banco.semear(contas),
    fechar: () => banco.fechar(),

    // Login "cru": devolve a resposta inteira (as sondas de ataque precisam do status).
    loginBruto: (login, senha) => http("POST", "/api/login", { corpo: { login, senha } }),

    // Login "de verdade": devolve o token ou lança erro (falha de preparo, não ataque).
    async login(conta) {
      const r = await http("POST", "/api/login", { corpo: { login: conta.login, senha: conta.senha } });
      const token = r.status === 200 ? r.body?.token : null;
      if (!token) throw new Error(`Não consegui logar como "${conta.login}" (status ${r.status}) — o seed rodou e o servidor está no ar?`);
      return token;
    },

    // Rotas que exigem login. A sonda ISO-06 chama todas sem token.
    rotasProtegidas: [
      ["GET", "/api/pedidos"],
      ["DELETE", "/api/pedidos/1"],
      ["GET", "/api/produtos"],
      ["POST", "/api/produtos"],
      ["PUT", "/api/estoque/marg"],
      ["GET", "/api/empresa"],
      ["PUT", "/api/empresa"],
      ["POST", "/api/senha"],
    ],

    // Formato do token do Vendly: base64url(payload JSON) + "." + HMAC.
    // Devolve variações adulteradas que apontam pra outra empresa.
    forjarTokens(token, empresaIdAlvo) {
      const [payloadB64, assinatura] = token.split(".");
      if (!payloadB64 || !assinatura) throw new Error("Formato de token inesperado (esperado payload.assinatura).");
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
      const trocado = b64u(JSON.stringify({ ...payload, empresaId: empresaIdAlvo }));
      return [
        { descricao: "payload trocado, assinatura original", token: `${trocado}.${assinatura}` },
        { descricao: "payload trocado, sem assinatura", token: trocado },
        { descricao: "payload trocado, assinatura vazia", token: `${trocado}.` },
        { descricao: "payload trocado, assinatura aleatória", token: `${trocado}.${randomBytes(32).toString("base64url")}` },
      ];
    },

    webhook(headers = {}) {
      return http("POST", "/webhook/mensagem", {
        headers,
        corpo: {
          instance: contas.burgerA.instancia,
          data: { key: { remoteJid: "551199999@s.whatsapp.net" }, message: { conversation: "oi" } },
        },
      });
    },

    // Manda uma mensagem "de cliente" pra empresa dada e devolve o TEXTO que o
    // bot respondeu (lido da Evolution falsa) — ou null se não respondeu a
    // tempo. Precisa de evolutionFalsa (ver acima) e de WEBHOOK_TOKEN, porque
    // a rota exige o header quando configurado.
    async perguntarIA(instancia, numeroCliente, texto, { timeoutMs } = {}) {
      if (!this.evolutionFalsa) throw new Error("perguntarIA chamado sem evolutionFalsa configurada.");
      const headers = {};
      if (webhookToken) headers["x-webhook-token"] = webhookToken;
      const r = await http("POST", "/webhook/mensagem", {
        headers,
        corpo: { instance: instancia, data: { key: { remoteJid: numeroCliente }, message: { conversation: texto } } },
      });
      if (r.status < 200 || r.status >= 300) throw new Error(`webhook recusou a mensagem de teste (status ${r.status}) — confira WEBHOOK_TOKEN.`);
      return this.evolutionFalsa.esperarResposta(numeroCliente, { timeoutMs });
    },
  };
}
