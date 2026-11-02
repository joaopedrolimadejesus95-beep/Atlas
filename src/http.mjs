// Cliente HTTP mínimo do ATLAS. Sempre com timeout (um alvo travado não pode
// travar a rodada inteira) e sem seguir redirects (um redirect poderia levar o
// ataque pra fora do alvo).

export function criarCliente(baseUrl, { timeoutMs = 10_000 } = {}) {
  return async function http(metodo, caminho, { token, corpo, corpoBruto, headers } = {}) {
    const h = { ...(headers || {}) };
    if (token) h.authorization = `Bearer ${token}`;

    let body;
    if (corpoBruto !== undefined) {
      body = corpoBruto; // texto cru (ex.: JSON quebrado de propósito)
      h["content-type"] = "application/json";
    } else if (corpo !== undefined) {
      body = JSON.stringify(corpo);
      h["content-type"] = "application/json";
    }

    const resp = await fetch(`${baseUrl}${caminho}`, {
      method: metodo,
      headers: h,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await resp.text();
    let parsed;
    try { parsed = JSON.parse(texto); } catch { parsed = texto; }
    return { status: resp.status, body: parsed, texto, headers: resp.headers };
  };
}
