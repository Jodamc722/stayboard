'use client'
// ACTIONS FROM GUEST FEEDBACK.
//
// The reputation strip above this tells you what guests are saying. This tells you what is being
// DONE about it. Every row is one unit + one complaint theme, carrying the guest's own words, the
// job to do, and a button to finish it.
//
// The number worth watching is REOPENED: an action that came back after being marked done means the
// fix did not hold. Two reopens on the same theme is the argument for replacing something rather
// than repairing it again.
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Check, X, RefreshCw, ChevronRight, ExternalLink, AlertTriangle, Play, RotateCcw } from 'lucide-react'

type Action = {
  id: string; listing_id: string; unit: string | null; building: string | null
  theme_key: string; kind: string; title: string; action: string
  severity: string; mentions: number; worst_rating: number | null
  evidence: any[]; first_seen: string | null; last_seen: string | null
  status: string; completed_at: string | null; completed_by: string | null
  reopened_count: number; note: string | null
}

const KINDS = [
  { k: 'all', l: 'Everyone' },
  { k: 'clean', l: 'Housekeeping' },
  { k: 'inspection', l: 'Inspection' },
  { k: 'maintenance', l: 'Maintenance' },
]
const VIEWS = [
  { v: 'live', l: 'To do' },
  { v: 'done', l: 'Done' },
  { v: 'dismissed', l: 'Dismissed' },
  { v: 'all', l: 'All' },
]
const KIND_UI: Record<string, string> = {
  clean: 'bg-sky-50 text-sky-700 border-sky-200',
  inspection: 'bg-violet-50 text-violet-700 border-violet-200',
  maintenance: 'bg-amber-50 text-amber-700 border-amber-200',
}

/** One complaint theme inside a unit's card. */
function Item({ a, onSet }: { a: Action; onSet: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(false)
  const busyDone = a.status === 'done' || a.status === 'dismissed'
  // "Cleanliness — 1201 Brickell" → "Cleanliness". The unit is the card heading; repeating it on
  // every line is noise.
  const short = a.title.split(' — ')[0]
  return (
    <div className={'border-t border-line/60 ' + (busyDone ? 'opacity-55' : '')}>
      <div className="flex items-start gap-2 py-1.5">
        <button onClick={() => setOpen(o => !o)} className="pt-0.5 flex-shrink-0">
          <ChevronRight size={12} className={'text-muted transition-transform ' + (open ? 'rotate-90' : '')} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {a.severity === 'urgent' && !busyDone && <AlertTriangle size={11} className="text-rose-600 flex-shrink-0" />}
            <span className={'text-[12.5px] font-semibold ' + (busyDone ? 'text-muted line-through' : 'text-ink')}>{short}</span>
            <span className={'text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded border ' + (KIND_UI[a.kind] || 'bg-slate-100 text-muted border-line')}>{a.kind}</span>
            {a.reopened_count > 0 && (
              <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-1"
                title="Marked done, then guests raised it again — the fix did not hold">
                <RotateCcw size={9} /> came back ×{a.reopened_count}
              </span>
            )}
          </div>
          <div className="text-[12px] text-muted mt-0.5">{a.action}</div>
          <div className="text-[10.5px] text-muted mt-0.5">
            {a.mentions} mention{a.mentions === 1 ? '' : 's'}
            {a.worst_rating != null ? ' · worst ' + a.worst_rating + '★' : ''}
            {a.last_seen ? ' · ' + a.last_seen : ''}
            {a.completed_by ? ' · by ' + a.completed_by : ''}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!busyDone ? (
            <>
              {a.status !== 'doing' && (
                <button onClick={() => onSet(a.id, 'doing')} title="Mark in progress"
                  className="inline-flex items-center text-[11px] font-semibold px-1.5 py-1 rounded border border-line text-muted hover:text-ink hover:bg-app">
                  <Play size={11} />
                </button>
              )}
              <button onClick={() => onSet(a.id, 'done')} title="Mark complete"
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                <Check size={11} /> Done
              </button>
              <button onClick={() => onSet(a.id, 'dismissed')} title="Not a real issue"
                className="inline-flex items-center text-[11px] px-1.5 py-1 rounded border border-line text-muted hover:text-ink hover:bg-app">
                <X size={11} />
              </button>
            </>
          ) : (
            <button onClick={() => onSet(a.id, 'open')} title="Reopen"
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-line text-muted hover:text-ink hover:bg-app">
              <RotateCcw size={11} /> Reopen
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="pl-5 pb-2 space-y-1">
          {(a.evidence || []).map((e: any, i: number) => (
            <div key={i} className="text-[11.5px] border-l-2 border-rose-200 pl-2">
              <span className="text-ink">{'“'}{e.quote}{'”'}</span>
              <div className="text-[10.5px] text-muted">
                {e.at}{e.channel ? ' · ' + e.channel : ''}{e.rating ? ' · ' + e.rating + '★' : ''}
              </div>
            </div>
          ))}
          {a.note && <div className="text-[11.5px] text-muted">Note: {a.note}</div>}
        </div>
      )}
    </div>
  )
}

/**
 * ONE CARD PER UNIT.
 *
 * Jon's call: the team works a unit, not a complaint. Five separate rows for 1201 meant five trips
 * in the planner's head; one card with five things to check is a single visit. The database still
 * stores a row per (unit, theme) — that is what makes the reopen rule work — but nobody has to see
 * it that way.
 */
