#!/usr/bin/env node
// ATLAS — runner (compatível com flags de CLI e com atlas.mjs)
// Uso: node run.mjs [--so-json] [--sem-xss] [--sem-ia] [--ajuda]
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { principal, parsearCli, gerarTextoAjuda } from "./atlas.mjs";

export { parseArgs, parsearCli, gerarTextoAjuda, principal };

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDireto) {
  principal().catch((e) => {
    console.error("Erro na rodada do ATLAS:", e);
    process.exit(1);
  });
}
