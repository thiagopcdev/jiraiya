import { Link, useLocation } from 'react-router-dom'

/**
 * Faixa de abas dos pares agrupados da sidebar (Criar · Dividir,
 * Filtros · Timeline): a nav aponta para a primeira rota do par e a segunda
 * aparece aqui, dentro da tela. É navegação de página (troca de rota), não
 * estado local — por isso fica numa linha própria abaixo do ScreenHeader, e
 * não dentro das `actions` dele, que são controles da tela.
 */
export function PairTabs({
  tabs
}: {
  tabs: Array<{ to: string; label: string }>
}): React.JSX.Element {
  const { pathname } = useLocation()
  return (
    <nav className="flex gap-1 border-b border-zinc-800 px-6">
      {tabs.map((tab) => {
        const active = pathname === tab.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-indigo-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
