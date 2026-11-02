# ATLAS — Relatório de Red Team do Vendly

**Data:** 21/10/2026, 14:41:38  
**Alvo:** cópia de teste local do Vendly (banco isolado, duas empresas fictícias)  
**Escopo:** isolamento entre empresas, autenticação, política de senha, exposição de dados e XSS.

## Resumo

Foram executados **10** testes de ataque.

- 🟢 **10** defesas funcionaram (o ataque foi bloqueado)
- 🔴 **0** vulnerabilidades / pontos a corrigir

| ID | Teste | Gravidade | Resultado |
|----|-------|-----------|-----------|
| ISO-01 | Apagar pedido de outra empresa trocando o ID (IDOR) | crítica | 🟢 defendido |
| ISO-02 | Listar produtos vaza itens de outra empresa | crítica | 🟢 defendido |
| ISO-03 | Alterar estoque de produto de outra empresa | crítica | 🟢 defendido |
| ISO-04 | Rota de troca de senha age só sobre a própria empresa | crítica | 🟢 defendido |
| ISO-05 | Token adulterado (trocar empresaId sem a chave) é aceito | crítica | 🟢 defendido |
| ISO-06 | Rota protegida acessível sem token | alta | 🟢 defendido |
| APP-01 | Webhook aceita requisição sem token | alta | 🟢 defendido |
| APP-03 | Cardápio público vaza campos internos | alta | 🟢 defendido |
| APP-04 | XSS armazenado via nome de produto no painel | alta | 🟢 defendido |
| APP-02 | Sistema aceita senha fraca (curta) | média | 🟢 defendido |

## Detalhes

### 🟢 ISO-01 — Apagar pedido de outra empresa trocando o ID (IDOR)

- **Categoria:** isolamento
- **Gravidade:** crítica
- **Resultado:** defendido
- **Como reproduzir:** Logado como Burger A, DELETE /api/pedidos/10 (pedido da Pizza B).
- **Esperado:** O pedido da Pizza B permanece intacto (DELETE não afeta dados de outra empresa).
- **Obtido:** status 200, ok=false; pedido de B ainda existe: true

### 🟢 ISO-02 — Listar produtos vaza itens de outra empresa

- **Categoria:** isolamento
- **Gravidade:** crítica
- **Resultado:** defendido
- **Como reproduzir:** Logado como Burger A, GET /api/produtos.
- **Esperado:** A Burger A só vê o próprio cardápio (X-Burger, Refrigerante).
- **Obtido:** produtos vistos pela Burger A: ["Refrigerante","X-Burger"]

### 🟢 ISO-03 — Alterar estoque de produto de outra empresa

- **Categoria:** isolamento
- **Gravidade:** crítica
- **Resultado:** defendido
- **Como reproduzir:** Logado como Burger A, PUT /api/estoque/marg com quantidade alta.
- **Esperado:** O estoque da Pizza B (margherita = 50) não muda com ação da Burger A.
- **Obtido:** estoque da margherita após tentativa: 50

### 🟢 ISO-04 — Rota de troca de senha age só sobre a própria empresa

- **Categoria:** isolamento
- **Gravidade:** crítica
- **Resultado:** defendido
- **Como reproduzir:** POST /api/senha com empresaId/id extras no corpo.
- **Esperado:** Campos extras no corpo (empresaId/id) são ignorados; a senha da Pizza B não muda.
- **Obtido:** Pizza B continua logando com a senha original.

### 🟢 ISO-05 — Token adulterado (trocar empresaId sem a chave) é aceito

- **Categoria:** autenticação
- **Gravidade:** crítica
- **Resultado:** defendido
- **Como reproduzir:** Pegar token da Burger A, trocar empresaId no payload, reenviar sem reassinar.
- **Esperado:** 401 — a assinatura HMAC não confere com o payload adulterado.
- **Obtido:** status 401

### 🟢 ISO-06 — Rota protegida acessível sem token

- **Categoria:** autenticação
- **Gravidade:** alta
- **Resultado:** defendido
- **Como reproduzir:** GET /api/pedidos sem header Authorization.
- **Esperado:** 401 — sem token, sem acesso.
- **Obtido:** status 401

### 🟢 APP-01 — Webhook aceita requisição sem token

- **Categoria:** autenticação
- **Gravidade:** alta
- **Resultado:** defendido
- **Como reproduzir:** POST /webhook/mensagem sem x-webhook-token, com o nome da instância de uma empresa.
- **Esperado:** 401 — o webhook exige o header x-webhook-token.
- **Obtido:** status 401 (WEBHOOK_TOKEN configurado)

### 🟢 APP-03 — Cardápio público vaza campos internos

- **Categoria:** exposição de dados
- **Gravidade:** alta
- **Resultado:** defendido
- **Como reproduzir:** Definir slug público e consultar GET /api/publico/:slug, checando campos internos.
- **Esperado:** Só nome, descrição, preço e 'esgotado' (booleano) — nada de senha, token, instância ou estoque numérico.
- **Obtido:** Nenhum campo interno presente na resposta pública.

### 🟢 APP-04 — XSS armazenado via nome de produto no painel

- **Categoria:** xss
- **Gravidade:** alta
- **Resultado:** defendido
- **Como reproduzir:** Salvar produto com nome contendo HTML e inspecionar o render do painel.
- **Esperado:** O nome é escapado com esc() antes de ir pro innerHTML do painel.
- **Obtido:** API guarda o texto cru (ok): true; esc() existe: true; nome passa por esc(): true

### 🟢 APP-02 — Sistema aceita senha fraca (curta)

- **Categoria:** política de senha
- **Gravidade:** média
- **Resultado:** defendido
- **Como reproduzir:** POST /api/senha trocando para '1234'.
- **Esperado:** Rejeitar senhas com menos de 8 caracteres.
- **Obtido:** rejeitada (status 400).

---

_Relatório gerado pelo ATLAS. Testes contra uma cópia de teste isolada — nenhum dado de produção foi tocado._