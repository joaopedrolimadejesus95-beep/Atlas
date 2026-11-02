import { ordenar } from "../nucleo.mjs";
import { carregarHistorico, resumirEvolucao } from "../relatorios.mjs";
import { CSS } from "./css.mjs";
import { PAINEL_JS } from "./js.mjs";

export function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CLASSE_GRAV = { "crítica": "critica", "alta": "alta", "média": "media", "baixa": "baixa", "informativo": "informativo" };
const RES_CLASSE = { VULNERAVEL: "vuln", erro: "erro", pulado: "pulado", defendido: "defendido" };
const RES_LABEL = { VULNERAVEL: "Vulnerável", erro: "Erro", pulado: "Pulado", defendido: "Defendido" };

const ICONE_SHIELD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';

const ICONE_APRES =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>';

const ICONE_PDF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>';

const ICONE_TEMA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

const ICONE_CARET =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function classificarBateria(achado) {
  const id = String(achado?.id ?? "").toUpperCase();
  const cat = String(achado?.categoria ?? "").toLowerCase();
  if (id.startsWith("ISO-") || cat.includes("isolamento")) return "iso";
  if (id.startsWith("IA-") || cat.includes("ia")) return "ia";
  if (id.startsWith("APP-")) return "app";
  return "app";
}

