import { ordenar } from "./nucleo.mjs";

const ICONE = { VULNERAVEL: "🔴", erro: "⚪", pulado: "🟡", defendido: "🟢" };
const ROTULO = { VULNERAVEL: "vulnerável — precisa corrigir", erro: "erro na execução", pulado: "pulado", defendido: "defendido" };

export function gerarMarkdown(r, achados, meta) {
  const data = new Date(meta.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const L = [];
  L.push("# ATLAS — Relatório de Red Team do Vendly", "");
  L.push(`**Data:** ${data}  `, `**Alvo:** ${meta.descricaoAlvo}  `, `**Escopo:** isolamento entre empresas, autenticação, política de senha, exposição de dados, XSS, força bruta e injeção.`, "");
  L.push("## Resumo", "", `Foram executados **${r.total}** testes de ataque.`, "");
  L.push(`- 🟢 **${r.defendido}** defesas funcionaram (o ataque foi bloqueado)`);
  L.push(`- 🔴 **${r.vulneravel}** vulnerabilidades / pontos a corrigir`);
  if (r.pulado) L.push(`- 🟡 **${r.pulado}** testes pulados (checagem opcional não habilitada)`);
  if (r.erro) L.push(`- ⚪ **${r.erro}** testes com erro de execução (não contam como defendidos)`);
  L.push("");
  L.push("| ID | Teste | Gravidade | Resultado |", "|----|-------|-----------|-----------|");
  for (const a of ordenar(achados)) {
    const ic = { VULNERAVEL: "🔴 corrigir", erro: "⚪ erro", pulado: "🟡 pulado", defendido: "🟢 defendido" }[a.resultado];
    L.push(`| ${a.id} | ${a.titulo} | ${a.gravidade} | ${ic} |`);
  }
  L.push("", "## Detalhes", "");
  for (const a of ordenar(achados)) {
    L.push(`### ${ICONE[a.resultado]} ${a.id} — ${a.titulo}`, "");
    L.push(`- **Categoria:** ${a.categoria}`, `- **Gravidade:** ${a.gravidade}`, `- **Resultado:** ${ROTULO[a.resultado]}`);
    if (a.reproduzir) L.push(`- **Como reproduzir:** ${a.reproduzir}`);
    L.push(`- **Esperado:** ${a.esperado}`, `- **Obtido:** ${a.obtido}`);
    if (a.correcao) L.push(`- **Correção sugerida:** ${a.correcao}`);
    L.push("");
  }
  L.push("---", "", "_Relatório gerado pelo ATLAS. Testes contra uma cópia de teste isolada — nenhum dado de produção foi tocado._");
  return L.join("\n");
}

export function gerarJson(r, achados, meta) {
  return JSON.stringify({ geradoEm: meta.geradoEm, alvo: meta.descricaoAlvo, resumo: r, achados: ordenar(achados) }, null, 2);
}
