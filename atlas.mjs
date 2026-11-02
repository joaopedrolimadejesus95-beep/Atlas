#!/usr/bin/env node
// =============================================================================
// ATLAS — red team automatizado do Vendly (runner)
//
// PRÉ-REQUISITOS
//   - Uma cópia de TESTE do Vendly rodando (o ATLAS recusa alvos remotos e
//     bancos sem "test"/"teste"/"atlas" no nome — ver src/config.mjs).
//   - Dependência: "pg".
//
// COMO RODAR
//   ALVO_URL=http://127.0.0.1:3000 \
//   DATABASE_URL=postgres://postgres@127.0.0.1:5433/vendly_test \
//   ADMIN_HTML=/caminho/para/public/admin.html \   (opcional: liga o teste de XSS)
//   WEBHOOK_TOKEN=... \                            (opcional: confirma a config do webhook)
//   node atlas.mjs [--so-json] [--sem-xss] [--sem-ia] [--ajuda]
//
// SAÍDA (em ATLAS_SAIDA, padrão a pasta atual)
//   RELATORIO.md · findings.json · painel.html · historico/YYYY-MM-DD_HH-mm-ss.json
//
// CÓDIGO DE SAÍDA (útil em CI): 0 tudo defendido · 2 há vulnerabilidade · 3 só erro
// =============================================================================
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { carregarConfig, parsearCli, gerarTextoAjuda, ErroConfig } from "./src/config.mjs";
import { criarAdaptadorVendly } from "./src/adaptador-vendly.mjs";
import { Rodada, ordenar } from "./src/nucleo.mjs";
import { bateriaIsolamento } from "./src/sondas/isolamento.mjs";
import { bateriaAppSec } from "./src/sondas/appsec.mjs";
import { bateriaSegurancaIa } from "./src/sondas/seguranca-ia.mjs";
import { subirEvolutionFalsa } from "./src/evolution-falsa.mjs";
import { gerarMarkdown, gerarJson, salvarHistorico, carregarHistorico, resumirEvolucao } from "./src/relatorios.mjs";
import { gerarPainel } from "./src/painel/gerar.mjs";

export { parseArgs, parsearCli, gerarTextoAjuda };

export async function principal(argv = process.argv.slice(2), env = process.env) {
  let config;
  try {
    config = carregarConfig(env, argv);
  } catch (e) {
    if (e instanceof ErroConfig) { console.error(`ATLAS recusou rodar: ${e.message}`); process.exit(1); }
    throw e;
  }

  if (config.ajuda) {
    console.log(config.textoAjuda);
    return 0;
  }

  console.log("ATLAS — iniciando rodada de red team");
  console.log(`  alvo: ${config.alvoUrl}`);
  console.log(`  banco: ${config.nomeBanco}\n`);

  const { criarBancoPg } = await import("./src/banco-pg.mjs");
  const banco = criarBancoPg(config.databaseUrl);

  let evolutionFalsa = null;
  if (config.evolutionLigada && !config.semIa) {
    evolutionFalsa = await subirEvolutionFalsa(config.evolutionPorta);
    console.log(`→ Evolution falsa no ar em ${evolutionFalsa.url} — confirme que a EVOLUTION_API_URL do Vendly de teste aponta pra cá.\n`);
  } else if (config.semIa) {
    console.log("→ Bateria de segurança de IA desativada via --sem-ia.\n");
  } else {
    console.log("→ Bateria de segurança de IA desligada (defina ATLAS_EVOLUTION=on pra ligar — ver README).\n");
  }

  const alvo = criarAdaptadorVendly({
    alvoUrl: config.alvoUrl, banco, webhookToken: config.webhookToken, timeoutMs: config.timeoutMs, evolutionFalsa,
  });
  alvo.adminHtml = config.adminHtml;
  alvo.semXss = config.semXss;
  alvo.tentativasForcaBruta = config.tentativasForcaBruta;

  const rodada = new Rodada();

  try {
    await alvo.verificarNoAr();

    console.log("→ Semeando ambiente de teste...");
    const ctx = await alvo.semear();
    console.log(`  Burger A (id ${ctx.idA}) e Pizza B (id ${ctx.idB}) prontas.\n`);

    console.log("→ Bateria: isolamento entre empresas...");
    await rodada.bateria("isolamento", () => bateriaIsolamento(rodada, alvo, ctx));
    console.log("→ Bateria: segurança da aplicação...");
    await rodada.bateria("appsec", () => bateriaAppSec(rodada, alvo, ctx));
    if (!config.semIa) {
      console.log("→ Bateria: segurança de IA...");
      await rodada.bateria("seguranca-ia", () => bateriaSegurancaIa(rodada, alvo, ctx));
    }
  } catch (e) {
    console.error(`\nATLAS parou antes de terminar a rodada: ${e.message}`);
    await banco.fechar().catch(() => {});
    if (evolutionFalsa) await evolutionFalsa.fechar().catch(() => {});
    process.exit(1);
  }

  const r = rodada.resumo();
  const dirHistorico = join(config.saida, "historico");
  const meta = {
    geradoEm: new Date().toISOString(),
    descricaoAlvo: `cópia de teste local do Vendly (${config.alvoUrl}, banco ${config.nomeBanco})`,
    dirHistorico,
  };

  salvarHistorico(r, rodada.achados, meta, dirHistorico);
  const historico = carregarHistorico(dirHistorico);
  const evolucao = resumirEvolucao(r, historico, meta);
  const dados = { geradoEm: meta.geradoEm, alvo: meta.descricaoAlvo, resumo: r, achados: ordenar(rodada.achados), historico };

  writeFileSync(join(config.saida, "findings.json"), gerarJson(r, rodada.achados, meta, historico));
  if (!config.soJson) {
    writeFileSync(join(config.saida, "RELATORIO.md"), gerarMarkdown(r, rodada.achados, meta, historico));
    writeFileSync(join(config.saida, "painel.html"), gerarPainel(dados, historico));
  }

  console.log("\n" + "=".repeat(56));
  console.log(`RESULTADO: ${r.defendido} defesas OK · ${r.vulneravel} a corrigir · ${r.pulado} pulados · ${r.erro} erros`);
  if (evolucao) console.log(`EVOLUÇÃO: ${evolucao.texto}`);
  console.log("=".repeat(56));
  for (const a of ordenar(rodada.achados)) {
    const ic = { VULNERAVEL: "🔴", erro: "⚪", pulado: "🟡", defendido: "🟢" }[a.resultado];
    console.log(`${ic} ${a.id} [${a.gravidade}] ${a.titulo}`);
  }
  console.log(config.soJson ? "\nGerado: findings.json" : "\nGerados: RELATORIO.md · findings.json · painel.html");

  await banco.fechar();
  if (evolutionFalsa) await evolutionFalsa.fechar();
  process.exit(rodada.codigoDeSaida());
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDireto) {
  principal().catch((e) => { console.error("Erro inesperado no ATLAS:", e); process.exit(1); });
}
