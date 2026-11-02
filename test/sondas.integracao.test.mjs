// Testes de ponta a ponta: sobe o Vendly falso (HTTP real em localhost) ligado
// ao banco falso, roda as duas baterias de sondas e confere:
//   1) contra o modo "seguro" → tudo "defendido";
//   2) contra cada modo "vulneravel-*" → a sonda certa acusa "VULNERAVEL"
//      (prova que a sonda detecta o bug de verdade, não só no feliz caminho).
import test from "node:test";
import assert from "node:assert/strict";
import { subirServidorFalso } from "./helpers/servidor-falso.mjs";
import { criarBancoFalso } from "./helpers/banco-falso.mjs";
import { criarAdaptadorVendly } from "../src/adaptador-vendly.mjs";
import { Rodada } from "../src/nucleo.mjs";
import { bateriaIsolamento } from "../src/sondas/isolamento.mjs";
import { bateriaAppSec } from "../src/sondas/appsec.mjs";

async function montarCenario(modo) {
  const banco = criarBancoFalso();
  const servidor = await subirServidorFalso(modo, banco);
  const alvo = criarAdaptadorVendly({ alvoUrl: servidor.url, banco, timeoutMs: 4000 });
  alvo.tentativasForcaBruta = 8;
  const ctx = await alvo.semear();
  return { servidor, alvo, ctx };
}

function achado(rodada, id) {
  const a = rodada.achados.find((x) => x.id === id);
  assert.ok(a, `achado ${id} não foi registrado`);
  return a;
}

test("bateria de isolamento: tudo 'defendido' contra o Vendly falso seguro", async () => {
  const { servidor, alvo, ctx } = await montarCenario("seguro");
  const rodada = new Rodada();
  await bateriaIsolamento(rodada, alvo, ctx);
  await servidor.fechar();
  for (const a of rodada.achados) assert.equal(a.resultado, "defendido", `${a.id}: ${a.obtido}`);
  assert.ok(rodada.achados.length >= 7);
});

test("ISO-01 acusa VULNERAVEL quando o IDOR funciona de verdade", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-idor");
  const rodada = new Rodada();
  await bateriaIsolamento(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "ISO-01").resultado, "VULNERAVEL");
});

test("ISO-02 acusa VULNERAVEL quando o catálogo vaza produto de outra empresa", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-vazamento");
  const rodada = new Rodada();
  await bateriaIsolamento(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "ISO-02").resultado, "VULNERAVEL");
});

test("ISO-03 acusa VULNERAVEL quando o estoque de outra empresa muda", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-estoque");
  const rodada = new Rodada();
  await bateriaIsolamento(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "ISO-03").resultado, "VULNERAVEL");
});

test("ISO-07 acusa VULNERAVEL quando mass assignment grava produto em outra empresa", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-mass-assignment");
  const rodada = new Rodada();
  await bateriaIsolamento(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "ISO-07").resultado, "VULNERAVEL");
});

test("bateria de appsec: tudo 'defendido' ou 'pulado' contra o Vendly falso seguro", async () => {
  const { servidor, alvo, ctx } = await montarCenario("seguro");
  const rodada = new Rodada();
  await bateriaAppSec(rodada, alvo, ctx);
  await servidor.fechar();
  for (const a of rodada.achados) assert.ok(["defendido", "pulado"].includes(a.resultado), `${a.id}: ${a.resultado} — ${a.obtido}`);
});

test("APP-01 acusa VULNERAVEL quando o webhook aceita sem token", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-webhook");
  const rodada = new Rodada();
  await bateriaAppSec(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "APP-01").resultado, "VULNERAVEL");
});

test("APP-02 acusa VULNERAVEL quando senha curta é aceita", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-senha-curta");
  const rodada = new Rodada();
  await bateriaAppSec(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "APP-02").resultado, "VULNERAVEL");
});

test("APP-03 acusa VULNERAVEL quando a rota pública vaza segredo do banco", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-exposicao");
  const rodada = new Rodada();
  await bateriaAppSec(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "APP-03").resultado, "VULNERAVEL");
});

test("APP-05 acusa VULNERAVEL quando não há limite de tentativas de login", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-bruteforce");
  const rodada = new Rodada();
  await bateriaAppSec(rodada, alvo, ctx);
  await servidor.fechar();
  assert.equal(achado(rodada, "APP-05").resultado, "VULNERAVEL");
});

test("achados nunca expõem o hash de senha bruto nem o token no texto 'obtido' (redação)", async () => {
  const { servidor, alvo, ctx } = await montarCenario("vulneravel-exposicao");
  const rodada = new Rodada();
  await bateriaAppSec(rodada, alvo, ctx);
  await servidor.fechar();
  for (const a of rodada.achados) {
    assert.ok(!/[a-f0-9]{40,}/i.test(a.obtido), `achado ${a.id} parece vazar um hash cru: ${a.obtido}`);
  }
});
