// ATLAS — adaptador do alvo
// -----------------------------------------------------------------------------
// Esta é a ÚNICA peça que conhece os detalhes do Vendly (URL base, formato de
// login, header de token). Toda a bateria de testes fala só com este adaptador.
// Pra apontar o ATLAS a outro bot no futuro, basta reescrever este arquivo —
// os testes não mudam.

const BASE = process.env.ALVO_URL || "http://127.0.0.1:3000";

// Chamada HTTP crua. Devolve sempre { status, body } — nunca lança por status
// de erro, porque pra um teste de segurança o 401/403/404 É o resultado que a
// gente quer medir, não uma exceção pra tratar.
export async function http(metodo, caminho, { token, corpo, headers } = {}) {
  const h = { "content-type": "application/json", ...(headers || {}) };
  if (token) h.authorization = `Bearer ${token}`;
  const resp = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: h,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  let body;
  const texto = await resp.text();
  try { body = JSON.parse(texto); } catch { body = texto; }
  return { status: resp.status, body };
}

// Faz login e devolve o token (ou null se recusado). Serve tanto pra dono
// quanto pra atendente — o Vendly usa a mesma rota pros dois.
export async function login(usuario, senha) {
  const { status, body } = await http("POST", "/api/login", { corpo: { login: usuario, senha } });
  return status === 200 ? body.token : null;
}

export { BASE };
