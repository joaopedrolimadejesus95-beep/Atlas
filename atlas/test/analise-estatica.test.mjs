import test from "node:test";
import assert from "node:assert/strict";
import { analisarXss } from "../src/analise-estatica.mjs";

test("analisarXss: detecta innerHTML SEM esc() num campo do usuário", () => {
  const html = `function render(p){ div.innerHTML = '<b>' + p.nome + '</b>'; }`;
  const r = analisarXss(html);
  assert.equal(r.naoEscapados.length, 1);
  assert.equal(r.naoEscapados[0].linha, 1);
});

test("analisarXss: não acusa quando o campo passa por esc()", () => {
  const html = [
    "function esc(s){ return s; }",
    "function render(p){ div.innerHTML = '<b>' + esc(p.nome) + '</b>'; }",
  ].join("\n");
  const r = analisarXss(html);
  assert.equal(r.temEsc, true);
  assert.equal(r.naoEscapados.length, 0);
});

test("analisarXss: pega vários campos de usuário sem esc() em linhas diferentes", () => {
  const html = [
    "function esc(s){ return s; }",
    "el.innerHTML = p.nome;",
    "el2.innerHTML = esc(p.nome);",
    "el3.innerHTML = ped.endereco;",
  ].join("\n");
  const r = analisarXss(html);
  assert.equal(r.naoEscapados.length, 2);
  assert.deepEqual(r.naoEscapados.map((n) => n.linha), [2, 4]);
});

test("analisarXss: ignora linha que não monta HTML", () => {
  const html = "const x = p.nome.toUpperCase();";
  const r = analisarXss(html);
  assert.equal(r.montaHtml, 0);
  assert.equal(r.naoEscapados.length, 0);
});
