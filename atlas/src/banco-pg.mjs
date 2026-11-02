// =============================================================================
// BANCO (Postgres) — duas funções:
//   1) semear o cenário de teste;
//   2) servir de "verdade absoluta": depois de um ataque, o ATLAS pergunta ao
//      BANCO se o dado mudou, em vez de confiar no que a API responde.
//      (Uma API pode dizer "ok:false" e mesmo assim ter apagado a linha.)
//
// Mesma interface do banco em memória usado nos testes (test/helpers).
// =============================================================================
import pg from "pg";
import { hashSenha, novoSalt } from "./senha.mjs";
import { PRODUTOS, PEDIDOS } from "./cenario.mjs";

// Constante fixa, na ordem das chaves estrangeiras. Nunca vem de entrada externa
// (por isso pode ser interpolada no DELETE sem risco de SQL injection).
const TABELAS_DO_CENARIO = ["lancamentos_mesa", "pedidos", "mesas", "atendentes", "produtos", "empresas"];

export function criarBancoPg(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

  async function inserirEmpresa(q, c) {
    const salt = novoSalt();
    const { rows } = await q.query(
      `INSERT INTO empresas (nome, login, senha_salt, senha_hash, evolution_instance, plano)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [c.nome, c.login, salt, hashSenha(c.senha, salt), c.instancia, c.plano]
    );
    return rows[0].id;
  }

  async function inserirProduto(q, empresaId, p) {
    await q.query(
      `INSERT INTO produtos (id, empresa_id, nome, preco, descricao, disponivel, estoque, categoria)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7)`,
      [p.id, empresaId, p.nome, p.preco, p.descricao, p.estoque, p.categoria]
    );
  }

  async function inserirPedido(q, empresaId, ped) {
    const { rows } = await q.query(
      `INSERT INTO pedidos (empresa_id, numero_cliente, itens, total, tipo_entrega, endereco, origem)
       VALUES ($1,$2,$3,$4,$5,$6,'whatsapp') RETURNING id`,
      [empresaId, ped.numeroCliente, JSON.stringify(ped.itens), ped.total, ped.tipoEntrega, ped.endereco]
    );
    return rows[0].id;
  }

  async function inserirAtendente(q, empresaId, a) {
    const salt = novoSalt();
    const { rows } = await q.query(
      `INSERT INTO atendentes (empresa_id, nome, login, senha_salt, senha_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [empresaId, a.nome, a.login, salt, hashSenha(a.senha, salt)]
    );
    return rows[0].id;
  }

  return {
    nomeBanco: new URL(databaseUrl).pathname.replace(/^\//, ""),

    // Tudo numa transação: se algo falhar no meio, o banco volta ao que era
    // (nada de ficar com as tabelas apagadas pela metade).
    async semear(contas) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const t of TABELAS_DO_CENARIO) await client.query(`DELETE FROM ${t}`);
        const idA = await inserirEmpresa(client, contas.burgerA);
        const idB = await inserirEmpresa(client, contas.pizzaB);
        const idVitima = await inserirEmpresa(client, contas.vitima);
        for (const p of PRODUTOS.burgerA) await inserirProduto(client, idA, p);
        for (const p of PRODUTOS.pizzaB) await inserirProduto(client, idB, p);
        const pedidoA = await inserirPedido(client, idA, PEDIDOS.burgerA);
        const pedidoB = await inserirPedido(client, idB, PEDIDOS.pizzaB);
        const atendA = await inserirAtendente(client, idA, contas.atendenteA);
        await client.query("COMMIT");
        return { idA, idB, idVitima, pedidoA, pedidoB, atendA, produtosA: PRODUTOS.burgerA, produtosB: PRODUTOS.pizzaB };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },

    async pedidoExiste(id) {
      const { rowCount } = await pool.query("SELECT 1 FROM pedidos WHERE id=$1", [id]);
      return rowCount > 0;
    },
    async estoqueDe(empresaId, produtoId) {
      const { rows } = await pool.query("SELECT estoque FROM produtos WHERE empresa_id=$1 AND id=$2", [empresaId, produtoId]);
      return rows.length ? Number(rows[0].estoque) : null;
    },
    async produtoExiste(empresaId, produtoId) {
      const { rowCount } = await pool.query("SELECT 1 FROM produtos WHERE empresa_id=$1 AND id=$2", [empresaId, produtoId]);
      return rowCount > 0;
    },
    async removerProduto(produtoId) {
      await pool.query("DELETE FROM produtos WHERE id=$1", [produtoId]);
    },
    async hashSenhaDe(empresaId) {
      const { rows } = await pool.query("SELECT senha_hash FROM empresas WHERE id=$1", [empresaId]);
      return rows[0]?.senha_hash ?? null;
    },
    async redefinirSenha(empresaId, senha) {
      const salt = novoSalt();
      await pool.query("UPDATE empresas SET senha_salt=$1, senha_hash=$2 WHERE id=$3", [salt, hashSenha(senha, salt), empresaId]);
    },
    // Valores que NUNCA podem aparecer numa resposta pública.
    async segredosDe(empresaId) {
      const { rows } = await pool.query("SELECT senha_hash, senha_salt, evolution_instance FROM empresas WHERE id=$1", [empresaId]);
      const r = rows[0];
      return r ? [r.senha_hash, r.senha_salt, r.evolution_instance].filter(Boolean) : [];
    },
    async fechar() {
      await pool.end();
    },
  };
}
