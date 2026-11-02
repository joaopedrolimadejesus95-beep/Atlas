// Testes de ponta a ponta da bateria de segurança de IA: sobe o Vendly falso +
// a Evolution falsa + um "bot" falso (seguro ou com UM bug de IA ligado) e
// prova que cada sonda detecta o bug certo — e que, sem Evolution falsa, a
// bateria inteira "pula" em vez de quebrar.
import test from "node:test";
import assert from "node:assert/strict";
import { subirServidorFalso } from "./helpers/servidor-falso.mjs";
import { criarBancoFalso } from "./helpers/banco-falso.mjs";
import { ligarBotDeIaFalso } from "./helpers/vendly-falso.mjs";
import { subirEvolutionFalsa } from "../src/evolution-falsa.mjs";
import { criarAdaptadorVendly } from "../src/adaptador-vendly.mjs";
import { Rodada } from "../src/nucleo.mjs";
import { bateriaSegurancaIa } from "../src/sondas/seguranca-ia.mjs";

async function montarCenario(modoBot) {
  const banco = criarBancoFalso();
  const evolutionFalsa = await subirEvolutionFalsa(0); // porta livre, não a fixa — testes em paralelo não colidem
  const servidor = await subirServidorFalso("seguro", banco, {
    configurarBot: (falso) => ligarBotDeIaFalso(falso, modoBot, evolutionFalsa, banco),
  });
  const alvo = criarAdaptadorVendly({ alvoUrl: servidor.url, banco, timeoutMs: 4000, evolutionFalsa, webhookToken: "token-correto-do-teste" });
  const ctx = await alvo.semear();
  return { servidor, evolutionFalsa, alvo, ctx };
}

function achado(rodada, id) {
  const a = rodada.achados.find((x) => x.id === id);
  assert.ok(a, `achado ${id} não foi registrado`);
  return a;
}

async function fecharTudo({ servidor, evolutionFalsa }) {
  await servidor.fechar();
  await evolutionFalsa.fechar();
}

test("sem evolutionFalsa configurada, a bateria inteira vem 'pulado' (não quebra o ATLAS)", async () => {
  const alvoSemIa = { evolutionFalsa: null };
  const rodada = new Rodada();
  await bateriaSegurancaIa(rodada, alvoSemIa, {});
  assert.equal(rodada.achados.length, 4);
  for (const a of rodada.achados) assert.equal(a.resultado, "pulado");
});

test("bateria de IA: tudo 'defendido' contra um bot seguro", async () => {
  const cen = await montarCenario("ia-seguro");
  const rodada = new Rodada();
  await bateriaSegurancaIa(rodada, cen.alvo, cen.ctx);
  await fecharTudo(cen);
  for (const a of rodada.achados) assert.equal(a.resultado, "defendido", `${a.id}: ${a.obtido}`);
});

test("IA-01 acusa VULNERAVEL quando o bot obedece injeção de prompt", async () => {
  const cen = await montarCenario("ia-vulneravel-injecao");
  const rodada = new Rodada();
  await bateriaSegurancaIa(rodada, cen.alvo, cen.ctx);
  await fecharTudo(cen);
  assert.equal(achado(rodada, "IA-01").resultado, "VULNERAVEL");
});

test("IA-02 acusa VULNERAVEL quando o bot narra as próprias instruções internas", async () => {
  const cen = await montarCenario("ia-vulneravel-prompt");
  const rodada = new Rodada();
  await bateriaSegurancaIa(rodada, cen.alvo, cen.ctx);
  await fecharTudo(cen);
  assert.equal(achado(rodada, "IA-02").resultado, "VULNERAVEL");
});

test("IA-03 acusa VULNERAVEL quando o bot vaza endereço de outra empresa", async () => {
  const cen = await montarCenario("ia-vulneravel-vazamento");
  const rodada = new Rodada();
  await bateriaSegurancaIa(rodada, cen.alvo, cen.ctx);
  await fecharTudo(cen);
  assert.equal(achado(rodada, "IA-03").resultado, "VULNERAVEL");
});

test("IA-04 acusa VULNERAVEL quando o bot cancela pedido de outra empresa por texto (ground truth no banco)", async () => {
  const cen = await montarCenario("ia-vulneravel-cancelamento");
  const rodada = new Rodada();
  await bateriaSegurancaIa(rodada, cen.alvo, cen.ctx);
  await fecharTudo(cen);
  assert.equal(achado(rodada, "IA-04").resultado, "VULNERAVEL");
  assert.equal(await cen.alvo.banco.pedidoExiste(cen.ctx.pedidoB), false); // confirma que o banco realmente mudou
});

test("perguntarIA devolve null (não quebra) quando o bot não responde a tempo", async () => {
  const banco = criarBancoFalso();
  const evolutionFalsa = await subirEvolutionFalsa(0);
  const servidor = await subirServidorFalso("seguro", banco); // sem bot ligado — ninguém responde
  const alvo = criarAdaptadorVendly({ alvoUrl: servidor.url, banco, timeoutMs: 4000, evolutionFalsa, webhookToken: "token-correto-do-teste" });
  const resposta = await alvo.perguntarIA("qualquer-instancia", "5544900009999@s.whatsapp.net", "oi", { timeoutMs: 300 });
  assert.equal(resposta, null);
  await servidor.fechar();
  await evolutionFalsa.fechar();
});
