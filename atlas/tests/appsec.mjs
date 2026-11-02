// ATLAS — bateria: segurança da aplicação
// -----------------------------------------------------------------------------
// Testes da camada de API/aplicação: autenticação do webhook, política de
// senha, exposição de dados na rota pública e XSS armazenado.

import { readFileSync } from "fs";
import { http, login } from "../adapter.mjs";
import { registrar, sonda, GRAVIDADE } from "../atlas.mjs";
import { CONTAS } from "../seed.mjs";

const ADMIN_HTML = "/home/claude/vendly_src/vendly-main/public/admin.html";

export async function rodar(ctx) {
  const tokenA = await login(CONTAS.burgerA.login, CONTAS.burgerA.senha);

  // --- APP-01: webhook aceita mensagem sem autenticação ---
  // Depende do WEBHOOK_TOKEN no ambiente. Sem ele, qualquer um que descubra a
  // URL + o nome da instância injeta pedido falso e gasta crédito de IA.
  await sonda(
    { id: "APP-01", categoria: "autenticação", titulo: "Webhook aceita requisição sem token",
      reproduzir: "POST /webhook/mensagem sem header x-webhook-token, usando o nome de instância de uma empresa." },
    async () => {
      const r = await http("POST", "/webhook/mensagem", {
        corpo: { instance: CONTAS.burgerA.instancia, data: { key: { remoteJid: "551199999@s.whatsapp.net" }, message: { conversation: "oi" } } },
      });
      // Seguro = rejeita com 401 (token exigido). Qualquer outra coisa = aceitou
      // processar uma chamada não autenticada.
      const seguro = r.status === 401;
      registrar({
        id: "APP-01", categoria: "autenticação", titulo: "Webhook aceita requisição sem token",
        gravidade: GRAVIDADE.ALTA, seguro,
        esperado: "401 — o webhook exige o header x-webhook-token.",
        obtido: `status ${r.status} (WEBHOOK_TOKEN ${process.env.WEBHOOK_TOKEN ? "configurado" : "VAZIO neste ambiente"})`,
        correcao: "Definir WEBHOOK_TOKEN no .env do servidor e reconectar cada instância. Sem ele, o código avisa no log mas deixa o webhook aberto — o teste prova o impacto. Confirmar que a produção tem o token setado.",
      });
    }
  );

  // --- APP-02: política de senha permite senha curta ---
  await sonda(
    { id: "APP-02", categoria: "política de senha", titulo: "Sistema aceita senha fraca (curta)",
      reproduzir: "POST /api/senha trocando para uma senha de 4 dígitos ('1234')." },
    async () => {
      const r = await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: CONTAS.burgerA.senha, novaSenha: "1234" } });
      const aceitou = r.status === 200;
      // Restaura a senha original pra não quebrar o resto da bateria.
      if (aceitou) await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: "1234", novaSenha: CONTAS.burgerA.senha } });
      registrar({
        id: "APP-02", categoria: "política de senha", titulo: "Sistema aceita senha fraca (curta)",
        gravidade: GRAVIDADE.MEDIA, seguro: !aceitou,
        esperado: "Rejeitar senhas com menos de 8 caracteres.",
        obtido: aceitou ? "'1234' foi aceita como senha válida (mínimo atual é 4)." : `rejeitada (status ${r.status}).`,
        correcao: "Subir o mínimo de 4 para 8+ caracteres em server.js (/api/senha), em criarAtendente e no script criar-empresa; opcionalmente bloquear senhas comuns ('1234', 'senha').",
      });
    }
  );

  // --- APP-03: rota pública de cardápio não vaza campos internos ---
  await sonda(
    { id: "APP-03", categoria: "exposição de dados", titulo: "Cardápio público vaza campos internos",
      reproduzir: "Definir um slug público e consultar GET /api/publico/:slug, checando se vêm senha, token, estoque numérico, etc." },
    async () => {
      // Dá um slug público pra Burger A e liga o cardápio digital.
      await http("PUT", "/api/empresa", { token: tokenA, corpo: { slug: "burger-a-teste", ofereceCardapioDigital: true } });
      const r = await http("GET", "/api/publico/burger-a-teste");
      const texto = JSON.stringify(r.body || {});
      const campoSensivel = /senha|hash|salt|session|webhook|evolution_?instance|token/i.test(texto);
      // Estoque deve vir como booleano "esgotado", nunca o número.
      const vazouEstoqueNumerico = /"estoque"\s*:\s*\d/.test(texto);
      const seguro = !campoSensivel && !vazouEstoqueNumerico;
      registrar({
        id: "APP-03", categoria: "exposição de dados", titulo: "Cardápio público vaza campos internos",
        gravidade: GRAVIDADE.ALTA, seguro,
        esperado: "Só nome, descrição, preço e 'esgotado' (booleano) — nada de senha, token, instância ou estoque numérico.",
        obtido: seguro ? "Nenhum campo interno presente na resposta pública." : `Campo sensível detectado na resposta: ${texto.slice(0, 200)}`,
        correcao: "getEmpresaPublicaPorSlug já monta a resposta com lista explícita de campos (sem spread) — manter esse padrão ao adicionar campos novos.",
      });
    }
  );

  // --- APP-04: XSS armazenado via nome de produto (análise de render) ---
  // Guarda um nome com payload e confirma que (a) o servidor aceita guardar
  // (normal) e (b) o painel renderiza esse nome escapado (função esc()).
  await sonda(
    { id: "APP-04", categoria: "xss", titulo: "XSS armazenado via nome de produto no painel",
      reproduzir: "Salvar produto com nome '<img src=x onerror=alert(1)>' e checar se o painel escapa ao renderizar." },
    async () => {
      const payload = '<img src=x onerror=alert(1)>';
      await http("POST", "/api/produtos", { token: tokenA, corpo: { id: "xss-teste", nome: payload, preco: 1, descricao: "x", categoria: "comida" } });
      const r = await http("GET", "/api/produtos", { token: tokenA });
      const guardado = (r.body?.produtos || []).find((p) => p.id === "xss-teste");
      const armazenadoCru = guardado?.nome === payload; // esperado: API guarda cru, escape é no render

      // Análise estática do render: o painel usa esc() nas listas via innerHTML?
      const html = readFileSync(ADMIN_HTML, "utf8");
      const temFuncaoEsc = /function esc\(/.test(html);
      // Procura o bloco que renderiza a lista de produtos (buscarProdutos/encontrados)
      // e confere se o nome passa por esc(). Heurística conservadora.
      const usaEscNoNome = /esc\(\s*p\.nome\s*\)/.test(html) || /\$\{esc\(p\.nome\)\}/.test(html);
      const seguro = temFuncaoEsc && usaEscNoNome;
      registrar({
        id: "APP-04", categoria: "xss", titulo: "XSS armazenado via nome de produto no painel",
        gravidade: GRAVIDADE.ALTA, seguro,
        esperado: "O nome é escapado com esc() antes de ir pro innerHTML do painel.",
        obtido: `API guarda o texto cru (ok): ${armazenadoCru}; função esc() existe: ${temFuncaoEsc}; nome do produto passa por esc(): ${usaEscNoNome}`,
        correcao: usaEscNoNome ? null : "Envolver p.nome (e todo campo vindo do cliente: endereço, observação, mensagem) com esc() em TODO innerHTML do admin.html. Verificação manual recomendada por sink.",
      });
      // Limpa o produto de teste.
      await http("DELETE", "/api/produtos/xss-teste", { token: tokenA });
    }
  );
}
