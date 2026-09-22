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
import { isTaskDone } from '@/lib/task-done'
import { LeanHead, Pill, Tag, LeanTabs, LeanEmpty, IconBtn, Tip, type Tone } from '@/components/lean'

type Flag = 'over_150' | 'no_price' | 'override_far' | 'no_detail' | 'duplicate' | 'long_hours' | 'no_owner' | 'ai_bill' | 'ai_pending' | 'not_done'
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
  not_done: 'not finished in Breezeway',
  ai_bill: 'AI: real work — price it', ai_pending: 'AI check pending',
}
// LEAN PASS (2026-09-22): the row shows the short word, the hover says the full reason.
const FLAG_SHORT: Record<Flag, string> = {
  over_150: 'Over $150', no_price: 'No price', override_far: 'Override off', no_detail: 'No detail',
  duplicate: 'Duplicate?', long_hours: 'Long hours', no_owner: 'No owner', not_done: 'Not finished',
  ai_bill: 'AI: bill it', ai_pending: 'AI pending',
}
const FLAG_TONE = (f: Flag): Tone => f === 'over_150' ? 'amber' : f === 'ai_bill' ? 'brand' : f === 'ai_pending' ? 'slate' : 'rose'
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
  const finished = isTaskDone(t.status, t.finishedAt)
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
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className={'text-[13.5px] font-bold truncate ' + (t.excluded ? 'text-muted line-through' : 'text-ink')}>{t.unit}</span>
            <span className="text-[12.5px] text-ink/80 truncate max-w-[18rem]">{t.name}</span>
            <span className="text-[11.5px] text-muted truncate">
              {t.doer || 'no one assigned'} · {short(t.scheduledDate || t.finishedAt)}
              {t.actualMinutes ? ' · ' + (t.actualMinutes / 60).toFixed(1) + 'h' : ''}
            </span>
            {t.flags.map(f => (
              <Tag key={f} tone={FLAG_TONE(f)}
                title={f === 'ai_bill' && t.aiReason ? t.aiReason + (t.aiAmount != null ? ' — suggests ' + money(t.aiAmount) : '') : FLAG_LABEL[f]}>{FLAG_SHORT[f]}</Tag>
            ))}
          </span>
        </button>

        <div className="text-right">
          {/* The price is editable right here — click it, type, Enter or click away to save. Esc cancels. */}
          {editing ? (
            <input autoFocus value={amt} onChange={e => setAmt(e.target.value)} inputMode="decimal" placeholder={money(t.billedAmount)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setAmt(t.overrideAmount != null ? String(t.overrideAmount) : ''); setEditing(false) } }}
              onBlur={() => { setEditing(false); const v = amt.trim() === '' ? null : Number(amt.replace(/[$,]/g, '')); if (v !== (t.overrideAmount ?? null) && (v === null || Number.isFinite(v))) onEdit(t.id, { override_amount: v }) }}
              className="h-8 w-28 rounded-lg border border-brand-400 ring-2 ring-brand-100 bg-white px-2 text-right text-[15px] font-bold tabular-nums text-ink outline-none" />
          ) : (
            <button onClick={() => { if (!done) setEditing(true) }} disabled={done} title={done ? 'GM-approved — send back to change' : 'Click to set the price (Enter saves, Esc cancels)'}
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
              {isGm && t.gmBy !== 'auto' ? <Tip label="Back to final review"><button disabled={busy} onClick={() => onState(t.id, 'ops_approved')} aria-label="Back to final review" className={btn + ' text-muted hover:text-ink'}><Undo2 size={12} /></button></Tip> : null}
            </>
          ) : inGmQueue ? (
            <>
              <span className="text-[11px] text-muted mr-1">ops {who(t.opsBy)}</span>
              {isGm ? <button disabled={busy} onClick={() => onState(t.id, 'gm_approved')} className={btn + ' bg-ink text-white hover:bg-ink/90'}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Final approve</button> : null}
              <Tip label="Send back to ops"><button disabled={busy} onClick={() => onState(t.id, 'open')} aria-label="Send back to ops" className={btn + ' text-muted hover:text-rose-700'}><Undo2 size={12} /></button></Tip>
            </>
          ) : (
            <>
              {t.aiVerdict === 'bill' && t.aiAmount != null && t.overrideAmount == null && !t.excluded ? (
                <button disabled={busy} onClick={() => { setAmt(String(t.aiAmount)); onEdit(t.id, { override_amount: t.aiAmount }) }} title="Take the AI's suggested price" className={btn + ' border border-brand-200 text-brand-700 hover:bg-brand-50'}>Use {money(t.aiAmount)}</button>
              ) : null}
              <button disabled={busy} onClick={() => onState(t.id, 'ops_approved')} className={btn + ' bg-brand-600 text-white hover:bg-brand-700'}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Approve</button>
            </>
          )}
          <Tip label={open ? 'Close details' : 'Details, price and note'}><button onClick={() => onToggle(t.id)} className="p-1 text-muted hover:text-ink" aria-label="Details"><ChevronDown size={14} className={'transition ' + (open ? 'rotate-180' : '')} /></button></Tip>
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
            {t.aiVerdict === 'bill' && t.aiReason ? <p className="text-[11.5px] text-brand-800 mt-2">AI: {t.aiReason}{t.aiAmount != null ? ' — suggests ' + money(t.aiAmount) : ''}</p> : null}
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

  if (!data && loading) return <><LeanHead title="Billable Hours" /><LeanEmpty><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading {monthLabel(month)}…</LeanEmpty></>
  if (!data) return <><LeanHead title="Billable Hours" /><div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err || 'Nothing loaded.'}</div></>
  const isGm = !!data.me?.isGm
  const st: Stage = stage || (isGm ? 'gm' : 'ops')
  const approveAllLabel = st === 'gm' ? 'Final approve all shown' : 'Approve all shown'
  const approveAllTo: State = st === 'gm' ? 'gm_approved' : 'ops_approved'
  const canApproveAll = st === 'ops' || (st === 'gm' && isGm)

  return (
    <div className="space-y-3">
      {/* ── one line: the four numbers the desk is judged on (whole month, never the filtered view) */}
      <LeanHead title="Billable Hours">
        <Pill title={'Open — ops to review · ' + kpi.open.n + ' task' + (kpi.open.n === 1 ? '' : 's')}>{money(kpi.open.$)} open</Pill>
        <Pill tone="brand" title={'Ops approved — waiting on final (GM) review · ' + kpi.gm.n + ' task' + (kpi.gm.n === 1 ? '' : 's')}>{money(kpi.gm.$)} final</Pill>
        <Pill tone="emerald" title={'Final approved — statement-ready · ' + kpi.done.n + ' task' + (kpi.done.n === 1 ? '' : 's')}>{money(kpi.done.$)} approved</Pill>
        {kpi.flagged.n ? <Pill tone="amber" title={'Flagged and not final-approved: ' + money(kpi.flagged.$) + '. Amber edge on a row = over $150. A flag never blocks approval.'}>{kpi.flagged.n} flagged</Pill> : null}
        {data.missingDetail ? <Pill tone="amber" title="Tasks in this month that never had billing detail pulled — their cost lines may be missing. The nightly pull catches up on its own.">{data.missingDetail} no detail</Pill> : null}
      </LeanHead>

      {/* ── month, then which queue and what to show in it — one line */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <IconBtn title="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></IconBtn>
        <span className="text-[13.5px] font-bold text-ink tracking-tight min-w-[120px] text-center">{monthLabel(month)}</span>
        <IconBtn title="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></IconBtn>
        <IconBtn title="Reload the month" onClick={() => load(month)} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></IconBtn>
        <IconBtn title="Download final-approved statements (ZIP)" href={'/api/billing/export?month=' + month + '&format=zip&reviewed=1'}><Download size={14} /></IconBtn>
        <a href="/billing?view=labor" title="The older board: labor vs payroll, rates, bulk edits" className="text-[12px] font-semibold text-muted hover:text-ink px-1">Labor &amp; rates</a>
      </div>
      <LeanTabs
        tabs={[
          { key: 'ops' as Stage, label: 'Ops review', n: kpi.open.n },
          { key: 'gm' as Stage, label: 'Final review', n: kpi.gm.n },
          { key: 'done' as Stage, label: 'Approved', n: kpi.done.n },
          { key: 'all' as Stage, label: 'All', n: tasks.length },
        ]}
        value={st} onChange={k => { setStage(k); resnapshot() }}
        right={<>
          <Tip label="Show only rows with a flag"><button onClick={() => setFlaggedOnly(v => !v)} aria-label="Flagged only" className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold inline-flex items-center gap-1.5 ' + (flaggedOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-line text-muted hover:text-ink')}><AlertTriangle size={13} /> Flagged</button></Tip>
          <label className="h-8 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 text-[12px]"><Search size={13} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="unit, task, person, owner" className="w-36 bg-transparent outline-none text-ink" /></label>
          {aiBusy ? <Tag title={'AI is reading ' + aiBusy + ' unit checks / strips — the ones with a real description stay open only if it saw chargeable work'}><Loader2 size={10} className="animate-spin inline mr-1" />AI {aiBusy}</Tag> : null}
          {canApproveAll && visible.some(inStage) ? (
            <button onClick={() => setState(visible.filter(inStage).map(t => t.id), approveAllTo)} className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1.5"><Check size={13} /> {approveAllLabel} ({visible.filter(inStage).length})</button>
          ) : null}
        </>} />

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div> : null}

      {/* ── by owner, in an order that never changes ───────────────────────────────────────── */}
      {!visible.length ? (
        <LeanEmpty>
          {st === 'ops' ? 'Nothing open for ops to review.' : st === 'gm' ? 'Nothing waiting on final review.' : st === 'done' ? 'Nothing final-approved yet this month.' : 'No tasks in this month.'}
          {flaggedOnly || q ? ' (with the current filter)' : ''}
        </LeanEmpty>
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
              <span className="text-[12px] text-muted tabular-nums" title={o.tasks + ' task' + (o.tasks === 1 ? '' : 's') + ' · ' + o.units + ' unit' + (o.units === 1 ? '' : 's') + ' this month'}>
                {money(o.billed)} · {o.tasks}t · {o.units}u
              </span>
              {/* Progress over the WHOLE month for this owner, whatever the filter shows. */}
              <span className="inline-flex items-center gap-1 flex-wrap">
                <Tag title="Open — ops to review">{o.open} open</Tag>
                <Tag tone="brand" title="Ops approved — waiting on final review">{o.opsApproved} ops</Tag>
                <Tag tone="emerald" title="Final approved — statement-ready">{o.gmApproved} final</Tag>
                {o.flagged ? <Tag tone="amber" title="Flagged rows">{o.flagged} flagged</Tag> : null}
              </span>
              <div className="flex-1" />
              {canApproveAll && actionable.length ? (
                <button onClick={() => setState(actionable.map(t => t.id), approveAllTo)} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><Check size={12} /> {st === 'gm' ? 'Final approve' : 'Approve'} {actionable.length}</button>
              ) : null}
              {o.ownerId ? <IconBtn title={'Download ' + o.ownerName + '’s sheet (Excel)'} href={'/api/billing/export?month=' + month + '&format=xls&done=1&owner=' + encodeURIComponent(o.ownerId)}><Download size={13} /></IconBtn> : null}
            </header>
            {isOpen ? (
              <ul>
                {rows.map(t => <Row key={t.id} t={t} stage={st} isGm={isGm} busy={busy.has(t.id)} open={openId === t.id} onToggle={onToggle} onState={onState} onEdit={onEdit} />)}
              </ul>
            ) : null}
          </section>
        )
      })}

    </div>
  )
}
