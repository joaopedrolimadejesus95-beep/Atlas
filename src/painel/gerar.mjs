import { ordenar } from "../nucleo.mjs";
import { carregarHistorico, resumirEvolucao } from "../relatorios.mjs";
import { CSS } from "./css.mjs";
import { PAINEL_JS } from "./js.mjs";

function escHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const CLASSE_GRAV = { "crítica": "critica", "alta": "alta", "média": "media", "baixa": "baixa", "informativo": "informativo" };
const RES_CLASSE = { VULNERAVEL: "vuln", erro: "erro", pulado: "pulado", defendido: "defendido" };
const RES_LABEL = { VULNERAVEL: "A corrigir", erro: "Erro", pulado: "Pulado", defendido: "Defendido" };

export function gerarPainel(dados, historico = null) {
  const r = dados.resumo;
  const dataFmt = new Date(dados.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const sevTxt = Object.entries(r.porGravidade || {}).map(([g, n]) => n + " " + g).join(" · ") || "—";
  const listaHistorico = Array.isArray(historico)
    ? historico
    : Array.isArray(dados.historico)
      ? dados.historico
      : dados.dirHistorico
        ? carregarHistorico(dados.dirHistorico)
        : [];
  const evolucao = resumirEvolucao(r, listaHistorico, { geradoEm: dados.geradoEm });
  const evolucaoHtml = evolucao ? ' <span class="evolucao">Evolução: <strong>' + escHtml(evolucao.texto) + "</strong></span>" : "";
  const lede = (r.vulneravel === 0
    ? "<strong>Todos os ataques foram bloqueados.</strong>"
    : "<strong>" + r.defendido + " de " + r.total + " ataques foram bloqueados pelas defesas do Vendly.</strong> Restam " + r.vulneravel + (r.vulneravel === 1 ? " ponto" : " pontos") + " a corrigir.") + evolucaoHtml;

  const tiles = [
    { n: r.total, l: "Testes", c: "" },
    { n: r.defendido, l: "Defesas OK", c: "ok" },
    { n: r.vulneravel, l: "A corrigir", c: "fix" },
    { n: sevTxt, l: "Gravidade dos achados", c: "" },
  ].map((t) => '<div class="tile ' + t.c + '"><div class="n">' + escHtml(t.n) + '</div><div class="l">' + t.l + "</div></div>").join("");

  const cards = ordenar(dados.achados).map((a) => {
    const resClass = RES_CLASSE[a.resultado] || "erro";
    const resLabel = RES_LABEL[a.resultado] || a.resultado;
    return '<div class="card r-' + resClass + '" data-r="' + resClass + '">' +
      '<button class="row" aria-expanded="false">' +
      '<span class="id">' + escHtml(a.id) + "</span>" +
      '<span class="ttl">' + escHtml(a.titulo) + '<span class="cat">' + escHtml(a.categoria) + "</span></span>" +
      '<span class="badges">' +
      '<span class="sev ' + (CLASSE_GRAV[a.gravidade] || "media") + '">' + escHtml(a.gravidade) + "</span>" +
      '<span class="res ' + resClass + '">' + resLabel + "</span>" +
      '<span class="caret">\u203a</span>' +
      "</span></button>" +
      '<div class="detail"><dl>' +
      (a.reproduzir ? "<dt>Reproduzir</dt><dd>" + escHtml(a.reproduzir) + "</dd>" : "") +
      "<dt>Esperado</dt><dd>" + escHtml(a.esperado) + "</dd>" +
      '<dt>Obtido</dt><dd class="out">' + escHtml(a.obtido) + "</dd></dl>" +
      (a.correcao ? '<div class="fix"><b>Correção sugerida</b><br>' + escHtml(a.correcao) + "</div>" : "") +
      "</div></div>";
  }).join("");

  return [
    "<title>ATLAS Console</title>",
    '<meta name="claude:viewport-fit-sides" content="cover">',
    "<style>" + CSS + "</style>",
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">',
    '<div class="wrap">',
    '<header><div class="brand"><div class="mark">A</div><div><h1>ATLAS</h1><p>Red team automatizado — alvo: Vendly</p></div></div>',
    '<div class="meta"><div>rodada: <b>' + dataFmt + "</b></div><div>ambiente: <b>teste isolado</b></div></div></header>",
    '<section class="verdict"><div class="score"><b>' + r.defendido + "</b><span>/" + r.total + '</span></div><div class="lede">' + lede + "</div></section>",
    '<div class="tiles">' + tiles + "</div>",
    '<div class="filters"><span class="cap">Filtrar</span>' +
      '<button class="chip" data-f="todos" aria-pressed="true">Todos</button>' +
      '<button class="chip" data-f="vuln" aria-pressed="false">A corrigir</button>' +
      '<button class="chip" data-f="defendido" aria-pressed="false">Defendidos</button></div>',
    '<div class="list" id="list" data-filtro="todos">' + cards + "</div>",
    '<footer>Os testes rodaram contra uma cópia de teste isolada do Vendly (banco próprio, empresas fictícias). Nenhum dado de produção foi tocado. Cada achado traz o esperado, o obtido e, quando falha, a correção sugerida.</footer>',
    "</div>",
    "<script>" + PAINEL_JS + "<\/script>",
  ].join("\n");
}
