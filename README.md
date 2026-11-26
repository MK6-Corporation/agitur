# Agitur – Landing Page Black Friday

Landing page publicada no GitHub Pages + painel de leads em **`/admin`**.

- Site: https://mk6-corporation.github.io/agitur/
- Painel: https://mk6-corporation.github.io/agitur/admin/ (usuário **mk6** / senha **mk6**)

## Como funciona

1. O visitante preenche o formulário da landing.
2. O navegador envia os dados para um **Google Apps Script** ("Agitur Leads", na conta pablo.alves@mk6corporation.com.br) e abre o WhatsApp como antes.
3. O script grava o lead na planilha **"Leads – Black Friday Agitur"** no Google Drive, com data/hora, UTMs da campanha e página de origem.
4. O `/admin` pede usuário e senha. Quem confere a senha é o Apps Script, então ela não fica no código do site.

No painel: totais, gráfico por destino, busca, filtros por destino/status/período, ordenação, status do atendimento, anotações, botão de WhatsApp, exclusão e exportação em CSV.

## Trocar usuário ou senha

No Apps Script "Agitur Leads": **Configurações do projeto → Propriedades do script** e altere `ADMIN_USER` e `ADMIN_PASS`. Não precisa publicar de novo.

## Código do Apps Script

O código está em `apps-script/Code.gs` (cópia de referência). Se alterar o script, publique em **Implantar → Gerenciar implantações → Editar → Nova versão**, mantendo a mesma URL.
