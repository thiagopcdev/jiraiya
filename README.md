# Jiraiya

Cliente de desktop (Electron, macOS/Windows) para o **Jira Cloud** — feito para trabalhar o dia inteiro sem abrir o Jira no navegador, com um copiloto de IA opcional via **Claude, Gemini ou Codex** (CLI local, sua própria assinatura) **ou OpenRouter** (API key).

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

**Copiloto (Claude, Gemini, Codex ou OpenRouter — opcional, tudo degrada sem ele)**

- **Criar e dividir cards** com título/descrição redigidos no padrão do time
- **Resumos** daily/weekly/1:1/mensal/retro enriquecidos com os comentários do período
- **Perguntar** — chat sobre seus dados locais que propõe ações (mover, comentar, registrar tempo) executadas **só com a sua confirmação**
- **Formatar com IA** em qualquer editor de texto
- **Briefing matinal** automático no primeiro boot do dia
- **Provider configurável** em Configurações — CLI (Claude Code, Gemini CLI, Codex CLI) ou OpenRouter (API key), com modelo por funcionalidade e auditoria dos comandos executados

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

| Integração      | O que habilita                                   | Requisito                                                                 |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| CLI `claude`    | Copiloto de IA (provider Claude)                 | [Claude Code](https://claude.com/claude-code) logado (assinatura Pro/Max) |
| CLI `gemini`    | Copiloto de IA (provider Gemini)                 | [Gemini CLI](https://github.com/google-gemini/gemini-cli) logado          |
| CLI `codex`     | Copiloto de IA (provider Codex)                  | [Codex CLI](https://github.com/openai/codex) logado                       |
| OpenRouter      | Copiloto de IA (provider OpenRouter)             | API key configurada em Configurações                                      |
| CLI `gh`        | Seção de PRs relacionados ao card                | `gh` autenticado; ligar em Configurações                                  |
| Token do GitHub | Aviso e download de novas versões (repo privado) | Token com leitura do repo, em Configurações                               |

Nenhuma integração é obrigatória: sem nenhum provider de IA configurado, o app funciona normalmente e os recursos de IA ficam desabilitados (com aviso em Configurações). Com mais de um provider disponível, escolha o ativo em Configurações → Inteligência artificial — inclusive um modelo por funcionalidade — e acompanhe os comandos externos disparados (CLIs e `gh`) na auditoria "Ver comandos executados", também em Configurações.

## Scripts

| Script                  | O que faz                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`           | App em modo dev com HMR                                                                |
| `npm test`              | Testes (vitest via runtime do Electron, por causa da ABI do better-sqlite3)            |
| `npm run typecheck`     | tsc em main/preload/renderer                                                           |
| `npm run lint`          | eslint                                                                                 |
| `npm run build:mac`     | DMG para macOS (arm64)                                                                 |
| `npm run build:win`     | Instalador NSIS para Windows                                                           |
| `npm run test:coverage` | Testes com relatório de cobertura (gate: 85% statements/functions/lines, 78% branches) |

## Fluxo de branches e CI

- Trabalho entra por branch de feature → **PR para `develop`**. O CI (`.github/workflows/ci.yml`) valida typecheck, lint e a suíte com gate de cobertura em todo PR/push da develop.
- A `main` é protegida: **só recebe PR vindo da `develop`** — o check `valida-origem` (`.github/workflows/guard-main.yml`) reprova qualquer outra origem, e push direto é bloqueado por ruleset.

Releases: push de uma tag `v*` dispara o workflow que cria a release no GitHub com o `.exe` e o `.dmg`. Os apps instalados avisam sobre a versão nova (boot + a cada 6h) com download direto pelo banner.

### Assinatura do app no macOS

O macOS marca todo arquivo baixado com `com.apple.quarantine` e valida a assinatura na primeira abertura. Isso divide o build em três resultados bem diferentes:

| Assinatura                                   | O que o usuário vê ao abrir                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ad-hoc **incompleta** (recursos não selados) | "está danificado e não pode ser aberto" e sugestão de mover para o Lixo — **sem saída pela interface** |
| ad-hoc completa                              | "desenvolvedor não pode ser verificado" — resolve com botão direito → _Abrir_                          |
| Developer ID + notarização                   | abre com dois cliques, como qualquer app                                                               |

A primeira linha era o comportamento até a v3.2.0: sem certificado no keychain o electron-builder **pula** a assinatura e sobra a ad-hoc que o linker põe só no binário, sem selar os recursos — assinatura inválida, não "app sem assinatura". Na máquina que compila nunca aparece, porque a cópia local não recebe quarentena.

`scripts/after-sign-mac.cjs` (hook `afterSign`) elimina esse caso: sem certificado ele aplica `codesign --force --deep --sign -`, e no fim **verifica** o bundle (`codesign --verify --deep --strict`), falhando o build se não passar. Com Developer ID presente ele não intervém.

Para o resultado definitivo (dois cliques em qualquer Mac) faltam credenciais que não vivem no repositório:

1. Assinatura no Apple Developer Program (US$ 99/ano) e um certificado **Developer ID Application** — Xcode → Settings → Accounts → Manage Certificates, ou CSR em developer.apple.com.
2. Senha específica de app (appleid.apple.com → Segurança) ou chave da App Store Connect API, para o `notarytool`.
3. Build local: `npm run build:mac:notarized`, com `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID` no ambiente. O certificado é achado no keychain.
4. Build no CI: os mesmos valores como secrets do repositório — `MAC_CERT_P12_BASE64` (o `.p12` exportado em base64), `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. O job de macOS detecta a presença deles e troca para o build notarizado sozinho; sem secrets, segue no ad-hoc.

Conferência rápida do que saiu do build: `syspolicy_check distribution dist/mac-arm64/Jiraiya.app` diz exatamente o que ainda falta para distribuir.

## Arquitetura

- `src/shared/` — contrato IPC (zod req + tipos de res, fonte única) e tipos de domínio, importado por main e renderer
- `src/main/` — todo o Node: `jira/` (client REST v3 + Agile com retry/rate-limit, ADF↔markdown), `sync/` (engine incremental por cursor + derivação de atividades), `db/` (migrations + repos + FTS5), `ai/` (providers Claude/Gemini/Codex via CLI + OpenRouter via API, resolução do provider ativo, auditoria de comandos), `summaries/`, `ask/`, `alerts/`, `watch/`, `queries/` (leituras puras testáveis), `gh/` (PRs), `backup.ts`
- `src/renderer/` — React 19 + Tailwind 4 + TanStack Query sobre IPC; sem acesso a Node (`sandbox: true`); tema por variáveis CSS (a escala zinc inverte no claro)

A integração de IA invoca o CLI do provider ativo (`claude -p`, `gemini` ou `codex`, todos em modo não-interativo) resolvendo o binário em caminhos usuais, ou a API do OpenRouter quando esse é o provider escolhido; qualquer falha cai no template determinístico. Cada comando externo executado (CLIs de IA e `gh`) fica registrado numa auditoria local, consultável em Configurações. Regra de ouro do histórico: agregações por sprint usam **janela temporal** sobre `resolved_at` (o Jira só guarda a última sprint do card).

## Licença e autoria

Construído por **Thiago Prado** ([@thiagopcdev](https://github.com/thiagopcdev)). Distribuído sob a licença [MIT](LICENSE) — use, modifique e redistribua mantendo o aviso de copyright.

> **Disclaimer**: projeto pessoal, **não afiliado nem endossado pela Atlassian**. "Jira" é marca registrada da Atlassian; "Jiraiya" é uma referência ao personagem do folclore japonês.
