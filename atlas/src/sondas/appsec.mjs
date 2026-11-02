// Bateria 2 — SEGURANÇA DA APLICAÇÃO: webhook, senha, exposição de dados,
// XSS, força bruta e um teste de injeção. Tudo contra a cópia de teste.
import { readFileSync } from "node:fs";
import { GRAV, percorrer } from "../nucleo.mjs";
import { analisarXss } from "../analise-estatica.mjs";
import { gerarSenha } from "../senha.mjs";

export async function bateriaAppSec(rodada, alvo, ctx) {
  const { burgerA: A } = alvo.contas;
  const { banco, http } = alvo;
  const tokenA = await alvo.login(A);

  await rodada.sonda(
    {
      id: "APP-01", categoria: "autenticação", gravidade: GRAV.ALTA,
      titulo: "Webhook aceita requisição sem token",
      reproduzir: "POST /webhook/mensagem sem x-webhook-token, com o nome de uma instância válida.",
      correcao: "Definir WEBHOOK_TOKEN no .env do servidor e comparar o header com timingSafeEqual antes de processar a mensagem.",
    },
    async () => {
      const semToken = await alvo.webhook();
      const tokenErrado = await alvo.webhook({ "x-webhook-token": "chave-claramente-errada" });
      const seguro = semToken.status === 401 && tokenErrado.status === 401;
      return {
        seguro,
        esperado: "401 tanto sem o header x-webhook-token quanto com um token errado.",
        obtido: `sem token: ${semToken.status}; token errado: ${tokenErrado.status} (WEBHOOK_TOKEN ${alvo.webhookTokenConfigurado ? "configurado no ambiente do ATLAS" : "não informado ao ATLAS — configure WEBHOOK_TOKEN pra validar de ponta a ponta"})`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "APP-02", categoria: "política de senha", gravidade: GRAV.MEDIA,
      titulo: "Sistema aceita senha fraca (curta ou comum)",
      reproduzir: "POST /api/senha trocando para '1234' e depois para 'password'.",
      correcao: "Exigir mínimo de 8 caracteres em /api/senha, criar atendente e criar empresa; rejeitar uma lista curta de senhas comuns.",
      limpar: () => banco.redefinirSenha(ctx.idA, A.senha),
    },
    async () => {
      const fracas = ["1234", "password", "aaaaaaaa"];
      const aceitas = [];
      for (const fraca of fracas) {
        const r = await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: A.senha, novaSenha: fraca } });
        if (r.status === 200) {
          aceitas.push(fraca);
          await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: fraca, novaSenha: A.senha } });
        }
      }
      return {
        seguro: aceitas.length === 0,
        esperado: "Todas as senhas fracas testadas são rejeitadas (400).",
        obtido: aceitas.length ? `Aceitas: ${JSON.stringify(aceitas)}` : `Todas as ${fracas.length} senhas fracas foram rejeitadas.`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "APP-03", categoria: "exposição de dados", gravidade: GRAV.ALTA,
      titulo: "Cardápio público vaza campos internos",
      reproduzir: "Definir slug público e consultar GET /api/publico/:slug, comparando contra os segredos reais do banco.",
      correcao: "Montar a resposta pública com lista explícita de campos permitidos (nunca spread do registro inteiro).",
    },
    async () => {
      const slug = "burger-a-teste";
      await http("PUT", "/api/empresa", { token: tokenA, corpo: { slug, ofereceCardapioDigital: true } });
      const r = await http("GET", `/api/publico/${slug}`);
      const segredos = await banco.segredosDe(ctx.idA);
      const vazados = segredos.filter((s) => r.texto.includes(s));
      let numeroInterno = false;
      percorrer(r.body, (chave, valor) => {
        if (/estoque/i.test(chave) && typeof valor === "number") numeroInterno = true;
      });
      return {
        seguro: vazados.length === 0 && !numeroInterno,
        esperado: "Nenhum segredo real do banco (hash, salt, instância) nem estoque numérico aparece na resposta pública.",
        obtido: vazados.length || numeroInterno
          ? `vazou ${vazados.length} segredo(s) do banco${numeroInterno ? " e estoque numérico" : ""}`
          : "Nenhum segredo do banco nem estoque numérico na resposta pública.",
      };
    }
  );

  await rodada.sonda(
    {
      id: "APP-04", categoria: "xss", gravidade: GRAV.ALTA,
      titulo: "XSS armazenado via nome de produto no painel",
      reproduzir: "Salvar produto com nome contendo HTML e varrer admin.html em busca de innerHTML sem esc().",
      correcao: "Envolver todo campo vindo do cliente com esc() em cada innerHTML do admin.html — a análise aponta a(s) linha(s) faltando.",
      limpar: () => banco.removerProduto("atlas-xss"),
    },
    async () => {
      const payload = "<img src=x onerror=alert(1)>";
      await http("POST", "/api/produtos", { token: tokenA, corpo: { id: "atlas-xss", nome: payload, preco: 1, descricao: "x", categoria: "comida" } });
      const r = await http("GET", "/api/produtos", { token: tokenA });
      const guardado = (r.body?.produtos ?? []).find((p) => p.id === "atlas-xss");
      if (!alvo.adminHtml) return { pulado: true, motivo: "ADMIN_HTML não informado — defina a variável pra habilitar a checagem de render." };
      const html = readFileSync(alvo.adminHtml, "utf8");
      const { temEsc, montaHtml, naoEscapados } = analisarXss(html);
      const seguro = temEsc && naoEscapados.length === 0;
      return {
        seguro,
        esperado: "esc() existe e é aplicado a todo campo do usuário em innerHTML/insertAdjacentHTML.",
        obtido: `API guarda o payload cru: ${guardado?.nome === payload}; esc() existe: ${temEsc}; ${montaHtml} linha(s) montam HTML; ${naoEscapados.length} sem esc()` +
          (naoEscapados.length ? `: ${naoEscapados.map((n) => `L${n.linha}`).join(", ")}` : ""),
      };
    }
  );

  await rodada.sonda(
    {
      id: "APP-05", categoria: "autenticação", gravidade: GRAV.MEDIA,
      titulo: "Login sem limite de tentativas (força bruta)",
      reproduzir: `Tentar login ${alvo.tentativasForcaBruta ?? 25} vezes seguidas com senha errada contra uma conta isolada.`,
      correcao: "Adicionar limite de tentativas por login/IP (ex.: bloqueio progressivo ou CAPTCHA após 5 tentativas erradas).",
    },
    async () => {
      const max = alvo.tentativasForcaBruta ?? 25;
      let bloqueouEm = null;
      for (let i = 1; i <= max; i++) {
        const r = await alvo.loginBruto(alvo.contas.vitima.login, `tentativa-errada-${i}`);
        if (r.status === 429 || r.status === 423) { bloqueouEm = i; break; }
      }
      return {
        seguro: bloqueouEm !== null,
        esperado: `Algum tipo de bloqueio (429/423) antes de ${max} tentativas erradas seguidas.`,
        obtido: bloqueouEm ? `bloqueou na tentativa ${bloqueouEm}.` : `${max} tentativas erradas seguidas, nenhum bloqueio (status sempre 200/401 comum).`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "APP-06", categoria: "injeção", gravidade: GRAV.CRITICA,
      titulo: "Login com payload de SQL injection",
      reproduzir: "POST /api/login com login contendo aspas e comentário SQL, checando erro 500/stack trace e login indevido.",
      correcao: "Confirmar que toda query usa parâmetros ($1, $2...) — nunca concatenação de string no SQL.",
    },
    async () => {
      const payloads = [`' OR '1'='1`, `' OR '1'='1' --`, `admin'--`, `'; DROP TABLE empresas;--`];
      const problemas = [];
      for (const login of payloads) {
        const r = await alvo.loginBruto(login, "qualquer");
        if (r.status === 200 && r.body?.token) problemas.push(`"${login}" logou indevidamente`);
        if (r.status === 500 || /stack|syntax error|SQLSTATE/i.test(r.texto)) problemas.push(`"${login}" → erro 500 / vazou detalhe de SQL`);
      }
      return {
        seguro: problemas.length === 0,
        esperado: "Todo payload é tratado como login inexistente — nunca autentica, nunca derruba a query com erro 500.",
        obtido: problemas.length ? problemas.join("; ") : `${payloads.length} payloads testados, nenhum autenticou nem gerou erro de SQL.`,
      };
    }
  );
}
