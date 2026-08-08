import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}): React.JSX.Element {
  const styles = {
    // disabled em opacidade, não num tom fixo: indigo-900 é claro no tema claro
    // e sumiria debaixo do text-white.
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-indigo-600/45',
    secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:text-zinc-500',
    ghost: 'hover:bg-zinc-800 text-zinc-300 disabled:text-zinc-600',
    danger: 'bg-red-900/60 hover:bg-red-800 text-red-100'
  }[variant]
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({
  label,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-zinc-300">{label}</span>}
      <input
        className={`w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 ${className}`}
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  )
}

/**
 * Cartão da direção visual "Cartões": superfície SÓLIDA (o /60 antigo sobre a
 * base azul-ardósia sujava a cor), sombra de 1px e o título numa faixa com
 * borda inferior — é ela que dá o ritmo das telas.
 *
 * Regra de ouro (handoff): o Card NUNCA recebe `flex-1`. Cartão tem a altura do
 * conteúdo; quem estica é a coluna, com `items-start`. Cartão esticado fica oco.
 *
 * Sem `overflow-hidden` de propósito: há popover posicionado dentro de cartão
 * (ModelCombobox em Configurações) que seria cortado. A faixa não tem fundo
 * próprio, então nada vaza pelo raio.
 */
export function Card({
  title,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4'
}: {
  title?: ReactNode
  /** slot à direita da faixa de título (contador, botões) */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** troca o padding do corpo; passe '' para conteúdo que sangra até a borda */
  bodyClassName?: string
}): React.JSX.Element {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-900 shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center gap-2.5 border-b border-zinc-800 px-4 py-3">
          {title && <h3 className="text-sm font-bold text-zinc-50">{title}</h3>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

/**
 * Interruptor do design system (34×19, botão de 15px). Substitui o
 * `<input type="checkbox" className="accent-indigo-600">` das telas de
 * configuração, criação, divisão e timeline.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-indigo-600' : 'bg-zinc-700/70'
      }`}
    >
      <span
        className={`absolute top-0.5 size-[15px] rounded-full transition-all ${
          checked ? 'left-[17px] bg-white' : 'left-0.5 bg-zinc-500'
        }`}
      />
    </button>
  )
}

/**
 * Trilho segmentado único — o padrão aparecia com uma variação por tela
 * (Hoje, Time, Timeline, Resumos).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel
}: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (next: T) => void
  className?: string
  'aria-label'?: string
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
              active ? 'bg-indigo-600 font-semibold text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }): React.JSX.Element {
  return <Loader2 className={`animate-spin ${className}`} size={16} />
}

export function Badge({
  children,
  color = 'zinc'
}: {
  children: ReactNode
  /** `brand` é a pílula de contador da faixa de título — pastilha, não retângulo */
  color?: 'zinc' | 'green' | 'blue' | 'amber' | 'red' | 'indigo' | 'brand'
}): React.JSX.Element {
  if (color === 'brand') {
    return (
      <span className="inline-block rounded-full bg-indigo-600/16 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-indigo-400">
        {children}
      </span>
    )
  }
  const styles = {
    zinc: 'bg-zinc-800 text-zinc-300',
    green: 'bg-green-900/50 text-green-300 light:bg-green-100 light:text-green-700',
    blue: 'bg-blue-900/50 text-blue-300 light:bg-blue-100 light:text-blue-700',
    amber: 'bg-amber-900/50 text-amber-300 light:bg-amber-100 light:text-amber-700',
    red: 'bg-red-900/50 text-red-300 light:bg-red-100 light:text-red-700',
    indigo: 'bg-indigo-900/50 text-indigo-300 light:bg-indigo-100 light:text-indigo-700'
  }[color]
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}

/**
 * Cabeçalho único das 13 telas (handoff regra 5). Geometria fixa — não aceitar
 * className extra aqui, senão cada tela volta a divergir em altura.
 */
export function ScreenHeader({
  title,
  context,
  actions,
  flush = false
}: {
  title: string
  context?: ReactNode
  actions?: ReactNode
  /**
   * Tela com faixa de abas logo abaixo: o cabeçalho perde a borda inferior e
   * quem fecha o bloco é a faixa, senão ficam duas linhas coladas.
   */
  flush?: boolean
}): React.JSX.Element {
  return (
    <header
      className={`flex items-start gap-3 bg-zinc-900 px-5 pt-4 pb-3.5 ${
        flush ? '' : 'border-b border-zinc-800'
      }`}
    >
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold tracking-[-.2px] text-zinc-50">{title}</h2>
        {context && <div className="mt-0.5 text-xs text-zinc-400">{context}</div>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * "Vazio não ocupa altura" (handoff regra 1): enquanto todo contador estiver
 * zerado, os baldes viram uma linha de ~26px em vez de cards de empty state.
 * Assim que qualquer contador passar de 0, quem chama decide o que `children`
 * mostra — este componente só troca o invólucro para o tratamento de atenção.
 */
export function CollapsedStats({
  items,
  allClearLabel,
  children
}: {
  items: Array<{ label: string; count: number }>
  allClearLabel: string
  children?: ReactNode
}): React.JSX.Element {
  const allClear = items.every((item) => item.count === 0)

  if (allClear) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 px-3 py-1.5">
        <CheckCircle2 size={13} className="text-green-400 light:text-green-600" />
        <span className="text-xs text-zinc-500">{allClearLabel}</span>
        <span className="text-xs text-zinc-400">
          {items.map((item) => `${item.label} ${item.count}`).join(' · ')}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-red-900/55 bg-red-950/28 light:border-red-300 light:bg-red-50">
      {children}
    </div>
  )
}
