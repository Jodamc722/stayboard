'use client'
// BILLABLE HOURS — organize every Breezeway task's billing in one place: see the cost, fix the
// rate (writes back to Breezeway), add what their API can't carry (exclusions, notes, extra line
// items — our overlay), and export the month by BILLING OWNER for the owner statements.
//
// Three views:
//   By owner  — tasks grouped under the unit's statement owner (guesty_owners), with totals.
//   All tasks — the same rows flat, for search/scan.
//   Labor     — billable labor vs ACTUAL hours worked per person (Breezeway Start/Complete time),
//               against an editable per-person hourly cost, for the maintenance margin story.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Download, ChevronDown, ChevronRight, Search, ExternalLink, AlertTriangle, Check, X, Pencil } from 'lucide-react'
import { useAccess } from '@/lib/useAccess'

type Item = { key: string; description: string; amount: number; originalAmount: number | null; bill_to: string | null; kind: 'cost' | 'supply' | 'extra' }
type Task = {
  id: string; listingId: string | null; unit: string; building: string | null
  ownerId: string | null; ownerName: string
  department: string; name: string; description: string | null; status: string
  assignees: { id: number | null; name: string | null }[]
  crew?: 'inhouse' | 'vendor' | null
  finishedBy: string | null
  scheduledDate: string | null; finishedAt: string | null
  actualMinutes: number | null
  ratePaid: number | null; rateType: string | null; billTo: string | null
  items: Item[]; hasDetail: boolean; detailSyncedAt: string | null
  excluded: boolean; note: string | null; overrideAmount: number | null; billedHours: number | null
  reviewedBy: string | null; reviewedAt: string | null
  laborAmount: number; billedAmount: number; reportUrl: string | null
}
type OwnerGroup = { ownerId: string | null; ownerName: string; units: number; tasks: number; billed: number; labor: number; items: number; actualMinutes: number }
type Data = { ok: boolean; month: string; from?: string; to?: string; custom?: boolean; tasks: Task[]; owners: OwnerGroup[]; missingDetail: number; laborRates: Record<string, number>; defaultRate?: number; reviews?: Record<string, { by: string; at: string }>; units?: { id: string; name: string }[]; maintenancePayroll?: { cost: number; hours: number; people: number; source: string; roster?: { name: string; hours: number; cost: number }[]; tasks: number; tasksWithBilling: number; tasksWithTime: number; hoursOnTask: number; billed: number } | null; maintenanceByMarket?: { market: string; tasks: number; tasksWithBilling: number; tasksWithTime: number; minutes: number; billed: number }[]; error?: string }

const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hours = (min: number | null | undefined) => min == null ? '—' : (Math.round((min / 60) * 10) / 10).toFixed(1) + 'h'

const DEPT_CLS: Record<string, string> = {
  maintenance: 'bg-amber-50 text-amber-700 ring-amber-200',
  housekeeping: 'bg-sky-50 text-sky-700 ring-sky-200',
  inspection: 'bg-violet-50 text-violet-700 ring-violet-200',
  safety: 'bg-rose-50 text-rose-700 ring-rose-200',
}
const chip = (cls: string) => 'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ' + cls

function etMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
}
/** First and last calendar day of a month, used to seed the custom range with what is on screen. */
function monthEdges(m: string): { from: string; to: string } {
  const [y, mo] = m.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { from: m + '-01', to: m + '-' + String(last).padStart(2, '0') }
}
function shiftMonth(m: string, by: number): string {
  const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7)) - 1 + by
  const d = new Date(Date.UTC(y, mo, 1))
  return d.toISOString().slice(0, 7)
}
function monthLabel(m: string): string {
  const d = new Date(m + '-15T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || '?'

// ── Add a billable task (created in Breezeway, billed immediately when an amount is set) ────
function AddTask({ units, month, onDone }: { units: { id: string; name: string }[]; month: string; onDone: () => void }) {
  const [listingId, setListingId] = useState('')
  const [name, setName] = useState('')
  const [dept, setDept] = useState('maintenance')
  const [date, setDate] = useState(month + '-01')
  const [amount, setAmount] = useState('')
  const [descr, setDescr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/billing/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, name, department: dept, date, amount: amount ? Number(amount) : null, description: descr }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Create failed')
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft space-y-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-brand-600 font-bold">Add a billable task — created in Breezeway</div>
      {err ? <div className="text-[12px] text-rose-600">{err}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select value={listingId} onChange={e => setListingId(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] max-w-[240px]">
          <option value="">Unit…</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Task title (e.g. Owner onboarding clean)"
          className="grow min-w-[220px] rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
        <select value={dept} onChange={e => setDept(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px]">
          <option value="maintenance">maintenance</option>
          <option value="housekeeping">housekeeping</option>
          <option value="inspection">inspection</option>
          <option value="safety">safety</option>
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-[12.5px]" />
        <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Bill $ (flat, optional)"
          className="w-32 rounded-lg border border-line px-2 py-1.5 text-[12.5px] tabular-nums" />
      </div>
      <div className="flex items-center gap-2">
        <input value={descr} onChange={e => setDescr(e.target.value)} placeholder="Description (optional — goes to Breezeway)"
          className="grow rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
        <button onClick={submit} disabled={busy || !listingId || !name.trim()}
          className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
          {busy ? 'Creating…' : 'Create & bill'}
        </button>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  const v = tone === 'bad' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-700' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">{label}</div>
      <div className={'text-2xl font-bold tabular-nums mt-1 tracking-tight ' + v}>{value}</div>
      {sub ? <div className="text-[11px] text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

// ── Per-task editor row ─────────────────────────────────────────────────────
// Shared column header for task tables (owner cards + All tasks). Keeps every row aligned.
function ColsHeader({ withUnit }: { withUnit?: boolean }) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted font-bold border-t border-line bg-neutral-50/40">
      <div className="col-span-5">{withUnit ? 'Task · unit' : 'Task'}</div>
      <div className="col-span-1">Dept</div>
      <div className="col-span-2">Done by</div>
      <div className="col-span-1 text-right">Hours</div>
      <div className="col-span-1 text-right">Rate</div>
      <div className="col-span-1 text-right">Billed</div>
      <div className="col-span-1" />
    </div>
  )
}

// onPatch applies an OPTIMISTIC local update (row + totals move instantly, no page jump);
// onSync schedules a quiet background refetch that trues everything up against the server.
function TaskRow({ t, canEdit, onPatch, onSync, selected, onSelect, defaultRate, showUnit }: { t: Task; canEdit: boolean; onPatch: (id: string, p: Partial<Task>) => void; onSync: () => void; selected?: boolean; onSelect?: () => void; defaultRate?: number; showUnit?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rate, setRate] = useState(t.ratePaid != null ? String(t.ratePaid) : '')
  const [rateType, setRateType] = useState(t.rateType || 'piece')
  const [note, setNote] = useState(t.note || '')
  const [override, setOverride] = useState(t.overrideAmount != null ? String(t.overrideAmount) : '')
  const [billedH, setBilledH] = useState(t.billedHours != null ? String(t.billedHours) : '')
  const [extraDesc, setExtraDesc] = useState('')
  const [extraAmt, setExtraAmt] = useState('')
  const [itemAmt, setItemAmt] = useState<Record<string, string>>({})
  // Inline row editing (Jon 2026-08-07): hours + rate editable right in the row, no expand needed.
  const [rowH, setRowH] = useState<string | null>(null)
  const [rowR, setRowR] = useState<string | null>(null)
  const [rowA, setRowA] = useState<string | null>(null)
  const [title, setTitle] = useState(t.name)
  const [desc, setDesc] = useState(t.description || '')

  const post = useCallback(async (body: any, tag: string, optimistic?: Partial<Task>) => {
    if (optimistic) onPatch(t.id, optimistic)   // the UI moves NOW; the server catches up
    setBusy(tag); setErr(null)
    try {
      const r = await fetch('/api/billing/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Save failed')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(null)
    onSync()   // quiet true-up (also reverts the optimistic patch if the save failed)
  }, [t.id, onPatch, onSync])

  const itemsOwnerTotal = t.items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0)
  const saveRate = () => {
    const v = Number(rate)
    post({ action: 'update', rate_paid: rate, rate_type: rateType }, 'rate',
      Number.isFinite(v) ? { ratePaid: v, rateType } : undefined)
  }
  const saveAdjust = (fields: any, tag: string, optimistic?: Partial<Task>) => post({ action: 'adjust', ...fields }, tag, optimistic)
  const addExtra = () => {
    const next = (t.items.filter(i => i.kind === 'extra') as any[]).map(i => ({ description: i.description, amount: i.amount, bill_to: i.bill_to || 'owner' }))
    next.push({ description: extraDesc, amount: Number(extraAmt), bill_to: 'owner' })
    saveAdjust({ extra_items: next }, 'extra')
    setExtraDesc(''); setExtraAmt('')
  }
  const removeExtra = (idx: number) => {
    const cur = (t.items.filter(i => i.kind === 'extra') as any[]).map(i => ({ description: i.description, amount: i.amount, bill_to: i.bill_to || 'owner' }))
    cur.splice(idx, 1)
    saveAdjust({ extra_items: cur }, 'extra')
  }
  // Current full override map for this task's Breezeway line items (key → dollars).
  const overrideMap = (except?: string) => {
    const ov: Record<string, number> = {}
    for (const i of t.items) if (i.kind !== 'extra' && i.originalAmount != null && i.key !== except) ov[i.key] = i.amount
    return ov
  }
  const saveItemAmount = (it: Item) => {
    const raw = itemAmt[it.key]
    if (raw == null || raw === '') return
    const v = Number(raw)
    if (!Number.isFinite(v) || v < 0 || v === it.amount) return
    if (it.kind === 'extra') {
      const extras2 = t.items.filter(i => i.kind === 'extra').map(i => ({ description: i.description, amount: i.key === it.key ? v : i.amount, bill_to: i.bill_to || 'owner' }))
      saveAdjust({ extra_items: extras2 }, 'item')
    } else {
      const ov = overrideMap()
      ov[it.key] = v
      saveAdjust({ item_overrides: ov }, 'item')
    }
  }
  const resetItem = (it: Item) => {
    setItemAmt(m => ({ ...m, [it.key]: '' }))
    saveAdjust({ item_overrides: overrideMap(it.key) }, 'item')
  }
  // Row-level saves. HOURS and AMOUNT are the same fact at the charge rate (Jon: "we charge 40
  // per hour — if they put 20 it's .5 hours"): editing either overwrites the billed total AND
  // keeps the other in sync at $rate/h. Stored as our overlay (billed_hours + override_amount) —
  // Breezeway has no writable time field; their clock is the crew's taps. RATE edits push to
  // Breezeway (rate_paid + hourly).
  const chargeRate = defaultRate != null && defaultRate > 0 ? defaultRate : 40
  // Jon's rule: the team enters FLAT AMOUNTS in Breezeway; we read them as billable labor at the
  // charge rate — hours = amount ÷ rate, REGARDLESS of the clock time on the task. The crew's
  // actual time stays in the tooltip and the Labor tab.
  const shownHours: number | null = t.billedHours != null
    ? t.billedHours
    : (t.billedAmount > 0
      ? Math.round((t.billedAmount / chargeRate) * 100) / 100
      : (t.actualMinutes != null ? Math.round((t.actualMinutes / 60) * 100) / 100 : null))
  const saveRowHours = () => {
    if (rowH == null) return
    const cur = shownHours
    if (rowH === '') { setRowH(null); if (t.billedHours != null || t.overrideAmount != null) saveAdjust({ billed_hours: '', override_amount: '' }, 'rowh', { billedHours: null, overrideAmount: null }); return }
    const v = Number(rowH)
    if (!Number.isFinite(v) || v < 0) { setRowH(null); return }
    if (v === cur && t.overrideAmount != null) { setRowH(null); return }
    const amt = Math.round(v * chargeRate * 100) / 100
    saveAdjust({ billed_hours: v, override_amount: amt }, 'rowh', { billedHours: v, overrideAmount: amt, billedAmount: t.excluded ? 0 : amt })
    setRowH(null)
  }
  const saveRowAmount = () => {
    if (rowA == null) return
    if (rowA === '') { setRowA(null); if (t.overrideAmount != null || t.billedHours != null) saveAdjust({ billed_hours: '', override_amount: '' }, 'rowa', { billedHours: null, overrideAmount: null }); return }
    const v = Number(rowA)
    if (!Number.isFinite(v) || v < 0) { setRowA(null); return }
    if (v === t.billedAmount) { setRowA(null); return }
    const h = Math.round((v / chargeRate) * 100) / 100
    saveAdjust({ override_amount: v, billed_hours: h }, 'rowa', { overrideAmount: v, billedHours: h, billedAmount: t.excluded ? 0 : v })
    setRowA(null)
  }
  const saveRowRate = () => {
    if (rowR == null) return
    const v = rowR === '' ? (defaultRate != null ? defaultRate : null) : Number(rowR)
    if (v == null || !Number.isFinite(v)) { setRowR(null); return }
    if (t.ratePaid === v && String(t.rateType).toLowerCase() === 'hourly') { setRowR(null); return }
    post({ action: 'update', rate_paid: v, rate_type: 'hourly' }, 'rowr', { ratePaid: v, rateType: 'hourly' })
    setRowR(null)
  }

  const refreshDetail = async () => {
    setBusy('detail'); setErr(null)
    try {
      const r = await fetch('/api/billing/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [t.id] }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Pull failed')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(null)
    onSync()
  }

  const deptCls = DEPT_CLS[t.department] || 'bg-neutral-100 text-neutral-600 ring-neutral-200'
  const done = /complet|close|approv|finish/.test(t.status)
  const extras = t.items.filter(i => i.kind === 'extra')

  return (
    <div className={'border-t border-line hover:bg-neutral-50/60 transition-colors ' + (t.excluded ? 'opacity-50' : '')}>
      <div className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-[12.5px]">
        <div className="col-span-5 flex items-center gap-2 min-w-0">
        {onSelect ? <input type="checkbox" checked={!!selected} onChange={onSelect} className="shrink-0 accent-ink" aria-label="Select task" /> : null}
        <button className="flex items-center gap-2 text-left min-w-0 grow" onClick={() => setOpen(v => !v)}>
          {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted" />}
          <span className="min-w-0">
            <span className="font-semibold text-ink block truncate">{t.name}</span>
            <span className="text-[11px] text-muted block truncate">
              {showUnit ? t.unit + (t.building ? ' · ' + t.building : '') + ' · ' : ''}
              {t.scheduledDate || (t.finishedAt || '').slice(0, 10) || 'undated'}
              {t.reviewedBy ? <span className="text-emerald-600 font-semibold"> · ✓ {String(t.reviewedBy).split('@')[0]}{t.reviewedAt ? ' ' + String(t.reviewedAt).slice(5, 10) : ''}</span> : null}
              {t.note ? ' · 📝 ' + t.note : ''}
            </span>
            {/* MORE THAN ONE COST? SHOW WHAT THEY ARE (Jon, 2026-08-09: "supplies cost should show
                as a line item in the review process if more than one cost"). A single billed
                number hides whether it is labour, parts or supplies — you cannot review what you
                cannot see, and opening every row to find out is not reviewing. */}
            {(() => {
              const own = t.items.filter(i => String(i.bill_to || 'owner') !== 'guest' && i.amount)
              if (own.length < 2) return null
              const sum = (k: string) => own.filter(i => i.kind === k).reduce((a, i) => a + i.amount, 0)
              const parts: string[] = []
              const c = sum('cost'), sup = sum('supply'), ex = sum('extra')
              if (c) parts.push('costs ' + money(c))
              if (sup) parts.push('supplies ' + money(sup))
              if (ex) parts.push('extras ' + money(ex))
              return (
                <span className="text-[11px] text-teal-700 block truncate" title={own.map(i => i.kind + ': ' + i.description + ' ' + money(i.amount)).join('  ·  ')}>
                  {own.length} line items {'·'} {parts.join(' + ')}
                </span>
              )
            })()}
          </span>
        </button>
        </div>
        <div className="col-span-1 min-w-0">
          <span className={chip(deptCls) + ' truncate max-w-full'} title={t.department + (t.billTo ? ' · bills to ' + t.billTo : '')}>{t.department}</span>
        </div>
        <div className="col-span-2 truncate text-muted">{t.assignees.map(a => a.name).filter(Boolean).join(', ') || t.finishedBy || '—'}</div>
        <div className="col-span-1 text-right" title={'Billed hours = amount ÷ $' + chargeRate + '/h (crew clock: ' + hours(t.actualMinutes) + ') — click to edit'}>
          {canEdit ? (
            <input
              value={rowH != null ? rowH : (shownHours != null ? String(shownHours) : '')}
              onChange={e => setRowH(e.target.value)}
              onBlur={saveRowHours}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder="0"
              className={'w-14 rounded-lg border px-1.5 py-0.5 text-right text-[12.5px] tabular-nums ' + (t.billedHours != null ? 'border-brand-300 text-brand-700 font-semibold' : 'border-line')}
            />
          ) : (shownHours != null ? <span className={'tabular-nums' + (t.billedHours != null ? ' font-semibold text-brand-600' : '')}>{shownHours.toFixed(1)}h</span> : <span className="tabular-nums">—</span>)}
        </div>
        <div className="col-span-1 text-right" title="Hourly rate billed — saving pushes to Breezeway">
          {canEdit ? (
            <input
              value={rowR != null ? rowR : (t.ratePaid != null ? String(t.ratePaid) : '')}
              onChange={e => setRowR(e.target.value)}
              onBlur={saveRowRate}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder={defaultRate != null ? String(defaultRate) : '0'}
              className="w-14 rounded-lg border border-line px-1.5 py-0.5 text-right text-[12.5px] tabular-nums"
            />
          ) : <span className="tabular-nums text-muted">{t.ratePaid != null ? money(t.ratePaid) + (String(t.rateType).toLowerCase() === 'hourly' ? '/h' : '') : '—'}</span>}
        </div>
        <div className="col-span-1 text-right" title="Billed amount — editing overwrites the total and sets hours at the charge rate ($20 at $40/h = 0.5h)">
          {canEdit && !t.excluded ? (
            <input
              value={rowA != null ? rowA : String(t.billedAmount)}
              onChange={e => setRowA(e.target.value)}
              onBlur={saveRowAmount}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className={'w-[72px] rounded-lg border px-1.5 py-0.5 text-right text-[12.5px] tabular-nums font-bold ' + (t.overrideAmount != null ? 'border-brand-300 text-brand-700' : 'border-line text-ink')}
            />
          ) : <span className="tabular-nums font-bold text-ink">{money(t.billedAmount)}</span>}
        </div>
        <div className="col-span-1 flex items-center justify-end gap-1.5">
          {!t.hasDetail ? <span title="Billing detail not pulled yet"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span> : null}
          {done ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : null}
          {t.reviewedBy === 'auto' ? (
            <span title="Departure clean — auto-reviewed" className="rounded-md w-5 h-5 text-[11px] font-bold leading-none bg-emerald-100 text-emerald-600 inline-flex items-center justify-center">✓</span>
          ) : canEdit ? (
            <button
              onClick={() => saveAdjust({ reviewed: !t.reviewedBy }, 'rev',
                { reviewedBy: t.reviewedBy ? null : 'you', reviewedAt: t.reviewedBy ? null : new Date().toISOString() })}
              title={t.reviewedBy ? 'Reviewed by ' + t.reviewedBy + (t.reviewedAt ? ' · ' + t.reviewedAt.slice(0, 10) : '') + ' — click to clear' : 'Mark this task reviewed (review as you go — no month-end audit)'}
              className={'rounded-md w-5 h-5 text-[11px] font-bold leading-none ' + (t.reviewedBy ? 'bg-emerald-500 text-white' : 'border border-line text-muted hover:text-emerald-600 hover:border-emerald-300')}>
              ✓
            </button>
          ) : (t.reviewedBy ? <span title={'Reviewed by ' + t.reviewedBy} className="rounded-md w-5 h-5 text-[11px] font-bold leading-none bg-emerald-500 text-white inline-flex items-center justify-center">✓</span> : null)}
          <a href={'https://app.breezeway.io/task/' + t.id} target="_blank" rel="noreferrer" title="Open this task in Breezeway"
            className="text-muted hover:text-brand-600"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
      </div>
      {open ? (
        <div className="px-10 pb-4 space-y-3">
          {err ? <div className="text-[12px] text-rose-600">{err}</div> : null}
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted font-bold">Task — full title &amp; description (saves to Breezeway)</div>
            <input value={title} onChange={e => setTitle(e.target.value)} disabled={!canEdit}
              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-semibold text-ink" />
            <textarea value={desc} onChange={e => setDesc(e.target.value)} disabled={!canEdit} rows={2}
              placeholder="Description of the work performed (shows in Breezeway and available for the owner sheet)"
              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
            <div className="flex items-center gap-2">
              <button onClick={() => post({ action: 'update', name: title, description: desc }, 'meta', { name: title, description: desc })}
                disabled={!canEdit || busy === 'meta' || !title.trim()}
                className="rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">
                {busy === 'meta' ? 'Saving…' : 'Save title & description to Breezeway'}
              </button>
              <button
                onClick={async () => {
                  setBusy('ai'); setErr(null)
                  try {
                    const r = await fetch('/api/billing/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: title, description: desc, department: t.department, unit: t.unit }) })
                    const j = await r.json().catch(() => ({}))
                    if (!r.ok || !j.ok) throw new Error(j.error || 'AI polish failed')
                    setTitle(j.title)
                    if (j.description) setDesc(j.description)
                  } catch (e: any) { setErr(String(e?.message || e)) }
                  setBusy(null)
                }}
                disabled={!canEdit || busy === 'ai'}
                title="Rewrite the tech's title/notes into a clean owner-facing service line — review, then save"
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">
                {busy === 'ai' ? 'Polishing…' : '✨ AI polish'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted font-bold">Rate</span>
            <input value={rate} onChange={e => setRate(e.target.value)} disabled={!canEdit} placeholder="0.00"
              className="w-24 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums" />
            <select value={rateType} onChange={e => setRateType(e.target.value)} disabled={!canEdit}
              className="rounded-lg border border-line px-2 py-1 text-[12.5px] bg-white">
              <option value="piece">flat (piece)</option>
              <option value="hourly">hourly</option>
            </select>
            <button onClick={saveRate} disabled={!canEdit || busy === 'rate'}
              className="rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">
              {busy === 'rate' ? 'Saving…' : 'Save to Breezeway'}
            </button>
            <span className="flex items-center gap-1.5 ml-2">
              <span className="text-[11px] text-muted">billed hours</span>
              <input value={billedH} onChange={e => setBilledH(e.target.value)} disabled={!canEdit} placeholder={t.actualMinutes != null ? (t.actualMinutes / 60).toFixed(2) : 'actual'}
                className="w-20 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums" />
              <button onClick={() => saveAdjust({ billed_hours: billedH }, 'bh')} disabled={!canEdit || busy === 'bh'} className="text-[12px] font-semibold text-brand-600">{busy === 'bh' ? 'Saving…' : 'Set'}</button>
            </span>
            <span className="grow" />
            <a href={'https://app.breezeway.io/task/' + t.id} target="_blank" rel="noreferrer" className="text-[12px] text-brand-600 font-semibold inline-flex items-center gap-1">Open in Breezeway <ExternalLink className="w-3 h-3" /></a>
            {t.reportUrl ? <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-600 font-semibold inline-flex items-center gap-1">Report <ExternalLink className="w-3 h-3" /></a> : null}
            <button onClick={refreshDetail} disabled={busy === 'detail'} className="text-[12px] text-muted font-semibold inline-flex items-center gap-1">
              <RefreshCw className={'w-3 h-3 ' + (busy === 'detail' ? 'animate-spin' : '')} /> Re-pull from Breezeway
            </button>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-bold mb-1">Line items</div>
            {t.items.length ? (
              <div className="space-y-1">
                {t.items.map(it => (
                  <div key={it.key} className="flex items-center gap-2 text-[12.5px]">
                    <span className={chip(it.kind === 'extra' ? 'bg-brand-50 text-brand-700 ring-brand-200' : it.kind === 'supply' ? 'bg-teal-50 text-teal-700 ring-teal-200' : 'bg-neutral-100 text-neutral-600 ring-neutral-200')}>{it.kind}</span>
                    <span className="text-ink">{it.description}</span>
                    {it.bill_to ? <span className="text-[11px] text-muted">→ {it.bill_to}</span> : null}
                    {it.originalAmount != null ? <span className="text-[11px] text-muted">was <span className="line-through tabular-nums">{money(it.originalAmount)}</span></span> : null}
                    <span className="grow" />
                    {canEdit ? (
                      <input
                        value={itemAmt[it.key] != null && itemAmt[it.key] !== '' ? itemAmt[it.key] : String(it.amount)}
                        onChange={e => setItemAmt(m => ({ ...m, [it.key]: e.target.value }))}
                        onBlur={() => saveItemAmount(it)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        title={it.kind === 'extra' ? 'Edit this line item amount' : 'Edit the billed amount — stored as our adjustment, Breezeway keeps the original'}
                        className={'w-20 rounded-lg border px-2 py-0.5 text-right text-[12.5px] tabular-nums font-semibold ' + (it.originalAmount != null ? 'border-brand-300 text-brand-700' : 'border-line')}
                      />
                    ) : (
                      <span className="tabular-nums font-semibold">{money(it.amount)}</span>
                    )}
                    {it.originalAmount != null && canEdit ? (
                      <button onClick={() => resetItem(it)} title="Reset to the Breezeway amount" className="text-[12px] text-muted hover:text-ink font-semibold">↺</button>
                    ) : null}
                    {it.kind === 'extra' && canEdit ? (
                      <button onClick={() => removeExtra(extras.indexOf(it))} className="text-muted hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-muted">{t.hasDetail ? 'No costs or supplies on this task.' : 'Billing detail not pulled yet — use Re-pull from Breezeway, or the Pull details button up top.'}</div>
            )}
            {canEdit ? (
              <div className="flex items-center gap-2 mt-2">
                <input value={extraDesc} onChange={e => setExtraDesc(e.target.value)} placeholder="Add a line item (ours only — not sent to Breezeway)"
                  className="grow max-w-sm rounded-lg border border-line px-2 py-1 text-[12.5px]" />
                <input value={extraAmt} onChange={e => setExtraAmt(e.target.value)} placeholder="0.00"
                  className="w-24 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums" />
                <button onClick={addExtra} disabled={!extraDesc.trim() || !Number(extraAmt) || busy === 'extra'}
                  className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">Add</button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={t.excluded} disabled={!canEdit}
                onChange={e => saveAdjust({ excluded: e.target.checked }, 'ex',
                  { excluded: e.target.checked, billedAmount: e.target.checked ? 0 : (t.overrideAmount != null ? t.overrideAmount : Math.round((t.laborAmount + itemsOwnerTotal) * 100) / 100) })} />
              Exclude from billing
            </label>
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted">override billed total</span>
              <input value={override} onChange={e => setOverride(e.target.value)} disabled={!canEdit} placeholder="auto"
                className="w-24 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums" />
              <button onClick={() => { const v = Number(override); saveAdjust({ override_amount: override }, 'ov', Number.isFinite(v) && override !== '' ? { overrideAmount: v, billedAmount: t.excluded ? 0 : v } : undefined) }} disabled={!canEdit || busy === 'ov'} className="text-[12px] font-semibold text-brand-600">Set</button>
            </span>
            <input value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if ((t.note || '') !== note) saveAdjust({ note }, 'note', { note }) }}
              disabled={!canEdit} placeholder="Billing note (shows on the export)"
              className="grow min-w-[200px] rounded-lg border border-line px-2 py-1 text-[12.5px]" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Labor tab ───────────────────────────────────────────────────────────────
type PersonRow = { crew?: 'inhouse' | 'vendor' | null; key: string; tasks: number; completed: number; minutes: number; billed: number; depts: Record<string, number> }

function LaborView({ tasks, rates, canEdit, onRates, month }: { tasks: Task[]; rates: Record<string, number>; canEdit: boolean; onRates: (r: Record<string, number>) => void; month: string }) {
  // Real wages from Homebase for the month - billable vs wages is the true margin.
  // Wages come from the same crew roster the labor board uses (lib/crew), so "maintenance wages"
  // here means the declared maintenance crew — not whoever happened to have the word maintenance
  // typed in their Homebase role, which is blank for half of them.
  const [wages, setWages] = useState<{ maintenance: number; housekeeping: number; supervision: number; total: number } | null>(null)
  useEffect(() => {
    let dead = false
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    fetch('/api/labor/kpi?from=' + month + '-01&to=' + month + '-' + String(lastDay).padStart(2, '0'), { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!dead && j && j.ok) setWages({ maintenance: j.departments?.maintenance?.payroll ?? 0, housekeeping: j.departments?.housekeeping?.payroll ?? 0, supervision: j.departments?.supervision?.payroll ?? 0, total: (j.payroll && j.payroll.actual) || 0 }) })
      .catch(() => { /* wages tile just shows a dash */ })
    return () => { dead = true }
  }, [month])
  const [dept, setDept] = useState<string>('maintenance')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const people = useMemo(() => {
    const map: Record<string, PersonRow> = {}
    for (const t of tasks) {
      if (t.excluded) continue
      if (dept !== 'all' && t.department !== dept) continue
      const names = t.assignees.map(a => (a.name || '').trim()).filter(Boolean)
      const who = names.length ? names : (t.finishedBy ? [t.finishedBy] : [])
      if (!who.length) continue
      const share = 1 / who.length
      const done = /complet|close|approv|finish/.test(t.status)
      for (const n of who) {
        if (!map[n]) map[n] = { key: n, crew: t.crew ?? null, tasks: 0, completed: 0, minutes: 0, billed: 0, depts: {} }
        const p = map[n]
        if (!p.crew && t.crew) p.crew = t.crew
        p.tasks += 1
        if (done) p.completed += 1
        p.minutes += (t.actualMinutes || 0) * share
        p.billed += t.laborAmount * share
        p.depts[t.department] = (p.depts[t.department] || 0) + 1
      }
    }
    return Object.keys(map).map(k => map[k]).sort((a, b) => b.minutes - a.minutes)
  }, [tasks, dept])

  const totals = useMemo(() => {
    let costInhouse = 0, costVendor = 0
    let minutes = 0; let billed = 0; let cost = 0
    for (const p of people) {
      minutes += p.minutes; billed += p.billed
      const r = Number(draft[p.key] != null ? draft[p.key] : rates[p.key])
      if (Number.isFinite(r)) {
        const c0 = (p.minutes / 60) * r
        cost += c0
        if (p.crew === 'vendor') costVendor += c0; else costInhouse += c0
      }
    }
    return { minutes, billed, cost, costInhouse, costVendor }
  }, [people, rates, draft])

  const saveRates = async () => {
    setSaving(true)
    const next: Record<string, number> = { ...rates }
    for (const k of Object.keys(draft)) {
      const n = Number(draft[k])
      if (Number.isFinite(n) && n > 0) next[k] = n
      else if (draft[k] === '') delete next[k]
    }
    try {
      const r = await fetch('/api/billing/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates: next }) })
      const j = await r.json().catch(() => ({}))
      if (j.ok) { onRates(j.rates); setDraft({}) }
    } catch { /* keep draft for retry */ }
    setSaving(false)
  }

  const DEPTS = ['maintenance', 'housekeeping', 'inspection', 'safety', 'all']
  const wagesFor = wages ? (dept === 'maintenance' ? wages.maintenance : dept === 'housekeeping' ? wages.housekeeping : wages.total) : null
  const wagesNote = dept === 'maintenance' ? 'declared maintenance crew' : dept === 'housekeeping' ? 'housekeepers only' : 'whole team this month'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {DEPTS.map(d => (
          <button key={d} onClick={() => setDept(d)}
            className={'rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ring-inset ' + (dept === d ? 'bg-ink text-white ring-ink' : 'bg-white text-muted ring-line hover:text-ink')}>
            {d === 'all' ? 'All departments' : d}
          </button>
        ))}
        <span className="grow" />
        {Object.keys(draft).length ? (
          <button onClick={saveRates} disabled={saving || !canEdit}
            className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Save rates'}</button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Actual hours" value={(totals.minutes / 60).toFixed(1) + 'h'} sub="Breezeway time on task" />
        <Kpi label="Billable labor" value={money(totals.billed)} sub="rate math on these tasks" />
        <Kpi label="Labor cost" value={money(totals.cost)} sub={money(totals.costInhouse) + ' in-house · ' + money(totals.costVendor) + ' vendor'} />
        <Kpi label="Margin" value={money(totals.billed - totals.cost)} sub={totals.cost > 0 ? Math.round(((totals.billed - totals.cost) / totals.cost) * 100) + '% over cost' : 'set rates below'} />
        <Kpi label="Wages · Homebase" value={wagesFor != null ? money(wagesFor) : '—'} sub={wagesNote} />
        <Kpi label="Billable vs wages" value={wagesFor != null ? money(totals.billed - wagesFor) : '—'} sub="charges entered − payroll" />
      </div>
      <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10.5px] uppercase tracking-wide text-muted font-bold border-b border-line">
          <div className="col-span-3">Person</div>
          <div className="col-span-2 text-right">Tasks (done)</div>
          <div className="col-span-2 text-right">Actual hours</div>
          <div className="col-span-2 text-right">Billable labor</div>
          <div className="col-span-1 text-right">$/h rate</div>
          <div className="col-span-2 text-right">Cost · margin</div>
        </div>
        {people.map(p => {
          const rate = draft[p.key] != null ? draft[p.key] : (rates[p.key] != null ? String(rates[p.key]) : '')
          const rNum = Number(rate)
          const cost = Number.isFinite(rNum) && rate !== '' ? (p.minutes / 60) * rNum : null
          const margin = cost != null ? p.billed - cost : null
          return (
            <div key={p.key} className="grid grid-cols-12 gap-2 px-4 py-2 text-[12.5px] items-center border-t border-line">
              <div className="col-span-3 min-w-0">
                <div className="font-semibold text-ink truncate">{p.key}</div>
                <div className="text-[11px] text-muted truncate">{Object.keys(p.depts).map(d => d + ' ' + p.depts[d]).join(' · ')}</div>
              </div>
              <div className="col-span-2 text-right tabular-nums">{p.tasks} <span className="text-muted">({p.completed})</span></div>
              <div className="col-span-2 text-right tabular-nums">{(p.minutes / 60).toFixed(1)}h</div>
              <div className="col-span-2 text-right tabular-nums font-semibold">{money(p.billed)}</div>
              <div className="col-span-1 text-right">
                <input value={rate} disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, [p.key]: e.target.value }))}
                  placeholder="—" className="w-16 rounded-lg border border-line px-1.5 py-0.5 text-right text-[12px] tabular-nums" />
              </div>
              <div className="col-span-2 text-right tabular-nums">
                {cost != null ? (
                  <span>{money(cost)} <span className={margin != null && margin < 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>{margin != null ? (margin >= 0 ? '+' : '') + money(margin).replace('$', '$') : ''}</span></span>
                ) : <span className="text-muted">set rate</span>}
              </div>
            </div>
          )
        })}
        {!people.length ? <div className="px-4 py-8 text-center text-[12.5px] text-muted">No one has time on task for this filter yet.</div> : null}
      </div>
      <p className="text-[11.5px] text-muted">Actual hours come from the crew&apos;s Start/Complete taps in Breezeway (total time on task). When a task has several assignees, its time and billable labor are split evenly between them. Rates are what YOU pay per hour (loaded) — they stay in this app.</p>
    </div>
  )
}

// ── Board ───────────────────────────────────────────────────────────────────
export function BillingBoard() {
  const acc = useAccess()
  const canEdit = acc.atLeast('billing', 'edit')
  const [month, setMonth] = useState(etMonth())
  // CUSTOM DATE WINDOW (Jon, 2026-08-10: "make this date selection as well"). The month arrows
  // stay the default because month-end billing is the common case; ticking Custom swaps them for
  // a from/to pair so the same board can answer "this pay period" or "this quarter".
  const [rangeOn, setRangeOn] = useState(false)
  const [rFrom, setRFrom] = useState('')
  const [rTo, setRTo] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState<'owner' | 'all' | 'labor'>('owner')
  const [dept, setDept] = useState('all')
  const [billableOnly, setBillableOnly] = useState(true)
  // Billing is for FINISHED work — open/scheduled tasks stay hidden unless asked for.
  const [completedOnly, setCompletedOnly] = useState(true)
  const [showExcluded, setShowExcluded] = useState(false)
  // Review workflow (Jon): marking a task ✓ MOVES it from "To review" to "Reviewed" — the board
  // is a daily/weekly worklist, not a month-end audit. Default = the work that still needs eyes.
  const [reviewFilter, setReviewFilter] = useState<'todo' | 'done' | 'all'>('todo')
  const [translating, setTranslating] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [openOwners, setOpenOwners] = useState<Record<string, boolean>>({})
  const [pulling, setPulling] = useState<{ done: number; total: number } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  // Sorting — applies inside each owner group AND to the flat All-tasks view.
  const [sortKey, setSortKey] = useState<'date' | 'unit' | 'amount' | 'hours' | 'task'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [ownerSort, setOwnerSort] = useState<'billed' | 'name' | 'tasks' | 'hours'>('billed')
  // Bulk selection — tick tasks (or a whole owner group) then act on all of them at once.
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [bulk, setBulk] = useState<{ doing: string; done: number; total: number } | null>(null)
  const [bulkRate, setBulkRate] = useState('')
  const [bulkRateType, setBulkRateType] = useState('hourly')
  const [bulkAmt, setBulkAmt] = useState('')
  const [rateDraft, setRateDraft] = useState<string | null>(null)

  // One query string for every fetch on this board, so the tiles, the table below them and the
  // task list can never be looking at different windows.
  const winQS = (rangeOn && rFrom && rTo && rFrom <= rTo)
    ? 'from=' + rFrom + '&to=' + rTo + '&month=' + month
    : 'month=' + month
  const load = useCallback(async (qs: string, quiet?: boolean) => {
    if (!quiet) { setLoading(true); setErr(null) }
    try {
      const r = await fetch('/api/billing?' + qs)
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Load failed')
      setData(j)
    } catch (e: any) { if (!quiet) setErr(String(e?.message || e)) }
    if (!quiet) setLoading(false)
  }, [])
  useEffect(() => { load(winQS) }, [winQS, load])
  const reload = useCallback(() => load(winQS), [load, winQS])
  // Optimistic editing: patch one task locally (row + totals move instantly, nothing jumps),
  // then a debounced QUIET refetch trues the board up against the server.
  const patchTask = useCallback((id: string, p: Partial<Task>) => {
    setData(d => d ? { ...d, tasks: d.tasks.map(t => t.id === id ? { ...t, ...p } : t) } : d)
  }, [])
  const syncTimer = useRef<any>(null)
  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => { load(winQS, true) }, 1200)
  }, [load, winQS])

  const pullDetails = useCallback(async () => {
    if (!data) return
    let total = data.missingDetail
    let done = 0
    setPulling({ done, total })
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fetch('/api/billing/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) break
        done += Number(j.done || 0)
        setPulling({ done, total })
        if (!j.remaining) break
      } catch { break }
    }
    setPulling(null)
    reload()
  }, [data, month, reload])

  const filtered = useMemo(() => {
    if (!data) return [] as Task[]
    const needle = q.trim().toLowerCase()
    return data.tasks.filter(t => {
      if (!showExcluded && t.excluded) return false
      // Completed-only keeps manually billed tasks (override set) — an added flat fee is a
      // deliberate billable even while its Breezeway task is still open.
      if (completedOnly && !(/complet|close|approv|finish/.test(t.status) || t.finishedAt || t.overrideAmount != null)) return false
      if (dept !== 'all' && t.department !== dept) return false
      if (reviewFilter === 'todo' && t.reviewedBy) return false
      if (reviewFilter === 'done' && !t.reviewedBy) return false
      // Jon's rule: the billable view is tasks with a VALUE — anything over $0 goes on the owner
      // statement; the $0 rows are noise here (they still show with the toggle off).
      if (billableOnly && !(t.billedAmount > 0)) return false
      if (needle) {
        const hay = (t.name + ' ' + t.unit + ' ' + (t.building || '') + ' ' + t.ownerName + ' ' + t.assignees.map(a => a.name).join(' ')).toLowerCase()
        if (hay.indexOf(needle) < 0) return false
      }
      return true
    })
  }, [data, dept, billableOnly, completedOnly, showExcluded, reviewFilter, q])

  // Counts for the To review / Reviewed switch — same filters, ignoring the review split itself.
  const reviewCounts = useMemo(() => {
    if (!data) return { todo: 0, done: 0 }
    const needle = q.trim().toLowerCase()
    let todo = 0; let done = 0
    for (const t of data.tasks) {
      if (!showExcluded && t.excluded) continue
      if (completedOnly && !(/complet|close|approv|finish/.test(t.status) || t.finishedAt || t.overrideAmount != null)) continue
      if (dept !== 'all' && t.department !== dept) continue
      if (billableOnly && !(t.billedAmount > 0)) continue
      if (needle) {
        const hay = (t.name + ' ' + t.unit + ' ' + (t.building || '') + ' ' + t.ownerName + ' ' + t.assignees.map(a => a.name).join(' ')).toLowerCase()
        if (hay.indexOf(needle) < 0) continue
      }
      if (t.reviewedBy) done++; else todo++
    }
    return { todo, done }
  }, [data, dept, billableOnly, completedOnly, showExcluded, q])

  const cmpTasks = useCallback((a: Task, b: Task) => {
    let r = 0
    if (sortKey === 'date') r = String(a.scheduledDate || (a.finishedAt || '').slice(0, 10)).localeCompare(String(b.scheduledDate || (b.finishedAt || '').slice(0, 10)))
    else if (sortKey === 'unit') r = a.unit.localeCompare(b.unit)
    else if (sortKey === 'amount') r = a.billedAmount - b.billedAmount
    else if (sortKey === 'hours') r = (a.actualMinutes || 0) - (b.actualMinutes || 0)
    else r = a.name.localeCompare(b.name)
    if (r === 0) r = a.unit.localeCompare(b.unit)
    return sortDir === 'asc' ? r : -r
  }, [sortKey, sortDir])

  const sortedFlat = useMemo(() => filtered.slice().sort(cmpTasks), [filtered, cmpTasks])

  const byOwner = useMemo(() => {
    const map: Record<string, { g: { ownerId: string | null; ownerName: string }; tasks: Task[]; billed: number; minutes: number }> = {}
    for (const t of filtered) {
      const k = t.ownerId || '—'
      if (!map[k]) map[k] = { g: { ownerId: t.ownerId, ownerName: t.ownerName }, tasks: [], billed: 0, minutes: 0 }
      map[k].tasks.push(t)
      map[k].billed += t.billedAmount
      map[k].minutes += t.actualMinutes || 0
    }
    const groups = Object.keys(map).map(k => map[k])
    for (const g of groups) g.tasks.sort(cmpTasks)
    groups.sort((a, b) => {
      if (ownerSort === 'name') return a.g.ownerName.localeCompare(b.g.ownerName)
      if (ownerSort === 'tasks') return b.tasks.length - a.tasks.length
      if (ownerSort === 'hours') return b.minutes - a.minutes
      return b.billed - a.billed
    })
    return groups
  }, [filtered, cmpTasks, ownerSort])

  // ---- bulk actions over the current selection ----
  const selIds = useMemo(() => Object.keys(sel).filter(k => sel[k]), [sel])
  const toggleSel = useCallback((id: string) => setSel(s => ({ ...s, [id]: !s[id] })), [])
  const setMany = useCallback((ids: string[], on: boolean) => setSel(s => {
    const next = { ...s }
    for (const id of ids) next[id] = on
    return next
  }), [])

  // Review / close-out: an owner marked reviewed for the month moves to the "ready to download"
  // section — the sign-off that their billables are checked and statement-ready.
  const reviews = (data && data.reviews) || {}
  const toggleReview = useCallback(async (ownerKey: string, reviewed: boolean) => {
    try {
      const r = await fetch('/api/billing/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, ownerId: ownerKey, reviewed }) })
      const j = await r.json().catch(() => ({}))
      if (j.ok) setData(d => d ? { ...d, reviews: j.reviews } : d)
    } catch { /* board still works without the flag */ }
  }, [month])

  const runBulk = useCallback(async (label: string, body: (id: string) => any) => {
    setBulk({ doing: label, done: 0, total: selIds.length })
    for (let i = 0; i < selIds.length; i++) {
      try {
        await fetch('/api/billing/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: selIds[i], ...body(selIds[i]) }) })
      } catch { /* keep going — reload shows the truth */ }
      setBulk({ doing: label, done: i + 1, total: selIds.length })
    }
    setBulk(null)
    setSel({})
    reload()
  }, [selIds, reload])

  const kpis = useMemo(() => {
    let billed = 0; let labor = 0; let items = 0; let minutes = 0
    for (const t of filtered) {
      billed += t.billedAmount
      if (!t.excluded) {
        labor += t.laborAmount
        items += t.items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0)
      }
      minutes += t.actualMinutes || 0
    }
    return { billed, labor, items, minutes }
  }, [filtered])

  const exportUrl = (format: string, ownerId?: string | null) =>
    '/api/billing/export?' + winQS + '&format=' + format + (completedOnly ? '&done=1' : '') + (ownerId ? '&owner=' + encodeURIComponent(ownerId) : '')

  const DEPTS = ['all', 'maintenance', 'housekeeping', 'inspection', 'safety']

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Money</div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Billable Hours</h1>
          <p className="text-[12.5px] text-muted mt-0.5">Breezeway tasks organized for billing — review the cost, fix the rate, export by billing owner.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* DATE WINDOW. Months by default because that is how owners are billed; Custom opens a
              from/to pair for a week, a pay period or a quarter. Everything on the page — tiles,
              market table, task list, exports — reads the same window. */}
          {rangeOn ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-brand-300 bg-white shadow-soft px-2 py-1">
              <input type="date" value={rFrom} max={rTo || undefined} onChange={e => setRFrom(e.target.value)}
                className="text-[12.5px] font-semibold text-ink bg-transparent focus:outline-none" aria-label="From date" />
              <span className="text-muted text-[12px]">to</span>
              <input type="date" value={rTo} min={rFrom || undefined} onChange={e => setRTo(e.target.value)}
                className="text-[12.5px] font-semibold text-ink bg-transparent focus:outline-none" aria-label="To date" />
              <button onClick={() => setRangeOn(false)} title="Back to whole months"
                className="ml-1 text-muted hover:text-ink"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden">
              <button className="px-2.5 py-1.5 text-muted hover:text-ink" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
              <span className="px-2 text-[12.5px] font-semibold text-ink whitespace-nowrap">{monthLabel(month)}</span>
              <button className="px-2.5 py-1.5 text-muted hover:text-ink" onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month">›</button>
            </div>
          )}
          {!rangeOn ? (
            <button onClick={() => { const r = monthEdges(month); setRFrom(r.from); setRTo(r.to); setRangeOn(true) }}
              title="Pick any date range instead of a whole month"
              className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft">
              Custom range
            </button>
          ) : null}
          <button onClick={reload} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
          </button>
          {canEdit ? (
            <button onClick={() => setAddOpen(v => !v)} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft">
              + Add task
            </button>
          ) : null}
          {canEdit ? (
            <button
              onClick={async () => {
                if (translating) return
                setTranslating('Translating…')
                let total = 0
                for (let i = 0; i < 6; i++) {
                  try {
                    const r = await fetch('/api/billing/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) })
                    const j = await r.json().catch(() => ({}))
                    if (!r.ok || !j.ok) break
                    total += Number(j.translated || 0)
                    setTranslating('Translated ' + total + (j.remaining ? '… (' + j.remaining + ' left)' : ''))
                    if (!j.remaining) break
                  } catch { break }
                }
                setTranslating(null)
                reload()
              }}
              title="Find Spanish task titles this month, translate them to English with AI, and update the Breezeway tasks"
              className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft disabled:opacity-50" disabled={!!translating}>
              {translating || 'ES→EN titles'}
            </button>
          ) : null}
          <a href={exportUrl('csv')} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a href={exportUrl('xls')} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Excel by owner
          </a>
          <a href={exportUrl('zip')} title="One billable-labor sheet per owner, named for the owner, zipped"
            className="rounded-xl bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> All owners (ZIP)
          </a>
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      {addOpen && data ? <AddTask units={data.units || []} month={month} onDone={() => { setAddOpen(false); reload() }} /> : null}

      {/* THE ROW (Jon, 2026-08-10: "labor should be payroll"). The old Labor tile multiplied a
          Breezeway rate by hours and read $0.00 on every single task, because not one task in
          the system carries a rate — it was a tile that could never say anything. It is replaced
          by the three numbers that actually decide whether this work makes money: what we can
          bill for the labor, what the crew cost us, and the gap. Every tile covers the SELECTED
          WINDOW, not the filtered view, so nothing on this screen is scoped differently to
          anything else on it. */}
      {(() => {
        const mp = data && data.maintenancePayroll ? data.maintenancePayroll : null
        const winLabel = data && data.custom
          ? new Date(String(data.from) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            + ' – ' + new Date(String(data.to) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : new Date(String(data?.month || month) + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        const margin = mp ? mp.billed - mp.cost : null
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Billed to owners" value={money(kpis.billed)} sub={filtered.length + ' tasks in view'} />
            <Kpi label="Billable" value={mp ? money(mp.billed) : '—'}
              sub={mp ? mp.tasksWithBilling + ' of ' + mp.tasks + ' tasks carry a cost' : 'no maintenance data'} />
            <Kpi label="Payroll" value={mp ? money(mp.cost) : '—'}
              sub={mp ? mp.hours + 'h clocked · ' + mp.people + (mp.people === 1 ? ' person' : ' people') : 'Homebase unavailable'} />
            <Kpi label="Labor margin" value={margin == null ? '—' : (margin < 0 ? '−' : '') + money(Math.abs(margin))}
              sub={winLabel} tone={margin == null ? undefined : margin < 0 ? 'bad' : 'good'} />
            <Kpi label="Costs + supplies" value={money(kpis.items)} sub="owner-billable line items" />
            <Kpi label="Actual hours" value={(kpis.minutes / 60).toFixed(1) + 'h'} sub="time on task (crew taps)" />
          </div>
        )
      })()}

      {/* Coverage caveat + the per-market split. The summary strip that used to sit here is gone —
          its numbers are the tiles above now, and repeating them was the only thing it did. */}
      {data && data.maintenancePayroll ? (() => {
        const mp = data.maintenancePayroll!
        const noTime = mp.tasks - mp.tasksWithTime
        const pct = mp.hours > 0 ? Math.round((mp.hoursOnTask / mp.hours) * 100) : null
        return (
          <div className="rounded-xl border border-line bg-white px-4 py-3">
            {(noTime > 0 || (pct != null && pct < 90)) && (
              <div className="mb-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {mp.tasks > mp.tasksWithBilling ? <><b>{mp.tasks - mp.tasksWithBilling}</b> of {mp.tasks} maintenance tasks have no cost entered in Breezeway, so they bill the owner nothing. </> : null}
                {pct != null ? <>Only <b>{mp.hoursOnTask}h</b> of the crew&apos;s <b>{mp.hours}h</b> clocked ({pct}%) landed on a task {'\u2014'} read the margin above as a floor, not a verdict.</> : null}
              </div>
            )}
            {(data.maintenanceByMarket || []).length > 0 && (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted">
                    <th className="text-left font-semibold py-1">Market</th>
                    <th className="text-right font-semibold py-1">Tasks</th>
                    <th className="text-right font-semibold py-1">Hours on task</th>
                    <th className="text-right font-semibold py-1">Billed</th>
                    <th className="text-right font-semibold py-1">Tasks w/ cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.maintenanceByMarket || []).map(r => (
                    <tr key={r.market} className="border-t border-line/60">
                      <td className="py-1 font-semibold text-ink">{r.market}</td>
                      <td className="py-1 text-right tabular-nums text-muted" title={r.tasksWithTime + ' with time logged'}>{r.tasks}<span className="text-[10px]"> ({r.tasksWithTime} timed)</span></td>
                      <td className="py-1 text-right tabular-nums text-muted">{(r.minutes / 60).toFixed(1)}h</td>
                      <td className="py-1 text-right tabular-nums font-semibold">${Math.round(r.billed).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{r.tasksWithBilling} of {r.tasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })() : null}

      {data && data.missingDetail > 0 && canEdit ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-[12.5px] text-amber-800">
            <strong>{data.missingDetail}</strong> tasks this month have no billing detail yet (costs, supplies and bill-to live on the per-task pull).
          </span>
          <button onClick={pullDetails} disabled={!!pulling}
            className="rounded-lg bg-amber-600 text-white px-3 py-1 text-[12px] font-semibold disabled:opacity-50">
            {pulling ? 'Pulling… ' + pulling.done + '/' + pulling.total : 'Pull details from Breezeway'}
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-white shadow-soft px-3 py-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-line bg-neutral-50 overflow-hidden">
          {(['owner', 'all', 'labor'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={'px-3 py-1.5 text-[12.5px] font-semibold ' + (view === v ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              {v === 'owner' ? 'By owner' : v === 'all' ? 'All tasks' : 'Labor'}
            </button>
          ))}
        </div>
        {view !== 'labor' ? (
          <>
            {DEPTS.map(d => (
              <button key={d} onClick={() => setDept(d)}
                className={'rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ring-inset ' + (dept === d ? 'bg-ink text-white ring-ink' : 'bg-white text-muted ring-line hover:text-ink')}>
                {d === 'all' ? 'All departments' : d}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={completedOnly} onChange={e => setCompletedOnly(e.target.checked)} /> Completed only
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={billableOnly} onChange={e => setBillableOnly(e.target.checked)} /> Billable only
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)} /> Show excluded
            </label>
            <span className="flex items-center rounded-xl border border-line bg-neutral-50 overflow-hidden" title="Marking a task ✓ moves it from To review into Reviewed">
              <button onClick={() => setReviewFilter('todo')}
                className={'px-2.5 py-1 text-[12px] font-semibold ' + (reviewFilter === 'todo' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink')}>
                To review{reviewCounts.todo ? ' · ' + reviewCounts.todo : ''}
              </button>
              <button onClick={() => setReviewFilter('done')}
                className={'px-2.5 py-1 text-[12px] font-semibold ' + (reviewFilter === 'done' ? 'bg-emerald-600 text-white' : 'text-muted hover:text-ink')}>
                Reviewed{reviewCounts.done ? ' · ' + reviewCounts.done : ''}
              </button>
              <button onClick={() => setReviewFilter('all')}
                className={'px-2.5 py-1 text-[12px] font-semibold ' + (reviewFilter === 'all' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                All
              </button>
            </span>
            <span className="flex items-center gap-1 text-[12px] text-muted">
              Sort
              <select value={sortKey} onChange={e => setSortKey(e.target.value as any)} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[12px]">
                <option value="date">date</option>
                <option value="unit">unit</option>
                <option value="amount">billed $</option>
                <option value="hours">hours</option>
                <option value="task">task name</option>
              </select>
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} title="Flip sort direction"
                className="rounded-lg border border-line bg-white px-1.5 py-1 font-semibold">{sortDir === 'asc' ? '↑' : '↓'}</button>
            </span>
            {view === 'owner' ? (
              <span className="flex items-center gap-1 text-[12px] text-muted">
                Owners by
                <select value={ownerSort} onChange={e => setOwnerSort(e.target.value as any)} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[12px]">
                  <option value="billed">billed $</option>
                  <option value="name">name</option>
                  <option value="tasks">tasks</option>
                  <option value="hours">hours</option>
                </select>
              </span>
            ) : null}
            {canEdit ? (
              <span className="flex items-center gap-1 text-[12px] text-muted" title="Your standard hourly charge — prefills every rate box">
                Charge $
                <input
                  value={rateDraft != null ? rateDraft : (data && data.defaultRate != null ? String(data.defaultRate) : '40')}
                  onChange={e => setRateDraft(e.target.value)}
                  onBlur={async () => {
                    if (rateDraft == null) return
                    const n = Number(rateDraft)
                    if (Number.isFinite(n) && n >= 0 && n !== data?.defaultRate) {
                      try {
                        const r = await fetch('/api/billing/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultRate: n }) })
                        const j = await r.json().catch(() => ({}))
                        if (j.ok) setData(d => d ? { ...d, defaultRate: n } : d)
                      } catch { /* keep draft */ }
                    }
                    setRateDraft(null)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="w-12 rounded-lg border border-line bg-white px-1.5 py-1 text-right tabular-nums"
                />/h
              </span>
            ) : null}
            <span className="grow" />
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit, task, owner, person…"
                className="rounded-xl border border-line bg-white pl-8 pr-3 py-1.5 text-[12.5px] w-56 shadow-soft" />
            </div>
          </>
        ) : null}
      </div>

      {canEdit && selIds.length > 0 && view !== 'labor' ? (
        <div className="sticky top-2 z-10 rounded-2xl border border-brand-200 bg-brand-50/95 backdrop-blur px-4 py-2.5 flex items-center gap-3 flex-wrap shadow-soft">
          <span className="text-[12.5px] font-bold text-ink">{selIds.length} selected</span>
          {bulk ? (
            <span className="text-[12.5px] text-muted">{bulk.doing}… {bulk.done}/{bulk.total}</span>
          ) : (
            <>
              <button onClick={() => runBulk('Reviewing', () => ({ action: 'adjust', reviewed: true }))}
                className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[12px] font-semibold">✓ Mark reviewed</button>
              <button onClick={() => runBulk('Excluding', () => ({ action: 'adjust', excluded: true }))}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold">Exclude from billing</button>
              <button onClick={() => runBulk('Including', () => ({ action: 'adjust', excluded: false }))}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold">Include</button>
              <span className="flex items-center gap-1.5">
                <input value={bulkAmt} onChange={e => setBulkAmt(e.target.value)} placeholder="Amount 0.00"
                  className="w-28 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums bg-white" />
                <button onClick={() => {
                  const v = Number(bulkAmt)
                  if (Number.isFinite(v) && v >= 0 && bulkAmt !== '') {
                    const h = Math.round((v / ((data && data.defaultRate) || 40)) * 100) / 100
                    runBulk('Setting amount on', () => ({ action: 'adjust', override_amount: v, billed_hours: h }))
                  }
                }} disabled={bulkAmt === ''}
                  title="Overwrite the billed total on every selected task (hours follow at the charge rate)"
                  className="rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">Set amount</button>
              </span>
              <span className="flex items-center gap-1.5">
                <input value={bulkRate} onChange={e => setBulkRate(e.target.value)} placeholder={data && data.defaultRate != null ? 'Rate ' + data.defaultRate : 'Rate 0.00'}
                  className="w-24 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums bg-white" />
                <select value={bulkRateType} onChange={e => setBulkRateType(e.target.value)} className="rounded-lg border border-line px-1.5 py-1 text-[12px] bg-white">
                  <option value="piece">flat</option>
                  <option value="hourly">hourly</option>
                </select>
                <button onClick={() => { if (Number(bulkRate) >= 0 && bulkRate !== '') runBulk('Setting rate on', () => ({ action: 'update', rate_paid: bulkRate, rate_type: bulkRateType })) }}
                  disabled={bulkRate === ''}
                  className="rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">Set rate → Breezeway</button>
              </span>
              <span className="grow" />
              <button onClick={() => setSel({})} className="text-[12px] text-muted font-semibold">Clear</button>
            </>
          )}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-[13px] text-muted">Loading the month…</div>
      ) : null}

      {view === 'labor' && data ? (
        /* Always the FULL window — the board's search/owner/status filters used to leak in here
           silently, so the Labor tab's totals changed with whatever was typed in the filter bar. */
        <LaborView tasks={data.tasks} rates={data.laborRates || {}} canEdit={canEdit} month={month}
          onRates={r => setData(d => d ? { ...d, laborRates: r } : d)} />
      ) : null}

      {view === 'all' && data ? (
        <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
          <ColsHeader withUnit />
          {sortedFlat.map(t => <TaskRow key={t.id} t={t} canEdit={canEdit} onPatch={patchTask} onSync={scheduleSync} defaultRate={data.defaultRate} showUnit
            selected={!!sel[t.id]} onSelect={canEdit ? () => toggleSel(t.id) : undefined} />)}
          {!sortedFlat.length && !loading ? <div className="px-4 py-8 text-center text-[12.5px] text-muted">Nothing matches this filter.</div> : null}
        </div>
      ) : null}

      {view === 'owner' && data ? (
        <div className="space-y-3">
          {byOwner.filter(o => !reviews[o.g.ownerId || 'unassigned']).map(o => {
            const k = o.g.ownerId || '—'
            const rk = o.g.ownerId || 'unassigned'
            const open = openOwners[k] !== false
            const allSel = o.tasks.length > 0 && o.tasks.every(t => sel[t.id])
            const unitMap: Record<string, Task[]> = {}
            for (const t of o.tasks) { if (!unitMap[t.unit]) unitMap[t.unit] = []; unitMap[t.unit].push(t) }
            const unitKeys = Object.keys(unitMap).sort((a, b) => a.localeCompare(b))
            const revCount = o.tasks.filter(t => t.reviewedBy).length
            return (
              <div key={k} className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  {canEdit ? <input type="checkbox" checked={allSel} onChange={e => setMany(o.tasks.map(t => t.id), e.target.checked)}
                    title="Select every task for this owner" aria-label="Select all tasks for this owner" className="accent-ink" /> : null}
                  <span className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 font-bold text-[12px] inline-flex items-center justify-center shrink-0">{initials(o.g.ownerName)}</span>
                  <button onClick={() => setOpenOwners(s => ({ ...s, [k]: !open }))} className="flex items-center gap-2 min-w-0 text-left">
                    {open ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                    <span className="min-w-0">
                      <span className="font-bold text-ink block truncate">{o.g.ownerName}</span>
                      <span className="text-[11px] text-muted block">{unitKeys.length} unit{unitKeys.length === 1 ? '' : 's'} · {o.tasks.length} tasks · {hours(o.minutes)} · <span className={revCount === o.tasks.length && o.tasks.length ? 'text-emerald-600 font-semibold' : ''}>{revCount}/{o.tasks.length} reviewed</span></span>
                    </span>
                  </button>
                  <span className="grow" />
                  <span className="font-bold text-ink tabular-nums text-[15px]">{money(o.billed)}</span>
                  {o.g.ownerId ? (
                    <a href={exportUrl('xls', o.g.ownerId)} className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] text-brand-600 font-semibold inline-flex items-center gap-1">
                      <Download className="w-3 h-3" /> Export
                    </a>
                  ) : null}
                  {canEdit ? (
                    <button onClick={() => toggleReview(rk, true)} title="Sign off this owner for the month — moves them to Ready to download"
                      className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[12px] font-semibold inline-flex items-center gap-1">
                      <Check className="w-3 h-3" /> Mark reviewed
                    </button>
                  ) : null}
                </div>
                {open ? <ColsHeader /> : null}
                {open ? unitKeys.map(u => {
                  const ts = unitMap[u]
                  const unitTotal = ts.reduce((s, t) => s + t.billedAmount, 0)
                  const building = ts[0] && ts[0].building
                  return (
                    <div key={u}>
                      <div className="px-4 py-1.5 flex items-center gap-2 border-t border-line bg-neutral-50/70">
                        <span className="text-[12px] font-bold text-ink">{u}</span>
                        {building ? <span className="text-[11px] text-muted">{building}</span> : null}
                        <span className="text-[11px] text-muted">· {ts.length} task{ts.length === 1 ? '' : 's'}</span>
                        <span className="grow" />
                        <span className="text-[12px] font-semibold text-ink tabular-nums">{money(unitTotal)}</span>
                        <span className="w-[104px]" />
                      </div>
                      {ts.map(t => <TaskRow key={t.id} t={t} canEdit={canEdit} onPatch={patchTask} onSync={scheduleSync} defaultRate={data.defaultRate}
                        selected={!!sel[t.id]} onSelect={canEdit ? () => toggleSel(t.id) : undefined} />)}
                    </div>
                  )
                }) : null}
              </div>
            )
          })}
          {!byOwner.length && !loading ? <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-[12.5px] text-muted">Nothing matches this filter.</div> : null}

          {byOwner.some(o => reviews[o.g.ownerId || 'unassigned']) ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-emerald-200">
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="font-bold text-emerald-800">Reviewed &amp; closed out — ready to download</span>
                <span className="text-[11.5px] text-emerald-700">{byOwner.filter(o => reviews[o.g.ownerId || 'unassigned']).length} owners · {money(byOwner.filter(o => reviews[o.g.ownerId || 'unassigned']).reduce((s, o) => s + o.billed, 0))}</span>
                <span className="grow" />
                <a href={exportUrl('zip') + '&reviewed=1'} className="rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-[12px] font-semibold inline-flex items-center gap-1">
                  <Download className="w-3 h-3" /> Download reviewed (ZIP)
                </a>
              </div>
              {byOwner.filter(o => reviews[o.g.ownerId || 'unassigned']).map(o => {
                const rk = o.g.ownerId || 'unassigned'
                const rv = reviews[rk]
                return (
                  <div key={rk} className="px-4 py-2.5 flex items-center gap-3 flex-wrap border-t border-emerald-100 text-[12.5px]">
                    <span className="font-semibold text-ink truncate">{o.g.ownerName}</span>
                    <span className="text-[11px] text-muted">{o.tasks.length} tasks · reviewed by {(rv && rv.by ? rv.by.split('@')[0] : '')}{rv && rv.at ? ' · ' + rv.at.slice(0, 10) : ''}</span>
                    <span className="grow" />
                    <span className="font-bold text-ink tabular-nums">{money(o.billed)}</span>
                    {o.g.ownerId ? (
                      <a href={exportUrl('xls', o.g.ownerId)} className="text-[12px] text-emerald-700 font-semibold inline-flex items-center gap-1">
                        <Download className="w-3 h-3" /> Download
                      </a>
                    ) : null}
                    {canEdit ? <button onClick={() => toggleReview(rk, false)} className="text-[12px] text-muted font-semibold">Reopen</button> : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
