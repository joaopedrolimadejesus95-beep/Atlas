// Banco em memória com a MESMA interface pública de src/banco-pg.mjs.
// Expõe também `_db` (os mapas crus) para test/helpers/vendly-falso.mjs mutar
// diretamente — assim banco e servidor falso enxergam o MESMO estado, do jeito
// que o Vendly real e o Postgres real são a mesma fonte de verdade.
import { hashSenha, novoSalt } from "../../src/senha.mjs";
import { PRODUTOS, PEDIDOS } from "../../src/cenario.mjs";

export function criarBancoFalso() {
  let seq = 1;
  const empresas = new Map(); // id -> { login, senha_hash, senha_salt, evolution_instance, nome, slug, ofereceCardapioDigital }
  const produtos = new Map(); // `${empresaId}:${produtoId}` -> { id, nome, preco, descricao, estoque, categoria, empresaId }
  const pedidos = new Map(); // id -> { empresaId }

  function criarEmpresa(c) {
    const salt = novoSalt();
    const id = seq++;
    empresas.set(id, { login: c.login, senha_hash: hashSenha(c.senha, salt), senha_salt: salt, evolution_instance: c.instancia, nome: c.nome });
    return id;
  }

  return {
    nomeBanco: "vendly_test",
    _db: { empresas, produtos, pedidos, proximoId: () => seq++ },

    async semear(contas) {
      empresas.clear(); produtos.clear(); pedidos.clear();
      const idA = criarEmpresa(contas.burgerA);
      const idB = criarEmpresa(contas.pizzaB);
      const idVitima = criarEmpresa(contas.vitima);
      for (const p of PRODUTOS.burgerA) produtos.set(`${idA}:${p.id}`, { ...p, empresaId: idA });
      for (const p of PRODUTOS.pizzaB) produtos.set(`${idB}:${p.id}`, { ...p, empresaId: idB });
      const pedidoA = seq++; pedidos.set(pedidoA, { empresaId: idA, ...PEDIDOS.burgerA });
      const pedidoB = seq++; pedidos.set(pedidoB, { empresaId: idB, ...PEDIDOS.pizzaB });
      const atendA = seq++;
      return { idA, idB, idVitima, pedidoA, pedidoB, atendA, produtosA: PRODUTOS.burgerA, produtosB: PRODUTOS.pizzaB };
    },
    async pedidoExiste(id) { return pedidos.has(id); },
    async estoqueDe(empresaId, produtoId) { return produtos.get(`${empresaId}:${produtoId}`)?.estoque ?? null; },
    async produtoExiste(empresaId, produtoId) { return produtos.has(`${empresaId}:${produtoId}`); },
    async removerProduto(produtoId) { for (const k of [...produtos.keys()]) if (k.endsWith(`:${produtoId}`)) produtos.delete(k); },
    async hashSenhaDe(empresaId) { return empresas.get(empresaId)?.senha_hash ?? null; },
    async redefinirSenha(empresaId, senha) {
      const salt = novoSalt();
      const e = empresas.get(empresaId);
      empresas.set(empresaId, { ...e, senha_hash: hashSenha(senha, salt), senha_salt: salt });
    },
    async segredosDe(empresaId) {
      const e = empresas.get(empresaId);
      return e ? [e.senha_hash, e.senha_salt, e.evolution_instance].filter(Boolean) : [];
    },
    async fechar() {},
  };
}
