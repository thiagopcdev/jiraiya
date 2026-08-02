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
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-indigo-900',
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

export function Card({
  title,
  children,
  className = ''
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>
      {title && <h3 className="mb-3 text-sm font-semibold text-zinc-300">{title}</h3>}
      {children}
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
  color?: 'zinc' | 'green' | 'blue' | 'amber' | 'red' | 'indigo'
}): React.JSX.Element {
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
  actions
}: {
  title: string
  context?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <header className="flex items-end gap-4 border-b border-zinc-800 px-6 pt-[22px] pb-3.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[22px] font-[650] tracking-[-.3px] text-zinc-50">{title}</h2>
        {context && <div className="text-[13px] text-zinc-500">{context}</div>}
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
