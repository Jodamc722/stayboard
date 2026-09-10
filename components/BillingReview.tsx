'use client'
// BILLABLE REVIEW — approve what the owners get billed, in two stages (Jon, 2026-09-10).
//
// "It's clunky, it glitches, it's slow, and it's not very clear. The goal is to review and
//  approve billables… once it's approved by Ronnie or our ops team, it should go into GM review…
//  it should be broken down by owner, and it should stay in the owner category… if I review
//  something, sometimes it moves to another owner. Make it fast, make it clean, make it easy."
//
// The old board's defect was structural, so this is a replacement, not a patch. Four rules:
//
//   1. OWNERS NEVER MOVE. They come from the server in name order and stay in that order. The
//      old board sorted owners by their billed total and computed that total from the filtered
//      list — so approving a task shrank the total, re-sorted the owners, and the card slid out
//      from under the cursor. That is the "moves to another owner" Jon saw.
//
//   2. ROWS NEVER VANISH MID-SESSION. What you see in a stage is snapshotted when you open it.
//      Approving a row changes how it looks — it does not disappear and pull the rows below it
//      up. Switch stage, change month or press refresh and the snapshot is taken again.
//
//   3. NOTHING RELOADS AFTER AN ACTION. The old board re-fetched the whole month 1.2 seconds
//      after every click — a megabyte or more, including the Homebase payroll walk — and the
//      response would land on top of whatever you had done since. Here an approval returns the
//      rows it changed and they are merged in place. Progress counts are adjusted locally by the
//      same delta. The month is fetched once.
//
//   4. THE EYE LANDS ON WHAT LOOKS OFF. Flags are computed on the server over the whole window
//      (a duplicate needs its neighbours) — over $150 is Jon's line, and it gets an amber edge.
//      A flag never blocks approval; a reviewer who has looked can still sign.
//
// Stages: OPEN → OPS APPROVED (Ronnie / ops) → GM APPROVED (Jon). Ops-approved is the GM's queue.
// GM approval is what reaches an owner's statement, and only an admin can give it.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, Undo2, ExternalLink, Loader2, ChevronDown, Search, Download } from 'lucide-react'

type Flag = 'over_150' | 'no_price' | 'override_far' | 'no_detail' | 'duplicate' | 'long_hours' | 'no_owner' | 'ai_bill' | 'ai_pending'
type State = 'open' | 'ops_approved' | 'gm_approved'
type Item = { key: string; description: string; amount: number; originalAmount: number | null; bill_to: string | null; kind: string }
type Task = {
  id: string; unit: string; building: string | null; ownerId: string | null; ownerName: string
  department: string; name: string; description: string | null; status: string; doer: string | null
  scheduledDate: string | null; finishedAt: string | null; actualMinutes: number | null
  ratePaid: number | null; rateType: string | null; crew: string | null
  items: Item[]; hasDetail: boolean
  excluded: boolean; note: string | null; overrideAmount: number | null; billedHours: number | null
  laborAmount: number; billedAmount: number; reportUrl: string | null
  reviewState: State; opsBy: string | null; opsAt: string | null; gmBy: string | null; gmAt: string | null
  flags: Flag[]
  routine: 'unit_check' | 'strip' | null
  aiVerdict: 'no_charge' | 'bill' | null; aiReason: string | null; aiAmount: number | null
}
type Owner = { ownerId: string | null; ownerName: string; units: number; tasks: number; billed: number; open: number; opsApproved: number; gmApproved: number; flagged: number }
type Payload = { ok: true; month: string; from: string; to: string; me: { email: string; isGm: boolean }; tasks: Task[]; owners: Owner[]; missingDetail: number; aiPending?: number }
type Stage = 'ops' | 'gm' | 'done' | 'all'

const FLAG_LABEL: Record<Flag, string> = {
  over_150: 'over $150', no_price: 'no price', override_far: 'override far from computed',
  no_detail: 'detail not pulled', duplicate: 'possible duplicate', long_hours: 'long hours', no_owner: 'no owner',
  ai_bill: 'AI: real work — price it', ai_pending: 'AI check pending',
}
const STAGE_OF: Record<Stage, (t: Task) => boolean> = {
  ops: t => t.reviewState === 'open',
  gm: t => t.reviewState === 'ops_approved',
  done: t => t.reviewState === 'gm_approved',
  all: () => true,
}
const money = (n: number | null | undefined) => n == null ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const short = (iso: string | null) => { if (!iso) return ''; try { return new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return iso } }
const who = (e: string | null) => e ? (e === 'auto' ? 'auto' : e.split('@')[0]) : ''
const monthLabel = (m: string) => { try { return new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) } catch { return m } }
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 15)); return d.toISOString().slice(0, 7) }
const todayMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)

