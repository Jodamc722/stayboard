'use client'
// THE SCOREBOARD STRIP — the week's KPIs under the verdict line (Jon, 2026-09-18). One row of
// compact tiles, the same visual language as the day's `Stat` tiles: 10.5px uppercase label, 15px
// bold number, 10.5px sub, a tone dot — plus a "vs last week" delta coloured by whether the move
// is good. Scrolls sideways on a phone, wraps on a desktop. Tap a tile → ONE inline drawer under
// the strip with this week vs last week and the list behind the number.
//
// Data: /api/command/scoreboard (five-minute cache, one read for every tile; a tile whose source
// failed says so in its drawer instead of taking the strip down).
import { useState } from 'react'
import Link from 'next/link'
import { X, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { CARD, ICON_BTN } from '@/components/CommandCockpit'

export const SCOREBOARD_URL = '/api/command/scoreboard'

type Tone = 'ok' | 'warn' | 'hot' | 'quiet'
type Delta = { value: string; dir: 'up' | 'down' | 'flat'; goodWhen: 'up' | 'down' }
type Row = { text: string; href?: string }
type Tile = { key: string; label: string; value: string; sub: string; tone: Tone; delta?: Delta; detail: { rows: Row[]; note?: string }; degraded?: string }
type Board = { ok: boolean; error?: string; weekStart: string; weekStartDay: string; today: string; generatedAt: string; tiles: Tile[] }

const niceDay = (ymd: string) => { try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }

function DeltaTag({ d }: { d: Delta }) {
  if (d.dir === 'flat') return <span className="text-[10.5px] text-muted leading-none whitespace-nowrap">= last wk</span>
  const good = d.dir === d.goodWhen
  return (
    <span className={'text-[10.5px] font-semibold leading-none whitespace-nowrap ' + (good ? 'text-emerald-700' : 'text-rose-700')} title="vs the same days last week">
      {d.dir === 'up' ? '▲' : '▼'} {d.value}
    </span>
  )
}

/** The tile — `Stat`'s classes, with the delta on a third line. */
function ScoreTile({ t, active, onClick }: { t: Tile; active: boolean; onClick: () => void }) {
  const tone: Tone = t.degraded ? 'warn' : t.tone
  const num = tone === 'hot' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-800' : tone === 'ok' ? 'text-emerald-700' : 'text-ink'
  const dot = tone === 'hot' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-400' : tone === 'ok' ? 'bg-emerald-500' : 'bg-transparent'
  return (
    <button onClick={onClick} aria-expanded={active} aria-label={t.label + ': ' + t.value + (t.sub ? ', ' + t.sub : '') + (t.delta ? ', ' + t.delta.value + ' vs last week' : '')}
      className={'shrink-0 text-left rounded-xl border px-2.5 py-1.5 min-h-[44px] transition-colors snap-start ' + (active ? 'border-ink bg-white ring-1 ring-ink' : 'border-line bg-white hover:border-ink/30')}>
      <div className="flex items-center gap-1.5">
        <span className={'w-1.5 h-1.5 rounded-full ' + dot} aria-hidden />
        <span className="text-[10.5px] uppercase tracking-wide text-muted font-semibold whitespace-nowrap">{t.label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className={'text-[15px] font-bold tabular-nums leading-none ' + num}>{t.value}</span>
        {t.sub && <span className="text-[10.5px] text-muted leading-none whitespace-nowrap">{t.sub}</span>}
      </div>
      <div className="mt-1 min-h-[11px] flex items-center gap-1">
        {t.degraded ? <span className="text-[10.5px] text-amber-800 leading-none inline-flex items-center gap-0.5"><AlertTriangle size={9} /> not read</span> : t.delta ? <DeltaTag d={t.delta} /> : <span className="text-[10.5px] text-muted/70 leading-none">week to date</span>}
      </div>
    </button>
  )
}

export function Scoreboard() {
  const { data, loading, error, refresh } = useCachedFetch<Board>(SCOREBOARD_URL, { ttl: 5 * 60_000 })
  const [open, setOpen] = useState<string | null>(null)
  const reload = () => { invalidateCache(SCOREBOARD_URL); refresh() }

  if (!data && loading) {
    return (
      <div className="flex gap-1.5 overflow-x-auto animate-pulse" aria-busy="true" aria-label="Loading the week's scoreboard">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="shrink-0 w-[118px] h-[58px] rounded-xl bg-white border border-line" />)}
      </div>
    )
  }
  if (!data || !data.ok) {
    return (
      <div className="text-[11.5px] text-muted flex items-center gap-1.5">
        <AlertTriangle size={12} className="text-amber-700" /> Scoreboard unavailable{error || data?.error ? ' — ' + (error || data?.error) : ''}.
        <button onClick={reload} className="font-semibold underline">Retry</button>
      </div>
    )
  }
  const tile = open ? data.tiles.filter(t => t.key === open)[0] || null : null
  return (
    <section aria-label="This week's scoreboard">
      <div className="flex items-center gap-2 px-1 mb-1 text-[11px] text-muted">
        <span className="font-semibold uppercase tracking-wide">This week</span>
        <span>from {niceDay(data.weekStart)} · vs the same days last week</span>
        <button onClick={reload} aria-label="Refresh the scoreboard" title="Refresh" className="ml-auto inline-flex items-center text-muted hover:text-ink min-h-[24px]">
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto sm:flex-wrap snap-x pb-1 -mx-1 px-1 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
        {data.tiles.map(t => <ScoreTile key={t.key} t={t} active={open === t.key} onClick={() => setOpen(open === t.key ? null : t.key)} />)}
      </div>
      {tile && (
        <div className={CARD + ' mt-1.5'}>
          <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2">
            <span className="text-[12.5px] font-bold text-ink">{tile.label}</span>
            <span className="text-[11.5px] text-muted truncate">{tile.value}{tile.sub ? ' · ' + tile.sub : ''}</span>
            {tile.delta && <DeltaTag d={tile.delta} />}
            <button onClick={() => setOpen(null)} className={ICON_BTN + ' ml-auto text-muted hover:text-ink'} aria-label="Close"><X size={15} /></button>
          </div>
          {tile.degraded && (
            <p className="px-4 py-2 text-[12px] text-amber-800 flex items-center gap-1.5 border-b border-line"><AlertTriangle size={12} /> Could not read this one: {tile.degraded}</p>
          )}
          {tile.detail.note && <p className="px-4 py-2 text-[12px] text-ink/80 leading-snug border-b border-line">{tile.detail.note}</p>}
          {tile.detail.rows.length > 0 ? (
            <ul className="divide-y divide-line/70">
              {tile.detail.rows.map((r, i) => {
                const inner = <span className="block text-[12.5px] text-ink leading-snug">{r.text}</span>
                const ext = !!r.href && /^https?:/.test(r.href)
                return (
                  <li key={i}>
                    {!r.href ? <div className="px-4 py-1.5 min-h-[36px] flex items-center">{inner}</div>
                      : ext ? <a href={r.href} target="_blank" rel="noreferrer" className="px-4 py-1.5 min-h-[36px] flex items-center gap-2 hover:bg-app/50"><span className="flex-1 min-w-0">{inner}</span><ExternalLink size={11} className="text-muted shrink-0" /></a>
                      : <Link href={r.href} className="px-4 py-1.5 min-h-[36px] flex items-center gap-2 hover:bg-app/50"><span className="flex-1 min-w-0">{inner}</span></Link>}
                  </li>
                )
              })}
            </ul>
          ) : !tile.degraded && !tile.detail.note ? <p className="px-4 py-2 text-[12px] text-muted">Nothing behind this number yet.</p> : null}
        </div>
      )}
    </section>
  )
}
