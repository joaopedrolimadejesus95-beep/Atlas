// =============================================================================
// CONFIG — lê o ambiente e aplica as TRAVAS DE SEGURANÇA do próprio ATLAS.
// O ATLAS apaga tabelas e dispara ataques. Estas travas existem pra que ele
// nunca rode, por engano, contra o banco ou o servidor de produção.
// =============================================================================
import { parseArgs } from "node:util";

export class ErroConfig extends Error {}

export function gerarTextoAjuda() {
  return [
    "ATLAS — Red team automatizado para o SaaS Vendly",
    "",
    "Uso:",
    "  node atlas.mjs [opções]",
    "",
    "Opções de CLI:",
    "  --so-json       Gera apenas findings.json (pula RELATORIO.md e painel.html)",
    "  --sem-xss       Desativa a análise estática e checagem de XSS (APP-04)",
    "  --sem-ia        Desativa a bateria de segurança de IA (IA-01 a IA-04)",
    "  --alvo <url>    Sobrescreve ALVO_URL",
    "  --saida <dir>   Sobrescreve ATLAS_SAIDA",
    "  -h, --ajuda     Exibe esta mensagem de ajuda e encerra",
    "",
    "Variáveis de ambiente:",
    "  DATABASE_URL             URL Postgres do banco de TESTE (obrigatório)",
    "  ALVO_URL                 URL do servidor de teste (padrão: http://127.0.0.1:3000)",
    "  ADMIN_HTML               Caminho do admin.html para checagem de XSS",
    "  WEBHOOK_TOKEN            Token configurado no webhook para teste de ponta a ponta",
    "  ATLAS_EVOLUTION=on       Liga a bateria de segurança de IA",
    "  ATLAS_SAIDA              Pasta de saída dos relatórios (padrão: .)",
  ].join("\n");
}

export function parsearCli(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "so-json": { type: "boolean", default: false },
      "sem-xss": { type: "boolean", default: false },
      "sem-ia": { type: "boolean", default: false },
      ajuda: { type: "boolean", short: "h", default: false },
      help: { type: "boolean", default: false },
      alvo: { type: "string" },
      saida: { type: "string" },
    },
    strict: false,
  });

  return {
    soJson: Boolean(values["so-json"]),
    semXss: Boolean(values["sem-xss"]),
    semIa: Boolean(values["sem-ia"]),
    ajuda: Boolean(values.ajuda || values.help),
    alvoUrl: typeof values.alvo === "string" ? values.alvo : undefined,
    saida: typeof values.saida === "string" ? values.saida : undefined,
  };
}

export const parsearArgs = parsearCli;

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const NOME_BANCO_DE_TESTE = /(^|[_-])(test|teste|atlas)([_-]|$)/i;

function ipPrivado(host) {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// O banco precisa ter "test", "teste" ou "atlas" no nome (separado por _ ou -).
// Para forçar outro nome é preciso repetir o nome exato do banco no override —
// assim uma flag copiada de outro terminal não aponta o ATLAS pro banco errado.
export function validarBanco(databaseUrl, env = process.env) {
  let nome;
  try {
    nome = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    // Não ecoa a URL: ela pode conter a senha do banco.
    throw new ErroConfig("DATABASE_URL não é uma URL válida (esperado postgres://usuario@host:porta/banco).");
  }
  if (!nome) throw new ErroConfig("DATABASE_URL não informa o nome do banco.");
  if (NOME_BANCO_DE_TESTE.test(nome)) return nome;
  if (env.ATLAS_CONFIRMO_BANCO === nome) return nome;
  throw new ErroConfig(
    `Recusei rodar: o banco "${nome}" não parece ser de teste (o nome precisa conter test, teste ou atlas).\n` +
      `O ATLAS APAGA as tabelas do cenário. Se tiver certeza que "${nome}" é descartável: ATLAS_CONFIRMO_BANCO=${nome}`
  );
}

// O alvo precisa ser local/rede privada. Para atacar um host remoto, o override
// também precisa repetir o hostname exato.
export function validarAlvo(alvoUrl, env = process.env) {
  let url;
  try {
    url = new URL(alvoUrl);
  } catch {
    throw new ErroConfig(`ALVO_URL inválida: ${alvoUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new ErroConfig("ALVO_URL precisa ser http:// ou https://");
  const host = url.hostname;
  if (HOSTS_LOCAIS.has(host) || ipPrivado(host)) return url.origin;
  if (env.ATLAS_ALVO_REMOTO_OK === host) return url.origin;
  throw new ErroConfig(
    `Recusei atacar "${host}": não é local nem rede privada. O ATLAS só deve rodar contra uma cópia de TESTE.\n` +
      `Se for uma cópia de teste hospedada: ATLAS_ALVO_REMOTO_OK=${host}`
  );
}

function inteiro(valor, padrao, nome) {
  if (valor === undefined || valor === "") return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) throw new ErroConfig(`${nome} precisa ser um inteiro positivo.`);
  return n;
}

export function carregarConfig(env = process.env, argv = []) {
  const cli = Array.isArray(argv) ? parsearCli(argv) : (argv || {});
  if (cli.ajuda) {
    return { ajuda: true, textoAjuda: gerarTextoAjuda() };
  }
  if (!env.DATABASE_URL) throw new ErroConfig("Defina DATABASE_URL apontando pro banco de TESTE do Vendly.");
  const semXss = Boolean(cli.semXss || env.ATLAS_SEM_XSS === "1" || env.ATLAS_SEM_XSS === "true");
  const semIa = Boolean(cli.semIa || env.ATLAS_SEM_IA === "1" || env.ATLAS_SEM_IA === "true");
  const soJson = Boolean(cli.soJson || env.ATLAS_SO_JSON === "1" || env.ATLAS_SO_JSON === "true");
  return {
    ajuda: false,
    soJson,
    semXss,
    semIa,
    alvoUrl: validarAlvo(cli.alvoUrl || env.ALVO_URL || "http://127.0.0.1:3000", env),
    databaseUrl: env.DATABASE_URL,
    nomeBanco: validarBanco(env.DATABASE_URL, env),
    adminHtml: semXss ? null : (env.ADMIN_HTML || null),
    webhookToken: env.WEBHOOK_TOKEN || null,
    saida: cli.saida || env.ATLAS_SAIDA || ".",
    tentativasForcaBruta: inteiro(env.ATLAS_TENTATIVAS_BRUTE, 25, "ATLAS_TENTATIVAS_BRUTE"),
    timeoutMs: inteiro(env.ATLAS_TIMEOUT_MS, 10_000, "ATLAS_TIMEOUT_MS"),
    // Bateria de segurança de IA: desligada por padrão (precisa você apontar a
    // EVOLUTION_API_URL do Vendly de teste pra essa porta — ver README).
    evolutionLigada: semIa ? false : env.ATLAS_EVOLUTION === "on",
    evolutionPorta: inteiro(env.ATLAS_EVOLUTION_PORTA, undefined, "ATLAS_EVOLUTION_PORTA"),
    evolutionTimeoutMs: inteiro(env.ATLAS_EVOLUTION_TIMEOUT_MS, 15_000, "ATLAS_EVOLUTION_TIMEOUT_MS"),
  };
}
