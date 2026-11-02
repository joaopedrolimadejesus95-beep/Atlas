import test from "node:test";
import assert from "node:assert/strict";
import { gerarMarkdown, gerarJson } from "../src/relatorios.mjs";
import { gerarPainel } from "../src/painel/gerar.mjs";
import { Rodada, GRAV } from "../src/nucleo.mjs";

async function rodadaDeExemplo() {
  const r = new Rodada();
  await r.sonda({ id: "A-1", categoria: "isolamento", titulo: "Teste OK", gravidade: GRAV.CRITICA }, async () => ({ seguro: true, esperado: "e", obtido: "o" }));
  await r.sonda({ id: "A-2", categoria: "xss", titulo: "Teste falhou", gravidade: GRAV.ALTA, correcao: "conserte x" }, async () => ({ seguro: false, esperado: "e2", obtido: "o2" }));
  await r.sonda({ id: "A-3", categoria: "xss", titulo: "Teste pulado", gravidade: GRAV.ALTA }, async () => ({ pulado: true, motivo: "sem pré-requisito" }));
  return r;
}

test("gerarMarkdown inclui todos os achados e a contagem bate com o resumo", async () => {
  const r = await rodadaDeExemplo();
  const resumo = r.resumo();
  const md = gerarMarkdown(resumo, r.achados, { geradoEm: new Date().toISOString(), descricaoAlvo: "alvo de teste" });
  assert.ok(md.includes("A-1"));
  assert.ok(md.includes("A-2"));
  assert.ok(md.includes("A-3"));
  assert.ok(md.includes(`**${resumo.defendido}**`));
  assert.ok(md.includes("conserte x"));
});

test("gerarJson produz JSON válido com o mesmo total de achados", async () => {
  const r = await rodadaDeExemplo();
  const resumo = r.resumo();
  const texto = gerarJson(resumo, r.achados, { geradoEm: new Date().toISOString(), descricaoAlvo: "alvo de teste" });
  const dados = JSON.parse(texto);
  assert.equal(dados.achados.length, 3);
  assert.equal(dados.resumo.total, resumo.total);
});

test("gerarPainel produz HTML autocontido, escapa achado malicioso e não quebra com XSS no próprio título", async () => {
  const r = new Rodada();
  await r.sonda(
    { id: "X-1", categoria: "xss", titulo: '<img src=x onerror=alert(1)>', gravidade: GRAV.ALTA },
    async () => ({ seguro: false, esperado: "e", obtido: '<script>alert(2)</script>' })
  );
  const resumo = r.resumo();
  const html = gerarPainel({ geradoEm: new Date().toISOString(), resumo, achados: r.achados });
  assert.ok(html.includes("<title>ATLAS Console</title>"));
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"), "título malicioso deveria estar escapado");
  assert.ok(!html.includes("<script>alert(2)</script>"), "'obtido' malicioso deveria estar escapado");
  assert.ok(html.includes("&lt;img") || html.includes("&lt;script"));
});

test("gerarPainel não quebra com zero achados", () => {
  const html = gerarPainel({ geradoEm: new Date().toISOString(), resumo: { total: 0, defendido: 0, vulneravel: 0, pulado: 0, erro: 0, porGravidade: {} }, achados: [] });
  assert.ok(html.includes("ATLAS Console"));
});
