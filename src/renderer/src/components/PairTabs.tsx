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
    <nav className="flex border-b border-zinc-800 bg-zinc-900 px-5">
      {tabs.map((tab) => {
        const active = pathname === tab.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3.5 pt-2 pb-2.5 text-[13px] transition-colors ${
              active
                ? 'border-indigo-500 font-semibold text-indigo-400'
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
