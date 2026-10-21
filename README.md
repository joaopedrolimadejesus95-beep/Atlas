# ATLAS

Red team automatizado para o [Vendly](https://meuvendly.com.br) — um SaaS multi-empresa de atendimento para restaurantes (pedidos via WhatsApp com IA e gestão de mesas).

O ATLAS ataca uma **cópia de teste** do Vendly de vários jeitos e mede onde as defesas seguram e onde há o que corrigir. Cada ataque vira um achado com gravidade, passo de reprodução e correção sugerida.

> Construído para testar o meu próprio SaaS. Os testes rodam sempre contra uma cópia de teste isolada — nunca contra produção com cliente real.

---

## Resultado da última rodada

| | |
|---|---|
| Testes executados | **10** |
| Defesas que seguraram | **10** |
| Pontos a corrigir | **0** |

A primeira rodada encontrou 2 pontos a corrigir (webhook que podia ficar aberto sem o token de autenticação, e política de senha que aceitava senha curta). Os dois foram corrigidos e a rodada seguinte confirmou o fechamento — de **8/10 para 10/10**.

Veja o relatório completo em [`RELATORIO.md`](RELATORIO.md) e o painel visual em [`painel.html`](painel.html).

---

## O que o ATLAS testa

**Isolamento entre empresas (multi-tenant)** — a falha mais grave possível num SaaS: logado como a empresa A, conseguir ver ou mexer nos dados da empresa B.

- `ISO-01` Apagar pedido de outra empresa trocando o ID na URL (IDOR)
- `ISO-02` Listar produtos vazando o cardápio de outra empresa
- `ISO-03` Alterar o estoque de um produto que é de outra empresa
- `ISO-04` Trocar a senha de outra empresa injetando campos no corpo da requisição
- `ISO-05` Forjar um token de sessão trocando o `empresaId` sem a chave secreta
- `ISO-06` Acessar rota protegida sem token nenhum

**Segurança da aplicação**

- `APP-01` Webhook aceitando requisição sem autenticação
- `APP-02` Política de senha aceitando senha fraca
- `APP-03` Cardápio público vazando campos internos (senha, token, estoque)
- `APP-04` XSS armazenado via nome de produto no painel

As categorias seguem o espírito do [OWASP Top 10 para LLM](https://owasp.org/www-project-top-10-for-large-language-model-applications/) e do [OWASP API Security Top 10](https://owasp.org/API-Security/).

---

## Como funciona

O ATLAS é um arquivo único (`atlas.mjs`) com quatro partes bem separadas:

1. **Semeadura** — cria duas empresas fictícias (Burger A e Pizza B) com cardápio e pedidos, direto no banco de teste.
2. **Adaptador** — a única parte que conhece o Vendly (URL, login, formato do token). Para apontar o ATLAS a outro alvo no futuro, basta reescrever essa parte.
3. **Baterias de ataque** — cada "sonda" descreve um ataque: o que tenta, qual o comportamento seguro esperado e qual seria a correção se falhar.
4. **Relatório** — gera `RELATORIO.md`, `findings.json` e o painel visual `painel.html`.

---

## Como rodar

Pré-requisitos: uma cópia de **teste** do Vendly rodando e acesso ao banco de teste.

```bash
npm install

ALVO_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgres://usuario@host:5432/vendly_test \
ADMIN_HTML=../vendly-bot/public/admin.html \
node atlas.mjs
```

| Variável | O que é |
|----------|---------|
| `ALVO_URL` | Endereço da cópia de teste do Vendly |
| `DATABASE_URL` | Banco de teste (o ATLAS cria as empresas fictícias ali) |
| `ADMIN_HTML` | *(opcional)* caminho do `admin.html` do Vendly — liga a checagem de XSS |

A saída vai pro terminal e pra três arquivos: `RELATORIO.md`, `findings.json` e `painel.html`.

---

## Painel visual

O `painel.html` é uma página independente que mostra o placar e a lista de achados (cada um abre com o esperado, o obtido e a correção). Abre em qualquer navegador, sem servidor.

---

## Por que esse projeto existe

Com a IA mudando a forma de programar, saber **atacar o próprio sistema e defendê-lo** vale tanto quanto saber construí-lo. O ATLAS é a minha forma de levar o Vendly a sério como produto: pensar como atacante, achar as falhas antes que alguém de fora ache, corrigir e comprovar.
