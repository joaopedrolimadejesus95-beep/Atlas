// Bateria 1 — ISOLAMENTO ENTRE EMPRESAS (multi-tenant) e autenticação.
// A falha mais grave de um SaaS: logado como a empresa A, mexer nos dados da B.
// Regra de ouro desta bateria: quem decide se o ataque funcionou é o BANCO,
// nunca a resposta da API.
import { GRAV } from "../nucleo.mjs";
import { gerarSenha } from "../senha.mjs";

export async function bateriaIsolamento(rodada, alvo, ctx) {
  const { burgerA: A } = alvo.contas;
  const { banco, http } = alvo;
  const tokenA = await alvo.login(A);
  const produtoB = ctx.produtosB[0]; // "marg" — Pizza Margherita

  await rodada.sonda(
    {
      id: "ISO-01", categoria: "isolamento", gravidade: GRAV.CRITICA,
      titulo: "Apagar pedido de outra empresa trocando o ID (IDOR)",
      reproduzir: `Logado como Burger A, DELETE /api/pedidos/${ctx.pedidoB} (pedido da Pizza B).`,
      correcao: "Todo UPDATE/DELETE precisa filtrar por empresa_id vindo do token (WHERE id=$1 AND empresa_id=$2).",
    },
    async () => {
      const r = await http("DELETE", `/api/pedidos/${ctx.pedidoB}`, { token: tokenA });
      const existe = await banco.pedidoExiste(ctx.pedidoB);
      return {
        seguro: existe,
        esperado: "O pedido da Pizza B continua existindo no banco.",
        obtido: `status ${r.status}; pedido da Pizza B ainda existe no banco: ${existe}`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "ISO-02", categoria: "isolamento", gravidade: GRAV.CRITICA,
      titulo: "Listar produtos vaza itens de outra empresa",
      reproduzir: "Logado como Burger A, GET /api/produtos.",
      correcao: "Toda query de catálogo deve filtrar por empresa_id.",
    },
    async () => {
      const r = await http("GET", "/api/produtos", { token: tokenA });
      if (r.status !== 200) throw new Error(`GET /api/produtos respondeu ${r.status} (esperava 200 pra poder avaliar)`);
      const nomes = (r.body?.produtos ?? []).map((p) => p.nome);
      const vazados = ctx.produtosB.map((p) => p.nome).filter((n) => nomes.includes(n));
      const veOsProprios = ctx.produtosA.every((p) => nomes.includes(p.nome));
      return {
        seguro: vazados.length === 0 && veOsProprios,
        esperado: `A Burger A vê só o próprio cardápio (${ctx.produtosA.map((p) => p.nome).join(", ")}).`,
        obtido: `produtos vistos pela Burger A: ${JSON.stringify(nomes)}${vazados.length ? ` — VAZOU: ${JSON.stringify(vazados)}` : ""}${veOsProprios ? "" : " — não listou os próprios produtos"}`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "ISO-03", categoria: "isolamento", gravidade: GRAV.CRITICA,
      titulo: "Alterar estoque de produto de outra empresa",
      reproduzir: `Logado como Burger A, PUT /api/estoque/${produtoB.id} com quantidade alta.`,
      correcao: "UPDATE de estoque precisa filtrar por empresa_id (WHERE id=$1 AND empresa_id=$2).",
    },
    async () => {
      const antes = await banco.estoqueDe(ctx.idB, produtoB.id);
      await http("PUT", `/api/estoque/${produtoB.id}`, { token: tokenA, corpo: { quantidade: 99999 } });
      const depois = await banco.estoqueDe(ctx.idB, produtoB.id);
      return {
        seguro: antes !== null && depois === antes,
        esperado: `O estoque da Pizza B (${produtoB.id}) não muda por ação da Burger A.`,
        obtido: `estoque no banco: antes=${antes}, depois=${depois}`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "ISO-04", categoria: "isolamento", gravidade: GRAV.CRITICA,
      titulo: "Rota de troca de senha age só sobre a própria empresa",
      reproduzir: "POST /api/senha com empresaId/id extras no corpo (mass assignment).",
      correcao: "A rota deve usar o id da empresa que vem do TOKEN, nunca de campos do corpo.",
      limpar: () => banco.redefinirSenha(ctx.idA, A.senha),
    },
    async () => {
      const antes = await banco.hashSenhaDe(ctx.idB);
      await http("POST", "/api/senha", {
        token: tokenA,
        corpo: { senhaAtual: A.senha, novaSenha: gerarSenha(), empresaId: ctx.idB, id: ctx.idB },
      });
      const depois = await banco.hashSenhaDe(ctx.idB);
      return {
        seguro: antes !== null && antes === depois,
        esperado: "Campos extras (empresaId/id) são ignorados; o hash de senha da Pizza B não muda.",
        obtido: antes === depois ? "hash da Pizza B inalterado no banco." : "hash da Pizza B MUDOU — senha de outra empresa foi trocada!",
      };
    }
  );

  await rodada.sonda(
    {
      id: "ISO-05", categoria: "autenticação", gravidade: GRAV.CRITICA,
      titulo: "Token adulterado (trocar empresaId sem a chave) é aceito",
      reproduzir: "Pegar token da Burger A, trocar empresaId no payload e reenviar (com assinatura original, vazia, ausente e aleatória).",
      correcao: "Validar a assinatura HMAC do token com comparação em tempo constante (timingSafeEqual) e rejeitar token sem assinatura.",
    },
    async () => {
      const variantes = alvo.forjarTokens(tokenA, ctx.idB);
      const resultados = [];
      for (const v of variantes) {
        const r = await http("GET", "/api/empresa", { token: v.token });
        resultados.push({ descricao: v.descricao, status: r.status });
      }
      const aceitos = resultados.filter((x) => x.status >= 200 && x.status < 300);
      return {
        seguro: aceitos.length === 0 && resultados.every((x) => x.status === 401 || x.status === 403),
        esperado: "401/403 em todas as variações — a assinatura não confere com o payload adulterado.",
        obtido: resultados.map((x) => `${x.descricao}: ${x.status}`).join(" | "),
      };
    }
  );

  await rodada.sonda(
    {
      id: "ISO-06", categoria: "autenticação", gravidade: GRAV.ALTA,
      titulo: "Rota protegida acessível sem token",
      reproduzir: "Chamar cada rota protegida sem header Authorization.",
      correcao: "Aplicar o middleware de login em TODO /api (exceto login e /publico) — preferir lista de exceções, não de rotas protegidas.",
    },
    async () => {
      const abertas = [];
      for (const [metodo, caminho] of alvo.rotasProtegidas) {
        const r = await http(metodo, caminho, { corpo: metodo === "GET" ? undefined : {} });
        if (r.status !== 401 && r.status !== 403) abertas.push(`${metodo} ${caminho} → ${r.status}`);
      }
      return {
        seguro: abertas.length === 0,
        esperado: `401/403 nas ${alvo.rotasProtegidas.length} rotas protegidas, sem token.`,
        obtido: abertas.length ? `Sem 401/403: ${abertas.join("; ")}` : `${alvo.rotasProtegidas.length} rotas recusaram a chamada sem token.`,
      };
    }
  );

  await rodada.sonda(
    {
      id: "ISO-07", categoria: "isolamento", gravidade: GRAV.CRITICA,
      titulo: "Criar produto dentro de outra empresa injetando empresaId no corpo",
      reproduzir: "POST /api/produtos como Burger A com empresaId/empresa_id da Pizza B no corpo.",
      correcao: "Ao criar registros, ignorar qualquer empresa_id do corpo e gravar o que vem do token (liste os campos aceitos, sem spread do body).",
      limpar: () => banco.removerProduto("atlas-massa"),
    },
    async () => {
      await http("POST", "/api/produtos", {
        token: tokenA,
        corpo: { id: "atlas-massa", nome: "Item plantado", preco: 1, descricao: "x", categoria: "comida", empresaId: ctx.idB, empresa_id: ctx.idB },
      });
      const naPizza = await banco.produtoExiste(ctx.idB, "atlas-massa");
      return {
        seguro: !naPizza,
        esperado: "Nenhum produto aparece dentro da Pizza B por ação da Burger A.",
        obtido: naPizza ? "O produto foi gravado DENTRO da Pizza B." : "Nada foi gravado na Pizza B.",
      };
    }
  );
}
