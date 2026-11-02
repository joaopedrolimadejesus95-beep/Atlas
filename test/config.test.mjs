import test from "node:test";
import assert from "node:assert/strict";
import { validarBanco, validarAlvo, carregarConfig, parsearCli, ErroConfig } from "../src/config.mjs";

test("validarBanco aceita banco com 'test' no nome", () => {
  assert.equal(validarBanco("postgres://u@127.0.0.1:5432/vendly_test"), "vendly_test");
});

test("validarBanco aceita banco chamado 'atlas'", () => {
  assert.equal(validarBanco("postgres://u@127.0.0.1:5432/atlas"), "atlas");
});

test("validarBanco RECUSA banco que parece produção", () => {
  assert.throws(() => validarBanco("postgres://u@127.0.0.1:5432/vendly_producao"), ErroConfig);
});

test("validarBanco aceita override explícito com o MESMO nome", () => {
  const env = { ATLAS_CONFIRMO_BANCO: "meu_banco" };
  assert.equal(validarBanco("postgres://u@127.0.0.1:5432/meu_banco", env), "meu_banco");
});

test("validarBanco recusa override com nome DIFERENTE (copy-paste errado)", () => {
  const env = { ATLAS_CONFIRMO_BANCO: "outro_banco" };
  assert.throws(() => validarBanco("postgres://u@127.0.0.1:5432/meu_banco", env), ErroConfig);
});

test("validarBanco nunca ecoa a DATABASE_URL (pode ter senha) numa URL malformada", () => {
  const urlComSenha = "postgres://usuario:segredo-super-secreto@";
  try {
    validarBanco(urlComSenha);
    assert.fail("deveria ter lançado");
  } catch (e) {
    assert.ok(!e.message.includes("segredo-super-secreto"));
  }
});

test("validarAlvo aceita localhost e IP de rede privada", () => {
  assert.equal(validarAlvo("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(validarAlvo("http://192.168.0.10:3000"), "http://192.168.0.10:3000");
  assert.equal(validarAlvo("http://10.0.0.5:3000"), "http://10.0.0.5:3000");
});

test("validarAlvo RECUSA host público sem override", () => {
  assert.throws(() => validarAlvo("https://meuvendly.com.br"), ErroConfig);
});

test("validarAlvo aceita override explícito com o MESMO host remoto", () => {
  const env = { ATLAS_ALVO_REMOTO_OK: "staging.meuvendly.com.br" };
  assert.equal(validarAlvo("https://staging.meuvendly.com.br", env), "https://staging.meuvendly.com.br");
});

test("carregarConfig exige DATABASE_URL", () => {
  assert.throws(() => carregarConfig({}), ErroConfig);
});

test("carregarConfig aplica padrões sãos", () => {
  const c = carregarConfig({ DATABASE_URL: "postgres://u@127.0.0.1:5432/vendly_test" });
  assert.equal(c.alvoUrl, "http://127.0.0.1:3000");
  assert.equal(c.nomeBanco, "vendly_test");
  assert.equal(c.tentativasForcaBruta, 25);
});

test("parsearCli e carregarConfig suportam flags --so-json, --sem-xss, --sem-ia e --ajuda mantendo retrocompatibilidade", () => {
  const flags = parsearCli(["--so-json", "--sem-xss", "--sem-ia"]);
  assert.equal(flags.soJson, true);
  assert.equal(flags.semXss, true);
  assert.equal(flags.semIa, true);
  assert.equal(flags.ajuda, false);

  const cfg = carregarConfig(
    {
      DATABASE_URL: "postgres://u@127.0.0.1:5432/vendly_test",
      ADMIN_HTML: "/caminho/admin.html",
      ATLAS_EVOLUTION: "on",
    },
    ["--so-json", "--sem-xss", "--sem-ia"]
  );
  assert.equal(cfg.soJson, true);
  assert.equal(cfg.semXss, true);
  assert.equal(cfg.adminHtml, null, "--sem-xss deve desativar adminHtml mesmo se definido no env");
  assert.equal(cfg.semIa, true);
  assert.equal(cfg.evolutionLigada, false, "--sem-ia deve desligar a bateria de IA mesmo com ATLAS_EVOLUTION=on");

  const cfgAjuda = carregarConfig({}, ["--ajuda"]);
  assert.equal(cfgAjuda.ajuda, true);
  assert.ok(cfgAjuda.textoAjuda.includes("--so-json"));
});