/** Recompute the money on a task after a local edit, the same way lib/billing does on the server. */
function recompute(t: Task): Task {
  const itemsTotal = t.items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0)
  const computed = Math.round((t.laborAmount + itemsTotal) * 100) / 100
  const billed = t.excluded ? 0 : (t.overrideAmount != null ? t.overrideAmount : computed)
  const flags: Flag[] = t.flags.filter(f => f !== 'over_150' && f !== 'override_far' && f !== 'no_price' && !((f === 'ai_bill' || f === 'ai_pending') && (t.overrideAmount != null || t.excluded)))
  if (billed > 150) flags.push('over_150')
  if (t.overrideAmount != null) {
    const gap = Math.abs(t.overrideAmount - computed)
    if (computed > 0 ? (gap / computed > 0.5 || gap > 50) : t.overrideAmount > 50) flags.push('override_far')
  }
  const finished = /complet|close|approv|finish/i.test(t.status) || !!t.finishedAt
  if (finished && !t.excluded && billed === 0 && t.overrideAmount == null && !/(departur|turnover|check-?out)[\s\-_/]*clean/i.test(t.name)) flags.push('no_price')
  return { ...t, billedAmount: billed, flags }
}

// ── ONE TASK ──────────────────────────────────────────────────────────────────────────────────
const Row = memo(function Row({ t, stage, isGm, busy, open, onToggle, onState, onEdit }: {
  t: Task; stage: Stage; isGm: boolean; busy: boolean; open: boolean
  onToggle: (id: string) => void
  onState: (id: string, to: State) => void
  onEdit: (id: string, patch: { override_amount?: number | null; note?: string; excluded?: boolean }) => Promise<void>
}) {
  const over = t.flags.includes('over_150')
  const done = t.reviewState === 'gm_approved'
  const inGmQueue = t.reviewState === 'ops_approved'
  const [amt, setAmt] = useState<string>(t.overrideAmount != null ? String(t.overrideAmount) : '')
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<string>(t.note || '')
  useEffect(() => { setAmt(t.overrideAmount != null ? String(t.overrideAmount) : ''); setNote(t.note || '') }, [t.overrideAmount, t.note])

  const btn = 'inline-flex items-center gap-1 rounded-lg px-2.5 h-8 text-[12px] font-semibold disabled:opacity-40 transition'
  return (
    <li className={'border-b border-line last:border-b-0 ' + (over ? 'border-l-[3px] border-l-amber-400 ' : 'border-l-[3px] border-l-transparent ') + (done ? 'bg-emerald-50/40' : t.excluded ? 'bg-app/40' : '')}>
      <div className="grid gap-3 px-3 py-2.5 items-center" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
        <button onClick={() => onToggle(t.id)} className="text-left min-w-0">
          <span className="flex items-baseline gap-2 flex-wrap">
            <span className={'text-[13.5px] font-bold truncate ' + (t.excluded ? 'text-muted line-through' : 'text-ink')}>{t.unit}</span>
            <span className="text-[12.5px] text-ink/80 truncate">{t.name}</span>
          </span>
          <span className="block text-[11px] text-muted mt-0.5 truncate">
            {t.doer || 'no one assigned'} · {short(t.scheduledDate || t.finishedAt)}
            {t.actualMinutes ? ' · ' + (t.actualMinutes / 60).toFixed(1) + 'h on the clock' : ''}
            {t.department ? ' · ' + t.department : ''}
          </span>
          {t.flags.length ? (
            <span className="flex flex-wrap gap-1 mt-1">
              {t.flags.map(f => (
                <span key={f} className={'text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ' + (f === 'over_150' ? 'bg-amber-50 text-amber-800 ring-amber-200' : f === 'ai_bill' ? 'bg-brand-50 text-brand-700 ring-brand-200' : f === 'ai_pending' ? 'bg-app text-muted ring-line' : 'bg-rose-50 text-rose-700 ring-rose-200')}>{FLAG_LABEL[f]}</span>
              ))}
            </span>
          ) : null}
          {t.aiVerdict === 'bill' && t.aiReason && t.overrideAmount == null && !done ? (
            <span className="block text-[11px] text-brand-800 mt-1">{t.aiReason}{t.aiAmount != null ? ' — suggests ' + money(t.aiAmount) : ''}</span>
          ) : null}
        </button>

        <div className="text-right">
          {/* The price is editable right here — click it, type, Enter or click away to save. Esc cancels. */}
          {editing ? (
            <input autoFocus value={amt} onChange={e => setAmt(e.target.value)} inputMode="decimal" placeholder={money(t.billedAmount)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setAmt(t.overrideAmount != null ? String(t.overrideAmount) : ''); setEditing(false) } }}
              onBlur={() => { setEditing(false); const v = amt.trim() === '' ? null : Number(amt.replace(/[$,]/g, '')); if (v !== (t.overrideAmount ?? null) && (v === null || Number.isFinite(v))) onEdit(t.id, { override_amount: v }) }}
              className="h-8 w-28 rounded-lg border border-brand-400 ring-2 ring-brand-100 bg-white px-2 text-right text-[15px] font-bold tabular-nums text-ink outline-none" />
          ) : (
            <button onClick={() => { if (!done) setEditing(true) }} disabled={done} title={done ? 'GM-approved — send back to change' : 'Click to set the price'}
              className={'block ml-auto text-[16px] font-bold tabular-nums leading-tight rounded px-1 -mx-1 ' + (done ? '' : 'hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 ') + (t.excluded ? 'text-muted line-through' : over ? 'text-amber-800' : 'text-ink')}>
              {money(t.billedAmount)}
            </button>
          )}
          <span className="block text-[10.5px] text-muted">
            {t.overrideAmount != null ? 'set by hand' : t.rateType === 'hourly' ? 'hourly' : t.laborAmount ? 'rate' : t.items.length ? 'line items' : 'no charge'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {done ? (
            <>
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700"><Check size={13} /> Final {who(t.gmBy)}</span>
              {isGm && t.gmBy !== 'auto' ? <button disabled={busy} onClick={() => onState(t.id, 'ops_approved')} title="Back to final review" className={btn + ' text-muted hover:text-ink'}><Undo2 size={12} /></button> : null}
            </>
          ) : inGmQueue ? (
            <>
              <span className="text-[11px] text-muted mr-1">ops {who(t.opsBy)}</span>
              {isGm ? <button disabled={busy} onClick={() => onState(t.id, 'gm_approved')} className={btn + ' bg-ink text-white hover:bg-ink/90'}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Final approve</button> : null}
              <button disabled={busy} onClick={() => onState(t.id, 'open')} title="Send back to ops" className={btn + ' text-muted hover:text-rose-700'}><Undo2 size={12} /></button>
            </>
          ) : (
            <>
              {t.aiVerdict === 'bill' && t.aiAmount != null && t.overrideAmount == null && !t.excluded ? (
                <button disabled={busy} onClick={() => { setAmt(String(t.aiAmount)); onEdit(t.id, { override_amount: t.aiAmount }) }} title="Take the AI's suggested price" className={btn + ' border border-brand-200 text-brand-700 hover:bg-brand-50'}>Use {money(t.aiAmount)}</button>
              ) : null}
              <button disabled={busy} onClick={() => onState(t.id, 'ops_approved')} className={btn + ' bg-brand-600 text-white hover:bg-brand-700'}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Approve</button>
            </>
          )}
          <button onClick={() => onToggle(t.id)} className="p-1 text-muted hover:text-ink" aria-label="Details"><ChevronDown size={14} className={'transition ' + (open ? 'rotate-180' : '')} /></button>
        </div>
      </div>

      {open ? (
        <div className="px-3 pb-3 pt-1 border-t border-line bg-app/40 grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted mb-1">What Breezeway has</p>
            <ul className="text-[12px] space-y-0.5">
              <li className="flex justify-between gap-3"><span className="text-muted">Labor ({t.rateType || 'rate'}{t.ratePaid != null ? ' ' + money(t.ratePaid) : ''}{t.billedHours != null ? ' × ' + t.billedHours + 'h' : ''})</span><span className="tabular-nums text-ink">{money(t.laborAmount)}</span></li>
              {t.items.map(it => (
                <li key={it.key} className="flex justify-between gap-3">
                  <span className={'truncate ' + (String(it.bill_to || 'owner') === 'guest' ? 'text-muted line-through' : 'text-ink/80')}>{it.description || it.kind}{String(it.bill_to || 'owner') === 'guest' ? ' (guest pays)' : ''}</span>
                  <span className="tabular-nums text-ink shrink-0">{money(it.amount)}{it.originalAmount != null ? <span className="text-muted line-through ml-1">{money(it.originalAmount)}</span> : null}</span>
                </li>
              ))}
              {!t.hasDetail ? <li className="text-amber-800 text-[11.5px] flex items-center gap-1"><AlertTriangle size={11} /> Detail not pulled yet — cost lines may be missing.</li> : null}
            </ul>
            {t.description ? <p className="text-[11.5px] text-muted mt-2 whitespace-pre-wrap">{t.description}</p> : null}
            {t.reportUrl ? <a href={t.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 mt-2"><ExternalLink size={11} /> Open in Breezeway</a> : null}
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">Our adjustment</p>
            <label className="flex items-center gap-2 text-[12px]">
              <span className="text-muted w-24 shrink-0">Bill instead</span>
              <input value={amt} onChange={e => setAmt(e.target.value)} inputMode="decimal" placeholder={money(t.billedAmount)}
                onBlur={() => { const v = amt.trim() === '' ? null : Number(amt.replace(/[$,]/g, '')); if (v !== (t.overrideAmount ?? null) && (v === null || Number.isFinite(v))) onEdit(t.id, { override_amount: v }) }}
                className="h-8 w-28 rounded-lg border border-line bg-white px-2 tabular-nums text-ink" />
              {t.overrideAmount != null ? <button onClick={() => { setAmt(''); onEdit(t.id, { override_amount: null }) }} className="text-[11px] text-muted hover:text-ink">clear</button> : null}
            </label>
            <label className="flex items-start gap-2 text-[12px]">
              <span className="text-muted w-24 shrink-0 pt-1.5">Note</span>
              <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== (t.note || '')) onEdit(t.id, { note }) }} rows={2}
                placeholder="Why, in the owner's words" className="flex-1 rounded-lg border border-line bg-white px-2 py-1 text-ink" />
            </label>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={t.excluded} onChange={e => onEdit(t.id, { excluded: e.target.checked })} />
              <span className="text-ink">Leave off the owner's statement</span>
            </label>
            {(t.opsBy || t.gmBy) ? (
              <p className="text-[11px] text-muted">
                {t.opsBy ? 'Ops: ' + who(t.opsBy) + (t.opsAt ? ' · ' + short(t.opsAt) : '') : ''}
                {t.gmBy ? (t.opsBy ? ' · ' : '') + 'Final: ' + who(t.gmBy) + (t.gmAt ? ' · ' + short(t.gmAt) : '') : ''}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
})

// ── THE DESK ──────────────────────────────────────────────────────────────────────────────────
export function BillingReview() {
  const [month, setMonth] = useState(todayMonth())
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [stage, setStage] = useState<Stage | null>(null)     // null until we know the role
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string>('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // The snapshot that keeps rows from vanishing mid-session (rule 2).
  const [viewIds, setViewIds] = useState<Set<string> | null>(null)
  const seq = useRef(0)
  const aiRan = useRef<Set<string>>(new Set())
  const [aiBusy, setAiBusy] = useState(0)

  const loadRef = useRef<(m: string) => Promise<void>>(async () => {})
  const load = useCallback(async (m: string) => {
    const my = ++seq.current
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/billing/review?month=' + m, { cache: 'no-store' })
      const j = await r.json()
      if (my !== seq.current) return                      // a newer request has superseded this one
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load the month.')
      setData(j); setViewIds(null)
      setStage(s => s || (j.me?.isGm ? 'gm' : 'ops'))
      // Routine tasks with a real description that the model has not read yet: send them now,
      // once, then pull the month again so the verdicts land. Nothing else waits on this.
      if (Number(j.aiPending) > 0 && !aiRan.current.has(m)) {
        aiRan.current.add(m); setAiBusy(Number(j.aiPending))
        fetch('/api/billing/ai-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m }) })
          .then(r => r.json()).catch(() => null)
          .then(res => { setAiBusy(0); if (res && res.ok && res.judged > 0 && my === seq.current) loadRef.current(m) })
      }
    } catch (e: any) { if (my === seq.current) setErr(String(e?.message || e)) }
    if (my === seq.current) setLoading(false)
  }, [])
  loadRef.current = load
  useEffect(() => { load(month) }, [month, load])

  const tasks = data?.tasks || []
  const byId = useMemo(() => { const m = new Map<string, Task>(); for (const t of tasks) m.set(t.id, t); return m }, [tasks])

  // Which rows belong to the stage right now — and the frozen snapshot of that (rule 2).
  const inStage = useCallback((t: Task) => (stage ? STAGE_OF[stage](t) : false), [stage])
  useEffect(() => {
    if (!data || !stage) return
    if (viewIds) return
    setViewIds(new Set(tasks.filter(inStage).map(t => t.id)))
  }, [data, stage, viewIds, tasks, inStage])
  const resnapshot = () => setViewIds(null)

  const visible = useMemo(() => {
    if (!viewIds) return [] as Task[]
    const needle = q.trim().toLowerCase()
    return tasks.filter(t => viewIds.has(t.id))
      .filter(t => !flaggedOnly || t.flags.length)
      .filter(t => !needle || (t.unit + ' ' + t.name + ' ' + (t.doer || '') + ' ' + t.ownerName).toLowerCase().includes(needle))
  }, [tasks, viewIds, q, flaggedOnly])

  // Owners in server order (name), rows inside sorted: flagged first, then biggest.
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of visible) { const k = t.ownerId || '—'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t) }
    for (const list of Array.from(m.values())) list.sort((a, b) => Number(!!b.flags.length) - Number(!!a.flags.length) || b.billedAmount - a.billedAmount || a.unit.localeCompare(b.unit))
    return (data?.owners || []).map(o => ({ owner: o, rows: m.get(o.ownerId || '—') || [] }))
  }, [visible, data])

  // Whole-window numbers for the strip — never the filtered view's.
  const kpi = useMemo(() => {
    const sum = (f: (t: Task) => boolean) => tasks.filter(f).reduce((a, t) => ({ n: a.n + 1, $: a.$ + t.billedAmount }), { n: 0, $: 0 })
    return { open: sum(t => t.reviewState === 'open'), gm: sum(t => t.reviewState === 'ops_approved'), done: sum(t => t.reviewState === 'gm_approved'), flagged: sum(t => t.flags.length > 0 && t.reviewState !== 'gm_approved') }
  }, [tasks])

  // ── actions: merge, never reload ────────────────────────────────────────────────────────────
  const markBusy = (ids: string[], on: boolean) => setBusy(prev => { const n = new Set(prev); for (const id of ids) on ? n.add(id) : n.delete(id); return n })
  const applyState = useCallback((changed: { id: string; reviewState: State; opsBy?: string | null; opsAt?: string | null; gmBy?: string | null; gmAt?: string | null }[]) => {
    setData(d => {
      if (!d) return d
      const delta: Record<string, { open: number; opsApproved: number; gmApproved: number }> = {}
      const bump = (ownerKey: string, s: State, by: number) => {
        const x = delta[ownerKey] = delta[ownerKey] || { open: 0, opsApproved: 0, gmApproved: 0 }
        if (s === 'open') x.open += by; else if (s === 'ops_approved') x.opsApproved += by; else x.gmApproved += by
      }
      const next = d.tasks.map(t => {
        const c = changed.find(x => x.id === t.id); if (!c) return t
        const k = t.ownerId || '—'
        bump(k, t.reviewState, -1); bump(k, c.reviewState, +1)
        return { ...t, reviewState: c.reviewState,
          ...(c.opsBy !== undefined ? { opsBy: c.opsBy ?? null, opsAt: c.opsAt ?? null } : {}),
          ...(c.gmBy !== undefined ? { gmBy: c.gmBy ?? null, gmAt: c.gmAt ?? null } : {}) }
      })
      const owners = d.owners.map(o => { const x = delta[o.ownerId || '—']; return x ? { ...o, open: o.open + x.open, opsApproved: o.opsApproved + x.opsApproved, gmApproved: o.gmApproved + x.gmApproved } : o })
      return { ...d, tasks: next, owners }
    })
  }, [])
  const setState = useCallback(async (ids: string[], to: State) => {
    if (!ids.length) return
    markBusy(ids, true); setErr('')
    try {
      const r = await fetch('/api/billing/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: ids, to }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not save.')
      applyState(j.changed || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
    markBusy(ids, false)
  }, [applyState])
  const onState = useCallback((id: string, to: State) => { setState([id], to) }, [setState])

  const onEdit = useCallback(async (id: string, patch: { override_amount?: number | null; note?: string; excluded?: boolean }) => {
    const before = byId.get(id); if (!before) return
    // Optimistic, recomputed the same way the server does; the server's own reply carries no task.
    setData(d => d ? { ...d, tasks: d.tasks.map(t => t.id === id ? recompute({ ...t, ...(patch.override_amount !== undefined ? { overrideAmount: patch.override_amount } : {}), ...(patch.note !== undefined ? { note: patch.note || null } : {}), ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}) }) : t) } : d)
    try {
      const r = await fetch('/api/billing/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'adjust', taskId: id, ...patch }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not save the change.')
    } catch (e: any) {
      setErr(String(e?.message || e))
      setData(d => d ? { ...d, tasks: d.tasks.map(t => t.id === id ? before : t) } : d)   // roll back
    }
  }, [byId])
  const onToggle = useCallback((id: string) => setOpenId(cur => (cur === id ? '' : id)), [])

  if (!data && loading) return <div className="rounded-2xl bg-white ring-1 ring-line p-12 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading {monthLabel(month)}…</div>
  if (!data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err || 'Nothing loaded.'}</div>
  const isGm = !!data.me?.isGm
  const st: Stage = stage || (isGm ? 'gm' : 'ops')
  const tab = (k: Stage, label: string, n: number) => (
    <button onClick={() => { setStage(k); resnapshot() }}
      className={'px-3 h-9 text-[12.5px] font-semibold border-l border-line first:border-l-0 inline-flex items-center gap-1.5 ' + (st === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>
      {label}<span className={'text-[11px] tabular-nums px-1.5 rounded ' + (st === k ? 'bg-white/20' : 'bg-app')}>{n}</span>
    </button>
  )
  const approveAllLabel = st === 'gm' ? 'Final approve all shown' : 'Approve all shown'
  const approveAllTo: State = st === 'gm' ? 'gm_approved' : 'ops_approved'
  const canApproveAll = st === 'ops' || (st === 'gm' && isGm)

  return (
    <div className="space-y-4">
      {/* ── month + the numbers the desk is judged on ─────────────────────────────────────── */}
      <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-b border-line">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="h-9 w-9 grid place-items-center rounded-xl border border-line text-muted hover:text-ink" aria-label="Earlier"><ChevronLeft size={15} /></button>
          <h2 className="text-[16px] font-bold text-ink tracking-tight min-w-[150px]">{monthLabel(month)}</h2>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="h-9 w-9 grid place-items-center rounded-xl border border-line text-muted hover:text-ink" aria-label="Later"><ChevronRight size={15} /></button>
          <button onClick={() => load(month)} disabled={loading} className="h-9 w-9 grid place-items-center rounded-xl border border-line text-muted hover:text-ink disabled:opacity-40" aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          <div className="flex-1" />
          <a href={'/api/billing/export?month=' + month + '&format=zip&reviewed=1'} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-[12.5px] font-semibold text-ink hover:bg-app"><Download size={13} /> Final-approved statements</a>
          <a href="/billing?view=labor" className="text-[12px] font-semibold text-muted hover:text-ink">Labor &amp; rates</a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-line">
          {([
            ['Open · ops to review', kpi.open, 'text-ink'],
            ['Ops approved · final review', kpi.gm, 'text-brand-700'],
            ['Final approved · statement-ready', kpi.done, 'text-emerald-700'],
            ['Flagged, still open', kpi.flagged, kpi.flagged.n ? 'text-amber-700' : 'text-muted'],
          ] as [string, { n: number; $: number }, string][]).map(([l, v, cls]) => (
            <div key={l} className="px-4 py-3">
              <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">{l}</p>
              <p className={'text-[20px] font-bold tabular-nums leading-tight ' + cls}>{money(v.$)}</p>
              <p className="text-[11px] text-muted tabular-nums">{v.n} task{v.n === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── which queue, what to show in it ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white">
          {tab('ops', 'Ops review', kpi.open.n)}
          {tab('gm', 'Final review', kpi.gm.n)}
          {tab('done', 'Approved', kpi.done.n)}
          {tab('all', 'All', tasks.length)}
        </div>
        <button onClick={() => setFlaggedOnly(v => !v)} className={'h-9 px-3 rounded-xl border text-[12.5px] font-semibold inline-flex items-center gap-1.5 ' + (flaggedOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-line text-muted hover:text-ink')}><AlertTriangle size={13} /> Flagged only</button>
        <label className="h-9 inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 text-[12.5px]"><Search size={13} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="unit, task, person, owner" className="w-44 bg-transparent outline-none text-ink" /></label>
        {aiBusy ? <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><Loader2 size={12} className="animate-spin" /> AI is reading {aiBusy} unit check{aiBusy === 1 ? '' : 's'}/strip{aiBusy === 1 ? '' : 's'}…</span> : null}
        <div className="flex-1" />
        {canApproveAll && visible.some(inStage) ? (
          <button onClick={() => setState(visible.filter(inStage).map(t => t.id), approveAllTo)} className="h-9 px-3 rounded-xl bg-ink text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Check size={13} /> {approveAllLabel} ({visible.filter(inStage).length})</button>
        ) : null}
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div> : null}
      {data.missingDetail ? <p className="text-[12px] text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-xl px-3.5 py-2">{data.missingDetail} task{data.missingDetail === 1 ? '' : 's'} in this month never had billing detail pulled — their cost lines may be missing. The nightly pull catches up on its own.</p> : null}

      {/* ── by owner, in an order that never changes ───────────────────────────────────────── */}
      {!visible.length ? (
        <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-10 text-center text-[13px] text-muted">
          {st === 'ops' ? 'Nothing open for ops to review.' : st === 'gm' ? 'Nothing waiting on final review.' : st === 'done' ? 'Nothing final-approved yet this month.' : 'No tasks in this month.'}
          {flaggedOnly || q ? ' (with the current filter)' : ''}
        </div>
      ) : groups.filter(g => g.rows.length).map(({ owner: o, rows }) => {
        const k = o.ownerId || '—'
        const isOpen = !collapsed[k]
        const actionable = rows.filter(inStage)
        return (
          <section key={k} className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
            <header className="px-4 py-2.5 flex items-center gap-3 flex-wrap bg-app/40 border-b border-line">
              <button onClick={() => setCollapsed(c => ({ ...c, [k]: !c[k] }))} className="flex items-center gap-2 text-left min-w-0">
                <ChevronDown size={14} className={'text-muted transition ' + (isOpen ? '' : '-rotate-90')} />
                <span className="text-[14px] font-bold text-ink truncate">{o.ownerName}</span>
              </button>
              <span className="text-[12px] text-muted tabular-nums">
                {money(o.billed)} this month · {o.tasks} task{o.tasks === 1 ? '' : 's'} · {o.units} unit{o.units === 1 ? '' : 's'}
              </span>
              {/* Progress over the WHOLE month for this owner, whatever the filter shows. */}
              <span className="inline-flex items-center gap-1 text-[11px] tabular-nums">
                <span className="px-1.5 py-0.5 rounded bg-white ring-1 ring-line text-muted">{o.open} open</span>
                <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700">{o.opsApproved} ops</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{o.gmApproved} final</span>
                {o.flagged ? <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{o.flagged} flagged</span> : null}
              </span>
              <div className="flex-1" />
              {canApproveAll && actionable.length ? (
                <button onClick={() => setState(actionable.map(t => t.id), approveAllTo)} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><Check size={12} /> {st === 'gm' ? 'Final approve' : 'Approve'} {actionable.length}</button>
              ) : null}
              {o.ownerId ? <a href={'/api/billing/export?month=' + month + '&format=xls&done=1&owner=' + encodeURIComponent(o.ownerId)} className="text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1"><Download size={12} /> Export</a> : null}
            </header>
            {isOpen ? (
              <ul>
                {rows.map(t => <Row key={t.id} t={t} stage={st} isGm={isGm} busy={busy.has(t.id)} open={openId === t.id} onToggle={onToggle} onState={onState} onEdit={onEdit} />)}
              </ul>
            ) : null}
          </section>
        )
      })}

      <p className="text-[11px] text-muted">
        Approving never reloads the page and never reorders the owners — a row you have signed stays where it is, marked, until you switch queue or refresh.
        Click a price to change it in place (Enter saves, Esc cancels). Amber edge: over $150. Final approval (admin only) is what goes on the statement.
        Unit checks and strips close themselves at $0; the ones with a real description are read by AI once and stay open only if it saw chargeable work.
      </p>
    </div>
  )
}
