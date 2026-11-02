// =============================================================================
// Análise estática HEURÍSTICA do admin.html: procura linhas que montam HTML
// com um campo digitado por usuário SEM passar por esc().
// É um filtro, não uma prova: não executa o navegador. Serve pra pegar o erro
// comum (esquecer o esc() num innerHTML novo) e dar a linha exata.
// =============================================================================

// Campos que vêm de gente (cliente do WhatsApp ou dono da empresa).
export const CAMPOS_DO_USUARIO = ["nome", "descricao", "categoria", "endereco", "numero_cliente", "numeroCliente", "login", "observacao", "obs"];

const CAMPO = new RegExp(`\\.(?:${CAMPOS_DO_USUARIO.join("|")})\\b`);
const TEM_ESC = /function\s+esc\s*\(|(?:const|let|var)\s+esc\s*=/;

// Remove chamadas esc(...) (aceita um nível de parênteses dentro) pra sobrar
// só o que NÃO foi escapado.
function semEsc(linha) {
  return linha.replace(/\besc\s*\((?:[^()]|\([^()]*\))*\)/g, "");
}

export function analisarXss(html) {
  const temEsc = TEM_ESC.test(html);
  const naoEscapados = [];
  let montaHtml = 0;

  html.split("\n").forEach((linha, i) => {
    const pareceMontarHtml = /<[a-zA-Z\/]/.test(linha) || /innerHTML|insertAdjacentHTML|outerHTML/.test(linha);
    if (!pareceMontarHtml) return;
    montaHtml++;
    const resto = semEsc(linha);
    if (CAMPO.test(resto)) naoEscapados.push({ linha: i + 1, trecho: linha.trim().slice(0, 120) });
  });

  return { temEsc, montaHtml, naoEscapados };
}
