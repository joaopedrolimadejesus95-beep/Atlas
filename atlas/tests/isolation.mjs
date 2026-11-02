// ATLAS — bateria: isolamento entre empresas (multi-tenant)
// -----------------------------------------------------------------------------
// A falha mais grave possível num SaaS multi-empresa: logado como a empresa A,
// conseguir ver ou mexer nos dados da empresa B. Aqui o ATLAS loga como a
// Burger A e tenta, de vários jeitos, alcançar dados da Pizza B.
//
// Cada sonda espera o comportamento SEGURO (negar / não encontrar / não vazar).
// Se o Vendly se comportar assim, vira "defendido". Se vazar, vira VULNERAVEL.

import { http, login } from "../adapter.mjs";
import { registrar, sonda, GRAVIDADE } from "../atlas.mjs";
import { CONTAS } from "../seed.mjs";

export async function rodar(ctx) {
  const tokenA = await login(CONTAS.burgerA.login, CONTAS.burgerA.senha);
  const tokenB = await login(CONTAS.pizzaB.login, CONTAS.pizzaB.senha);

  if (!tokenA || !tokenB) {
    throw new Error("Não consegui logar nas empresas de teste — o seed rodou e o servidor está no ar?");
  }

  // --- 1. IDOR: ler o pedido da outra empresa trocando o id na rota ---
  // (A lê o pedido de B apagando-o; se conseguir apagar, vazou controle.)
  await sonda(
    { id: "ISO-01", categoria: "isolamento", titulo: "Apagar pedido de outra empresa trocando o ID (IDOR)",
      reproduzir: `Logado como Burger A, DELETE /api/pedidos/${ctx.pedidoB} (pedido que é da Pizza B).` },
    async () => {
      const r = await http("DELETE", `/api/pedidos/${ctx.pedidoB}`, { token: tokenA });
      // O Vendly responde 200 {ok:false} quando o DELETE não casou nenhuma linha
      // da empresa logada — ou seja, não apagou nada da outra. Isso é seguro.
      const naoApagou = r.body?.ok === false;
      // Confirma de fato que o pedido de B continua existindo (consultando como B).
      const comoB = await http("GET", "/api/pedidos", { token: tokenB });
      const aindaExiste = Array.isArray(comoB.body?.pedidos) && comoB.body.pedidos.some((p) => p.id === ctx.pedidoB);
      registrar({
        id: "ISO-01", categoria: "isolamento",
        titulo: "Apagar pedido de outra empresa trocando o ID (IDOR)",
        gravidade: GRAVIDADE.CRITICA,
        seguro: naoApagou && aindaExiste,
        esperado: "O pedido da Pizza B permanece intacto (DELETE não afeta dados de outra empresa).",
        obtido: `status ${r.status}, ok=${r.body?.ok}; pedido de B ainda existe: ${aindaExiste}`,
        correcao: "Garantir que todo UPDATE/DELETE filtre por empresa_id (já é o padrão; manter em rotas novas).",
      });
    }
  );

  // --- 2. Vazamento de catálogo: A vê produtos de B? ---
  await sonda(
    { id: "ISO-02", categoria: "isolamento", titulo: "Listar produtos vaza itens de outra empresa",
      reproduzir: "Logado como Burger A, GET /api/produtos e checar se aparece item da Pizza B." },
    async () => {
      const r = await http("GET", "/api/produtos", { token: tokenA });
      const nomes = (r.body?.produtos || []).map((p) => p.nome);
      const vazou = nomes.some((n) => /margherita|suco de laranja/i.test(n));
      registrar({
        id: "ISO-02", categoria: "isolamento", titulo: "Listar produtos vaza itens de outra empresa",
        gravidade: GRAVIDADE.CRITICA, seguro: !vazou,
        esperado: "A Burger A só vê o próprio cardápio (X-Burger, Refrigerante).",
        obtido: `produtos vistos pela Burger A: ${JSON.stringify(nomes)}`,
        correcao: "Toda query de catálogo deve filtrar por empresa_id (padrão atual mantido).",
      });
    }
  );

  // --- 3. Alterar estoque de produto da outra empresa ---
  await sonda(
    { id: "ISO-03", categoria: "isolamento", titulo: "Alterar estoque de produto de outra empresa",
      reproduzir: "Logado como Burger A, PUT /api/estoque/marg (produto 'marg' é da Pizza B)." },
    async () => {
      await http("PUT", "/api/estoque/marg", { token: tokenA, corpo: { quantidade: 99999 } });
      // Confere como B se o estoque da margherita foi mexido.
      const comoB = await http("GET", "/api/produtos", { token: tokenB });
      const estoqueMarg = comoB.body?.estoque?.marg;
      const intacto = estoqueMarg === 50; // valor semeado
      registrar({
        id: "ISO-03", categoria: "isolamento", titulo: "Alterar estoque de produto de outra empresa",
        gravidade: GRAVIDADE.CRITICA, seguro: intacto,
        esperado: "O estoque da Pizza B (margherita = 50) não muda com ação da Burger A.",
        obtido: `estoque da margherita após tentativa: ${estoqueMarg}`,
        correcao: "UPDATE de estoque já filtra por empresa_id — o produto 'marg' não pertence à Burger A, então nada é afetado.",
      });
    }
  );

  // --- 4. Trocar a senha da outra empresa (não há id no corpo, mas testa o escopo) ---
  // Aqui o ponto é confirmar que a rota de senha age SÓ sobre a empresa do token,
  // nunca aceitando um alvo arbitrário.
  await sonda(
    { id: "ISO-04", categoria: "isolamento", titulo: "Rota de troca de senha age só sobre a própria empresa",
      reproduzir: "Logado como Burger A, POST /api/senha tentando passar empresaId/alvo no corpo." },
    async () => {
      // Injeta campos extras no corpo tentando apontar pra empresa B.
      await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: CONTAS.burgerA.senha, novaSenha: "novaA123", empresaId: ctx.idB, id: ctx.idB } });
      // A senha da Pizza B deve continuar a mesma.
      const pizzaAindaLoga = await login(CONTAS.pizzaB.login, CONTAS.pizzaB.senha);
      registrar({
        id: "ISO-04", categoria: "isolamento", titulo: "Rota de troca de senha age só sobre a própria empresa",
        gravidade: GRAVIDADE.CRITICA, seguro: Boolean(pizzaAindaLoga),
        esperado: "Campos extras no corpo (empresaId/id) são ignorados; a senha da Pizza B não muda.",
        obtido: pizzaAindaLoga ? "Pizza B continua logando com a senha original." : "Pizza B NÃO loga mais — senha foi afetada!",
        correcao: "A rota usa req.empresaId do token, nunca um id vindo do corpo — manter esse padrão.",
      });
      // Repõe a senha da Burger A pro resto da bateria não quebrar.
      await http("POST", "/api/senha", { token: tokenA, corpo: { senhaAtual: "novaA123", novaSenha: CONTAS.burgerA.senha } });
    }
  );

  // --- 5. Token forjado: trocar o empresaId dentro do payload sem reassinar ---
  await sonda(
    { id: "ISO-05", categoria: "autenticação", titulo: "Token adulterado (trocar empresaId sem a chave) é aceito",
      reproduzir: "Pegar o token da Burger A, trocar o empresaId no payload base64 e reenviar sem reassinar." },
    async () => {
      const [payloadB64, assinatura] = tokenA.split(".");
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
      payload.empresaId = ctx.idB; // tenta virar a Pizza B
      const payloadAdulterado = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const tokenForjado = `${payloadAdulterado}.${assinatura}`; // mesma assinatura, payload trocado
      const r = await http("GET", "/api/empresa", { token: tokenForjado });
      // Seguro = a assinatura não bate e o servidor recusa com 401.
      registrar({
        id: "ISO-05", categoria: "autenticação", titulo: "Token adulterado (trocar empresaId sem a chave) é aceito",
        gravidade: GRAVIDADE.CRITICA, seguro: r.status === 401,
        esperado: "401 — a assinatura HMAC não confere com o payload adulterado.",
        obtido: `status ${r.status}${r.status === 200 ? ` — ACEITOU e retornou empresa: ${JSON.stringify(r.body?.nome)}` : ""}`,
        correcao: "verificarToken() recalcula o HMAC do payload e compara — adulterar o payload invalida a assinatura. Manter.",
      });
    }
  );

  // --- 6. Acesso sem token nenhum ---
  await sonda(
    { id: "ISO-06", categoria: "autenticação", titulo: "Rota protegida acessível sem token",
      reproduzir: "GET /api/pedidos sem header Authorization." },
    async () => {
      const r = await http("GET", "/api/pedidos");
      registrar({
        id: "ISO-06", categoria: "autenticação", titulo: "Rota protegida acessível sem token",
        gravidade: GRAVIDADE.ALTA, seguro: r.status === 401,
        esperado: "401 — sem token, sem acesso.",
        obtido: `status ${r.status}`,
        correcao: "Middleware exigirLogin cobre tudo em /api exceto login e /publico — manter.",
      });
    }
  );
}
