import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gerarMarkdown,
  gerarJson,
  salvarHistorico,
  carregarHistorico,
  formatarNomeHistorico,
  resumirEvolucao,
} from "../src/relatorios.mjs";
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

test("salvarHistorico cria a pasta historico/ com formato YYYY-MM-DD_HH-mm-ss.json e campos obrigatórios", async () => {
  const baseTmp = mkdtempSync(join(tmpdir(), "atlas-hist-"));
  const dirHistorico = join(baseTmp, "historico");
  try {
    const r = await rodadaDeExemplo();
    const resumo = r.resumo();
    const meta = { geradoEm: "2026-11-02T17:30:45.000Z", descricaoAlvo: "alvo de teste" };

    const salvo = salvarHistorico(resumo, r.achados, meta, dirHistorico);
    assert.ok(salvo, "salvarHistorico deveria retornar os dados do arquivo salvo");
    assert.match(salvo.arquivo, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);

    const arquivos = readdirSync(dirHistorico);
    assert.equal(arquivos.length, 1);

    const conteudo = JSON.parse(readFileSync(salvo.caminho, "utf8"));
    assert.equal(conteudo.timestamp, meta.geradoEm);
    assert.equal(conteudo.pontuacaoGeral, "1/3");
    assert.equal(conteudo.totalSondas, 3);
    assert.equal(conteudo.defendidas, 1);
    assert.deepEqual(conteudo.falhasPorGravidade, { alta: 1 });
    assert.equal(conteudo.resumoAchados.length, 3);
  } finally {
    rmSync(baseTmp, { recursive: true, force: true });
  }
});

test("salvarHistorico aplica redação de segredos ANTES de persistir no histórico", () => {
  const baseTmp = mkdtempSync(join(tmpdir(), "atlas-redact-"));
  const dirHistorico = join(baseTmp, "historico");
  try {
    const hashSecreto = "ab".repeat(32);
    const tokenSecreto = "eyJhbGciOiJIUzI1NiJ9.eyJlbXByZXNhSWQiOjF9";
    const achadosCrus = [
      {
        id: "APP-03",
        categoria: "exposição de dados",
        titulo: "Vazamento com segredo",
        gravidade: GRAV.ALTA,
        resultado: "VULNERAVEL",
        esperado: "nenhum segredo",
        obtido: `Authorization: Bearer ${tokenSecreto} hash=${hashSecreto} "senha": "super-secreta-123"`,
        correcao: "filtrar campos",
      },
    ];
    const resumo = { total: 1, defendido: 0, vulneravel: 1, pulado: 0, erro: 0, porGravidade: { alta: 1 } };
    const salvo = salvarHistorico(resumo, achadosCrus, { geradoEm: "2026-11-02T18:00:00.000Z", descricaoAlvo: "alvo" }, dirHistorico);

    const textoDisco = readFileSync(salvo.caminho, "utf8");
    assert.ok(!textoDisco.includes(hashSecreto), "hash hex longo não pode ser salvo no histórico");
    assert.ok(!textoDisco.includes(tokenSecreto), "token não pode ser salvo no histórico");
    assert.ok(!textoDisco.includes("super-secreta-123"), "senha não pode ser salva no histórico");
    assert.ok(textoDisco.includes("[redigido]") || textoDisco.includes("[hex-redigido]"));
  } finally {
    rmSync(baseTmp, { recursive: true, force: true });
  }
});

test("carregarHistorico tolera pasta inexistente e JSON corrompido sem derrubar a execução", () => {
  const baseTmp = mkdtempSync(join(tmpdir(), "atlas-fault-"));
  const dirInexistente = join(baseTmp, "nao-existe");
  const dirComCorrompido = join(baseTmp, "historico");
  try {
    // 1) Pasta não existe → retorna array vazio sem lançar erro
    assert.deepEqual(carregarHistorico(dirInexistente), []);

    // 2) Pasta com um registro válido e dois arquivos JSON corrompidos
    salvarHistorico(
      { total: 10, defendido: 8, vulneravel: 2, pulado: 0, erro: 0, porGravidade: { alta: 2 } },
      [],
      { geradoEm: "2026-11-01T10:00:00.000Z", descricaoAlvo: "alvo" },
      dirComCorrompido
    );
    writeFileSync(join(dirComCorrompido, "2026-11-01_11-00-00.json"), "{ json corrompido sem fechar", "utf8");
    writeFileSync(join(dirComCorrompido, "2026-11-01_12-00-00.json"), "null", "utf8");

    const carregados = carregarHistorico(dirComCorrompido);
    assert.equal(carregados.length, 1);
    assert.equal(carregados[0].pontuacaoGeral, "8/10");
  } finally {
    rmSync(baseTmp, { recursive: true, force: true });
  }
});

test("gerarMarkdown e gerarPainel exibem a evolução temporal (ex: 'de 8/10 para 10/10') a partir do histórico", () => {
  const baseTmp = mkdtempSync(join(tmpdir(), "atlas-evo-"));
  const dirHistorico = join(baseTmp, "historico");
  try {
    salvarHistorico(
      { total: 10, defendido: 8, vulneravel: 2, pulado: 0, erro: 0, porGravidade: { alta: 2 } },
      [],
      { geradoEm: "2026-11-01T12:00:00.000Z", descricaoAlvo: "alvo" },
      dirHistorico
    );
    const metaAtual = { geradoEm: "2026-11-02T12:00:00.000Z", descricaoAlvo: "alvo", dirHistorico };
    const resumoAtual = { total: 10, defendido: 10, vulneravel: 0, pulado: 0, erro: 0, porGravidade: {} };
    salvarHistorico(resumoAtual, [], metaAtual, dirHistorico);

    const historico = carregarHistorico(dirHistorico);
    assert.equal(historico.length, 2);

    const evolucao = resumirEvolucao(resumoAtual, historico, metaAtual);
    assert.equal(evolucao.texto, "de 8/10 para 10/10");

    const md = gerarMarkdown(resumoAtual, [], metaAtual, historico);
    assert.ok(md.includes("de 8/10 para 10/10"), "Markdown deve exibir a evolução 'de 8/10 para 10/10'");

    const html = gerarPainel({ geradoEm: metaAtual.geradoEm, resumo: resumoAtual, achados: [], historico });
    assert.ok(html.includes("de 8/10 para 10/10"), "Painel HTML deve exibir a evolução 'de 8/10 para 10/10'");

    const nomeFmt = formatarNomeHistorico("2026-11-02T12:00:00.000Z");
    assert.match(nomeFmt, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
  } finally {
    rmSync(baseTmp, { recursive: true, force: true });
  }
});
