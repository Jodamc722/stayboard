'use client'
// TOMORROW AT A GLANCE — the schedule check, in the app (Jon, 2026-10-01: "I don't want her to send
// these long scheduler messages, it's more I want the app to help with scheduling").
//
// The same pass Eve runs each evening (lib/eve/schedule-check), shown on the Scheduler page instead
// of posted to Slack. Plain English, one card per market: the cleans with nobody on them (same-day
// first, with the guest's arrival time) and who usually covers that building and is on shift — with
// an Assign button that files it through the same endpoint the board uses; people OFF on the roster
// but assigned; people past their own usual day; same-day turns sitting late in somebody's list; a
// blank roster said as a blank roster; and the three days after. A ‹ day › pager looks further out.
import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarCheck2, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Loader2, Send, UserX } from 'lucide-react'
import { Tag } from '@/components/lean'
import { useCachedFetch } from '@/lib/swr'
import { matchRoster, type RosterPerson } from '@/lib/roster-match'

type Clean = { taskId: string; listingId: string; unit: string; building: string; market: string; who: string[]; minutes: number; sameDay: boolean; arrivesAt: string | null }
type Person = { name: string; cleans: Clean[]; minutes: number; rostered: 'Working' | 'OFF' | 'unknown'; usualMax: number | null; usualMedian: number | null }
type Market = {
  market: string; date: string; cleans: number; people: Person[]
  unassigned: Clean[]; offButAssigned: { person: string; cleans: Clean[] }[]; overloaded: { person: string; cleans: number; minutes: number; usualMax: number | null }[]
  lateTurns: { person: string; clean: Clean; position: number }[]
  demandMin: number; supplyMin: number; shortMin: number; rosterKnown: boolean
  suggestions: { clean: Clean; names: string[] }[]
  lookahead: { date: string; cleans: number; people: number; shortBy: number; rosterKnown: boolean }[]
}
type Res = { ok: boolean; date: string; markets: Market[]; notes: string[]; error?: string }

