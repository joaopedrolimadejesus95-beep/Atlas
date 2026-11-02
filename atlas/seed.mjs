// ATLAS — semeadura do ambiente de teste
// -----------------------------------------------------------------------------
// Cria duas empresas de teste ISOLADAS da produção (Burger A e Pizza B), cada
// uma com cardápio, estoque e um pedido fechado, mais um atendente na Burger A.
// É esse cenário que a bateria de isolamento usa pra tentar fazer uma empresa
// enxergar/mexer nos dados da outra.
//
// Roda contra o banco de TESTE (DATABASE_URL do .env.test), nunca a produção.
// Uso: node seed.mjs  (com as envs de teste já exportadas)

import { pool, inicializarBancoDeDados } from "../vendly_src/vendly-main/src/db.js";
import { criarEmpresa, criarAtendente } from "../vendly_src/vendly-main/src/auth.js";
import { salvarProduto } from "../vendly_src/vendly-main/src/catalog.js";
import { registrarPedido } from "../vendly_src/vendly-main/src/orders.js";

// Credenciais fixas pro ambiente de teste — o adaptador usa as mesmas.
export const CONTAS = {
  burgerA: { nome: "Burger A", login: "burgera", senha: "burger1234", instancia: "atlas-burger-a", plano: "pro" },
  pizzaB: { nome: "Pizza B", login: "pizzab", senha: "pizza1234", instancia: "atlas-pizza-b", plano: "pro" },
  atendenteA: { nome: "Garçom A1", login: "garcom-a1", senha: "garcom1234" },
};

async function limpar() {
  // Zera só as tabelas do nosso cenário de teste (ordem respeita FKs).
  await pool.query("DELETE FROM lancamentos_mesa");
  await pool.query("DELETE FROM pedidos");
  await pool.query("DELETE FROM mesas");
  await pool.query("DELETE FROM atendentes");
  await pool.query("DELETE FROM produtos");
  await pool.query("DELETE FROM empresas");
}

export async function semear() {
  await inicializarBancoDeDados();
  await limpar();

  const idA = await criarEmpresa({ ...CONTAS.burgerA, evolutionInstance: CONTAS.burgerA.instancia });
  const idB = await criarEmpresa({ ...CONTAS.pizzaB, evolutionInstance: CONTAS.pizzaB.instancia });

  // Cardápio da Burger A
  await salvarProduto(idA, { id: "xb", nome: "X-Burger", preco: 20, descricao: "pão, carne, queijo", estoqueInicial: 100, categoria: "comida" });
  await salvarProduto(idA, { id: "refri", nome: "Refrigerante", preco: 6, descricao: "lata 350ml", estoqueInicial: 200, categoria: "bebida" });

  // Cardápio da Pizza B — nomes/preços diferentes de propósito, pra deixar
  // óbvio num vazamento de qual empresa o dado veio.
  await salvarProduto(idB, { id: "marg", nome: "Pizza Margherita", preco: 45, descricao: "molho, muçarela, manjericão", estoqueInicial: 50, categoria: "comida" });
  await salvarProduto(idB, { id: "suco", nome: "Suco de Laranja", preco: 10, descricao: "natural 500ml", estoqueInicial: 80, categoria: "bebida" });

  // Um pedido fechado em cada empresa (dado "sensível" que não pode vazar).
  const pedidoA = await registrarPedido(idA, {
    numeroCliente: "5544911110000@s.whatsapp.net",
    itens: [{ produto_id: "xb", nome: "X-Burger", quantidade: 2, preco: 20 }],
    total: 40, tipoEntrega: "entrega", endereco: "Rua Secreta da Burger A, 123", origem: "whatsapp",
  });
  const pedidoB = await registrarPedido(idB, {
    numeroCliente: "5544922220000@s.whatsapp.net",
    itens: [{ produto_id: "marg", nome: "Pizza Margherita", quantidade: 1, preco: 45 }],
    total: 45, tipoEntrega: "entrega", endereco: "Av. Confidencial da Pizza B, 999", origem: "whatsapp",
  });

  // Atendente só na Burger A (pra testar escopo de permissão depois).
  const atendA = await criarAtendente({ empresaId: idA, ...CONTAS.atendenteA });

  return { idA, idB, pedidoA: pedidoA.id, pedidoB: pedidoB.id, atendA };
}

// Só roda sozinho quando chamado direto (node seed.mjs). Quando é importado
// pelo runner, o runner é quem chama semear() e fecha o pool no fim.
const executadoDireto = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (executadoDireto) {
  semear()
    .then((ctx) => { console.log(JSON.stringify(ctx)); return pool.end(); })
    .catch((e) => { console.error("Erro no seed:", e); process.exit(1); });
}
