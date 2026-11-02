import test from "node:test";
import assert from "node:assert/strict";
import { executarDemoBotExemplo } from "../examples/adaptador-bot-exemplo.mjs";

test("Segundo adaptador (ShopBot E-Commerce em memória): núcleo e baterias do ATLAS rodam contra outro alvo sem acoplamento ao Vendly", async () => {
  const rodada = await executarDemoBotExemplo("seguro");
  const r = rodada.resumo();
  assert.equal(r.vulneravel, 0);
  assert.equal(r.erro, 0);
  assert.ok(r.defendido >= 12);
});

test("Segundo adaptador (ShopBot E-Commerce): ATLAS detecta falha de IDOR quando introduzida no bot de exemplo", async () => {
  const rodada = await executarDemoBotExemplo("vulneravel-idor");
  const iso01 = rodada.achados.find((a) => a.id === "ISO-01");
  assert.ok(iso01);
  assert.equal(iso01.resultado, "VULNERAVEL");
});