const hm = (m: number) => { const x = Math.max(0, Math.round(m)); const h = Math.floor(x / 60), r = x % 60; return h ? `${h}h${r ? ' ' + r + 'm' : ''}` : `${r}m` }
const first = (n: string) => String(n || '').split(' ')[0]
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayName = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function TomorrowCheck() {
  const today = ymdET(new Date())
  const [date, setDate] = useState(addDays(today, 1))
  const { data, loading, error, refresh } = useCachedFetch<Res>('/api/schedule/check?date=' + date, { ttl: 3 * 60_000 })
  const { data: rosterRes } = useCachedFetch<{ people: RosterPerson[] }>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const roster = rosterRes?.people || []
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  useEffect(() => { setErr('') }, [date])

  const assign = async (c: Clean, name: string) => {
    const hit = matchRoster(roster, name)
    if (!hit.ok) { setErr(hit.reason); return }
    setBusy(c.taskId); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: c.taskId, assigneeIds: [hit.id] }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) throw new Error(j.error || 'failed')
      setDone(d => ({ ...d, [c.taskId]: first(name) }))
      setTimeout(() => refresh(), 1500)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  const rel = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : dayName(date).split(',')[0]
  const markets = (data?.markets || []).filter(m => m.cleans > 0)
  const quiet = !loading && !error && markets.every(m => !m.unassigned.length && !m.offButAssigned.length && !m.overloaded.length && !m.lateTurns.length && m.shortMin <= 60 && (m.rosterKnown || m.cleans < 3))

  // ONE LINE, THEN DETAILS (2026-10-02 sweep). The check used to open as a wall of amber lines above
  // the board; now it is a single sentence — the markets, the people, and what is off — and the
  // full read (per-market cards, assign buttons) unfolds on a click. Nothing is hidden, it is folded.
  const [open, setOpen] = useState(false)
  const flags: string[] = []
  const unassigned = markets.reduce((n, m) => n + m.unassigned.length, 0)
  const late = markets.reduce((n, m) => n + m.lateTurns.length, 0)
  const over = markets.reduce((n, m) => n + m.overloaded.length, 0)
  const blind = markets.filter(m => !m.rosterKnown && m.cleans >= 3).length
  if (unassigned) flags.push(unassigned + (unassigned === 1 ? ' clean with nobody on it' : ' cleans with nobody on them'))
  if (late) flags.push(late + ' same-day ' + (late === 1 ? 'turn' : 'turns') + ' to make first')
  if (over) flags.push(over + (over === 1 ? ' person past a full day' : ' people past a full day'))
  if (blind) flags.push('roster blank')
  const summary = markets.length
    ? markets.map(m => m.market + ' ' + m.cleans + (m.cleans === 1 ? ' clean' : ' cleans') + ', ' + m.people.length + (m.people.length === 1 ? ' person' : ' people')).join(' · ')
      + (flags.length ? ' — ' + flags.join(' · ') : (quiet ? ' — looks covered' : ''))
    : 'no departure cleans on the board yet'
  const tone = flags.length ? (unassigned || late ? 'bg-rose-500' : 'bg-amber-500') : 'bg-emerald-500'

  return (
    <div className="mb-3 rounded-xl border border-line bg-white">
      <div className="px-3 py-2 flex items-center gap-2 min-w-0">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left" title={open ? 'Hide the full read' : 'Open the full read — per market, with who to put on what'}>
          <span aria-hidden className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (loading && !data ? 'bg-muted/40' : tone)} />
          <span className="text-[13px] font-bold text-ink shrink-0">{rel}</span>
          <span className="text-[12.5px] text-ink/80 truncate min-w-0 flex-1">{loading && !data ? 'reading the day…' : error ? 'could not read the day — ' + String(error) : summary}</span>
          <ChevronDown size={14} className={'text-muted shrink-0 transition-transform ' + (open ? 'rotate-180' : '')} />
        </button>
        <span className="inline-flex items-center gap-1 shrink-0">
          <button onClick={() => setDate(d => addDays(d, -1))} disabled={date <= today} className="p-1 rounded-md border border-line text-muted hover:text-ink disabled:opacity-40" title="Earlier"><ChevronLeft size={13} /></button>
          <button onClick={() => setDate(d => addDays(d, 1))} disabled={date >= addDays(today, 7)} className="p-1 rounded-md border border-line text-muted hover:text-ink disabled:opacity-40" title="Later"><ChevronRight size={13} /></button>
        </span>
      </div>
      {open && (
      <div className="px-3 py-2 space-y-3 border-t border-line/60">
        {loading && !data && <p className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Reading the day…</p>}
        {error && <p className="text-[12px] text-rose-700">Could not read the day — {String(error)}</p>}
        {!loading && !error && !markets.length && <p className="text-[12px] text-muted">No departure cleans on the board for {rel.toLowerCase()} yet.</p>}
        {quiet && markets.length > 0 && (
          <p className="text-[12px] text-emerald-800 font-semibold inline-flex items-center gap-1"><Check size={13} /> {rel} looks covered — {markets.map(m => `${m.market}: ${m.cleans} clean${m.cleans === 1 ? '' : 's'}, ${m.people.length} ${m.people.length === 1 ? 'person' : 'people'}`).join(' · ')}</p>
        )}
        {markets.map(m => (
          <MarketCard key={m.market} m={m} quiet={quiet} busy={busy} done={done} onAssign={assign} />
        ))}
        {err && <p className="text-[11.5px] font-semibold text-rose-600">{err}</p>}
        {data?.notes?.length ? <p className="text-[11px] text-muted">{data.notes.filter(n => !/looks covered/.test(n)).join(' · ')}</p> : null}
      </div>
      )}
    </div>
  )
}