function gerarGraficoEvolucaoSvg(pontos, evolucao) {
  if (!Array.isArray(pontos) || pontos.length < 2) {
    const unico = pontos?.[0];
    const notaUnica = unico ? escHtml(unico.pontuacaoGeral || `${unico.defendidas}/${unico.totalSondas}`) : "—";
    return (
      '<div class="chart-empty">' +
        "<div><b>1ª rodada registrada (" + notaUnica + ")</b></div>" +
        "<div>Execute novas rodadas do ATLAS para plotar automaticamente a curva de evolução a partir de <code>historico/</code>.</div>" +
      "</div>" +
      '<div class="bento-foot"><span>1 rodada registrada</span><span>próxima ativa a curva</span></div>'
    );
  }

  const w = 320;
  const h = 90;
  const padX = 28;
  const padY = 18;
  const utilW = w - padX * 2;
  const utilH = h - padY * 2;

  const coords = pontos.map((p, idx) => {
    const tot = Number(p.totalSondas ?? p.total ?? 0);
    const def = Number(p.defendidas ?? p.defendido ?? 0);
    const pct = tot > 0 ? Math.max(0, Math.min(100, Math.round((def / tot) * 100))) : 100;
    const x = Number((padX + (idx / (pontos.length - 1)) * utilW).toFixed(1));
    const y = Number((padY + ((100 - pct) / 100) * utilH).toFixed(1));
    const label = `${def}/${tot}`;
    return { x, y, pct, label, ts: String(p.timestamp || "") };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `${coords[0].x},${h - padY} ${polyline} ${coords.at(-1).x},${h - padY}`;

  const circles = coords
    .map((c, i) => {
      const ultimo = i === coords.length - 1;
      const mostrarTexto = i === 0 || ultimo || coords.length <= 5;
      return (
        `<g class="pt">` +
          `<circle cx="${c.x}" cy="${c.y}" r="${ultimo ? "4.5" : "3.8"}" fill="${ultimo ? "var(--ok)" : "var(--surface)"}" stroke="var(--ok)" stroke-width="2">` +
            `<title>${escHtml(c.ts)} — ${escHtml(c.label)} (${c.pct}%)</title>` +
          `</circle>` +
          (mostrarTexto
            ? `<text x="${c.x}" y="${Math.max(10, c.y - 8)}" text-anchor="middle" font-size="10" font-family="var(--f-mono)" font-weight="${ultimo ? "700" : "500"}" fill="${ultimo ? "var(--ok-text)" : "var(--muted)"}">${escHtml(c.label)}</text>`
            : "") +
        `</g>`
      );
    })
    .join("");

  return (
    '<div class="chart-wrap">' +
      `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Gráfico de evolução entre rodadas">` +
        "<defs>" +
          '<linearGradient id="atlasGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#10B981" stop-opacity="0.25"/>' +
            '<stop offset="100%" stop-color="#10B981" stop-opacity="0.0"/>' +
          "</linearGradient>" +
        "</defs>" +
        `<line x1="${padX}" y1="${padY}" x2="${w - padX}" y2="${padY}" stroke="var(--line)" stroke-dasharray="2 3"/>` +
        `<line x1="${padX}" y1="${Math.round(h / 2)}" x2="${w - padX}" y2="${Math.round(h / 2)}" stroke="var(--line)" stroke-dasharray="2 3"/>` +
        `<line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="var(--line)"/>` +
        `<polygon points="${area}" fill="url(#atlasGrad)"/>` +
        `<polyline points="${polyline}" fill="none" stroke="var(--ok)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
        circles +
      "</svg>" +
      '<div class="bento-foot">' +
        `<span>${pontos.length} rodadas registradas</span>` +
        `<span style="font-family:var(--f-mono);font-size:11px;color:var(--ok-text)">${evolucao ? escHtml(evolucao.texto) : "Tendência estável"}</span>` +
      "</div>" +
    "</div>"
  );
}

export function gerarPainel(dados, historico = null) {
  const r = dados?.resumo || { total: 0, defendido: 0, vulneravel: 0, pulado: 0, erro: 0, porGravidade: {} };
  const achadosOrdenados = ordenar(dados?.achados || []);
  const dataFmt = new Date(dados?.geradoEm || Date.now()).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

  const listaHistorico = Array.isArray(historico)
    ? historico
    : Array.isArray(dados?.historico)
      ? dados.historico
      : dados?.dirHistorico
        ? carregarHistorico(dados.dirHistorico)
        : [];

  const evolucao = resumirEvolucao(r, listaHistorico, { geradoEm: dados?.geradoEm });
  const statusMsg =
    r.vulneravel === 0
      ? "<strong>Todos os ataques foram bloqueados.</strong>"
      : `<strong>${escHtml(r.vulneravel)} ${r.vulneravel === 1 ? "ponto vulnerável" : "pontos vulneráveis"} a corrigir.</strong>`;

  const pctDefesa = r.total > 0 ? Math.round((r.defendido / r.total) * 100) : 100;
  const raio = 32;
  const circunferencia = Number((2 * Math.PI * raio).toFixed(2));
  const offset = Number((circunferencia - (pctDefesa / 100) * circunferencia).toFixed(2));
  const corAnel = r.vulneravel > 0 ? "var(--crit)" : "var(--ok)";

  const porGrav = r.porGravidade || {};
  const qtdCrit = Number(porGrav["crítica"] || 0);
  const qtdAlta = Number(porGrav["alta"] || 0);
  const qtdMedia = Number(porGrav["média"] || 0);
  const qtdBaixa = Number(porGrav["baixa"] || 0) + Number(porGrav["informativo"] || 0);
  const qtdDef = Number(r.defendido || 0);

  // Correção 3: Qualquer gravidade com valor 0 recebe a classe .zero (neutra/apagada)
  const sevBadges = [
    { lbl: "Crítico", n: qtdCrit, cls: "s-crit" },
    { lbl: "Alto", n: qtdAlta, cls: "s-alta" },
    { lbl: "Médio", n: qtdMedia, cls: "s-media" },
    { lbl: "Baixo", n: qtdBaixa, cls: "s-baixa" },
    { lbl: "Defendido", n: qtdDef, cls: "s-ok" },
  ]
    .map(
      (b) =>
        `<div class="sev-box ${b.cls}${b.n === 0 ? " zero" : ""}">` +
          `<span class="count">${escHtml(b.n)}</span>` +
          `<span class="lbl">${escHtml(b.lbl)}</span>` +
        `</div>`
    )
    .join("");

  const pontosGrafico =
    listaHistorico.length > 0
      ? listaHistorico
      : [{ timestamp: dados?.geradoEm || new Date().toISOString(), defendidas: r.defendido, totalSondas: r.total, pontuacaoGeral: `${r.defendido}/${r.total}` }];

  const contBateria = { todas: achadosOrdenados.length, iso: 0, app: 0, ia: 0 };
  for (const a of achadosOrdenados) {
    const b = classificarBateria(a);
    if (contBateria[b] !== undefined) contBateria[b]++;
  }

  // Correções 1, 4 e 5:
  // - Apenas VULNERAVEL inicia expandido (.open); Defendido e Pulado iniciam fechados.
  // - Tag de gravidade neutra com bolinha discreta (.sev-dot).
  // - Como Reproduzir em linha compacta estilo terminal ($ Vetor: ...) e Esperado vs Obtido lado a lado com divisor fino.
  const cards = achadosOrdenados
    .map((a) => {
      const resClass = RES_CLASSE[a.resultado] || "erro";
      const resLabel = RES_LABEL[a.resultado] || escHtml(a.resultado);
      const bat = classificarBateria(a);
      const sevClass = CLASSE_GRAV[a.gravidade] || "media";
      const iniciarAberto = a.resultado === "VULNERAVEL";
      return (
        `<div class="card r-${resClass}${iniciarAberto ? " open" : ""}" data-r="${resClass}" data-bateria="${bat}">` +
          `<button class="row" type="button" aria-expanded="${iniciarAberto ? "true" : "false"}">` +
            '<span class="row-left">' +
              `<span class="id">${escHtml(a.id)}</span>` +
              `<span class="ttl">${escHtml(a.titulo)}<span class="cat">${escHtml(a.categoria)}</span></span>` +
            "</span>" +
            '<span class="badges">' +
              `<span class="sev ${sevClass}" title="Gravidade potencial da sonda"><span class="sev-dot"></span><span class="sev-txt">${escHtml(a.gravidade)}</span></span>` +
              `<span class="res ${resClass}">${resLabel}</span>` +
              `<span class="caret">${ICONE_CARET}</span>` +
            "</span>" +
          "</button>" +
          '<div class="detail"><div class="detail-inner"><div class="detail-body">' +
            (a.reproduzir
              ? '<div class="repro-box">' +
                  '<div class="repro-left">' +
                    '<span class="repro-prompt">$</span>' +
                    '<span class="blk-label">Vetor:</span>' +
                    `<span class="blk-val">${escHtml(a.reproduzir)}</span>` +
                  "</div>" +
                  `<button type="button" class="btn-copy" data-copy="${escHtml(a.reproduzir)}">Copiar</button>` +
                "</div>"
              : "") +
            '<div class="detail-grid">' +
              '<div class="detail-col"><span class="blk-label">Comportamento Esperado</span><div class="blk-val">' +
                escHtml(a.esperado || "—") +
              "</div></div>" +
              '<div class="detail-col col-out"><span class="blk-label">Resultado Obtido</span><div class="blk-val out">' +
                escHtml(a.obtido || "—") +
              "</div></div>" +
            "</div>" +
            (a.correcao
              ? '<div class="fix"><b>Correção sugerida</b>' + escHtml(a.correcao) + "</div>"
              : "") +
          "</div></div></div>" +
        "</div>"
      );
    })
    .join("");

  const pillStatus =
    r.vulneravel > 0
      ? `<span class="status-pill is-vuln"><span class="dot"></span>${escHtml(r.vulneravel)} Falha(s)</span>`
      : '<span class="status-pill"><span class="dot"></span>Alvo Protegido</span>';

  return [
    "<!DOCTYPE html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>ATLAS Console</title>",
    '<meta name="claude:viewport-fit-sides" content="cover">',
    "<style>" + CSS + "</style>",
    "</head>",
    "<body>",
    '<div class="wrap">',
    '<header class="topbar">',
      '<div class="brand">',
        `<div class="brand-logo">${ICONE_SHIELD}</div>`,
        '<div class="brand-text">',
          `<div class="brand-title-row"><h1>ATLAS</h1><span class="brand-badge">Security Suite v2</span>${pillStatus}</div>`,
          "<p>Red team automatizado &amp; verificação contínua no banco — alvo: <code>Vendly SaaS</code></p>",
        "</div>",
      "</div>",
      '<div class="top-right">',
        `<div class="meta"><div>rodada: <b>${escHtml(dataFmt)}</b></div><div>ambiente: <b class="env-ok">teste isolado (PG)</b></div></div>`,
        '<div class="toolbar">',
          `<button type="button" class="btn-tool" id="btn-apresentacao" aria-pressed="false" title="Modo Apresentação">${ICONE_APRES}<span>Modo Apresentação</span></button>`,
          `<button type="button" class="btn-tool" id="btn-pdf" title="Exportar PDF">${ICONE_PDF}<span>Exportar PDF</span></button>`,
          `<button type="button" class="btn-tool" id="btn-tema" aria-pressed="false" aria-label="Alternar tema claro/escuro" title="Tema Claro/Escuro">${ICONE_TEMA}<span>Tema</span></button>`,
        "</div>",
      "</div>",
    "</header>",
    '<section class="bento" aria-label="Resumo Executivo">',
      '<div class="bento-card verdict">',
        '<div class="bento-head">' +
          '<span class="bento-title">Score Geral de Defesa</span>' +
          (evolucao ? `<span class="evolucao-pill">${escHtml(evolucao.texto)}</span>` : '<span class="bento-sub">ground truth</span>') +
        "</div>",
        '<div class="score-main">',
          '<div class="score-ring">',
            `<svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="${raio}" fill="none" stroke="var(--line-strong)" stroke-width="5.5"/><circle cx="38" cy="38" r="${raio}" fill="none" stroke="${corAnel}" stroke-width="5.5" stroke-dasharray="${circunferencia}" stroke-dashoffset="${offset}" stroke-linecap="round"/></svg>`,
            `<span class="pct">${pctDefesa}%</span>`,
          "</div>",
          '<div class="score-numbers">',
            `<div class="score${r.vulneravel > 0 ? " has-vuln" : ""}"><b>${escHtml(r.defendido)}</b><span>/${escHtml(r.total)}</span></div>`,
            `<div class="score-sub">${escHtml(r.total)} sondas verificadas no banco</div>`,
          "</div>",
        "</div>",
        `<div class="bento-foot"><span class="lede">${statusMsg}</span><span style="font-family:var(--f-mono);font-size:11px">${evolucao ? escHtml(evolucao.texto) : `${escHtml(r.defendido)}/${escHtml(r.total)}`}</span></div>`,
      "</div>",
      '<div class="bento-card">',
        '<div class="bento-head"><span class="bento-title">Resumo por Gravidade</span><span class="bento-sub">Falhas abertas vs Defesas</span></div>',
        `<div class="sev-grid">${sevBadges}</div>`,
        `<div class="bento-foot"><span>Falhas abertas: <strong>${escHtml(r.vulneravel)}</strong></span><span style="font-family:var(--f-mono);font-size:11px">Pulados: <strong style="color:var(--warn-text)">${escHtml(r.pulado || 0)}</strong> · Erros: ${escHtml(r.erro || 0)}</span></div>`,
      "</div>",
      '<div class="bento-card">',
        '<div class="bento-head"><span class="bento-title">Evolução entre Rodadas</span><span class="bento-sub">historico/*.json</span></div>',
        gerarGraficoEvolucaoSvg(pontosGrafico, evolucao),
      "</div>",
    "</section>",
    '<div class="controls-bar">',
      '<div class="tabs" role="tablist" aria-label="Baterias de teste">',
        `<button type="button" class="tab" role="tab" data-bateria="todas" aria-selected="true">Todas <span class="t-cnt">${contBateria.todas}</span></button>`,
        `<button type="button" class="tab" role="tab" data-bateria="iso" aria-selected="false">Isolamento Multi-Tenant (ISO) <span class="t-cnt">${contBateria.iso}</span></button>`,
        `<button type="button" class="tab" role="tab" data-bateria="app" aria-selected="false">AppSec (APP) <span class="t-cnt">${contBateria.app}</span></button>`,
        `<button type="button" class="tab" role="tab" data-bateria="ia" aria-selected="false">Segurança de IA (IA) <span class="t-cnt">${contBateria.ia}</span></button>`,
      "</div>",
      '<div class="controls-right">',
        '<div class="filters">',
          '<span class="cap">Status</span>',
          '<button type="button" class="chip" data-f="todos" aria-pressed="true">Todos</button>',
          '<button type="button" class="chip" data-f="vuln" aria-pressed="false">A Corrigir / Pulados</button>',
          '<button type="button" class="chip" data-f="defendido" aria-pressed="false">Defendidos</button>',
        "</div>",
        '<button type="button" class="btn-expand-all" id="btn-expandir-todos">Expandir todos</button>',
      "</div>",
    "</div>",
    `<div class="sub-bar"><span>Sondas defendidas e puladas iniciam recolhidas para leitura rápida. Clique em qualquer linha para inspecionar a prova no banco.</span><span id="visible-count-label" class="mono">Exibindo ${achadosOrdenados.length} de ${achadosOrdenados.length} sondas</span></div>`,
    `<div class="list" id="list" data-filtro="todos" data-bateria="todas">${cards}</div>`,
    '<div class="empty-state" id="empty-state">Nenhuma sonda encontrada para a combinação de bateria e filtro selecionada.</div>',
    '<footer><div class="f-left"><span class="f-dot"></span><span>ATLAS Red Team Framework — Validação por verdade absoluta no PostgreSQL + limpeza automática de artefatos.</span></div><div class="f-right">Uso restrito a ambientes próprios autorizados (Lei 12.737 / CFAA)</div></footer>',
    "</div>",
    "<script>" + PAINEL_JS + "<\/script>",
    "</body>",
    "</html>",
  ].join("\n");
}
