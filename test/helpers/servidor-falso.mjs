// Sobe o Vendly falso (vendly-falso.mjs) num servidor HTTP real em localhost,
// numa porta livre, ligado ao MESMO banco falso dos testes — assim os testes
// passam pelo cliente fetch de verdade (src/http.mjs) e o "banco" que as
// sondas consultam é a mesma fonte de dados que o servidor muta.
import { createServer } from "node:http";
import { criarVendlyFalso } from "./vendly-falso.mjs";

export async function subirServidorFalso(modo, banco, { configurarBot } = {}) {
  const falso = criarVendlyFalso(modo, banco);
  if (configurarBot) configurarBot(falso); // ex.: ligarBotDeIaFalso (ver vendly-falso.mjs)
  const httpServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bruto = Buffer.concat(chunks).toString("utf8");
    let corpo;
    try { corpo = bruto ? JSON.parse(bruto) : undefined; } catch { corpo = bruto; }
    const url = new URL(req.url, "http://localhost");
    const r = await falso.server.lidar(req.method, url.pathname, { headers: req.headers, corpo });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(r.body !== undefined ? JSON.stringify(r.body) : "null");
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const porta = httpServer.address().port;
  return { url: `http://127.0.0.1:${porta}`, fechar: () => new Promise((resolve) => httpServer.close(resolve)) };
}
