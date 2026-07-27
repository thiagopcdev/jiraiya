# Jiraiya

Cliente de desktop (Electron, macOS/Windows) para o **Jira Cloud** — feito para trabalhar o dia inteiro sem abrir o Jira no navegador, com um copiloto de IA opcional via **Claude** (CLI local, sua assinatura Pro/Max; nenhuma API key).

Tudo local: cache em SQLite (`better-sqlite3`), tokens criptografados via `safeStorage` (Keychain/DPAPI), imagens de anexos só em RAM. Nada sobe para lugar nenhum além do seu próprio Jira.

## O que ele faz

**Trabalho diário**

- **Dashboard pessoal** — concluí/movi/comentei/em andamento/parados por período, reprovados, burndown da sprint em story points
- **Quadro** kanban com drag & drop, filtros por pessoa e sprint
- **Gaveta do card** em todas as telas: descrição e comentários formatados (ADF), anexos com upload/arrastar/colar imagem, subtarefas, vínculos, worklogs (ver/editar/apagar), histórico de alterações (changelog), navegação entre cards relacionados
- **Fila offline** — comentar, mover, apontar tempo e editar campos sem rede: a ação é aplicada localmente, entra na fila com indicador na sidebar e sincroniza sozinha quando a conexão volta (conflitos são revertidos e notificados)
- **Rascunho automático de comentário** — fechou a gaveta com um comentário pela metade? Ele volta quando você reabrir o card
- **Edição completa**: título, descrição, status, responsável, story points, prioridade, severidade, estimativa, sprint/backlog — com barra de formatação markdown, abas Editar/Prévia e checklists nativos
- **Timer de trabalho** por card com registro em 1 clique + widget flutuante
- **Painel rápido no tray**: timer, cards em andamento, menções e daily sem abrir a janela

**Copiloto (Claude via CLI local — opcional, tudo degrada sem ele)**

- **Criar e dividir cards** com título/descrição redigidos no padrão do time
- **Resumos** daily/weekly/1:1/mensal/retro enriquecidos com os comentários do período
- **Perguntar** — chat sobre seus dados locais que propõe ações (mover, comentar, registrar tempo) executadas **só com a sua confirmação**
- **Formatar com IA** em qualquer editor de texto
- **Briefing matinal** automático no primeiro boot do dia

**Busca e navegação**

- **⌘K / Ctrl+K** — busca full-text local (FTS5) em título, descrição, comentários e key, criação rápida (`criar <ideia>`) e ações rápidas (`mover BT-12 review`, `atribuir BT-12 mim`, `apontar 1h30m BT-12`, `comentar BT-12 …`)
- **Atalhos de teclado** — `g`+letra navega entre telas, `j/k/Enter` percorre listas, `?` mostra o mapa completo
- **Aviso de cards parecidos** ao criar (anti-duplicados)

**Visões e rotina**

- **Épicos** com progresso por cards e story points
- **Time**: radar por pessoa, entregas por sprint (velocity), **tendências** (SP, lead time, scope creep) e radar de risco da sprint
- **Menções**, **alertas** (bloqueadores, sem estimativa, parados, sprint acabando) e **seguir cards** de terceiros com notificação nativa
- **Lembrete de apontamento** em dias úteis quando nenhum worklog foi lançado
- **Exportar worklogs** do período (markdown/CSV), **templates de comentário** com placeholders, **notas privadas** por card
- **Tema** escuro/claro/sistema, **backup/restore** dos dados locais, integração **PR↔card** opcional via CLI `gh`

## Setup

```bash
npm install
npm run dev
```

No primeiro uso, conecte com a URL do site (`suaempresa.atlassian.net`), e-mail e um [API token](https://id.atlassian.com/manage-profile/security/api-tokens) do Jira.

Integrações opcionais (o app funciona sem todas):

| Integração | O que habilita | Requisito |
|---|---|---|
| CLI `claude` | Todo o copiloto de IA | [Claude Code](https://claude.com/claude-code) logado (assinatura Pro/Max) |
| CLI `gh` | Seção de PRs relacionados ao card | `gh` autenticado; ligar em Configurações |
| Token do GitHub | Aviso e download de novas versões (repo privado) | Token com leitura do repo, em Configurações |

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | App em modo dev com HMR |
| `npm test` | Testes (vitest via runtime do Electron, por causa da ABI do better-sqlite3) |
| `npm run typecheck` | tsc em main/preload/renderer |
| `npm run lint` | eslint |
| `npm run build:mac` | DMG para macOS (arm64) |
| `npm run build:win` | Instalador NSIS para Windows |

Releases: push de uma tag `v*` dispara o workflow que cria a release no GitHub com o `.exe` e o `.dmg`. Os apps instalados avisam sobre a versão nova (boot + a cada 6h) com download direto pelo banner.

## Arquitetura

- `src/shared/` — contrato IPC (zod req + tipos de res, fonte única) e tipos de domínio, importado por main e renderer
- `src/main/` — todo o Node: `jira/` (client REST v3 + Agile com retry/rate-limit, ADF↔markdown), `sync/` (engine incremental por cursor + derivação de atividades), `db/` (migrations + repos + FTS5), `summaries/`, `ask/`, `alerts/`, `watch/`, `queries/` (leituras puras testáveis), `gh/` (PRs), `backup.ts`
- `src/renderer/` — React 19 + Tailwind 4 + TanStack Query sobre IPC; sem acesso a Node (`sandbox: true`); tema por variáveis CSS (a escala zinc inverte no claro)

A integração com o Claude invoca `claude -p` (modo não-interativo) resolvendo o binário em caminhos usuais; qualquer falha cai no template determinístico. Regra de ouro do histórico: agregações por sprint usam **janela temporal** sobre `resolved_at` (o Jira só guarda a última sprint do card).

## Licença e autoria

Construído por **Thiago Prado** ([@thiagopcdev](https://github.com/thiagopcdev)). Distribuído sob a licença [MIT](LICENSE) — use, modifique e redistribua mantendo o aviso de copyright.

> **Disclaimer**: projeto pessoal, **não afiliado nem endossado pela Atlassian**. "Jira" é marca registrada da Atlassian; "Jiraiya" é uma referência ao personagem do folclore japonês.
