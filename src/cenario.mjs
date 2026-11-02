// O cenário de teste: duas empresas fictícias que não devem enxergar uma à outra
// (+ uma "vítima" só pro teste de força bruta). Só dados — quem grava no banco
// (Postgres de verdade ou memória nos testes) está em banco-pg.mjs / nos testes.
import { gerarSenha } from "./senha.mjs";

export function gerarContas() {
  return {
    burgerA: { nome: "Burger A", login: "burgera", senha: gerarSenha(), instancia: "atlas-burger-a", plano: "pro" },
    pizzaB: { nome: "Pizza B", login: "pizzab", senha: gerarSenha(), instancia: "atlas-pizza-b", plano: "pro" },
    // Conta sacrificada: o teste de força bruta pode bloqueá-la sem atrapalhar as outras.
    vitima: { nome: "Vítima Brute", login: "atlas-vitima", senha: gerarSenha(), instancia: "atlas-vitima", plano: "pro" },
    atendenteA: { nome: "Garçom A1", login: "garcom-a1", senha: gerarSenha() },
  };
}

export const PRODUTOS = {
  burgerA: [
    { id: "xb", nome: "X-Burger", preco: 20, descricao: "pão, carne, queijo", estoque: 100, categoria: "comida" },
    { id: "refri", nome: "Refrigerante", preco: 6, descricao: "lata 350ml", estoque: 200, categoria: "bebida" },
  ],
  pizzaB: [
    { id: "marg", nome: "Pizza Margherita", preco: 45, descricao: "molho, muçarela, manjericão", estoque: 50, categoria: "comida" },
    { id: "suco", nome: "Suco de Laranja", preco: 10, descricao: "natural 500ml", estoque: 80, categoria: "bebida" },
  ],
};

export const PEDIDOS = {
  burgerA: {
    numeroCliente: "5544911110000@s.whatsapp.net",
    itens: [{ produto_id: "xb", nome: "X-Burger", quantidade: 2, preco: 20 }],
    total: 40,
    tipoEntrega: "entrega",
    endereco: "Rua Secreta da Burger A, 123",
  },
  pizzaB: {
    numeroCliente: "5544922220000@s.whatsapp.net",
    itens: [{ produto_id: "marg", nome: "Pizza Margherita", quantidade: 1, preco: 45 }],
    total: 45,
    tipoEntrega: "entrega",
    endereco: "Av. Confidencial da Pizza B, 999",
  },
};
