import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Timer de trabalho por card — store global do renderer (sem IPC).
 * Um único timer RODANDO por vez: iniciar em outro card pausa o atual
 * (o tempo acumulado do card pausado é preservado até reset/registro).
 * Persistido em localStorage: sobrevive a navegação e reinício do app.
 */

interface TimerEntry {
  /** ms acumulados em execuções anteriores (pausas) */
  accumulatedMs: number
  /** epoch ms do início da execução atual; null = pausado */
  startedAt: number | null
  /** epoch ms da última interação (para eleger o timer "ativo" quando nenhum roda) */
  touchedAt: number
}

type TimerMap = Record<string, TimerEntry>

const STORAGE_KEY = 'jiraiya.timers'

function load(): TimerMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as TimerMap) : {}
  } catch {
    return {}
  }
}

let state: TimerMap = load()
const listeners = new Set<() => void>()

function persist(next: TimerMap): void {
  state = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): TimerMap {
  return state
}

function elapsedMs(entry: TimerEntry, now: number): number {
  return entry.accumulatedMs + (entry.startedAt !== null ? now - entry.startedAt : 0)
}

function pauseEntry(entry: TimerEntry, now: number): TimerEntry {
  if (entry.startedAt === null) return entry
  return {
    accumulatedMs: entry.accumulatedMs + (now - entry.startedAt),
    startedAt: null,
    touchedAt: now
  }
}

export function startTimer(issueKey: string): void {
  const now = Date.now()
  const next: TimerMap = {}
  for (const [key, entry] of Object.entries(state)) next[key] = pauseEntry(entry, now)
  const current = next[issueKey] ?? { accumulatedMs: 0, startedAt: null, touchedAt: now }
  next[issueKey] = { ...current, startedAt: now, touchedAt: now }
  persist(next)
}

export function pauseTimer(issueKey: string): void {
  const entry = state[issueKey]
  if (!entry) return
  persist({ ...state, [issueKey]: pauseEntry(entry, Date.now()) })
}

export function resetTimer(issueKey: string): void {
  const next = { ...state }
  delete next[issueKey]
  persist(next)
}

export function timerSeconds(issueKey: string): number {
  const entry = state[issueKey]
  return entry ? Math.floor(elapsedMs(entry, Date.now()) / 1000) : 0
}

/**
 * Relógio para exibição: re-render por segundo enquanto `active`.
 * Render precisa ser puro (react-hooks/purity), então Date.now() vive num
 * estado alimentado pelo efeito; vale 0 até o primeiro tick.
 */
function useNowWhile(active: boolean): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const sync = (): void => setNow(Date.now())
    // primeiro sync agendado (setState síncrono em efeito dispara render em cascata)
    const timeout = window.setTimeout(sync, 0)
    const interval = active ? window.setInterval(sync, 1000) : null
    return () => {
      window.clearTimeout(timeout)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [active])
  return now
}

/** Antes do primeiro tick (now=0) mostra só o acumulado — o próximo render corrige. */
function displaySeconds(entry: TimerEntry, now: number): number {
  const clock = entry.startedAt !== null ? Math.max(now, entry.startedAt) : now
  return Math.floor(elapsedMs(entry, clock) / 1000)
}

export interface IssueTimer {
  seconds: number
  running: boolean
  /** há tempo acumulado (rodando ou pausado > 0) */
  hasTime: boolean
  start: () => void
  pause: () => void
  reset: () => void
}

export function useIssueTimer(issueKey: string): IssueTimer {
  const map = useSyncExternalStore(subscribe, getSnapshot)
  const entry = map[issueKey]
  const running = entry?.startedAt != null
  const now = useNowWhile(running)
  const seconds = entry ? displaySeconds(entry, now) : 0
  return {
    seconds,
    running,
    hasTime: seconds > 0 || running,
    start: () => startTimer(issueKey),
    pause: () => pauseTimer(issueKey),
    reset: () => resetTimer(issueKey)
  }
}

export interface ActiveTimer {
  issueKey: string
  running: boolean
  seconds: number
}

/** O timer em execução; se nenhum roda, o pausado com tempo tocado mais recentemente. */
export function useActiveTimer(): ActiveTimer | null {
  const map = useSyncExternalStore(subscribe, getSnapshot)
  let best: { key: string; entry: TimerEntry } | null = null
  for (const [key, entry] of Object.entries(map)) {
    if (entry.startedAt !== null) {
      best = { key, entry }
      break
    }
    // pausado: elapsed é só o acumulado, não depende do relógio
    if (entry.accumulatedMs < 1000) continue
    if (!best || entry.touchedAt > best.entry.touchedAt) best = { key, entry }
  }
  const running = best?.entry.startedAt != null
  const now = useNowWhile(running)
  if (!best) return null
  return {
    issueKey: best.key,
    running,
    seconds: displaySeconds(best.entry, now)
  }
}

/** '12:34' / '1:23:45' para exibição */
export function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Duração no formato do Jira ('1h 30m'); arredonda para cima em minutos, mínimo '1m'. */
export function formatJiraDuration(totalSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(totalSeconds / 60))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}
