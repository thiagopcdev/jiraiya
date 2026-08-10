import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Settings } from 'lucide-react'
import { invoke } from '../api/client'
import { useProjects } from '../api/hooks'
import { Spinner } from './ui'

/**
 * Seletor de projeto do topo da barra lateral (handoff do menu, M1).
 *
 * "Projeto" aqui é MULTI-seleção, não um workspace ativo: o que se escolhe é o
 * conjunto de projetos acompanhados, exatamente o mesmo `projects:setSelected`
 * dos chips de Configurações — daí a marca de conferido em vez de um radio. O
 * atalho existe porque trocar o recorte do que sincroniza é rotina; a gestão
 * completa continua em Configurações, no rodapé do popover.
 */
export function ProjectPicker(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const { data, isLoading } = useProjects()
  const queryClient = useQueryClient()
  const projects = data?.projects ?? []

  // fecha no clique fora e no Esc, como qualquer popover ancorado
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = async (key: string): Promise<void> => {
    const atuais = projects.filter((p) => p.selected).map((p) => p.key)
    const proximos = atuais.includes(key) ? atuais.filter((k) => k !== key) : [...atuais, key]
    // desmarcar tudo deixaria o app sem nada para sincronizar
    if (proximos.length === 0) return
    setBusy(key)
    try {
      await invoke('projects:setSelected', { keys: proximos })
      await queryClient.invalidateQueries()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Projetos acompanhados"
        title="Projetos acompanhados"
        className="flex shrink-0 items-center justify-center rounded-md p-[5px] text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronsUpDown size={14} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Projetos acompanhados"
          className="absolute top-full left-0 z-30 mt-1.5 w-[232px] rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold tracking-[.06em] text-zinc-500 uppercase">
            Projetos acompanhados
          </p>

          {isLoading && (
            <div className="px-3 py-2">
              <Spinner className="text-zinc-500" />
            </div>
          )}

          {!isLoading && projects.length === 0 && (
            <p className="px-3 py-2 text-[12.5px] text-zinc-500">Nenhum projeto sincronizado.</p>
          )}

          {projects.map((project) => (
            <button
              key={project.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={project.selected}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-zinc-200 transition-colors hover:bg-zinc-700/60 disabled:opacity-60"
              onClick={() => void toggle(project.key)}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                {project.selected && <Check size={13} className="text-indigo-400" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">{project.key}</span>
            </button>
          ))}

          <div className="mt-1 border-t border-zinc-700 pt-1">
            <Link
              to="/config"
              className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-200"
              onClick={() => setOpen(false)}
            >
              <Settings size={13} className="shrink-0" />
              Gerenciar em Configurações
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
