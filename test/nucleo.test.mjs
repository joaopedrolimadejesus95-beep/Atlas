import test from "node:test";
import assert from "node:assert/strict";
import { Rodada, redigir, percorrer, ordenar, GRAV } from "../src/nucleo.mjs";

test("redigir mascara Bearer token, token tipo JWT e campos de senha/hash", () => {
  const texto = JSON.stringify({ msg: "status 200 Bearer abc.def", senha: "1234", hash: "aa".repeat(20) });
  const r = redigir(texto);
  assert.ok(!r.includes("abc.def"));
  assert.ok(!r.includes("1234"));
  assert.ok(!r.includes("aa".repeat(20)));
});

test("percorrer visita todo nó de um JSON aninhado", () => {
  const vistos = [];
  percorrer({ a: 1, b: { c: 2, d: [{ e: 3 }] } }, (k, v) => vistos.push(`${k}=${JSON.stringify(v)}`));
  assert.ok(vistos.includes("a=1"));
  assert.ok(vistos.includes("c=2"));
  assert.ok(vistos.includes("e=3"));
});

test("Rodada.sonda registra 'defendido' quando seguro=true", async () => {
  const r = new Rodada();
  await r.sonda({ id: "X-1", categoria: "c", titulo: "t", gravidade: GRAV.ALTA }, async () => ({ seguro: true, esperado: "e", obtido: "o" }));
  assert.equal(r.achados[0].resultado, "defendido");
  assert.equal(r.achados[0].correcao, null);
});

test("Rodada.sonda registra 'VULNERAVEL' e inclui a correção quando seguro=false", async () => {
  const r = new Rodada();
  await r.sonda({ id: "X-2", categoria: "c", titulo: "t", gravidade: GRAV.ALTA, correcao: "conserta assim" }, async () => ({ seguro: false, esperado: "e", obtido: "o" }));
  assert.equal(r.achados[0].resultado, "VULNERAVEL");
  assert.equal(r.achados[0].correcao, "conserta assim");
});

test("Rodada.sonda captura exceção como 'erro' (não conta como defendido)", async () => {
  const r = new Rodada();
  await r.sonda({ id: "X-3", categoria: "c", titulo: "t", gravidade: GRAV.ALTA }, async () => { throw new Error("quebrou"); });
  assert.equal(r.achados[0].resultado, "erro");
  const resumo = r.resumo();
  assert.equal(resumo.defendido, 0);
  assert.equal(resumo.erro, 1);
});

test("Rodada.sonda roda a limpeza mesmo quando a sonda lança exceção", async () => {
  const r = new Rodada();
  let limpou = false;
  await r.sonda(
    { id: "X-4", categoria: "c", titulo: "t", gravidade: GRAV.ALTA, limpar: async () => { limpou = true; } },
    async () => { throw new Error("quebrou"); }
  );
  assert.equal(limpou, true);
});

test("Rodada.sonda registra 'pulado' sem contar como erro nem vulnerável", async () => {
  const r = new Rodada();
  await r.sonda({ id: "X-5", categoria: "c", titulo: "t", gravidade: GRAV.ALTA }, async () => ({ pulado: true, motivo: "sem pré-requisito" }));
  assert.equal(r.achados[0].resultado, "pulado");
  const resumo = r.resumo();
  assert.equal(resumo.pulado, 1);
  assert.equal(resumo.erro, 0);
});

test("Rodada.bateria isola a falha de preparo num único achado de erro", async () => {
  const r = new Rodada();
  await r.bateria("minha-bateria", async () => { throw new Error("login falhou"); });
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].resultado, "erro");
});

test("Rodada.codigoDeSaida: 0 limpo, 2 com vulnerabilidade, 3 só com erro", async () => {
  const limpo = new Rodada();
  await limpo.sonda({ id: "A", categoria: "c", titulo: "t", gravidade: GRAV.ALTA }, async () => ({ seguro: true }));
  assert.equal(limpo.codigoDeSaida(), 0);

  const vuln = new Rodada();
  await vuln.sonda({ id: "B", categoria: "c", titulo: "t", gravidade: GRAV.ALTA }, async () => ({ seguro: false }));
  assert.equal(vuln.codigoDeSaida(), 2);

  const comErro = new Rodada();
  await comErro.sonda({ id: "C", categoria: "c", titulo: "t", gravidade: GRAV.ALTA }, async () => { throw new Error("x"); });
  assert.equal(comErro.codigoDeSaida(), 3);
});

test("ordenar: vulnerável > erro > pulado > defendido, e por gravidade dentro do grupo", () => {
  const lista = [
    { resultado: "defendido", gravidade: GRAV.CRITICA },
    { resultado: "VULNERAVEL", gravidade: GRAV.BAIXA },
    { resultado: "VULNERAVEL", gravidade: GRAV.CRITICA },
    { resultado: "erro", gravidade: GRAV.INFO },
  ];
  const r = ordenar(lista);
  assert.equal(r[0].gravidade, GRAV.CRITICA);
  assert.equal(r[0].resultado, "VULNERAVEL");
  assert.equal(r[1].resultado, "VULNERAVEL");
  assert.equal(r[2].resultado, "erro");
  assert.equal(r[3].resultado, "defendido");
});
