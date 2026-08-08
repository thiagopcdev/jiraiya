# CONTRATO — refatoração visual (design system Biud)

Congelado pelo coordenador na Fase 0. **Nenhum agente altera os arquivos desta
seção.** Handoff completo: `/Users/thiagoprado/Downloads/design_handoff_visual_biud/README.md`.
Protótipo (fonte da verdade de cor/espaçamento): `Jiraiya Visual.dc.html` no mesmo diretório.

## Já feito na Fase 0 (NÃO MEXER)

| Arquivo | Estado |
| --- | --- |
| `src/renderer/src/index.css` | tokens `--tone-N`, `--brand-N`, `--accent`, raios, `--shadow-card`, Figtree — **fechado** |
| `src/renderer/src/components/ui.tsx` | `Card`, `Badge`, `Toggle`, `SegmentedControl`, `ScreenHeader` — **fechado** |
| `src/renderer/src/components/ui.test.tsx` | testes dos acima — **fechado** |
| `src/renderer/src/components/PairTabs.tsx` | aba sublinhada — **fechado** |
| `package.json` | `@fontsource-variable/figtree` — **fechado** |
| `src/renderer/src/strings/ptBR.ts` | **dono exclusivo é o coordenador**. Precisa de string nova? Escreva o literal em pt-BR direto no JSX e ANOTE no relatório final; o coordenador move para `ptBR.ts` na integração. |

## Regra de cor — inegociável

Nunca hex, nunca `style={{color:...}}`. Sempre as utilities Tailwind, porque a
escala inteira já aponta para as variáveis de tema:

- `zinc-50…950` = superfícies e texto (o protótipo mostra o azul-ardósia; a
  utility já entrega isso nos dois temas).
- `indigo-50…950` = cor de marca (o azul da Biud). `indigo-600` **preenche**
  (botão, timer, trilho ligado) sempre com `text-white`; `indigo-400`
  **pinta texto e ícone** (link, chave de card, "Estruturar com IA").
- `green/amber/red/blue` = semânticas, escala Tailwind original. Quando usadas
  como TEXTO precisam da variante `light:` (ex.: `text-green-400 light:text-green-600`).
- `accent` (novo) = destaque secundário do DS, só no crachá de menções: `bg-accent`, `text-accent`.
- SVG de gráfico continua em `var(--chart-accent)` / `var(--chart-muted)`.

## API congelada de `ui.tsx`

```tsx
Card({ title?: ReactNode, actions?: ReactNode, children, className?, bodyClassName? = 'p-4' })
// superfície sólida + shadow-card; faixa de título com border-b quando há title ou actions.
// bodyClassName='' para conteúdo que sangra até a borda (listas divididas por border-b).
// REGRA DE OURO: Card NUNCA recebe flex-1. Quem estica é a coluna, com items-start.

Badge({ children, color?: 'zinc'|'green'|'blue'|'amber'|'red'|'indigo'|'brand' })
// 'brand' = pílula de contador da faixa de título (rounded-full, bg-indigo-600/16, text-indigo-400).

Toggle({ checked, onChange: (next: boolean) => void, disabled?, id?, 'aria-label'?, 'aria-labelledby'? })
// role="switch". Substitui todo <input type="checkbox" className="accent-indigo-600">.

SegmentedControl<T extends string>({ options: {value: T, label: ReactNode}[], value, onChange, className?, 'aria-label'? })
// trilho bg-zinc-950/60, item ativo bg-indigo-600 text-white.

ScreenHeader({ title, context?, actions?, flush? })
// flush = true quando a tela tem faixa de abas logo abaixo (o header perde a border-b).

Button({ variant?: 'primary'|'secondary'|'ghost'|'danger', ... })  // inalterado
Input, Spinner, EmptyState, CollapsedStats                          // inalterados
```

## Geometria de referência

- Moldura do protótipo: 1360×800, sidebar 216px.
- Corpo de tela: `p-[18px_24px]`. Cabeçalho: `px-5 pt-4 pb-3.5`.
- Cartão: faixa `px-4 py-3`, corpo `p-4`.
- Raios: `rounded-lg` = 10px (cartão/painel), `rounded-md` = 8px (linha/botão/campo), `rounded-sm` = 4px (badge de SP, kbd).
- Aba sublinhada (padrão do `PairTabs`, replicar nas abas de período e do painel docado):
  faixa `border-b border-zinc-800 bg-zinc-900 px-5`; item `-mb-px border-b-2 px-3.5 pt-2 pb-2.5 text-[13px]`;
  ativo `border-indigo-500 font-semibold text-indigo-400`, inativo `border-transparent text-zinc-400`.
- Linha de configuração (padrão único de Configurações):
  ```tsx
  <div className="flex items-center gap-4 border-b border-zinc-800/60 py-2.5 last:border-0">
    <div className="min-w-0 flex-1">
      <div className="text-[13.5px] text-zinc-200">{label}</div>
      {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{hint}</div>}
    </div>
    {control}
  </div>
  ```
- `<select>` estilizado: `rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px]`.

## Armadilhas (custaram caro na revisão do protótipo)

1. **Cartão com `flex-1` fica oco.** Cartão tem a altura do conteúdo.
2. **Contador tem que bater** com o que a tela renderiza (cabeçalho, crachá da nav, número de linhas).
3. **Vazio não vira cartão.** Bloco com zero itens é uma linha de ~26px (`CollapsedStats`).
4. **Largura fecha na conta.** Quadro: 1360 − 216 − 380 − 32 − 24 = 708 = 3 × 236.
5. **Não sobrescrever `box-sizing`** no piso das colunas.
6. **Nada de backend.** Zero mudança em `src/main`, `src/preload`, `src/shared`. Todos os dados já existem.

## Estado novo (tudo no cliente)

| Necessidade | Onde |
| --- | --- |
| Grupo ativo / busca em Configurações | `useState` em `Settings.tsx` |
| Nav recolhida / fixada (M2) | `localStorage` `jiraiya.navCollapsed`, no padrão de `lib/theme.ts` |
| Largura do painel docado | `localStorage` `jiraiya.detailPanelWidth` (já existe) |

## Testes — gate do CI

`npm test` = `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run`
(`npx vitest` direto quebra por ABI do better-sqlite3).

Thresholds do `vitest.config.ts`: statements 85, branches 78, functions 85, lines 85.
**Todo componente novo precisa de teste.** Cada agente conserta os testes DOS SEUS
arquivos — nunca de arquivo de outro agente. Testes de componente exigem
`// @vitest-environment jsdom` na 1ª linha e `afterEach(cleanup)` explícito.
