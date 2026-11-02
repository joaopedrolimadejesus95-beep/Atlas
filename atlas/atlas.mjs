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
//   node atlas.mjs
//
// SAÍDA (em ATLAS_SAIDA, padrão a pasta atual)
//   RELATORIO.md · findings.json · painel.html
//
// CÓDIGO DE SAÍDA (útil em CI): 0 tudo defendido · 2 há vulnerabilidade · 3 só erro
// =============================================================================
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { carregarConfig, ErroConfig } from "./src/config.mjs";
import { criarBancoPg } from "./src/banco-pg.mjs";
import { criarAdaptadorVendly } from "./src/adaptador-vendly.mjs";
import { Rodada, ordenar } from "./src/nucleo.mjs";
import { bateriaIsolamento } from "./src/sondas/isolamento.mjs";
import { bateriaAppSec } from "./src/sondas/appsec.mjs";
import { bateriaSegurancaIa } from "./src/sondas/seguranca-ia.mjs";
import { subirEvolutionFalsa } from "./src/evolution-falsa.mjs";
import { gerarMarkdown, gerarJson } from "./src/relatorios.mjs";
import { gerarPainel } from "./src/painel/gerar.mjs";

async function principal() {
  let config;
  try {
    config = carregarConfig();
  } catch (e) {
    if (e instanceof ErroConfig) { console.error(`ATLAS recusou rodar: ${e.message}`); process.exit(1); }
    throw e;
  }

  console.log("ATLAS — iniciando rodada de red team");
  console.log(`  alvo: ${config.alvoUrl}`);
  console.log(`  banco: ${config.nomeBanco}\n`);

  const banco = criarBancoPg(config.databaseUrl);

  let evolutionFalsa = null;
  if (config.evolutionLigada) {
    evolutionFalsa = await subirEvolutionFalsa(config.evolutionPorta);
    console.log(`→ Evolution falsa no ar em ${evolutionFalsa.url} — confirme que a EVOLUTION_API_URL do Vendly de teste aponta pra cá.\n`);
  } else {
    console.log("→ Bateria de segurança de IA desligada (defina ATLAS_EVOLUTION=on pra ligar — ver README).\n");
  }

  const alvo = criarAdaptadorVendly({
    alvoUrl: config.alvoUrl, banco, webhookToken: config.webhookToken, timeoutMs: config.timeoutMs, evolutionFalsa,
  });
  alvo.adminHtml = config.adminHtml;
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
    console.log("→ Bateria: segurança de IA...");
    await rodada.bateria("seguranca-ia", () => bateriaSegurancaIa(rodada, alvo, ctx));
  } catch (e) {
    console.error(`\nATLAS parou antes de terminar a rodada: ${e.message}`);
    await banco.fechar().catch(() => {});
    if (evolutionFalsa) await evolutionFalsa.fechar().catch(() => {});
    process.exit(1);
  }

  const r = rodada.resumo();
  const meta = { geradoEm: new Date().toISOString(), descricaoAlvo: `cópia de teste local do Vendly (${config.alvoUrl}, banco ${config.nomeBanco})` };
  const dados = { geradoEm: meta.geradoEm, alvo: meta.descricaoAlvo, resumo: r, achados: ordenar(rodada.achados) };

  writeFileSync(join(config.saida, "RELATORIO.md"), gerarMarkdown(r, rodada.achados, meta));
  writeFileSync(join(config.saida, "findings.json"), gerarJson(r, rodada.achados, meta));
  writeFileSync(join(config.saida, "painel.html"), gerarPainel(dados));

  console.log("\n" + "=".repeat(56));
  console.log(`RESULTADO: ${r.defendido} defesas OK · ${r.vulneravel} a corrigir · ${r.pulado} pulados · ${r.erro} erros`);
  console.log("=".repeat(56));
  for (const a of ordenar(rodada.achados)) {
    const ic = { VULNERAVEL: "🔴", erro: "⚪", pulado: "🟡", defendido: "🟢" }[a.resultado];
    console.log(`${ic} ${a.id} [${a.gravidade}] ${a.titulo}`);
  }
  console.log("\nGerados: RELATORIO.md · findings.json · painel.html");

  await banco.fechar();
  if (evolutionFalsa) await evolutionFalsa.fechar();
  process.exit(rodada.codigoDeSaida());
}

principal().catch((e) => { console.error("Erro inesperado no ATLAS:", e); process.exit(1); });
