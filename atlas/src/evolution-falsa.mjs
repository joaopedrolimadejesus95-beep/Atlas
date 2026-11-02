// =============================================================================
// EVOLUTION FALSA — um servidor HTTP local que imita o endpoint de ENVIO da
// Evolution API (o gateway de WhatsApp que o Vendly usa — ver evolution_instance
// no banco). O Vendly real manda a resposta do bot fazendo uma chamada de SAÍDA
// pra Evolution; este servidor fica no lugar da Evolution de verdade só durante
// a rodada de teste, e guarda o que o bot tentou mandar — é assim que o ATLAS
// "lê" a resposta de um bot assíncrono sem precisar de WhatsApp de verdade.
//
// PRECISA DISSO NO AMBIENTE DE TESTE DO VENDLY:
//   Apontar a variável que o Vendly usa pra falar com a Evolution (geralmente
//   EVOLUTION_API_URL) pra http://127.0.0.1:<porta-impressa-no-início>.
//
// SUPOSIÇÃO A CONFIRMAR: estou aceitando o formato oficial de envio de texto da
// Evolution API — POST /message/sendText/:instance — com o número e o texto em
// algum destes formatos comuns ({number,text} ou {number,textMessage:{text}}).
// Se o Vendly chamar de outro jeito, ajuste só o `extrairEnvio()` abaixo.
// =============================================================================
import { createServer } from "node:http";

function extrairEnvio(caminho, corpo) {
  const m = /^\/message\/sendText\/(.+)$/.exec(caminho);
  if (!m) return null;
  const instancia = decodeURIComponent(m[1]);
  const numero = corpo?.number ?? corpo?.remoteJid ?? null;
  const texto = corpo?.text ?? corpo?.textMessage?.text ?? corpo?.message?.text ?? null;
  if (!numero || texto == null) return null;
  return { instancia, numero, texto };
}

// porta fixa (padrão) pra você configurar UMA VEZ a EVOLUTION_API_URL do
// Vendly de teste e nunca mais precisar trocar — a cada rodada o ATLAS sobe
// de novo nessa mesma porta. Mude com ATLAS_EVOLUTION_PORTA se já estiver em uso.
export const PORTA_PADRAO = 4001;

export async function subirEvolutionFalsa(porta = PORTA_PADRAO) {
  const mensagens = new Map(); // numero -> [texto, texto, ...] (em ordem de chegada)

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let corpo;
    try { corpo = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { corpo = {}; }
    const url = new URL(req.url, "http://localhost");
    const envio = extrairEnvio(url.pathname, corpo);
    if (envio) {
      if (!mensagens.has(envio.numero)) mensagens.set(envio.numero, []);
      mensagens.get(envio.numero).push(envio.texto);
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "PENDING" }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ erro: "rota não reconhecida pela Evolution falsa" }));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(porta, "127.0.0.1", resolve);
    });
  } catch (e) {
    if (e.code === "EADDRINUSE") throw new Error(`Porta ${porta} (Evolution falsa) já está em uso — mude com ATLAS_EVOLUTION_PORTA.`);
    throw e;
  }
  const portaReal = server.address().port;

  return {
    url: `http://127.0.0.1:${portaReal}`,

    // Espera (com timeout) a PRÓXIMA mensagem que o bot mandar pro número dado,
    // a partir de agora — ignora mensagens que já estavam na fila antes da chamada.
    async esperarResposta(numero, { timeoutMs = 15_000, intervaloMs = 250 } = {}) {
      const vistasAntes = mensagens.get(numero)?.length ?? 0;
      const limite = Date.now() + timeoutMs;
      while (Date.now() < limite) {
        const fila = mensagens.get(numero);
        if (fila && fila.length > vistasAntes) return fila[vistasAntes];
        await new Promise((r) => setTimeout(r, intervaloMs));
      }
      return null; // timeout — nenhuma resposta capturada
    },

    todasAs(numero) { return mensagens.get(numero) ?? []; },
    async fechar() { await new Promise((resolve) => server.close(resolve)); },
  };
}
