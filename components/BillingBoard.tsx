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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Download, ChevronDown, ChevronRight, Search, ExternalLink, AlertTriangle, Check, X, Pencil } from 'lucide-react'
import { useAccess } from '@/lib/useAccess'

type Item = { description: string; amount: number; bill_to: string | null; kind: 'cost' | 'supply' | 'extra' }
type Task = {
  id: string; listingId: string | null; unit: string; building: string | null
  ownerId: string | null; ownerName: string
  department: string; name: string; status: string
  assignees: { id: number | null; name: string | null }[]
  finishedBy: string | null
  scheduledDate: string | null; finishedAt: string | null
  actualMinutes: number | null
  ratePaid: number | null; rateType: string | null; billTo: string | null
  items: Item[]; hasDetail: boolean; detailSyncedAt: string | null
  excluded: boolean; note: string | null; overrideAmount: number | null; billedHours: number | null
  laborAmount: number; billedAmount: number; reportUrl: string | null
}
type OwnerGroup = { ownerId: string | null; ownerName: string; units: number; tasks: number; billed: number; labor: number; items: number; actualMinutes: number }
type Data = { ok: boolean; month: string; tasks: Task[]; owners: OwnerGroup[]; missingDetail: number; laborRates: Record<string, number>; error?: string }

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
function shiftMonth(m: string, by: number): string {
  const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7)) - 1 + by
  const d = new Date(Date.UTC(y, mo, 1))
  return d.toISOString().slice(0, 7)
}
function monthLabel(m: string): string {
  const d = new Date(m + '-15T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">{label}</div>
      <div className="text-xl font-bold text-ink tabular-nums mt-1">{value}</div>
      {sub ? <div className="text-[11px] text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

// ── Per-task editor row ─────────────────────────────────────────────────────
function TaskRow({ t, canEdit, onSaved, selected, onSelect }: { t: Task; canEdit: boolean; onSaved: () => void; selected?: boolean; onSelect?: () => void }) {
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

  const post = useCallback(async (body: any, tag: string) => {
    setBusy(tag); setErr(null)
    try {
      const r = await fetch('/api/billing/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Save failed')
      onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(null)
  }, [t.id, onSaved])

  const saveRate = () => post({ action: 'update', rate_paid: rate, rate_type: rateType }, 'rate')
  const saveAdjust = (fields: any, tag: string) => post({ action: 'adjust', ...fields }, tag)
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
  const refreshDetail = async () => {
    setBusy('detail'); setErr(null)
    try {
      const r = await fetch('/api/billing/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [t.id] }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Pull failed')
      onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(null)
  }

  const deptCls = DEPT_CLS[t.department] || 'bg-neutral-100 text-neutral-600 ring-neutral-200'
  const done = /complet|close|approv|finish/.test(t.status)
  const extras = t.items.filter(i => i.kind === 'extra')

  return (
    <div className={'border-t border-line ' + (t.excluded ? 'opacity-50' : '')}>
      <div className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-[12.5px]">
        <div className="col-span-4 flex items-center gap-2 min-w-0">
        {onSelect ? <input type="checkbox" checked={!!selected} onChange={onSelect} className="shrink-0" aria-label="Select task" /> : null}
        <button className="flex items-center gap-2 text-left min-w-0 grow" onClick={() => setOpen(v => !v)}>
          {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted" />}
          <span className="min-w-0">
            <span className="font-semibold text-ink block truncate">{t.name}</span>
            <span className="text-[11px] text-muted block truncate">{t.unit}{t.building ? ' · ' + t.building : ''} · {t.scheduledDate || (t.finishedAt || '').slice(0, 10) || 'undated'}</span>
          </span>
        </button>
        </div>
        <div className="col-span-2 min-w-0">
          <span className={chip(deptCls)}>{t.department}</span>
          {t.billTo ? <span className={chip('bg-emerald-50 text-emerald-700 ring-emerald-200') + ' ml-1'}>bill: {t.billTo}</span> : null}
        </div>
        <div className="col-span-2 truncate text-muted">{t.assignees.map(a => a.name).filter(Boolean).join(', ') || t.finishedBy || '—'}</div>
        <div className="col-span-1 tabular-nums text-right" title={t.billedHours != null ? 'Billed hours (edited) — actual ' + hours(t.actualMinutes) : 'Actual time on task'}>
          {t.billedHours != null ? <span className="font-semibold text-brand-600">{t.billedHours.toFixed(1)}h</span> : hours(t.actualMinutes)}
        </div>
        <div className="col-span-1 tabular-nums text-right text-muted">{t.ratePaid != null ? money(t.ratePaid) + (String(t.rateType).toLowerCase() === 'hourly' ? '/h' : '') : '—'}</div>
        <div className="col-span-1 tabular-nums text-right font-bold text-ink">{money(t.billedAmount)}</div>
        <div className="col-span-1 flex items-center justify-end gap-1.5">
          {!t.hasDetail ? <span title="Billing detail not pulled yet"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span> : null}
          {done ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : null}
          <a href={'https://app.breezeway.io/task/' + t.id} target="_blank" rel="noreferrer" title="Open this task in Breezeway"
            className="text-muted hover:text-brand-600"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
      </div>
      {open ? (
        <div className="px-10 pb-4 space-y-3">
          {err ? <div className="text-[12px] text-rose-600">{err}</div> : null}
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
                {t.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12.5px]">
                    <span className={chip(it.kind === 'extra' ? 'bg-brand-50 text-brand-700 ring-brand-200' : it.kind === 'supply' ? 'bg-teal-50 text-teal-700 ring-teal-200' : 'bg-neutral-100 text-neutral-600 ring-neutral-200')}>{it.kind}</span>
                    <span className="text-ink">{it.description}</span>
                    {it.bill_to ? <span className="text-[11px] text-muted">→ {it.bill_to}</span> : null}
                    <span className="grow" />
                    <span className="tabular-nums font-semibold">{money(it.amount)}</span>
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
              <input type="checkbox" checked={t.excluded} disabled={!canEdit} onChange={e => saveAdjust({ excluded: e.target.checked }, 'ex')} />
              Exclude from billing
            </label>
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted">override billed total</span>
              <input value={override} onChange={e => setOverride(e.target.value)} disabled={!canEdit} placeholder="auto"
                className="w-24 rounded-lg border border-line px-2 py-1 text-[12.5px] tabular-nums" />
              <button onClick={() => saveAdjust({ override_amount: override }, 'ov')} disabled={!canEdit || busy === 'ov'} className="text-[12px] font-semibold text-brand-600">Set</button>
            </span>
            <input value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if ((t.note || '') !== note) saveAdjust({ note }, 'note') }}
              disabled={!canEdit} placeholder="Billing note (shows on the export)"
              className="grow min-w-[200px] rounded-lg border border-line px-2 py-1 text-[12.5px]" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Labor tab ───────────────────────────────────────────────────────────────
type PersonRow = { key: string; tasks: number; completed: number; minutes: number; billed: number; depts: Record<string, number> }

function LaborView({ tasks, rates, canEdit, onRates }: { tasks: Task[]; rates: Record<string, number>; canEdit: boolean; onRates: (r: Record<string, number>) => void }) {
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
        if (!map[n]) map[n] = { key: n, tasks: 0, completed: 0, minutes: 0, billed: 0, depts: {} }
        const p = map[n]
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
    let minutes = 0; let billed = 0; let cost = 0
    for (const p of people) {
      minutes += p.minutes; billed += p.billed
      const r = Number(draft[p.key] != null ? draft[p.key] : rates[p.key])
      if (Number.isFinite(r)) cost += (p.minutes / 60) * r
    }
    return { minutes, billed, cost }
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Actual hours" value={(totals.minutes / 60).toFixed(1) + 'h'} sub="Breezeway time on task" />
        <Kpi label="Billable labor" value={money(totals.billed)} sub="rate math on these tasks" />
        <Kpi label="Labor cost" value={money(totals.cost)} sub="actual hours × your rates" />
        <Kpi label="Margin" value={money(totals.billed - totals.cost)} sub={totals.cost > 0 ? Math.round(((totals.billed - totals.cost) / totals.cost) * 100) + '% over cost' : 'set rates below'} />
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
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState<'owner' | 'all' | 'labor'>('owner')
  const [dept, setDept] = useState('all')
  const [billableOnly, setBillableOnly] = useState(true)
  const [showExcluded, setShowExcluded] = useState(false)
  const [q, setQ] = useState('')
  const [openOwners, setOpenOwners] = useState<Record<string, boolean>>({})
  const [pulling, setPulling] = useState<{ done: number; total: number } | null>(null)
  // Sorting — applies inside each owner group AND to the flat All-tasks view.
  const [sortKey, setSortKey] = useState<'date' | 'unit' | 'amount' | 'hours' | 'task'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [ownerSort, setOwnerSort] = useState<'billed' | 'name' | 'tasks' | 'hours'>('billed')
  // Bulk selection — tick tasks (or a whole owner group) then act on all of them at once.
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [bulk, setBulk] = useState<{ doing: string; done: number; total: number } | null>(null)
  const [bulkRate, setBulkRate] = useState('')
  const [bulkRateType, setBulkRateType] = useState('piece')

  const load = useCallback(async (m: string) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/billing?month=' + m)
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Load failed')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load(month) }, [month, load])
  const reload = useCallback(() => load(month), [load, month])

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
      if (dept !== 'all' && t.department !== dept) return false
      if (billableOnly && !(t.billedAmount > 0 || t.ratePaid != null || t.items.length || t.billTo)) return false
      if (needle) {
        const hay = (t.name + ' ' + t.unit + ' ' + (t.building || '') + ' ' + t.ownerName + ' ' + t.assignees.map(a => a.name).join(' ')).toLowerCase()
        if (hay.indexOf(needle) < 0) return false
      }
      return true
    })
  }, [data, dept, billableOnly, showExcluded, q])

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
    '/api/billing/export?month=' + month + '&format=' + format + (ownerId ? '&owner=' + encodeURIComponent(ownerId) : '')

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
          <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden">
            <button className="px-2.5 py-1.5 text-muted hover:text-ink" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
            <span className="px-2 text-[12.5px] font-semibold text-ink whitespace-nowrap">{monthLabel(month)}</span>
            <button className="px-2.5 py-1.5 text-muted hover:text-ink" onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month">›</button>
          </div>
          <button onClick={reload} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
          </button>
          <a href={exportUrl('csv')} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a href={exportUrl('xls')} className="rounded-xl bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Excel by owner
          </a>
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Billed to owners" value={money(kpis.billed)} sub={filtered.length + ' tasks in view'} />
        <Kpi label="Labor" value={money(kpis.labor)} sub="rate × work" />
        <Kpi label="Costs + supplies" value={money(kpis.items)} sub="owner-billable line items" />
        <Kpi label="Actual hours" value={(kpis.minutes / 60).toFixed(1) + 'h'} sub="time on task (crew taps)" />
      </div>

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

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden">
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
              <input type="checkbox" checked={billableOnly} onChange={e => setBillableOnly(e.target.checked)} /> Billable only
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)} /> Show excluded
            </label>
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
              <button onClick={() => runBulk('Excluding', () => ({ action: 'adjust', excluded: true }))}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold">Exclude from billing</button>
              <button onClick={() => runBulk('Including', () => ({ action: 'adjust', excluded: false }))}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold">Include</button>
              <span className="flex items-center gap-1.5">
                <input value={bulkRate} onChange={e => setBulkRate(e.target.value)} placeholder="Rate 0.00"
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
        <LaborView tasks={filtered.length ? filtered : data.tasks} rates={data.laborRates || {}} canEdit={canEdit}
          onRates={r => setData(d => d ? { ...d, laborRates: r } : d)} />
      ) : null}

      {view === 'all' && data ? (
        <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10.5px] uppercase tracking-wide text-muted font-bold">
            <div className="col-span-4">Task · unit · date</div>
            <div className="col-span-2">Dept · bill to</div>
            <div className="col-span-2">Assignee</div>
            <div className="col-span-1 text-right">Actual</div>
            <div className="col-span-1 text-right">Rate</div>
            <div className="col-span-1 text-right">Billed</div>
            <div className="col-span-1"></div>
          </div>
          {sortedFlat.map(t => <TaskRow key={t.id} t={t} canEdit={canEdit} onSaved={reload}
            selected={!!sel[t.id]} onSelect={canEdit ? () => toggleSel(t.id) : undefined} />)}
          {!sortedFlat.length && !loading ? <div className="px-4 py-8 text-center text-[12.5px] text-muted">Nothing matches this filter.</div> : null}
        </div>
      ) : null}

      {view === 'owner' && data ? (
        <div className="space-y-3">
          {byOwner.map(o => {
            const k = o.g.ownerId || '—'
            const open = openOwners[k] !== false
            const allSel = o.tasks.length > 0 && o.tasks.every(t => sel[t.id])
            return (
              <div key={k} className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  {canEdit ? <input type="checkbox" checked={allSel} onChange={e => setMany(o.tasks.map(t => t.id), e.target.checked)}
                    title="Select every task for this owner" aria-label="Select all tasks for this owner" /> : null}
                  <button onClick={() => setOpenOwners(s => ({ ...s, [k]: !open }))} className="flex items-center gap-2 min-w-0">
                    {open ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
                    <span className="font-bold text-ink truncate">{o.g.ownerName}</span>
                  </button>
                  <span className="text-[11.5px] text-muted">{o.tasks.length} tasks · {hours(o.minutes)}</span>
                  <span className="grow" />
                  <span className="font-bold text-ink tabular-nums">{money(o.billed)}</span>
                  {o.g.ownerId ? (
                    <a href={exportUrl('xls', o.g.ownerId)} className="text-[12px] text-brand-600 font-semibold inline-flex items-center gap-1">
                      <Download className="w-3 h-3" /> Export
                    </a>
                  ) : null}
                </div>
                {open ? o.tasks.map(t => <TaskRow key={t.id} t={t} canEdit={canEdit} onSaved={reload}
                  selected={!!sel[t.id]} onSelect={canEdit ? () => toggleSel(t.id) : undefined} />) : null}
              </div>
            )
          })}
          {!byOwner.length && !loading ? <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-[12.5px] text-muted">Nothing matches this filter.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