function UnitCard({ unit, rows, onSet, onAll }: { unit: any; rows: Action[]; onSet: (id: string, s: string) => void; onAll: (ids: string[]) => void }) {
  const live = rows.filter(r => r.status === 'open' || r.status === 'doing')
  const urgent = live.filter(r => r.severity === 'urgent').length
  const back = rows.filter(r => r.reopened_count > 0).length
  return (
    <div className="rounded-xl border border-line bg-white mb-2.5">
      <div className="flex items-center gap-2 px-3 py-2 bg-app/40 rounded-t-xl flex-wrap">
        <a href={'/listings/' + unit.listing_id} className="inline-flex items-center gap-1 text-[13px] font-bold text-ink hover:text-brand-700">
          {unit.unit || 'Unit'} <ExternalLink size={11} className="text-muted" />
        </a>
        {unit.building && <span className="text-[11px] text-muted">{unit.building}</span>}
        <span className="text-[11px] text-muted">· {live.length} to check</span>
        {!!urgent && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white">{urgent} urgent</span>}
        {!!back && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">{back} came back</span>}
        {!!live.length && (
          <button onClick={() => onAll(live.map(r => r.id))}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
            <Check size={11} /> All done
          </button>
        )}
      </div>
      <div className="px-3 pb-1">
        {rows.map(a => <Item key={a.id} a={a} onSet={onSet} />)}
      </div>
    </div>
  )
}

export function ReviewActionBoard() {
  const [view, setView] = useState('live')
  const [kind, setKind] = useState('all')
  const [rows, setRows] = useState<Action[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [gen, setGen] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/reviews/actions?status=' + view + '&kind=' + kind, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load')
      setRows(j.actions || []); setCounts(j.counts || {}); setNeedsMigration(!!j.needsMigration)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [view, kind])
  useEffect(() => { load() }, [load])

  async function generate() {
    setGen(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/reviews/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'generate' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not rebuild')
      setMsg(j.created + ' new · ' + j.updated + ' updated'
        + (j.reopened ? ' · ' + j.reopened + ' came back' : '')
        + (j.pruned ? ' · ' + j.pruned + ' retired' : '')
        + ' · from ' + j.scanned + ' reviews')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setGen(false)
  }

  async function setStatus(id: string, status: string) {
    // Optimistic: the board should feel like ticking a list, not like filing a form.
    setRows(rs => rs.map(r => (r.id === id ? { ...r, status } : r)))
    try {
      const r = await fetch('/api/reviews/actions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      })
      if (!r.ok) throw new Error('save failed')
      if (view !== 'all') setTimeout(load, 350)
    } catch { load() }
  }

  async function doneAll(ids: string[]) {
    setRows(rs => rs.map(r => (ids.includes(r.id) ? { ...r, status: 'done' } : r)))
    try {
      await Promise.all(ids.map(id => fetch('/api/reviews/actions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'done' }),
      })))
      if (view !== 'all') setTimeout(load, 400)
    } catch { load() }
  }

  // Group into one card per unit. Units with an urgent item float up, then the busiest.
  const groups = (() => {
    const by: Record<string, { unit: any; rows: Action[] }> = {}
    for (const r of rows) {
      const g = by[r.listing_id] = by[r.listing_id] || { unit: { listing_id: r.listing_id, unit: r.unit, building: r.building }, rows: [] }
      g.rows.push(r)
    }
    return Object.values(by).sort((a, b) => {
      const u = (g: any) => g.rows.filter((r: Action) => r.severity === 'urgent' && (r.status === 'open' || r.status === 'doing')).length
      return (u(b) - u(a)) || (b.rows.length - a.rows.length)
    })
  })()

  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-white mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted font-semibold">
          <ClipboardList size={13} /> Actions from feedback
        </span>
        {!!counts.open && <span className="text-[12px] font-semibold text-ink">{counts.open} to do</span>}
        {!!groups.length && <span className="text-[11.5px] text-muted">across {groups.length} unit{groups.length === 1 ? '' : 's'}</span>}
        {!!counts.done && <span className="text-[11.5px] text-muted">· {counts.done} done</span>}

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {VIEWS.map(v => (
            <button key={v.v} onClick={() => setView(v.v)}
              className={'text-[11px] font-semibold px-1.5 py-0.5 rounded ' + (view === v.v ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{v.l}</button>
          ))}
          <select value={kind} onChange={e => setKind(e.target.value)} className="text-[11px] border border-line rounded px-1.5 py-0.5 bg-white">
            {KINDS.map(k => <option key={k.k} value={k.k}>{k.l}</option>)}
          </select>
          <button onClick={generate} disabled={gen} title="Re-scan the last 10 days of reviews and refresh this list"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-line text-muted hover:text-ink hover:bg-app disabled:opacity-50">
            <RefreshCw size={11} className={gen ? 'animate-spin' : ''} /> {gen ? 'Scanning…' : 'Rebuild'}
          </button>
        </div>
      </div>

      {err && <div className="text-[12px] text-rose-700 px-3 py-2">{err}</div>}
      {msg && <div className="text-[12px] text-emerald-700 px-3 py-2">{msg}</div>}
      {needsMigration && (
        <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          The actions table is not in the database yet. Run <code className="font-mono">supabase/migrations/022_review_actions.sql</code> in the Supabase SQL editor, then hit Rebuild.
        </div>
      )}
      {loading && <div className="text-[12px] text-muted px-3 py-3">Loading…</div>}
      {!loading && !groups.length && !needsMigration && (
        <div className="text-[12px] text-muted px-3 py-3">
          {view === 'live' ? 'Nothing outstanding from the last 10 days. Hit Rebuild to re-scan.' : 'Nothing here.'}
        </div>
      )}
      {groups.map(g => (
        <UnitCard key={g.unit.listing_id} unit={g.unit} rows={g.rows} onSet={setStatus} onAll={doneAll} />
      ))}
    </section>
  )
}
