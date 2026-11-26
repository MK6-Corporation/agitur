# Agitur – Landing Page Black Friday

Landing page + painel de leads em **`/admin`**.

## Como rodar

Requer Node.js 18 ou superior (sem dependências para instalar).

```bash
npm start            # ou: node server.js
```

- Landing: `http://localhost:3000/`
- Painel:  `http://localhost:3000/admin`  → usuário **mk6** / senha **mk6**

## Como funciona

1. O visitante preenche o formulário da landing.
2. O navegador envia os dados para `POST /api/leads` (em segundo plano) **e** abre o WhatsApp como antes.
3. O servidor grava o lead em `data/leads.json` com data/hora, UTMs da campanha, página de origem e IP.
4. No `/admin` a equipe vê todos os leads, com:
   - totais (geral, hoje, 7 dias, sem atendimento) e gráfico por destino;
   - busca por nome/WhatsApp/notas/campanha, filtro por destino, status e período;
   - ordenação por coluna;
   - status do atendimento (novo, em atendimento, fechado, perdido) e anotações;
   - botão de WhatsApp que já abre a conversa com o lead;
   - exportação em CSV (abre direto no Excel).

## Configuração (variáveis de ambiente)

| Variável         | Padrão   | Uso                                         |
|------------------|----------|---------------------------------------------|
| `PORT`           | `3000`   | Porta HTTP                                  |
| `ADMIN_USER`     | `mk6`    | Usuário do painel                           |
| `ADMIN_PASS`     | `mk6`    | Senha do painel                             |
| `SESSION_SECRET` | derivado | Segredo do cookie de sessão (defina em produção) |
| `DATA_DIR`       | `./data` | Onde os leads ficam salvos                  |

## Hospedagem

Precisa de um host que rode Node com disco persistente (VPS, Render, Railway, Fly.io, Hostinger VPS etc.).
**GitHub Pages não executa servidor**: lá a landing continua funcionando, mas os leads não são gravados.

A pasta `data/` está no `.gitignore` porque contém dados pessoais dos clientes. Faça backup dela.

## Segurança

- Login com cookie assinado (HttpOnly, SameSite=Strict), expira em 12 h.
- Bloqueio após 10 tentativas de login erradas em 15 min por IP.
- Painel com `noindex` e proteção contra CSRF/XSS.
- Troque a senha `mk6` por uma forte via `ADMIN_PASS` antes de publicar.
