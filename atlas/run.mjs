// ATLAS — runner
// -----------------------------------------------------------------------------
// Orquestra uma rodada completa: (1) semeia o ambiente de teste, (2) roda as
// baterias de ataque contra o Vendly que já está no ar, (3) gera o relatório
// de achados (RELATORIO.md) e imprime um resumo.
//
// Uso: node run.mjs   (com o servidor Vendly de teste no ar e as envs setadas)

import { writeFileSync } from "fs";
import { pool } from "../vendly_src/vendly-main/src/db.js";
import { semear } from "./seed.mjs";
import { getAchados, resumo, GRAVIDADE } from "./atlas.mjs";
import * as isolamento from "./tests/isolation.mjs";
import * as appsec from "./tests/appsec.mjs";

const ORDEM_GRAVIDADE = [GRAVIDADE.CRITICA, GRAVIDADE.ALTA, GRAVIDADE.MEDIA, GRAVIDADE.BAIXA, GRAVIDADE.INFO];

function gerarRelatorio(achados, r) {
  const data = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const L = [];
  L.push("# ATLAS — Relatório de Red Team do Vendly");
  L.push("");
  L.push(`**Data:** ${data}  `);
  L.push(`**Alvo:** cópia de teste local do Vendly (banco isolado, duas empresas fictícias)  `);
  L.push(`**Escopo:** isolamento entre empresas, autenticação, política de senha, exposição de dados e XSS.`);
  L.push("");
  L.push("## Resumo");
  L.push("");
  L.push(`Foram executados **${r.total}** testes de ataque.`);
  L.push("");
  L.push(`- 🟢 **${r.defendido}** defesas funcionaram (o ataque foi bloqueado)`);
  L.push(`- 🔴 **${r.vulneravel}** vulnerabilidades / pontos a corrigir`);
  if (r.erro) L.push(`- ⚪ **${r.erro}** testes com erro de execução (revisar a sonda)`);
  L.push("");
  if (r.vulneravel > 0) {
    const porG = ORDEM_GRAVIDADE.filter((g) => r.porGravidade[g]).map((g) => `${r.porGravidade[g]} ${g}`).join(", ");
    L.push(`Dos pontos a corrigir: ${porG}.`);
    L.push("");
  }

  // Tabela-resumo
  L.push("| ID | Teste | Gravidade | Resultado |");
  L.push("|----|-------|-----------|-----------|");
  const ordenados = [...achados].sort((a, b) => {
    const rank = (x) => (x.resultado === "VULNERAVEL" ? 0 : x.resultado === "erro" ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return ORDEM_GRAVIDADE.indexOf(a.gravidade) - ORDEM_GRAVIDADE.indexOf(b.gravidade);
  });
  for (const a of ordenados) {
    const icone = a.resultado === "VULNERAVEL" ? "🔴 corrigir" : a.resultado === "erro" ? "⚪ erro" : "🟢 defendido";
    L.push(`| ${a.id} | ${a.titulo} | ${a.gravidade} | ${icone} |`);
  }
  L.push("");

  // Detalhe de cada achado
  L.push("## Detalhes");
  L.push("");
  for (const a of ordenados) {
    const icone = a.resultado === "VULNERAVEL" ? "🔴" : a.resultado === "erro" ? "⚪" : "🟢";
    L.push(`### ${icone} ${a.id} — ${a.titulo}`);
    L.push("");
    L.push(`- **Categoria:** ${a.categoria}`);
    L.push(`- **Gravidade:** ${a.gravidade}`);
    L.push(`- **Resultado:** ${a.resultado === "VULNERAVEL" ? "vulnerável — precisa corrigir" : a.resultado === "erro" ? "erro na execução do teste" : "defendido"}`);
    if (a.reproduzir) L.push(`- **Como reproduzir:** ${a.reproduzir}`);
    L.push(`- **Esperado:** ${a.esperado}`);
    L.push(`- **Obtido:** ${a.obtido}`);
    if (a.correcao) L.push(`- **Correção sugerida:** ${a.correcao}`);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("_Relatório gerado pelo ATLAS. Os testes rodaram contra uma cópia de teste isolada — nenhum dado de produção foi tocado._");
  return L.join("\n");
}

async function principal() {
  console.log("ATLAS — iniciando rodada de red team\n");

  console.log("→ Semeando ambiente de teste...");
  const ctx = await semear();
  console.log(`  Burger A (id ${ctx.idA}) e Pizza B (id ${ctx.idB}) prontas.\n`);

  console.log("→ Rodando bateria: isolamento entre empresas...");
  await isolamento.rodar(ctx);

  console.log("→ Rodando bateria: segurança da aplicação...");
  await appsec.rodar(ctx);

  const achados = getAchados();
  const r = resumo();

  const md = gerarRelatorio(achados, r);
  writeFileSync("/home/claude/atlas/RELATORIO.md", md);

  console.log("\n" + "=".repeat(56));
  console.log(`RESULTADO: ${r.defendido} defesas OK · ${r.vulneravel} a corrigir · ${r.erro} erros`);
  console.log("=".repeat(56));
  for (const a of achados) {
    const icone = a.resultado === "VULNERAVEL" ? "🔴" : a.resultado === "erro" ? "⚪" : "🟢";
    console.log(`${icone} ${a.id} [${a.gravidade}] ${a.titulo}`);
  }
  console.log("\nRelatório completo: /home/claude/atlas/RELATORIO.md");
}

principal()
  .then(() => pool.end())
  .catch((e) => { console.error("Erro na rodada do ATLAS:", e); pool.end(); process.exit(1); });
