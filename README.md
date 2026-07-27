# Jiraiya

App de desktop (Electron) que conecta no Jira Cloud e gera uma visão prática do seu trabalho:

- **Dashboard pessoal** — o que você moveu, comentou e concluiu hoje / nos últimos 7 dias / na sprint atual
- **Timeline** — feed de atividade (status, comentários, atribuições) agrupado por dia
- **Resumos** — daily/weekly/1:1/mensal em markdown, gerados por template determinístico e opcionalmente reescritos pelo **Claude** (via CLI `claude` local, usando sua assinatura Pro/Max)
- **Alertas** — bloqueadores, tickets sem descrição/estimativa, "in progress" sem responsável, parados há N dias, sprint acabando com issues abertas

Tudo local: cache em SQLite (`better-sqlite3`), token do Jira criptografado via `safeStorage` (Keychain). Nada sobe pra lugar nenhum.

## Setup

```bash
npm install
npm run dev
```

No primeiro uso, conecte com a URL do site (`suaempresa.atlassian.net`), e-mail e um [API token](https://id.atlassian.com/manage-profile/security/api-tokens).

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | App em modo dev com HMR |
| `npm test` | Testes (vitest via runtime do Electron, por causa da ABI do better-sqlite3) |
| `npm run typecheck` | tsc em main/preload/renderer |
| `npm run lint` | eslint |
| `npm run build:mac` | DMG para macOS (arm64) |

## Arquitetura

- `src/shared/` — contrato IPC (zod) + tipos de domínio, importado por main e renderer
- `src/main/` — todo o Node: `jira/` (client REST v3 com retry/rate-limit), `sync/` (engine incremental por cursor + derivação de atividades), `db/` (migrations + repos), `summaries/` (digest → templates → Claude), `alerts/` (regras puras + engine)
- `src/renderer/` — React + Tailwind 4 + TanStack Query sobre IPC; sem acesso a Node (`sandbox: true`)

A integração com o Claude invoca `claude -p` (modo não-interativo) resolvendo o binário em `~/.local/bin`, `/opt/homebrew/bin` ou `/usr/local/bin`; qualquer falha cai no template determinístico.

## Licença e autoria

Construído por **Thiago Prado** ([@thiagopcdev](https://github.com/thiagopcdev)). Distribuído sob a licença [MIT](LICENSE) — use, modifique e redistribua mantendo o aviso de copyright.

> **Disclaimer**: projeto pessoal, **não afiliado nem endossado pela Atlassian**. "Jira" é marca registrada da Atlassian; "Jiraiya" é uma referência ao personagem do folclore japonês.
