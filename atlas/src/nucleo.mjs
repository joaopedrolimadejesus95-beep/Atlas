// =============================================================================
// NÚCLEO — o que é comum a todas as sondas.
//
// Uma "sonda" é um ataque. Ela devolve { seguro, esperado, obtido } e o núcleo
// transforma isso num achado com um destes resultados:
//   defendido  → a defesa segurou
//   VULNERAVEL → o ataque funcionou (vira item de correção)
//   pulado     → não deu pra avaliar de propósito (ex.: falta ADMIN_HTML)
//   erro       → a sonda quebrou; NÃO conta como defendido
// =============================================================================

export const GRAV = { CRITICA: "crítica", ALTA: "alta", MEDIA: "média", BAIXA: "baixa", INFO: "informativo" };
export const ORDEM_GRAV = [GRAV.CRITICA, GRAV.ALTA, GRAV.MEDIA, GRAV.BAIXA, GRAV.INFO];

// Os relatórios vão pra um repositório público. Antes de gravar qualquer texto
// que veio do alvo, mascara o que parece segredo.
export function redigir(texto) {
  return String(texto ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [redigido]")
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[token-redigido]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[hex-redigido]")
    .replace(/("?(?:senha|password|token|hash|salt|authorization)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1"[redigido]"');
}

// Percorre um JSON e chama fn(chave, valor) em cada propriedade, em qualquer nível.
export function percorrer(valor, fn) {
  if (Array.isArray(valor)) return valor.forEach((v) => percorrer(v, fn));
  if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      fn(k, v);
      percorrer(v, fn);
    }
  }
}

export class Rodada {
  constructor() {
    this.achados = [];
  }

  _add(meta, resultado, extra) {
    this.achados.push({
      id: meta.id,
      categoria: meta.categoria,
      titulo: meta.titulo,
      gravidade: meta.gravidade,
      resultado,
      esperado: extra.esperado ?? "",
      obtido: redigir(extra.obtido),
      correcao: resultado === "VULNERAVEL" ? meta.correcao ?? null : null,
      reproduzir: meta.reproduzir ?? null,
    });
  }

  // meta: { id, categoria, titulo, gravidade, correcao, reproduzir, limpar? }
  // fn:   async () => ({ seguro, esperado, obtido }) | ({ pulado: true, motivo })
  // limpar roda SEMPRE (mesmo se a sonda quebrar) pra não deixar lixo no alvo.
  async sonda(meta, fn) {
    let aviso = "";
    try {
      const r = await fn();
      if (r?.pulado) return this._add(meta, "pulado", { esperado: meta.esperado, obtido: r.motivo });
      this._add(meta, r.seguro ? "defendido" : "VULNERAVEL", r);
    } catch (e) {
      // A gravidade original é mantida: um erro numa sonda crítica continua sendo
      // um buraco no teste de algo crítico.
      this._add(meta, "erro", { obtido: `A sonda quebrou: ${e.message}` });
    } finally {
      if (meta.limpar) {
        try { await meta.limpar(); } catch (e) { aviso = ` [aviso: a limpeza falhou: ${e.message}]`; }
        if (aviso) this.achados.at(-1).obtido += redigir(aviso);
      }
    }
  }

  // Agrupa sondas que dependem do mesmo preparo (ex.: logar). Se o preparo
  // quebrar, vira UM achado de erro em vez de derrubar a rodada inteira.
  async bateria(nome, fn) {
    try {
      await fn();
    } catch (e) {
      this._add(
        { id: `SETUP-${nome.toUpperCase()}`, categoria: "execução", titulo: `Preparo da bateria "${nome}" falhou`, gravidade: GRAV.INFO },
        "erro",
        { obtido: e.message }
      );
    }
  }

  resumo() {
    const r = { total: this.achados.length, vulneravel: 0, defendido: 0, erro: 0, pulado: 0, porGravidade: {} };
    for (const a of this.achados) {
      if (a.resultado === "VULNERAVEL") {
        r.vulneravel++;
        r.porGravidade[a.gravidade] = (r.porGravidade[a.gravidade] || 0) + 1;
      } else if (a.resultado === "defendido") r.defendido++;
      else if (a.resultado === "pulado") r.pulado++;
      else r.erro++;
    }
    return r;
  }

  // Código de saída pra CI: 0 limpo · 2 há vulnerabilidade · 3 só erros/execução.
  codigoDeSaida() {
    const r = this.resumo();
    return r.vulneravel > 0 ? 2 : r.erro > 0 ? 3 : 0;
  }
}

export function ordenar(lista) {
  const rank = (x) => (x.resultado === "VULNERAVEL" ? 0 : x.resultado === "erro" ? 1 : x.resultado === "pulado" ? 2 : 3);
  return [...lista].sort((a, b) =>
    rank(a) !== rank(b) ? rank(a) - rank(b) : ORDEM_GRAV.indexOf(a.gravidade) - ORDEM_GRAV.indexOf(b.gravidade)
  );
}
