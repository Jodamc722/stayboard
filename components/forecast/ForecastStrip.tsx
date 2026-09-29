'use client'
// THE STAFFING FORECAST STRIP — the next 14 days, one line per market (lib/forecast/staffing).
//
// One tag per day, coloured by the verdict, the whole sentence on hover ("Thu Oct 2 · Broward ·
// 11 checkouts · needs 3 · 2 rostered — short"); at the end of the line, the first short day
// spelled out. Lean rules: one line per thing, tags not sentences, every mark explains itself.
import { useEffect, useState } from 'react'
import { Tag, type Tone } from '../lean'

type Verdict = 'short' | 'ok' | 'over' | 'unknown' | 'none'
type Day = {
  date: string; label: string; dow: string; lead: number; market: string
  booked: number; expected: number; needed: number; working: number; onCall: number; rostered: number
  rosterKnown: boolean; callIn: number; verdict: Verdict; line: string
}
type Track = { n: number; mae: number | null; withinPct: number | null; tolerance: number } | null
type Resp = {
  ok: boolean; error?: string; message?: string
  days: Day[]; markets: string[]; basis: string; notes: string[]
  rosterPublishedThrough: string | null; pickup: { learning: boolean }
  track?: { cleans: Track; people: Track }
}

const toneOf = (d: Day): Tone =>
  d.verdict === 'short' ? 'rose' : d.verdict === 'over' ? 'sky' : d.verdict === 'ok' ? (d.callIn ? 'amber' : 'emerald') : 'slate'
const dayNum = (ymd: string) => String(Number(ymd.slice(8, 10)))
const niceDate = (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(ymd + 'T12:00:00Z'))

function trackLine(t: Track, unit: string): string {
  if (!t || !t.n) return 'not graded yet'
  if (t.withinPct == null) return `${t.n} graded — too few to call`
  return `${t.withinPct}% within ±${t.tolerance} ${unit} (${t.n} graded, off by ${t.mae} on average)`
}

export function ForecastStrip() {
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    fetch('/api/forecast/staffing', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (dead) return; if (j && j.ok) setData(j); else setErr(j?.message || j?.error || 'unavailable') })
      .catch(() => { if (!dead) setErr('unavailable') })
    return () => { dead = true }
  }, [])

  const box = 'rounded-xl border border-line bg-white px-3 py-2 mb-3'
  const label = <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Staffing · next 14 days</span>
  if (err) return <div className={box}>{label} <span className="text-[12px] text-muted">· {err}</span></div>
  if (!data) return <div className={box}>{label} <span className="text-[12px] text-muted">· reading the books…</span></div>

  const short = data.days.filter(d => d.verdict === 'short')
  const legend = 'Red = short · amber = needs the on-call · green = ok · blue = two or more spare · grey = nothing booked or the roster is not out yet.'
  const how = `${data.basis} ${legend} Track record, last 30 days — checkouts: ${trackLine(data.track?.cleans || null, 'cleans')}; people needed: ${trackLine(data.track?.people || null, 'people')}.` +
    (data.pickup.learning ? ' The booking pickup is still learning, so days far out lean low.' : '') +
    (data.notes.length ? ' Note: ' + data.notes.join('; ') + '.' : '')

  return (
    <div className={box}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span title={how} className="cursor-help">{label}</span>
        {short.length
          ? <Tag tone="rose" title={short.map(d => d.line).join('\n')}>{short.length} short day{short.length === 1 ? '' : 's'}</Tag>
          : <Tag tone="emerald" title="No day in the next 14 needs more housekeepers than are rostered">no short days</Tag>}
        {data.rosterPublishedThrough
          ? <Tag tone="slate" title="The last day Homebase has shifts published — after it, the roster is not written yet">roster to {niceDate(data.rosterPublishedThrough)}</Tag>
          : <Tag tone="amber" title="Homebase has no shifts published in the next 14 days">no roster yet</Tag>}
      </div>
      {data.markets.map(mk => {
        const mine = data.days.filter(d => d.market === mk)
        const firstShort = mine.find(d => d.verdict === 'short')
        const firstCall = mine.find(d => d.verdict === 'ok' && d.callIn > 0)
        const note = firstShort ? firstShort.line.replace(' · ' + mk, '') : firstCall ? firstCall.line.replace(' · ' + mk, '') : 'no short days'
        return (
          <div key={mk} className="flex items-center gap-2 py-0.5 min-w-0">
            <span className="w-16 shrink-0 text-[12.5px] font-semibold text-ink">{mk}</span>
            <div className="flex items-center gap-1 flex-wrap">
              {mine.map(d => <Tag key={d.date} tone={toneOf(d)} title={d.line + (d.lead === 0 ? ' (today)' : '')}>{d.dow.slice(0, 2)} {dayNum(d.date)}</Tag>)}
            </div>
            <span className={`hidden md:inline text-[12px] truncate ${firstShort ? 'text-rose-700 font-semibold' : 'text-muted'}`} title={note}>{note}</span>
          </div>
        )
      })}
    </div>
  )
}