function MarketCard({ m, quiet, busy, done, onAssign }: { m: Market; quiet: boolean; busy: string; done: Record<string, string>; onAssign: (c: Clean, name: string) => void }) {
  if (quiet) return null
  const people = m.people.length
  const sugFor = (c: Clean) => (m.suggestions.find(s => s.clean.taskId === c.taskId)?.names || []).slice(0, 2)
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] font-bold text-ink">
        {m.market} — {m.cleans} departure clean{m.cleans === 1 ? '' : 's'}, {people} {people === 1 ? 'person' : 'people'} assigned
        {m.rosterKnown && m.supplyMin > 0 ? <span className="font-normal text-muted"> · ~{hm(m.demandMin)} of work, {Math.round(m.supplyMin / 450)} rostered</span> : null}
      </p>

      {!m.rosterKnown && m.cleans >= 3 && (
        <Line tone="amber" icon={<AlertTriangle size={13} />}>The roster on the Turnover Schedule is blank for this day, so nobody knows who is on. Fill it in and this check gets sharper.</Line>
      )}

      {m.unassigned.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 space-y-1">
          <p className="text-[12px] font-bold text-amber-900">{m.unassigned.length} clean{m.unassigned.length === 1 ? ' has' : 's have'} nobody on {m.unassigned.length === 1 ? 'it' : 'them'}</p>
          {m.unassigned.slice(0, 12).map(c => {
            const names = sugFor(c)
            return (
              <div key={c.taskId} className="flex items-center gap-1.5 flex-wrap text-[12px]">
                <span className="font-semibold text-ink">{c.unit}</span>
                {c.sameDay && <Tag tone="rose" title="A guest arrives the same day">same-day{c.arrivesAt ? ` · in at ${c.arrivesAt}` : ''}</Tag>}
                <span className="text-muted">~{c.minutes} min</span>
                {done[c.taskId] ? (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700"><Check size={12} /> {done[c.taskId]}</span>
                ) : names.length ? (
                  <span className="inline-flex items-center gap-1 ml-auto">
                    <span className="text-[11px] text-muted hidden sm:inline">usually</span>
                    {names.map(n => (
                      <button key={n} onClick={() => onAssign(c, n)} disabled={busy === c.taskId}
                        className="text-[11.5px] font-bold px-2 py-0.5 rounded-lg bg-ink text-white disabled:opacity-50 inline-flex items-center gap-1">
                        {busy === c.taskId ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} {first(n)}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted ml-auto">no usual person on shift — assign on the board</span>
                )}
              </div>
            )
          })}
          {m.unassigned.length > 12 && <p className="text-[11px] text-muted">+{m.unassigned.length - 12} more on the board</p>}
        </div>
      )}

      {m.offButAssigned.map(o => (
        <Line key={o.person} tone="rose" icon={<UserX size={13} />}><b>{o.person}</b> is marked OFF on the roster but has {o.cleans.length} clean{o.cleans.length === 1 ? '' : 's'}: {o.cleans.map(c => c.unit).join(', ')}.</Line>
      ))}
      {m.overloaded.map(o => (
        <Line key={o.person} tone="rose" icon={<Clock size={13} />}><b>{o.person}</b> has {o.cleans} cleans — about {hm(o.minutes)} at the pace those units really take{o.usualMax != null ? `; their usual most is ${o.usualMax}` : ''}.</Line>
      ))}
      {m.lateTurns.slice(0, 4).map(l => (
        <Line key={l.clean.taskId} tone="amber" icon={<Clock size={13} />}><b>{l.clean.unit}</b> is a same-day turn{l.clean.arrivesAt ? ` (guest in at ${l.clean.arrivesAt})` : ''} on a {l.position}-clean day for <b>{first(l.person)}</b> — worth making it first.</Line>
      ))}
      {m.rosterKnown && m.shortMin > 60 && (
        <Line tone="rose" icon={<AlertTriangle size={13} />}>The day is short: ~{hm(m.demandMin)} of cleans against {Math.round(m.supplyMin / 450)} {Math.round(m.supplyMin / 450) === 1 ? 'person' : 'people'} rostered (~{hm(m.supplyMin)}). About {hm(m.shortMin)} over.</Line>
      )}

      {(m.lookahead.some(l => l.shortBy >= 1) || m.lookahead.some(l => !l.rosterKnown && l.cleans >= 3)) && (
        <p className="text-[11.5px] text-muted">
          Next days:{' '}
          {m.lookahead.map(l => (
            <span key={l.date} className="mr-2">
              {dayName(l.date).split(',')[0]} {l.cleans} clean{l.cleans === 1 ? '' : 's'}
              {!l.rosterKnown && l.cleans >= 3 ? <span className="text-amber-800"> · roster blank</span> : l.shortBy >= 1 ? <span className="text-rose-700"> · {l.people} rostered, ~{Math.ceil(l.shortBy)} over</span> : <span> · {l.people} rostered</span>}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function Line({ tone, icon, children }: { tone: 'rose' | 'amber'; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === 'rose' ? 'border-rose-200 bg-rose-50/60 text-rose-900' : 'border-amber-200 bg-amber-50/60 text-amber-900'
  return <p className={'rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug flex items-start gap-1.5 ' + cls}><span className="mt-[2px] shrink-0">{icon}</span><span>{children}</span></p>
}
