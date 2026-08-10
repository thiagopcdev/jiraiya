import { useEffect, useRef, useState } from 'react'

interface ModelOption {
  id: string
  name: string
}

/**
 * Combobox de modelo do OpenRouter: input de texto livre (aceita qualquer id digitado)
 * com dropdown filtrado (contains, case-insensitive, em id+nome) dos modelos carregados.
 * Sem chave configurada não há lista — o hint abaixo do input orienta a digitar o id.
 */
export function ModelCombobox({
  id,
  value,
  onChange,
  models,
  hasKey,
  loading = false
}: {
  /** liga o input ao <label> da linha de configuração que o hospeda */
  id?: string
  value: string
  onChange: (id: string) => void
  models: ModelOption[]
  hasKey: boolean
  loading?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(value)
  // Sincroniza o texto quando `value` muda por fora (troca de provider/feature) — ajuste
  // durante o render em vez de efeito, então não recria um ciclo de render extra.
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setText(value)
  }
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const query = text.trim().toLowerCase()
  const filtered = (
    query
      ? models.filter(
          (m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
        )
      : models
  ).slice(0, 50)

  const commit = (raw: string): void => {
    onChange(raw.trim())
  }

  const select = (model: ModelOption): void => {
    setText(model.id)
    onChange(model.id)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200 outline-none focus:border-indigo-500"
        placeholder="id do modelo (ex.: anthropic/claude-3.5-sonnet)"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(text)
            setOpen(false)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        onBlur={() => commit(text)}
      />
      {open && (loading || filtered.length > 0) && (
        // z-20: o popover fica dentro de um Card (que de propósito não tem
        // overflow-hidden), mas precisa passar por cima das linhas seguintes
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-card">
          {loading && <div className="px-2.5 py-1.5 text-[11.5px] text-zinc-500">Carregando…</div>}
          {!loading &&
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                className="block w-full truncate px-2.5 py-1.5 text-left text-[11.5px] text-zinc-300 hover:bg-zinc-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(m)}
                title={m.id}
              >
                {m.name} <span className="text-zinc-500">· {m.id}</span>
              </button>
            ))}
        </div>
      )}
      {!hasKey && (
        <p className="mt-1 text-[11.5px] text-zinc-500">
          Salve a chave para listar modelos; você ainda pode digitar um id.
        </p>
      )}
    </div>
  )
}
