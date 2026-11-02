import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ordenar, redigir, redigirAchado, criarRegistroHistorico } from "./nucleo.mjs";

const ICONE = { VULNERAVEL: "🔴", erro: "⚪", pulado: "🟡", defendido: "🟢" };
const ROTULO = { VULNERAVEL: "vulnerável — precisa corrigir", erro: "erro na execução", pulado: "pulado", defendido: "defendido" };

export function formatarNomeHistorico(dataIso = new Date().toISOString()) {
  let d = new Date(dataIso);
  if (Number.isNaN(d.getTime())) d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.json`;
}

function resolverDirHistorico(dirOuOpcoes = "historico") {
  if (typeof dirOuOpcoes === "string" && dirOuOpcoes.trim()) return dirOuOpcoes;
  if (dirOuOpcoes && typeof dirOuOpcoes === "object") {
    if (typeof dirOuOpcoes.dirHistorico === "string") return dirOuOpcoes.dirHistorico;
    if (typeof dirOuOpcoes.saida === "string") return join(dirOuOpcoes.saida, "historico");
  }
  return "historico";
}

// Salva uma execução na pasta historico/ com formato YYYY-MM-DD_HH-mm-ss.json.
// Garante que redigir() seja aplicado ANTES de persistir no disco.
// Aceita (r, achados, meta, dirHistorico) ou (dadosConsolidados, dirHistorico).
export function salvarHistorico(rOuDados, achadosOuDir = [], meta = {}, dirHistorico = "historico") {
  try {
    let r = rOuDados;
    let achados = achadosOuDir;
    let metaFinal = meta;
    let dirAlvo = dirHistorico;

    if (!Array.isArray(achadosOuDir)) {
      // Chamado como salvarHistorico(dados, dirHistorico)
      const dados = rOuDados || {};
      r = typeof dados.resumo === "function" ? dados.resumo() : (dados.resumo || dados);
      achados = Array.isArray(dados.achados) ? dados.achados : [];
      metaFinal = {
        geradoEm: dados.geradoEm || dados.timestamp,
        descricaoAlvo: dados.alvo || dados.descricaoAlvo || "",
      };
      dirAlvo = achadosOuDir || meta?.dirHistorico || "historico";
    } else if (meta && typeof meta === "object" && meta.dirHistorico && dirHistorico === "historico") {
      dirAlvo = meta.dirHistorico;
    }

    const pasta = resolverDirHistorico(dirAlvo);
    mkdirSync(pasta, { recursive: true });

    const registro = criarRegistroHistorico(r, achados, metaFinal);
    let dataBase = new Date(registro.timestamp);
    if (Number.isNaN(dataBase.getTime())) dataBase = new Date();

    let arquivo = formatarNomeHistorico(dataBase.toISOString());
    let caminho = join(pasta, arquivo);
    let offsetSegundos = 1;
    while (existsSync(caminho) && offsetSegundos < 3600) {
      const ajustada = new Date(dataBase.getTime() + offsetSegundos * 1000);
      arquivo = formatarNomeHistorico(ajustada.toISOString());
      caminho = join(pasta, arquivo);
      offsetSegundos++;
    }

    const conteudoJson = JSON.stringify(registro, null, 2);
    writeFileSync(caminho, conteudoJson, "utf8");
    return { caminho, arquivo, registro };
  } catch {
    return null;
  }
}

function normalizarRegistroHistorico(bruto, nomeArquivo = "") {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const resumo = bruto.resumo && typeof bruto.resumo === "object" ? bruto.resumo : {};
  const total = Number(bruto.totalSondas ?? bruto.total ?? resumo.total);
  const defendidas = Number(bruto.defendidas ?? bruto.defendido ?? resumo.defendido);
  if (!Number.isFinite(total) || !Number.isFinite(defendidas)) return null;

  const vulneraveis = Number(bruto.vulneraveis ?? bruto.vulneravel ?? resumo.vulneravel ?? 0);
  const pulados = Number(bruto.pulados ?? bruto.pulado ?? resumo.pulado ?? 0);
  const erros = Number(bruto.erros ?? bruto.erro ?? resumo.erro ?? 0);
  const falhasPorGravidade = bruto.falhasPorGravidade || bruto.porGravidade || resumo.porGravidade || {};
  const timestamp = bruto.timestamp || bruto.geradoEm || nomeArquivo.replace(/\.json$/i, "");

  return {
    ...bruto,
    timestamp,
    geradoEm: timestamp,
    pontuacaoGeral: bruto.pontuacaoGeral || `${defendidas}/${total}`,
    pontuacao: typeof bruto.pontuacao === "number" ? bruto.pontuacao : (total > 0 ? Math.round((defendidas / total) * 100) : 100),
    totalSondas: total,
    total,
    defendidas,
    defendido: defendidas,
    vulneraveis,
    vulneravel: vulneraveis,
    pulados,
    erros,
    falhasPorGravidade,
    porGravidade: falhasPorGravidade,
    resumoAchados: Array.isArray(bruto.resumoAchados)
      ? bruto.resumoAchados
      : Array.isArray(bruto.achados)
        ? bruto.achados.map((a) => ({
            id: a.id,
            categoria: a.categoria,
            titulo: a.titulo,
            gravidade: a.gravidade,
            resultado: a.resultado,
            obtido: a.obtido,
          }))
        : [],
  };
}

// Carrega os últimos registros da pasta historico/ de forma tolerante a falhas.
// Se a pasta não existir ou houver arquivos JSON corrompidos, ignora sem quebrar.
export function carregarHistorico(dirHistorico = "historico", limite = 10) {
  try {
    const pasta = resolverDirHistorico(dirHistorico);
    if (!existsSync(pasta)) return [];
    const arquivos = readdirSync(pasta)
      .filter((nome) => nome.toLowerCase().endsWith(".json"))
      .sort();

    const registros = [];
    for (const arquivo of arquivos) {
      try {
        const texto = readFileSync(join(pasta, arquivo), "utf8");
        const parsed = JSON.parse(texto);
        const norm = normalizarRegistroHistorico(parsed, arquivo);
        if (norm) registros.push(norm);
      } catch {
        // Ignora graciosamente JSON corrompido ou ilegível
      }
    }

    registros.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return limite > 0 ? registros.slice(-limite) : registros;
  } catch {
    return [];
  }
}

export function resumirEvolucao(rAtual, historico = [], metaAtual = {}) {
  if (!Array.isArray(historico) || historico.length === 0) return null;
  const validos = historico.map((h) => normalizarRegistroHistorico(h)).filter(Boolean);
  if (validos.length === 0) return null;

  const tsAtual = metaAtual?.geradoEm || metaAtual?.timestamp || null;
  const ultimo = validos.at(-1);
  let anterior = null;

  if (tsAtual && ultimo.timestamp === tsAtual) {
    if (validos.length >= 2) anterior = validos.at(-2);
  } else {
    anterior = ultimo;
  }

  if (!anterior) return null;

  const antDef = anterior.defendidas;
  const antTot = anterior.totalSondas;
  const atuDef = rAtual?.defendido ?? rAtual?.defendidas ?? 0;
  const atuTot = rAtual?.total ?? rAtual?.totalSondas ?? 0;

  return {
    anterior: `${antDef}/${antTot}`,
    atual: `${atuDef}/${atuTot}`,
    deltaDefendidas: atuDef - antDef,
    texto: `de ${antDef}/${antTot} para ${atuDef}/${atuTot}`,
    registroAnterior: anterior,
  };
}

export function gerarMarkdown(r, achados, meta = {}, historico = null) {
  const data = new Date(meta.geradoEm || Date.now()).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const listaHistorico = Array.isArray(historico)
    ? historico
    : Array.isArray(meta?.historico)
      ? meta.historico
      : meta?.dirHistorico
        ? carregarHistorico(meta.dirHistorico)
        : [];
  const evolucao = resumirEvolucao(r, listaHistorico, meta);
  const achadosSeguros = ordenar(achados).map(redigirAchado);

  const L = [];
  L.push("# ATLAS — Relatório de Red Team do Vendly", "");
  L.push(`**Data:** ${data}  `, `**Alvo:** ${meta.descricaoAlvo}  `, `**Escopo:** isolamento entre empresas, autenticação, política de senha, exposição de dados, XSS, força bruta e injeção.`, "");
  L.push("## Resumo", "", `Foram executados **${r.total}** testes de ataque.`, "");
  L.push(`- 🟢 **${r.defendido}** defesas funcionaram (o ataque foi bloqueado)`);
  L.push(`- 🔴 **${r.vulneravel}** vulnerabilidades / pontos a corrigir`);
  if (r.pulado) L.push(`- 🟡 **${r.pulado}** testes pulados (checagem opcional não habilitada)`);
  if (r.erro) L.push(`- ⚪ **${r.erro}** testes com erro de execução (não contam como defendidos)`);
  if (evolucao) {
    L.push(`- 📈 **Evolução temporal:** ${evolucao.texto} defesas`);
  }
  L.push("");
  L.push("| ID | Teste | Gravidade | Resultado |", "|----|-------|-----------|-----------|");
  for (const a of achadosSeguros) {
    const ic = { VULNERAVEL: "🔴 corrigir", erro: "⚪ erro", pulado: "🟡 pulado", defendido: "🟢 defendido" }[a.resultado];
    L.push(`| ${a.id} | ${a.titulo} | ${a.gravidade} | ${ic} |`);
  }

  if (listaHistorico.length > 0) {
    L.push("", "## Histórico de Rodadas", "");
    if (evolucao) {
      L.push(`Evolução: **${evolucao.texto}** (${evolucao.texto}).`, "");
    }
    L.push("| Data/Hora | Pontuação | Defendidas | Vulneráveis |", "|-----------|-----------|------------|-------------|");
    for (const h of listaHistorico.map((x) => normalizarRegistroHistorico(x)).filter(Boolean)) {
      L.push(`| ${h.timestamp} | ${h.pontuacaoGeral} | ${h.defendidas} | ${h.vulneraveis} |`);
    }
  }

  L.push("", "## Detalhes", "");
  for (const a of achadosSeguros) {
    L.push(`### ${ICONE[a.resultado]} ${a.id} — ${a.titulo}`, "");
    L.push(`- **Categoria:** ${a.categoria}`, `- **Gravidade:** ${a.gravidade}`, `- **Resultado:** ${ROTULO[a.resultado]}`);
    if (a.reproduzir) L.push(`- **Como reproduzir:** ${a.reproduzir}`);
    L.push(`- **Esperado:** ${a.esperado}`, `- **Obtido:** ${a.obtido}`);
    if (a.correcao) L.push(`- **Correção sugerida:** ${a.correcao}`);
    L.push("");
  }
  L.push("---", "", "_Relatório gerado pelo ATLAS. Testes contra uma cópia de teste isolada — nenhum dado de produção foi tocado._");
  return L.join("\n");
}

export function gerarJson(r, achados, meta = {}, historico = null) {
  const listaHistorico = Array.isArray(historico)
    ? historico
    : Array.isArray(meta?.historico)
      ? meta.historico
      : null;
  const payload = {
    geradoEm: meta.geradoEm,
    alvo: meta.descricaoAlvo,
    resumo: r,
    achados: ordenar(achados).map(redigirAchado),
  };
  if (listaHistorico) {
    payload.historico = listaHistorico;
    const ev = resumirEvolucao(r, listaHistorico, meta);
    if (ev) payload.evolucao = ev.texto;
  }
  return JSON.stringify(payload, null, 2);
}
