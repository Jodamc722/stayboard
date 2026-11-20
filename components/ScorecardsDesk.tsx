'use client'
// SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and Leaderboard based on KPI").
//
// One data call (/api/scorecards), one team at a time:
//   the team chips and the period toggle are rows of buttons (no drop-downs);
//   one row of quiet tiles: what the team completed in the period;
//   the leaderboard as a plain table, with the sentence that says what it ranks by.
// The look is the lean kit's: no trophies, no colour on a person's name. A tile that could not be
// read says so instead of showing a zero; a person with too few events reads "not enough yet (n)".
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { LeanHead, LeanTabs, LeanPick, LeanEmpty, IconBtn } from '@/components/lean'
import { TEAMS, type Scorecards, type Scorecard, type Tile, type Row, type TeamKey, type Period } from '@/lib/scorecards-core'

const isTeam = (v: any): v is TeamKey => TEAMS.some(t => t.key === v)

function TileBox({ t }: { t: Tile }) {
  const body = (
    <>
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">{t.label}</div>
      <div className="text-[22px] leading-tight font-bold tabular-nums text-ink mt-1 whitespace-nowrap">{t.value}</div>
      {t.degraded
        ? <div className="text-[11px] text-amber-700 mt-0.5" title={t.degraded}>could not read</div>
        : t.sub ? <div className="text-[11px] text-muted mt-0.5 line-clamp-2" title={t.sub}>{t.sub}</div> : null}
    </>
  )
  const cls = 'block min-w-0 rounded-2xl border border-line bg-white px-3.5 py-3'
  return t.href ? <a href={t.href} className={cls + ' hover:border-ink/30'}>{body}</a> : <div className={cls}>{body}</div>
}

function BoardRow({ r, ranked }: { r: Row; ranked: boolean }) {
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="px-3 py-2 text-muted tabular-nums w-8">{ranked ? r.rank : '–'}</td>
      <td className="px-2 py-2 font-semibold text-ink whitespace-nowrap">{r.name}</td>
      <td className={'px-2 py-2 text-right tabular-nums whitespace-nowrap ' + (ranked ? 'font-semibold text-ink' : 'text-muted')}>{r.kpi}</td>
      <td className="px-2 py-2 text-right tabular-nums text-muted">{r.count || '–'}</td>
      <td className="px-2 py-2 text-muted">{r.secondary.join(' · ')}</td>
    </tr>
  )
}

function Card({ c, periodWord }: { c: Scorecard; periodWord: string }) {
  const b = c.leaderboard
  const any = b.rows.length + b.unranked.length > 0
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 mb-5">
        {c.completed.map(t => <TileBox key={t.key} t={t} />)}
      </div>

      <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1 px-1">Leaderboard</h2>
      <p className="text-[12.5px] text-muted mb-2 px-1 max-w-3xl">Ranks by: {b.ranksBy}</p>
      {b.degraded ? <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[12.5px] mb-3">This board could not be read: {b.degraded}</div> : null}
      {!b.degraded && !any ? <LeanEmpty>Nothing to rank for {c.label} {periodWord}.</LeanEmpty> : null}
      {any ? (
        <div className="rounded-2xl border border-line bg-white overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
                <th className="px-3 py-2 font-semibold w-8">#</th>
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold text-right">{b.kpiLabel}</th>
                <th className="px-2 py-2 font-semibold text-right">{b.countLabel}</th>
                <th className="px-2 py-2 font-semibold">Also</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map(r => <BoardRow key={'r' + r.name} r={r} ranked />)}
              {b.unranked.map(r => <BoardRow key={'u' + r.name} r={r} ranked={false} />)}
            </tbody>
          </table>
        </div>
      ) : null}
      {b.note ? <p className="text-[11.5px] text-muted mt-2 px-1 max-w-3xl">{b.note}</p> : null}
      {c.links && c.links.length ? (
        <p className="text-[12.5px] mt-3 px-1">
          {c.links.map((l, i) => <span key={l.href}>{i ? <span className="text-muted"> · </span> : null}<a href={l.href} className="font-semibold text-brand-700 hover:underline">{l.label} →</a></span>)}
        </p>
      ) : null}
    </>
  )
}

export function ScorecardsDesk() {
  const [team, setTeam] = useState<TeamKey>('admin')
  const [period, setPeriod] = useState<Period>('yesterday')
  const [d, setD] = useState<Scorecards | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // ?team= and ?period= from a brief's link (read on mount: no useSearchParams, so no Suspense boundary).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      const t = q.get('team'), p = q.get('period')
      if (isTeam(t)) setTeam(t)
      if (p === 'week' || p === 'yesterday') setPeriod(p)
    } catch { /* defaults */ }
  }, [])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setErr(null)
    try {
      const r = await fetch('/api/scorecards', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`)
      setD(j)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const pick = (next: { team?: TeamKey; period?: Period }) => {
    const t = next.team || team, p = next.period || period
    if (next.team) setTeam(next.team)
    if (next.period) setPeriod(next.period)
    try { window.history.replaceState(null, '', `?team=${t}&period=${p}`) } catch { /* the view still changes */ }
  }

  const P = d ? d[period] : null
  const card = P ? P.teams[team] : null
  return (
    <div className="max-w-6xl mx-auto">
      <LeanHead title="Scorecards" sub={P ? `${period === 'yesterday' ? 'Yesterday' : 'Last 7 days'}, ${P.label}. What each team completed, and who is leading on the team’s KPI.` : 'What each team completed, and who is leading on the team’s KPI.'}>
        <LeanPick<Period> value={period} title="Period" onPick={p => pick({ period: p })} options={[{ v: 'yesterday', label: 'Yesterday' }, { v: 'week', label: '7 days' }]} />
        <IconBtn title="Reload" onClick={() => load(true)}><RefreshCw size={14} /></IconBtn>
      </LeanHead>

      <LeanTabs<TeamKey> value={team} onChange={t => pick({ team: t })} tabs={TEAMS.map(t => ({ key: t.key, label: t.label }))} />

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-[12.5px] mb-3">{err}</div> : null}
      {loading && !d ? <div className="flex items-center gap-2 text-muted text-[13px] py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading…</div> : null}
      {card ? <Card c={card} periodWord={period === 'yesterday' ? 'yesterday' : 'in the last 7 days'} /> : null}
    </div>
  )
}
