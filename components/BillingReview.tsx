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
import { Check, CheckSquare, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, Undo2, ExternalLink, Loader2, ChevronDown, Search, Download } from 'lucide-react'
import { isTaskDone } from '@/lib/task-done'
import { LeanHead, Pill, Tag, LeanTabs, LeanEmpty, IconBtn, Tip, type Tone } from '@/components/lean'
import { AddTaskDialog, TaskExtrasPanel, type Extra } from '@/components/BillingTaskTools'

type Flag = 'over_150' | 'no_price' | 'override_far' | 'no_detail' | 'duplicate' | 'long_hours' | 'no_owner' | 'ai_bill' | 'ai_pending' | 'not_done' | 'should_bill' | 'billed_routine'
type BVerdict = 'bill' | 'likely' | 'maybe' | 'no'
type Billable = { verdict: BVerdict; category: string; confidence: number; reasons: string[]; history?: { billed: number; total: number } | null; ai?: 'bill' | 'no' | null }
type State = 'open' | 'ops_approved' | 'gm_approved'
type Item = { key: string; description: string; type?: string; amount: number; originalAmount: number | null; bill_to: string | null; kind: string }
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
  billable?: Billable
}
type Owner = { ownerId: string | null; ownerName: string; units: number; tasks: number; billed: number; open: number; opsApproved: number; gmApproved: number; flagged: number }
type Payload = { ok: true; month: string; from: string; to: string; me: { email: string; isGm: boolean }; tasks: Task[]; owners: Owner[]; missingDetail: number; aiPending?: number; billableModel?: { stale: boolean; trainedAt: number | null; maybes: number }; extras?: Record<string, Extra> }
type Stage = 'ops' | 'gm' | 'done' | 'all'

const FLAG_LABEL: Record<Flag, string> = {
  over_150: 'over $150', no_price: 'Maybe billable — finished at $0, needs a look', override_far: 'override far from computed',
  no_detail: 'detail not pulled', duplicate: 'possible duplicate', long_hours: 'long hours', no_owner: 'no owner',
  not_done: 'not finished in Breezeway',
  should_bill: 'The billable model says this should bill the owner — finished and still $0',
  billed_routine: 'Carries money, but the billable model says it is routine (departure clean, check, common area)',
  ai_bill: 'AI: real work — price it', ai_pending: 'AI check pending',
}
// LEAN PASS (2026-09-22): the row shows the short word, the hover says the full reason.
const FLAG_SHORT: Record<Flag, string> = {
  over_150: 'Over $150', no_price: 'Maybe bill', override_far: 'Override off', no_detail: 'No detail',
  duplicate: 'Duplicate?', long_hours: 'Long hours', no_owner: 'No owner', not_done: 'Not finished',
  should_bill: 'Should bill', billed_routine: 'Billed routine?',
  ai_bill: 'AI: bill it', ai_pending: 'AI pending',
}
const FLAG_TONE = (f: Flag): Tone => f === 'over_150' ? 'amber' : f === 'ai_bill' || f === 'should_bill' ? 'brand' : f === 'ai_pending' || f === 'no_price' ? 'sky' : f === 'billed_routine' ? 'amber' : 'rose'
// The billable model's read, as one small chip per row.
const CAT_LABEL: Record<string, string> = { repair: 'Repair', pm: 'PM', pest: 'Pest', extra_clean: 'Extra clean', owner_item: 'Owner item', guest_fix: 'Guest fix', departure_clean: 'Departure', routine: 'Routine', inspection: 'Inspection', building: 'Common area', our_fault: 'Re-clean', other: 'Other' }
/** A task's kind for the Task filter: its title without the unit, numbers and dates. */
function taskKey(name: string): string {
  return String(name || '').replace(/\s*[-–|:]\s*(?=[A-Z0-9]*\d)[^-–|:]*$/, '').replace(/\b\d+[a-z]?\b/gi, '').replace(/\s{2,}/g, ' ').trim().slice(0, 60) || '—'
}
const VERDICT_WORD: Record<BVerdict, string> = { bill: 'billable', likely: 'likely billable', maybe: 'maybe', no: 'not billable' }
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
const monthRangeEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) }
const todayMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)

/** Recompute the money on a task after a local edit, the same way lib/billing does on the server. */
function recompute(t: Task): Task {
  const itemsTotal = t.items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0)
  const computed = Math.round((t.laborAmount + itemsTotal) * 100) / 100
  const billed = t.excluded ? 0 : (t.overrideAmount != null ? t.overrideAmount : computed)
  const flags: Flag[] = t.flags.filter(f => f !== 'over_150' && f !== 'override_far' && f !== 'no_price' && f !== 'should_bill' && f !== 'billed_routine' && !((f === 'ai_bill' || f === 'ai_pending') && (t.overrideAmount != null || t.excluded)))
  if (billed > 150) flags.push('over_150')
  if (t.overrideAmount != null) {
    const gap = Math.abs(t.overrideAmount - computed)
    if (computed > 0 ? (gap / computed > 0.5 || gap > 50) : t.overrideAmount > 50) flags.push('override_far')
  }
  const finished = isTaskDone(t.status, t.finishedAt)
  const bv = t.billable?.verdict
  const unpriced = finished && !t.excluded && billed === 0 && t.overrideAmount == null && t.reviewState !== 'gm_approved'
  if (unpriced && (bv === 'bill' || bv === 'likely')) flags.push('should_bill')
  else if (unpriced && (!bv || bv === 'maybe') && !t.routine && !/(departur|turnover|check-?out)[\s\-_/]*clean/i.test(t.name)) flags.push('no_price')
  if (billed > 0 && bv === 'no' && t.overrideAmount == null) flags.push('billed_routine')
  return { ...t, billedAmount: billed, flags }
}

// ── ONE TASK ──────────────────────────────────────────────────────────────────────────────────
// Spanish-looking text (same test the bulk translate uses on the server).
const SPANISHY = /[áéíóúñü¿¡]|\b(limpieza|limpiar|lista|baño|bano|cocina|basura|revisar|revision|reparar|arreglo|arreglar|cambiar|fuga|puerta|ventana|luz|agua|caliente|colchon|colchón|sabanas|sábanas|toallas|cerradura|pintura|urgente|huesped|huésped|dañado|danado|pendiente|falta|faltan|no funciona|piso|pared|techo|llaves|nevera|estufa|espejo|silla|mesa|cortina|salida|necesita|entregar|escurrir)\b/i
const looksSpanish = (t: { name: string; description: string | null }) => SPANISHY.test(t.name) || SPANISHY.test(t.description || '')

/** Title & description: Improve (owner-facing rewrite), Fix spelling, → English / → Español — review, then save to Breezeway. */
function TextTools({ t, onSave }: { t: Task; onSave: (id: string, name: string, description: string) => Promise<string | null> }) {
  const [title, setTitle] = useState(t.name)
  const [desc, setDesc] = useState(t.description || '')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { setTitle(t.name); setDesc(t.description || '') }, [t.name, t.description])
  const dirty = title !== t.name || desc !== (t.description || '')
  const ai = async (mode: string, to?: string) => {
    setBusy(mode + (to || '')); setMsg('')
    try {
      const r = await fetch('/api/billing/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: title, description: desc, department: t.department, unit: t.unit, mode, to }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'AI failed')
      setTitle(j.title); if (j.description != null) setDesc(j.description)
      setMsg('Review it, then save.')
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy('')
  }
  const b = 'h-7 px-2 rounded-md border border-line bg-white text-[11.5px] font-semibold text-ink hover:bg-app disabled:opacity-40'
  return (
    <div className="space-y-1.5">
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">Title &amp; description</p>
      <input value={title} onChange={e => setTitle(e.target.value)} className="w-full h-8 rounded-lg border border-line bg-white px-2 text-[12.5px] font-semibold text-ink" />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="What was done" className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12px] text-ink" />
      <div className="flex items-center gap-1 flex-wrap">
        <button className={b} disabled={!!busy} onClick={() => ai('polish')} title="Rewrite into a clean, owner-facing service line">{busy === 'polish' ? '…' : 'Improve'}</button>
        <button className={b} disabled={!!busy} onClick={() => ai('spelling')} title="Fix spelling and capitals only — same words">{busy === 'spelling' ? '…' : 'Fix spelling'}</button>
        <button className={b} disabled={!!busy} onClick={() => ai('translate', 'en')} title="Translate to English">{busy === 'translateen' ? '…' : '→ English'}</button>
        <button className={b} disabled={!!busy} onClick={() => ai('translate', 'es')} title="Traducir al español">{busy === 'translatees' ? '…' : '→ Español'}</button>
        {dirty ? <>
          <button className="h-7 px-2.5 rounded-md bg-ink text-white text-[11.5px] font-semibold disabled:opacity-40" disabled={!!busy || !title.trim()} onClick={async () => { setBusy('save'); const e = await onSave(t.id, title.trim(), desc); setMsg(e || 'Saved to Breezeway.'); setBusy('') }}>{busy === 'save' ? 'Saving…' : 'Save to Breezeway'}</button>
          <button className="text-[11.5px] text-muted hover:text-ink" onClick={() => { setTitle(t.name); setDesc(t.description || ''); setMsg('') }}>Undo</button>
        </> : null}
        {msg ? <span className="text-[11px] text-muted">{msg}</span> : null}
      </div>
    </div>
  )
}

/** "labor $10 · parts $60 · rate $45": owner-billed money by type, labor from the rate math first. */
function breakdown(t: Task): string[] {
  const out: string[] = []
  if (t.laborAmount) out.push((t.rateType === 'hourly' ? 'hourly ' : 'rate ') + money(t.laborAmount))
  const byType = new Map<string, number>()
  for (const it of t.items) {
    if (String(it.bill_to || 'owner') === 'guest') continue
    const k = String(it.type || (it.kind === 'supply' ? 'Supply' : it.kind === 'extra' ? 'Adjustment' : 'Cost')).toLowerCase()
    byType.set(k, (byType.get(k) || 0) + it.amount)
  }
  for (const [k, v] of Array.from(byType.entries())) out.push(k + ' ' + money(v))
  return out
}

const Row = memo(function Row({ t, stage, isGm, busy, open, checked, onCheck, onToggle, onState, onEdit, onText, extra, onExtra, onReload }: {
  t: Task; stage: Stage; isGm: boolean; busy: boolean; open: boolean; checked: boolean
  extra?: Extra; onExtra: (id: string, e: Extra) => void; onReload: () => void
  onCheck: (id: string, on: boolean, shift: boolean) => void
  onText: (id: string, name: string, description: string) => Promise<string | null>
  onToggle: (id: string) => void
  onState: (id: string, to: State) => void
  onEdit: (id: string, patch: { override_amount?: number | null; note?: string; excluded?: boolean }) => Promise<void>
}) {
  const over = t.flags.includes('over_150')
  const local = t.id.startsWith('lh-')
  const done = t.reviewState === 'gm_approved'
  const inGmQueue = t.reviewState === 'ops_approved'
  const [amt, setAmt] = useState<string>(t.overrideAmount != null ? String(t.overrideAmount) : '')
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<string>(t.note || '')
  useEffect(() => { setAmt(t.overrideAmount != null ? String(t.overrideAmount) : ''); setNote(t.note || '') }, [t.overrideAmount, t.note])

  const btn = 'inline-flex items-center gap-1 rounded-lg px-2.5 h-8 text-[12px] font-semibold disabled:opacity-40 transition'
  return (
    <li className={'border-b border-line last:border-b-0 ' + (over ? 'border-l-[3px] border-l-amber-400 ' : 'border-l-[3px] border-l-transparent ') + (done ? 'bg-emerald-50/40' : t.excluded ? 'bg-app/40' : '')}>
      <div className={'grid gap-3 px-3 py-2.5 items-center ' + (checked ? 'bg-brand-50/60' : '')} style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto auto' }}>
        {/* BULK (Jon, 2026-10-02: "bulk change billables and approve"): tick rows, then act on them all from the bar below. Shift-click ticks a run. */}
        <input type="checkbox" checked={checked} aria-label="Select this row" title="Select — then change or approve the selection together (shift-click for a run)"
          onClick={e => onCheck(t.id, !checked, (e as any).shiftKey)} onChange={() => { /* onClick carries shift */ }} className="h-4 w-4 accent-brand-600 cursor-pointer" />
        <button onClick={() => onToggle(t.id)} className="text-left min-w-0">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className={'text-[13.5px] font-bold truncate ' + (t.excluded ? 'text-muted line-through' : 'text-ink')}>{t.unit}</span>
            <span className="text-[12.5px] text-ink/80 break-words min-w-0" title={t.name}>{t.name}</span>
            {local ? <Tag tone="amber" title="Added in Lighthouse — Breezeway did not take it yet. Open the row to push it.">Not in Breezeway</Tag> : null}
            {(extra?.photos?.length || 0) > 0 ? <Tag tone="sky" title="Photos attached in Lighthouse">{extra!.photos.length} photo{extra!.photos.length === 1 ? '' : 's'}</Tag> : null}
            {looksSpanish(t) ? <Tag tone="sky" title="Written in Spanish — translate it from the row, or in bulk from the toolbar">ES</Tag> : null}
            <span className="text-[11.5px] text-muted truncate">
              {t.doer || 'no one assigned'} · {short(t.scheduledDate || t.finishedAt)}
              {t.actualMinutes ? ' · ' + (t.actualMinutes / 60).toFixed(1) + 'h' : ''}
            </span>
            {t.flags.map(f => (
              <Tag key={f} tone={FLAG_TONE(f)}
                title={f === 'ai_bill' && t.aiReason ? t.aiReason + (t.aiAmount != null ? ' — suggests ' + money(t.aiAmount) : '') : (f === 'should_bill' || f === 'no_price' || f === 'billed_routine') && t.billable ? FLAG_LABEL[f] + ' — ' + (CAT_LABEL[t.billable.category] || t.billable.category) + ': ' + t.billable.reasons.join(' · ') : FLAG_LABEL[f]}>{FLAG_SHORT[f]}{f === 'should_bill' && t.billable ? ' · ' + (CAT_LABEL[t.billable.category] || '') : ''}</Tag>
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
            <button onClick={() => { if (!done || isGm) setEditing(true) }} disabled={done && !isGm} title={done ? (isGm ? 'Final-approved — click to change the amount; it stays approved' : 'Final-approved — only the final approver can change it') : 'Click to set the price (Enter saves, Esc cancels)'}
              className={'block ml-auto text-[16px] font-bold tabular-nums leading-tight rounded px-1 -mx-1 ' + (done && !isGm ? '' : 'hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 ') + (t.excluded ? 'text-muted line-through' : over ? 'text-amber-800' : 'text-ink')}>
              {money(t.billedAmount)}
            </button>
          )}
          {/* THE BREAKDOWN UNDER THE NUMBER (Jon, 2026-10-05: "full amount on the title, the breakdown or
              type when you expand"): what Breezeway's cost lines add up to, by type — "labor $10 ·
              parts $60" — so a price is never a bare figure. */}
          <span className="block text-[10.5px] text-muted truncate max-w-[14rem] ml-auto" title={breakdown(t).join(' · ')}>
            {t.overrideAmount != null ? 'set by hand' : breakdown(t).join(' · ') || 'no charge'}
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
          {local ? null : <Tip label="Open the task in Breezeway"><a href={'https://app.breezeway.io/task/' + encodeURIComponent(t.id)} target="_blank" rel="noreferrer" aria-label="Open the task in Breezeway" className="p-1 text-muted hover:text-ink"><ExternalLink size={13} /></a></Tip>}
          <Tip label={open ? 'Close details' : 'Details, price and note'}><button onClick={() => onToggle(t.id)} className="p-1 text-muted hover:text-ink" aria-label="Details"><ChevronDown size={14} className={'transition ' + (open ? 'rotate-180' : '')} /></button></Tip>
        </div>
      </div>

      {open ? (
        <div className="px-3 pb-3 pt-1 border-t border-line bg-app/40 grid gap-3 md:grid-cols-2">
          <div className="min-w-0 md:col-span-2">
            {local ? null : <TextTools t={t} onSave={onText} />}
          </div>
          {/* PHOTOS, OWNER LINK, PUSH (Jon, 2026-10-07: "add photo directly from here … generate an owner-viewable link to the task with photos and a description") */}
          <div className="min-w-0 md:col-span-2 md:order-last">
            <TaskExtrasPanel id={t.id} extra={extra} onChange={e => onExtra(t.id, e)} onPushed={onReload} />
          </div>
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted mb-1">What Breezeway has</p>
            <ul className="text-[12px] space-y-0.5">
              <li className="flex justify-between gap-3"><span className="text-muted">Labor ({t.rateType || 'rate'}{t.ratePaid != null ? ' ' + money(t.ratePaid) : ''}{t.billedHours != null ? ' × ' + t.billedHours + 'h' : ''})</span><span className="tabular-nums text-ink">{money(t.laborAmount)}</span></li>
              {t.items.map(it => (
                <li key={it.key} className="flex justify-between gap-3">
                  <span className={'truncate ' + (String(it.bill_to || 'owner') === 'guest' ? 'text-muted line-through' : 'text-ink/80')}>
                    <span className="inline-block text-[10px] font-semibold uppercase tracking-wide px-1 py-[1px] rounded bg-app text-muted mr-1.5 align-middle">{it.type || (it.kind === 'supply' ? 'Supply' : it.kind === 'extra' ? 'Adjustment' : 'Cost')}</span>
                    {it.description && it.description !== it.type ? it.description : ''}{String(it.bill_to || 'owner') === 'guest' ? ' (guest pays)' : ''}
                  </span>
                  <span className="tabular-nums text-ink shrink-0">{money(it.amount)}{it.originalAmount != null ? <span className="text-muted line-through ml-1">{money(it.originalAmount)}</span> : null}</span>
                </li>
              ))}
              {!t.hasDetail ? <li className="text-amber-800 text-[11.5px] flex items-center gap-1"><AlertTriangle size={11} /> Detail not pulled yet — cost lines may be missing.</li> : null}
            </ul>
            {t.billable ? <p className="text-[11.5px] text-ink/80 mt-2"><b>Billable model:</b> {VERDICT_WORD[t.billable.verdict]} · {CAT_LABEL[t.billable.category] || t.billable.category} · {Math.round(t.billable.confidence * 100)}% — {t.billable.reasons.join(' · ')}</p> : null}
            {t.aiVerdict === 'bill' && t.aiReason ? <p className="text-[11.5px] text-brand-800 mt-2">AI: {t.aiReason}{t.aiAmount != null ? ' — suggests ' + money(t.aiAmount) : ''}</p> : null}
            {t.description ? <p className="text-[11.5px] text-muted mt-2 whitespace-pre-wrap">{t.description}</p> : null}
            {/* THE TASK, NOT ONLY ITS REPORT (Jon, 2026-10-05: "need to be able to get to the main task as
                well, not just the report"). The task is where costs, photos and status are edited; the
                report is the read-only printout. */}
            <span className="inline-flex items-center gap-3 mt-2 flex-wrap">
              {local ? null : <a href={'https://app.breezeway.io/task/' + encodeURIComponent(t.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700"><ExternalLink size={11} /> Open task in Breezeway</a>}
              {t.reportUrl ? <a href={t.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink"><ExternalLink size={11} /> Task report</a> : null}
            </span>
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

// ── APPROVED, BY OWNER ────────────────────────────────────────────────────────────────────────
// Jon, 2026-10-07: "can we also have it where we can see the approved billable by owner in simple
// collapsed view, we can open it to see how much each billable labor per owner will be."
//
// One line per owner, closed. The line is the money that will land on that owner's statement —
// only final-approved, excluded rows left out. Open it and the money comes apart: by unit, then by
// job, with the labour (and the hours behind it) separated from the parts and supplies, so the
// question "how much labour am I billing this owner" has an answer you can read without arithmetic.
// Anything still waiting on an approval is counted beside it, never inside it.
type ApTask = { t: Task; labor: number; parts: number; hand: number; hours: number }
type ApUnit = { unit: string; rows: ApTask[]; total: number; labor: number; parts: number; hand: number; hours: number }
type ApOwner = { owner: Owner; units: ApUnit[]; jobs: number; total: number; labor: number; parts: number; hand: number; hours: number; pendingN: number; pending$: number; zero: number }
const hoursTxt = (h: number) => (Math.round(h * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'h'
const partsOf = (t: Task) => Math.round(t.items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0) * 100) / 100
const hoursOf = (t: Task) => t.billedHours != null ? t.billedHours : (t.actualMinutes ? t.actualMinutes / 60 : 0)

// THE FINAL AMOUNT, EDITABLE IN PLACE (Jon, 2026-10-07: "I should be able to edit the approved
// amount in final"). The final approver clicks a job's amount, types, Enter — it is saved as the price
// and the job stays final-approved. Anyone else sees the figure.
function InlineAmount({ t, canEdit, onEdit, className = '' }: { t: Task; canEdit: boolean; onEdit: (id: string, patch: { override_amount?: number | null }) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState('')
  if (!canEdit) return <span className={className}>{money(t.billedAmount)}</span>
  if (editing) return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)} inputMode="decimal" placeholder={money(t.billedAmount)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(''); setEditing(false) } }}
      onBlur={() => { setEditing(false); const s = v.trim(); if (s === '') return; const n = Number(s.replace(/[$,]/g, '')); if (Number.isFinite(n) && n !== t.billedAmount) onEdit(t.id, { override_amount: n }) }}
      className="h-6 w-20 rounded border border-brand-400 ring-2 ring-brand-100 bg-white px-1.5 text-right text-[12.5px] font-semibold tabular-nums text-ink outline-none" />
  )
  return <button onClick={() => { setV(String(t.billedAmount)); setEditing(true) }} title="Change the approved amount — it stays final-approved" className={className + ' rounded px-1 -mx-1 hover:bg-brand-50 hover:ring-1 hover:ring-brand-200'}>{money(t.billedAmount)}</button>
}

function ApprovedByOwner({ owners, open, setOpen, winQS, isGm, onEdit, picks, checkMany, filtered }: {
  owners: ApOwner[]
  open: Record<string, boolean>
  setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void
  winQS: string
  isGm: boolean
  onEdit: (id: string, patch: { override_amount?: number | null }) => void
  picks: Set<string>
  checkMany: (ids: string[], on: boolean) => void
  filtered: boolean
}) {
  const [showQuiet, setShowQuiet] = useState(false)
  const total = owners.reduce((a, o) => a + o.total, 0)
  const labor = owners.reduce((a, o) => a + o.labor, 0)
  const parts = owners.reduce((a, o) => a + o.parts, 0)
  const hand = owners.reduce((a, o) => a + o.hand, 0)
  const hours = owners.reduce((a, o) => a + o.hours, 0)
  const pend = owners.reduce((a, o) => ({ n: a.n + o.pendingN, $: a.$ + o.pending$ }), { n: 0, $: 0 })
  // Owners whose approved work bills them nothing sit under a line of their own — otherwise a
  // month like this one is forty $0.00 rows with the three that matter buried in them.
  const billing = owners.filter(o => o.total > 0 || o.pendingN > 0)
  const quiet = owners.filter(o => !(o.total > 0 || o.pendingN > 0))
  const jobs = owners.reduce((a, o) => a + o.jobs, 0)
  const allOpen = billing.length > 0 && billing.every(o => open[o.owner.ownerId || '—'])
  if (!owners.length) return <LeanEmpty>Nothing final-approved yet in this window.</LeanEmpty>
  return (
    <div className="space-y-2">
      {filtered ? <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[12.5px] text-brand-800">Filtered — these totals cover only the jobs the filters let through, not whole statements.</div> : null}
      {/* what the statements add up to, and what is not in that number yet */}
      <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-3 flex items-end gap-6 flex-wrap">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Approved to bill</div>
          <div className="text-[26px] font-bold text-ink tabular-nums leading-tight">{money(total)}</div>
          <div className="text-[12px] text-muted">{billing.length} owner{billing.length === 1 ? '' : 's'} · {jobs} job{jobs === 1 ? '' : 's'}</div>
        </div>
        <div title="Breezeway's own labour lines — the rate times the hours. Most of this desk's money is priced by hand instead, which is the third figure.">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Labour</div>
          <div className="text-[18px] font-bold text-ink tabular-nums leading-tight">{money(labor)}</div>
          <div className="text-[12px] text-muted">{hoursTxt(hours)} on the clock</div>
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Parts &amp; supplies</div>
          <div className="text-[18px] font-bold text-ink tabular-nums leading-tight">{money(parts)}</div>
          <div className="text-[12px] text-muted">{total ? Math.round(parts / total * 100) : 0}% of the bill</div>
        </div>
        <div title="Jobs a reviewer priced by hand. The price replaces the computed one, so what is labour inside it is not recorded.">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Priced by hand</div>
          <div className="text-[18px] font-bold text-ink tabular-nums leading-tight">{money(hand)}</div>
          <div className="text-[12px] text-muted">{total ? Math.round(hand / total * 100) : 0}% of the bill</div>
        </div>
        {pend.n ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-amber-800">Still to approve</div>
            <div className="text-[18px] font-bold text-amber-900 tabular-nums leading-tight">{money(pend.$)}</div>
            <div className="text-[12px] text-amber-800">{pend.n} job{pend.n === 1 ? '' : 's'} not in the number above</div>
          </div>
        ) : null}
        <div className="flex-1" />
        <button onClick={() => setOpen(() => allOpen ? {} : Object.fromEntries(billing.map(o => [o.owner.ownerId || '—', true])))}
          className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink">
          {allOpen ? 'Collapse all' : 'Open all'}
        </button>
        <IconBtn title="Download every final-approved statement (ZIP)" href={'/api/billing/export?' + winQS + '&format=zip&reviewed=1'}><Download size={14} /></IconBtn>
      </div>

      {billing.map(o => {
        const k = o.owner.ownerId || '—'
        const isOpen = !!open[k]
        return (
          <section key={k} className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
            <header className="px-3.5 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 flex-wrap">
              {(() => { const ids = o.units.flatMap(u => u.rows.map(r => r.t.id)); return ids.length ? (
                <input type="checkbox" checked={ids.every(id => picks.has(id))} onChange={e => checkMany(ids, e.target.checked)} aria-label={'Select every job for ' + o.owner.ownerName} title={'Select all ' + ids.length + ' jobs — then change them together from the bar below'} className="h-4 w-4 accent-brand-600 cursor-pointer" />
              ) : null })()}
              <button onClick={() => setOpen(c => ({ ...c, [k]: !c[k] }))} className="flex items-center gap-2 text-left min-w-0 grow basis-48">
                <ChevronDown size={14} className={'text-muted shrink-0 transition ' + (isOpen ? '' : '-rotate-90')} />
                <span className="text-[14px] font-bold text-ink truncate">{o.owner.ownerName}</span>
                <span className="text-[12px] text-muted tabular-nums whitespace-nowrap">{o.units.length}u · {o.jobs}j · {hoursTxt(o.hours)}</span>
              </button>
              <span className="text-[12px] text-muted tabular-nums hidden sm:inline" title="What makes up the owner total">
                {[o.labor ? 'labour ' + money(o.labor) : '', o.parts ? 'parts ' + money(o.parts) : '', o.hand ? 'by hand ' + money(o.hand) : ''].filter(Boolean).join(' · ') || 'nothing priced'}
              </span>
              {o.pendingN ? <Tag tone="amber" title={money(o.pending$) + ' on ' + o.pendingN + ' job' + (o.pendingN === 1 ? '' : 's') + ' not approved yet — not in this total'}>{o.pendingN} to approve</Tag> : null}
              {o.zero ? <Tag title={o.zero + ' approved job' + (o.zero === 1 ? '' : 's') + ' bill the owner nothing'}>{o.zero} at $0</Tag> : null}
              <span className="text-[15px] font-bold text-ink tabular-nums ml-auto">{money(o.total)}</span>
              {o.owner.ownerId ? <IconBtn title={'Download ' + o.owner.ownerName + '’s sheet (Excel)'} href={'/api/billing/export?' + winQS + '&format=xls&done=1&owner=' + encodeURIComponent(o.owner.ownerId)}><Download size={13} /></IconBtn> : null}
            </header>
            {isOpen ? (
              <div className="border-t border-line divide-y divide-line">
                {o.units.map(u => (
                  <div key={u.unit} className="px-3.5 sm:px-4 py-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-ink">{u.unit}</span>
                      <span className="text-[11.5px] text-muted tabular-nums">{u.rows.length} job{u.rows.length === 1 ? '' : 's'} · {[u.labor ? 'labour ' + money(u.labor) : '', u.parts ? 'parts ' + money(u.parts) : '', u.hand ? 'by hand ' + money(u.hand) : ''].filter(Boolean).join(' · ')}{u.hours ? ' · ' + hoursTxt(u.hours) + ' on the clock' : ''}</span>
                      <span className="flex-1" />
                      <span className="text-[13px] font-bold text-ink tabular-nums">{money(u.total)}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {u.rows.map(({ t, labor: l, parts: pp, hand: hd, hours: hh }) => (
                        <li key={t.id} className={'flex items-baseline gap-2 flex-wrap text-[12.5px] ' + (picks.has(t.id) ? 'bg-brand-50/60 -mx-1 px-1 rounded' : '')}>
                          <input type="checkbox" checked={picks.has(t.id)} onChange={e => checkMany([t.id], e.target.checked)} aria-label="Select this job" title="Select — then change the selection together from the bar below" className="h-3.5 w-3.5 accent-brand-600 cursor-pointer self-center" />
                          <span className="text-muted tabular-nums w-[52px] shrink-0">{short(t.finishedAt || t.scheduledDate)}</span>
                          <span className="text-ink min-w-0 grow basis-48 truncate" title={t.name}>{t.name}</span>
                          <span className="text-muted whitespace-nowrap">
                            {hd
                              ? 'priced by hand' + (hh ? ' · ' + hoursTxt(hh) + ' on the clock' : '')
                              : [l ? 'labour ' + money(l) + (hh ? ' (' + hoursTxt(hh) + ')' : '') : '', pp ? 'parts ' + money(pp) : ''].filter(Boolean).join(' · ') || 'no labour'}
                          </span>
                          {t.doer ? <span className="text-muted hidden sm:inline">· {t.doer}</span> : null}
                          {t.gmBy ? <span className="text-muted hidden md:inline" title={'Final-approved by ' + t.gmBy + (t.gmAt ? ' on ' + short(t.gmAt) : '')}>· {who(t.gmBy)}</span> : null}
                          <span className="flex-1" />
                          <InlineAmount t={t} canEdit={isGm} onEdit={onEdit} className="text-ink font-semibold tabular-nums" />
                          {t.reportUrl ? <a href={t.reportUrl} target="_blank" rel="noreferrer" title="Open the job in Breezeway" className="text-muted hover:text-ink"><ExternalLink size={11} /></a> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="px-3.5 sm:px-4 py-2 bg-app/40 flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-muted">{o.owner.ownerName} — on the statement</span>
                  <span className="text-[11.5px] text-muted tabular-nums">{[o.labor ? 'labour ' + money(o.labor) : '', o.parts ? 'parts & supplies ' + money(o.parts) : '', o.hand ? 'priced by hand ' + money(o.hand) : ''].filter(Boolean).join(' · ')}{o.hours ? ' · ' + hoursTxt(o.hours) + ' on the clock' : ''}</span>
                  <span className="flex-1" />
                  <span className="text-[14px] font-bold text-ink tabular-nums">{money(o.total)}</span>
                </div>
              </div>
            ) : null}
          </section>
        )
      })}

      {quiet.length ? (
        <div className="rounded-2xl bg-white ring-1 ring-line px-3.5 sm:px-4 py-2.5">
          <button onClick={() => setShowQuiet(v => !v)} className="text-[12.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1.5">
            <ChevronDown size={13} className={'transition ' + (showQuiet ? '' : '-rotate-90')} />
            {quiet.length} owner{quiet.length === 1 ? '' : 's'} with nothing to bill
            <span className="font-normal">— approved work that costs them nothing</span>
          </button>
          {showQuiet ? (
            <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {quiet.map(o => (
                <li key={o.owner.ownerId || o.owner.ownerName} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="text-ink truncate">{o.owner.ownerName}</span>
                  <span className="flex-1" />
                  <span className="text-muted tabular-nums whitespace-nowrap">{o.zero} job{o.zero === 1 ? '' : 's'} · $0.00</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ── THE DESK ──────────────────────────────────────────────────────────────────────────────────
export function BillingReview() {
  const [month, setMonth] = useState(todayMonth())
  const [data, setData] = useState<Payload | null>(null)
  const dataRef = useRef<Payload | null>(null)
  dataRef.current = data
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [stage, setStage] = useState<Stage | null>(null)     // null until we know the role
  const visibleIdsRef = useRef<string[]>([])                  // the rows on screen, in order, for shift-click runs
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [q, setQ] = useState('')
  // FILTERS (Jon, 2026-09-30: "filter by billable amount greater than zero, by date window, by
  // department etc."). The window is a month (arrows) or any from–to range; the rest narrow the
  // rows shown. None of them changes the whole-window numbers in the header strip. All of them ride
  // in the URL so a filtered view can be bookmarked or sent to someone.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [billOnly, setBillOnly] = useState(false)
  const [depts, setDepts] = useState<string[]>([])
  const [building, setBuilding] = useState('')
  const [person, setPerson] = useState('')
  const [minAmt, setMinAmt] = useState('')
  // (Jon, 2026-10-07: "filter by owner, billable, by task and amount, and bulk edit")
  const [maxAmt, setMaxAmt] = useState('')
  const [ownerF, setOwnerF] = useState('')
  const [taskF, setTaskF] = useState('')        // 'cat:<category>' or 'name:<task name>'
  const [bFilter, setBFilter] = useState<'' | 'should' | 'bill' | 'maybe' | 'no'>('')
  const trained = useRef(false)
  const judged = useRef<Set<string>>(new Set())
  const urlRead = useRef(false)
  useEffect(() => {
    if (urlRead.current) return
    urlRead.current = true
    const sp = new URLSearchParams(window.location.search)
    const f = sp.get('from'), t = sp.get('to'), m = sp.get('month')
    if (f && t && /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) setRange({ from: f, to: t })
    else if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m)
    if (sp.get('billable') === '1') setBillOnly(true)
    if (sp.get('dept')) setDepts(sp.get('dept')!.split(',').filter(Boolean))
    if (sp.get('building')) setBuilding(sp.get('building')!)
    if (sp.get('person')) setPerson(sp.get('person')!)
    if (sp.get('min')) setMinAmt(sp.get('min')!)
    if (sp.get('max')) setMaxAmt(sp.get('max')!)
    if (sp.get('owner')) setOwnerF(sp.get('owner')!)
    if (sp.get('task')) setTaskF(sp.get('task')!)
    const bf = sp.get('bill'); if (bf === 'should' || bf === 'bill' || bf === 'maybe' || bf === 'no') setBFilter(bf)
  }, [])
  const [openId, setOpenId] = useState<string>('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // The Approved tab's summary: owners start CLOSED here (the point is the one-line read), and the
  // reviewer can still drop to the full rows with the toggle.
  const [apOpen, setApOpen] = useState<Record<string, boolean>>({})
  const [apMode, setApMode] = useState<'summary' | 'rows'>('summary')
  // The snapshot that keeps rows from vanishing mid-session (rule 2).
  const [viewIds, setViewIds] = useState<Set<string> | null>(null)
  const seq = useRef(0)
  const aiRan = useRef<Set<string>>(new Set())
  const [aiBusy, setAiBusy] = useState(0)

  const loadRef = useRef<(m: string, rg?: { from: string; to: string } | null) => Promise<void>>(async () => {})
  const load = useCallback(async (m: string, rg?: { from: string; to: string } | null) => {
    const my = ++seq.current
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/billing/review?' + (rg ? 'from=' + rg.from + '&to=' + rg.to : 'month=' + m), { cache: 'no-store' })
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
          .then(res => { setAiBusy(0); if (res && res.ok && res.judged > 0 && my === seq.current) loadRef.current(m, rg) })
      }
      // The billable model: retrain once a day, then let the AI read the MAYBEs with a description.
      const bm = j.billableModel
      const post = (b: any) => fetch('/api/billing/billable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => null)
      if (bm?.stale && !trained.current) { trained.current = true; post({ op: 'train' }).then(res => { if (res?.ok && my === seq.current) loadRef.current(m, rg) }) }
      else if (bm && bm.maybes > 0 && !judged.current.has(j.from + j.to)) { judged.current.add(j.from + j.to); post({ op: 'judge', from: j.from, to: j.to }).then(res => { if (res?.ok && res.judged > 0 && my === seq.current) loadRef.current(m, rg) }) }
    } catch (e: any) { if (my === seq.current) setErr(String(e?.message || e)) }
    if (my === seq.current) setLoading(false)
  }, [])
  loadRef.current = load
  useEffect(() => { load(month, range) }, [month, range, load])
  // Keep the URL in step with the window and the filters.
  useEffect(() => {
    if (!urlRead.current) return
    const url = new URL(window.location.href)
    const set = (k: string, v: string | null) => { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k) }
    set('month', range ? null : month); set('from', range?.from || null); set('to', range?.to || null)
    set('billable', billOnly ? '1' : null); set('dept', depts.length ? depts.join(',') : null)
    set('building', building || null); set('person', person || null); set('min', minAmt || null); set('bill', bFilter || null)
    set('max', maxAmt || null); set('owner', ownerF || null); set('task', taskF || null)
    window.history.replaceState(null, '', url.toString())
  }, [month, range, billOnly, depts, building, person, minAmt, bFilter, maxAmt, ownerF, taskF])

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

  // ONE TEST FOR EVERY FILTER, used by the rows AND by the Approved tab's by-owner read.
  const passes = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const num = (v: string) => { const n = v.trim() === '' ? null : Number(v.replace(/[$,]/g, '')); return n != null && Number.isFinite(n) ? n : null }
    const min = num(minAmt), max = num(maxAmt)
    return (t: Task) => (!flaggedOnly || t.flags.length > 0)
      && (!billOnly || t.billedAmount > 0)
      && (!bFilter || (bFilter === 'should' ? t.flags.includes('should_bill') : bFilter === 'bill' ? (t.billable?.verdict === 'bill' || t.billable?.verdict === 'likely') : t.billable?.verdict === bFilter))
      && (min == null || t.billedAmount >= min)
      && (max == null || t.billedAmount <= max)
      && (!ownerF || (t.ownerId || '—') === ownerF)
      && (!taskF || (taskF.startsWith('cat:') ? (t.billable?.category || 'other') === taskF.slice(4) : taskKey(t.name) === taskF.slice(5)))
      && (!depts.length || depts.includes(t.department))
      && (!building || (t.building || '—') === building)
      && (!person || (t.doer || '—') === person)
      && (!needle || (t.unit + ' ' + t.name + ' ' + (t.doer || '') + ' ' + t.ownerName).toLowerCase().includes(needle))
  }, [q, flaggedOnly, billOnly, minAmt, maxAmt, ownerF, taskF, depts, building, person, bFilter])
  const visible = useMemo(() => {
    if (!viewIds) return [] as Task[]
    return tasks.filter(t => viewIds.has(t.id)).filter(passes)
  }, [tasks, viewIds, passes])
  // The choices each filter offers — what this window actually holds, with counts.
  const facets = useMemo(() => {
    const count = (f: (t: Task) => string) => { const m = new Map<string, number>(); for (const t of tasks) { const k = f(t); m.set(k, (m.get(k) || 0) + 1) } return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])) }
    // Owners and task types, with counts. A task "name" is its title with the unit and dates
    // stripped (taskKey), so 40 "Departure Clean - Eden 2104" rows read as one choice.
    const owners = (() => { const m = new Map<string, { name: string; n: number }>(); for (const t of tasks) { const k = t.ownerId || '—'; const x = m.get(k) || { name: t.ownerName || 'No owner', n: 0 }; x.n++; m.set(k, x) } return Array.from(m.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name)) })()
    const cats = count(t => t.billable?.category || 'other')
    const names = count(t => taskKey(t.name)).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40)
    return { depts: count(t => t.department), buildings: count(t => t.building || '—'), people: count(t => t.doer || '—'), owners, cats, names }
  }, [tasks])
  const filtersOn = !!bFilter || billOnly || !!depts.length || !!building || !!person || minAmt.trim() !== '' || maxAmt.trim() !== '' || !!ownerF || !!taskF || flaggedOnly || !!q.trim()
  const shownTotal = useMemo(() => visible.reduce((a, t) => a + t.billedAmount, 0), [visible])
  const clearFilters = () => { setBFilter(''); setBillOnly(false); setDepts([]); setBuilding(''); setPerson(''); setMinAmt(''); setMaxAmt(''); setOwnerF(''); setTaskF(''); setFlaggedOnly(false); setQ('') }

  // Owners in server order (name), rows inside sorted: flagged first, then biggest.
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of visible) { const k = t.ownerId || '—'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t) }
    for (const list of Array.from(m.values())) list.sort((a, b) => Number(!!b.flags.length) - Number(!!a.flags.length) || b.billedAmount - a.billedAmount || a.unit.localeCompare(b.unit))
    return (data?.owners || []).map(o => ({ owner: o, rows: m.get(o.ownerId || '—') || [] }))
  }, [visible, data])
  visibleIdsRef.current = groups.flatMap(g => g.rows.map(t => t.id))

  // Whole-window numbers for the strip — never the filtered view's.
  const kpi = useMemo(() => {
    const sum = (f: (t: Task) => boolean) => tasks.filter(f).reduce((a, t) => ({ n: a.n + 1, $: a.$ + t.billedAmount }), { n: 0, $: 0 })
    return { should: sum(t => t.flags.includes('should_bill')), open: sum(t => t.reviewState === 'open'), gm: sum(t => t.reviewState === 'ops_approved'), done: sum(t => t.reviewState === 'gm_approved'), flagged: sum(t => t.flags.length > 0 && t.reviewState !== 'gm_approved') }
  }, [tasks])

  // What each owner is actually being billed, once it is final-approved. Whole window, so the
  // filters above never quietly shrink a statement total.
  const approved = useMemo<ApOwner[]>(() => {
    const byOwner = new Map<string, Task[]>()
    const pending = new Map<string, { n: number; $: number }>()
    // Filters narrow this read too (Jon, 2026-10-07) — the header says so when they are on.
    for (const t of (filtersOn ? tasks.filter(passes) : tasks)) {
      const k = t.ownerId || '—'
      if (t.reviewState === 'gm_approved') { if (!byOwner.has(k)) byOwner.set(k, []); byOwner.get(k)!.push(t) }
      else if (!t.excluded && t.billedAmount > 0) { const x = pending.get(k) || { n: 0, $: 0 }; x.n++; x.$ += t.billedAmount; pending.set(k, x) }
    }
    const out: ApOwner[] = []
    for (const o of (data?.owners || [])) {
      const k = o.ownerId || '—'
      const rows = (byOwner.get(k) || []).filter(t => !t.excluded)
      const p = pending.get(k) || { n: 0, $: 0 }
      if (!rows.length && !p.n) continue
      const paying = rows.filter(t => t.billedAmount > 0)
      const um = new Map<string, ApTask[]>()
      for (const t of paying) {
        const u = t.unit || '—'
        // Three buckets, and a dollar lands in exactly one of them. A price set by hand replaces
        // the computed total, so the labour/parts split behind it is not knowable — it gets its
        // own bucket rather than a made-up labour figure. (Most of this desk's money is that.)
        const hand = t.overrideAmount != null ? Math.round(t.billedAmount * 100) / 100 : 0
        const labor = hand ? 0 : Math.round(t.laborAmount * 100) / 100
        const parts = hand ? 0 : partsOf(t)
        if (!um.has(u)) um.set(u, [])
        um.get(u)!.push({ t, labor, parts, hand, hours: hoursOf(t) })
      }
      const units: ApUnit[] = Array.from(um.entries()).map(([unit, list]) => {
        list.sort((a, b) => b.t.billedAmount - a.t.billedAmount)
        return {
          unit, rows: list,
          total: Math.round(list.reduce((a, x) => a + x.t.billedAmount, 0) * 100) / 100,
          labor: Math.round(list.reduce((a, x) => a + x.labor, 0) * 100) / 100,
          parts: Math.round(list.reduce((a, x) => a + x.parts, 0) * 100) / 100,
          hand: Math.round(list.reduce((a, x) => a + x.hand, 0) * 100) / 100,
          hours: list.reduce((a, x) => a + x.hours, 0),
        }
      }).sort((a, b) => b.total - a.total || a.unit.localeCompare(b.unit))
      out.push({
        owner: o, units, jobs: paying.length,
        total: Math.round(units.reduce((a, u) => a + u.total, 0) * 100) / 100,
        labor: Math.round(units.reduce((a, u) => a + u.labor, 0) * 100) / 100,
        parts: Math.round(units.reduce((a, u) => a + u.parts, 0) * 100) / 100,
        hand: Math.round(units.reduce((a, u) => a + u.hand, 0) * 100) / 100,
        hours: units.reduce((a, u) => a + u.hours, 0),
        pendingN: p.n, pending$: Math.round(p.$ * 100) / 100,
        zero: rows.length - paying.length,
      })
    }
    // Biggest bill first — this view is read for the money, and nothing here is approved, so the
    // order can't shift under a click the way the review rows could.
    out.sort((a, b) => b.total - a.total || b.pending$ - a.pending$ || a.owner.ownerName.localeCompare(b.owner.ownerName))
    return out
  }, [tasks, data, filtersOn, passes])

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

  // ── SELECTION + BULK (Jon, 2026-10-02: "need to be able to bulk change billables and approve") ──
  // Tick rows (shift-click for a run, a box per owner for the owner's rows, "Select all shown" in
  // the toolbar), then the bar at the bottom changes them together: approve / send back, exclude or
  // include, one price for all, a note on all. Each change goes through the same per-row save and
  // merge as a single edit — a bulk price is N optimistic edits, never a reload.
  const [picks, setPicks] = useState<Set<string>>(new Set())
  const lastCheck = useRef<string>('')
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  const [bulkBusy, setBulkBusy] = useState('')
  const onCheck = useCallback((id: string, on: boolean, shift: boolean) => {
    setPicks(prev => {
      const n = new Set(prev)
      const order = visibleIdsRef.current
      const a = order.indexOf(lastCheck.current), b = order.indexOf(id)
      if (shift && a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; for (let i = lo; i <= hi; i++) on ? n.add(order[i]) : n.delete(order[i]) }
      else on ? n.add(id) : n.delete(id)
      return n
    })
    lastCheck.current = id
  }, [])
  const checkMany = useCallback((ids: string[], on: boolean) => setPicks(prev => { const n = new Set(prev); for (const id of ids) on ? n.add(id) : n.delete(id); return n }), [])
  const bulkEdit = useCallback(async (patch: { override_amount?: number | null; note?: string; excluded?: boolean }, label: string) => {
    // The final approver edits every selected row; anyone else, only the ones not yet final-approved
    // (the server refuses those anyway).
    const gm = !!dataRef.current?.me?.isGm
    const ids = Array.from(picks).filter(id => gm || dataRef.current?.tasks.find(t => t.id === id)?.reviewState !== 'gm_approved'); if (!ids.length) return
    setBulkBusy(label)
    // Four at a time: fast, and kind to Breezeway's and Supabase's rate limits.
    for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(id => onEdit(id, patch)))
    setBulkBusy('')
  }, [picks, onEdit])
  // Photos / owner link changed on a row: merge into the payload, nothing reloads.
  const onExtra = useCallback((id: string, e: Extra) => { setData(d => d ? { ...d, extras: { ...(d.extras || {}), [id]: e } } : d) }, [])
  const [addOpen, setAddOpen] = useState(false)
  const reload = useCallback(() => { loadRef.current(month, range) }, [month, range])
  const onText = useCallback(async (id: string, name: string, description: string): Promise<string | null> => {
    try {
      const r = await fetch('/api/billing/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', taskId: id, name, description }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) return j?.error || 'Could not save to Breezeway.'
      setData(d => d ? { ...d, tasks: d.tasks.map(t => t.id === id ? { ...t, name, description } : t) } : d)
      return null
    } catch (e: any) { return String(e?.message || e) }
  }, [])

  // SPANISH → ENGLISH, in bulk (Jon, 2026-09-30). The button translates every Spanish title and
  // description in the window and writes them back to Breezeway; the Auto switch does it on load.
  const [autoTr, setAutoTr] = useState(false)
  const [trBusy, setTrBusy] = useState('')
  const trDone = useRef<Set<string>>(new Set())
  useEffect(() => { fetch('/api/billing/translate', { cache: 'no-store' }).then(r => r.json()).then(j => setAutoTr(!!j?.autoTranslate)).catch(() => {}) }, [])
  const translateAll = useCallback(async () => {
    if (!data) return
    setTrBusy('Translating…')
    let total = 0, guard = 0
    try {
      for (;;) {
        const r = await fetch('/api/billing/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: data.from, to: data.to }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) throw new Error(j.error || 'Translate failed')
        total += Number(j.translated || 0)
        for (const c of (j.changed || [])) setData(d => d ? { ...d, tasks: d.tasks.map(t => t.id === c.id ? { ...t, name: c.name, description: c.description } : t) } : d)
        setTrBusy(`Translated ${total}…`)
        if (!j.remaining || ++guard > 8) break
      }
      setTrBusy(total ? `Translated ${total} to English` : 'Nothing in Spanish')
    } catch (e: any) { setTrBusy(String(e?.message || e)) }
    setTimeout(() => setTrBusy(''), 5000)
  }, [data])
  const spanishCount = useMemo(() => tasks.filter(looksSpanish).length, [tasks])
  useEffect(() => {
    if (!autoTr || !data || !spanishCount) return
    const k = data.from + data.to
    if (trDone.current.has(k)) return
    trDone.current.add(k)
    translateAll()
  }, [autoTr, data, spanishCount, translateAll])

  if (!data && loading) return <><LeanHead title="Billable Hours" /><LeanEmpty><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading {range ? short(range.from) + ' – ' + short(range.to) : monthLabel(month)}…</LeanEmpty></>
  if (!data) return <><LeanHead title="Billable Hours" /><div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err || 'Nothing loaded.'}</div></>
  const isGm = !!data.me?.isGm
  const st: Stage = stage || (isGm ? 'gm' : 'ops')
  const approveAllLabel = st === 'gm' ? 'Final approve all shown' : 'Approve all shown'
  const approveAllTo: State = st === 'gm' ? 'gm_approved' : 'ops_approved'
  const canApproveAll = st === 'ops' || (st === 'gm' && isGm)
  const winQS = range ? 'from=' + range.from + '&to=' + range.to : 'month=' + month
  const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
  const presets: { label: string; get: () => { from: string; to: string } | null }[] = [
    { label: 'Month', get: () => null },
    { label: 'Last 7 days', get: () => ({ from: ymd(new Date(Date.now() - 6 * 864e5)), to: ymd(new Date()) }) },
    { label: 'Last 30 days', get: () => ({ from: ymd(new Date(Date.now() - 29 * 864e5)), to: ymd(new Date()) }) },
    { label: 'Last 90 days', get: () => ({ from: ymd(new Date(Date.now() - 89 * 864e5)), to: ymd(new Date()) }) },
  ]
  const sel = 'h-8 rounded-lg border border-line bg-white px-2 text-[12px] text-ink max-w-[12rem]'

  return (
    <div className="space-y-3">
      {/* ── one line: the four numbers the desk is judged on (whole month, never the filtered view) */}
      <LeanHead title="Billable Hours">
        <Pill title={'Open — ops to review · ' + kpi.open.n + ' task' + (kpi.open.n === 1 ? '' : 's')}>{money(kpi.open.$)} open</Pill>
        <Pill tone="brand" title={'Ops approved — waiting on final (GM) review · ' + kpi.gm.n + ' task' + (kpi.gm.n === 1 ? '' : 's')}>{money(kpi.gm.$)} final</Pill>
        <Pill tone="emerald" title={'Final approved — statement-ready · ' + kpi.done.n + ' task' + (kpi.done.n === 1 ? '' : 's')}>{money(kpi.done.$)} approved</Pill>
        {kpi.should.n ? <Pill tone="brand" onClick={() => { setBFilter('should'); setStage('all'); resnapshot() }} title="The billable model says these should bill the owner and they are still $0 — click to see them">{kpi.should.n} should bill</Pill> : null}
        {kpi.flagged.n ? <Pill tone="amber" title={'Flagged and not final-approved: ' + money(kpi.flagged.$) + '. Amber edge on a row = over $150. A flag never blocks approval.'}>{kpi.flagged.n} flagged</Pill> : null}
        {data.missingDetail ? <Pill tone="amber" title="Tasks in this month that never had billing detail pulled — their cost lines may be missing. The nightly pull catches up on its own.">{data.missingDetail} no detail</Pill> : null}
      </LeanHead>

      {/* ── month, then which queue and what to show in it — one line */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {range ? (
          <span className="inline-flex items-center gap-1.5 text-[12px]">
            <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange({ from: e.target.value, to: range.to })} className={sel} />
            <span className="text-muted">to</span>
            <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange({ from: range.from, to: e.target.value })} className={sel} />
          </span>
        ) : (<>
          <IconBtn title="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></IconBtn>
          <span className="text-[13.5px] font-bold text-ink tracking-tight min-w-[120px] text-center">{monthLabel(month)}</span>
          <IconBtn title="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></IconBtn>
        </>)}
        <select value={range ? 'custom' : 'Month'} onChange={e => { const v = e.target.value; if (v === 'custom') setRange(range || { from: month + '-01', to: monthRangeEnd(month) }); else { const p = presets.find(x => x.label === v); setRange(p ? p.get() : null) } }} className={sel} title="Date window">
          {presets.map(p => <option key={p.label} value={p.label}>{p.label === 'Month' ? 'By month' : p.label}</option>)}
          <option value="custom">Custom dates…</option>
        </select>
        <button onClick={() => setAddOpen(true)} title="Add a task — date, assignee, photos and a value; it goes to Breezeway when Breezeway will take it" className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1">+ Add task</button>
        {addOpen ? <AddTaskDialog month={month} onClose={() => setAddOpen(false)} onCreated={() => load(month, range)} /> : null}
        <IconBtn title="Reload" onClick={() => load(month, range)} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></IconBtn>
        <IconBtn title="Download final-approved statements (ZIP)" href={'/api/billing/export?' + winQS + '&format=zip&reviewed=1'}><Download size={14} /></IconBtn>
        <a href="/billing?view=labor" title="The older board: labor vs payroll, rates, bulk edits" className="text-[12px] font-semibold text-muted hover:text-ink px-1">Labor &amp; rates</a>
        <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-white pl-2 pr-1 h-8 text-[12px]">
          <button onClick={translateAll} disabled={!!trBusy && trBusy.endsWith('…')} title="Translate every Spanish title and description in this window to English, and write them back to Breezeway" className="font-semibold text-ink disabled:opacity-50">{trBusy || ('ES → EN' + (spanishCount ? ' (' + spanishCount + ')' : ''))}</button>
          <label className="inline-flex items-center gap-1 text-muted pl-1.5 border-l border-line" title="Translate Spanish to English automatically whenever this desk opens a window">
            <input type="checkbox" checked={autoTr} onChange={async e => { const v = e.target.checked; setAutoTr(v); await fetch('/api/billing/translate', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoTranslate: v }) }).catch(() => {}) }} /> auto
          </label>
        </span>
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
          {st === 'done' ? (
            <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px] h-8">
              {([['summary', 'By owner'], ['rows', 'Every job']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setApMode(k)} title={k === 'summary' ? 'One line per owner — open it for the labour and parts behind the number' : 'The full reviewed rows'}
                  className={'px-2.5 font-semibold border-l border-line first:border-l-0 ' + (apMode === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{l}</button>
              ))}
            </div>
          ) : null}
          <Tip label="Show only rows with a flag"><button onClick={() => setFlaggedOnly(v => !v)} aria-label="Flagged only" className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold inline-flex items-center gap-1.5 ' + (flaggedOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-line text-muted hover:text-ink')}><AlertTriangle size={13} /> Flagged</button></Tip>
          <label className="h-8 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 text-[12px]"><Search size={13} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="unit, task, person, owner" className="w-36 bg-transparent outline-none text-ink" /></label>
          {aiBusy ? <Tag title={'AI is reading ' + aiBusy + ' unit checks / strips — the ones with a real description stay open only if it saw chargeable work'}><Loader2 size={10} className="animate-spin inline mr-1" />AI {aiBusy}</Tag> : null}
          {visible.length ? (
            <button onClick={() => checkMany(visible.map(t => t.id), !visible.every(t => picks.has(t.id)))} title="Tick every row shown, then change or approve them together from the bar below" className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1.5">
              <CheckSquare size={13} /> {visible.every(t => picks.has(t.id)) ? 'Unselect all' : 'Select all shown'}
            </button>
          ) : null}
          {canApproveAll && visible.some(inStage) ? (
            <button onClick={() => setState(visible.filter(inStage).map(t => t.id), approveAllTo)} className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1.5"><Check size={13} /> {approveAllLabel} ({visible.filter(inStage).length})</button>
          ) : null}
        </>} />

      {/* ── filters: billable only, minimum, department, building, person ───────────────────────
            The by-owner summary is a statement total, so the filters do not apply to it and are
            hidden rather than left there doing nothing. */}
      {(
      <div className="flex items-center gap-1.5 flex-wrap">
        <select value={ownerF} onChange={e => setOwnerF(e.target.value)} className={sel} title="Owner">
          <option value="">All owners</option>
          {facets.owners.map(([k, o]) => <option key={k} value={k}>{o.name} ({o.n})</option>)}
        </select>
        <select value={taskF} onChange={e => setTaskF(e.target.value)} className={sel} title="Task — by type, or by the task itself">
          <option value="">All tasks</option>
          <optgroup label="Type">{facets.cats.map(([c, n]) => <option key={'c' + c} value={'cat:' + c}>{CAT_LABEL[c] || c} ({n})</option>)}</optgroup>
          <optgroup label="Task">{facets.names.map(([nm, n]) => <option key={'n' + nm} value={'name:' + nm}>{nm} ({n})</option>)}</optgroup>
        </select>
        <button onClick={() => setBillOnly(v => !v)} title="Only rows that bill the owner something" className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold ' + (billOnly ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-line text-muted hover:text-ink')}>Billable &gt; $0</button>
        <label className="h-8 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 text-[12px] text-muted" title="Amount — at least / at most">$<input value={minAmt} onChange={e => setMinAmt(e.target.value)} inputMode="decimal" placeholder="min" className="w-12 bg-transparent outline-none text-ink tabular-nums" />–<input value={maxAmt} onChange={e => setMaxAmt(e.target.value)} inputMode="decimal" placeholder="max" className="w-12 bg-transparent outline-none text-ink tabular-nums" /></label>
        <select value={bFilter} onChange={e => setBFilter(e.target.value as any)} className={sel} title="The billable model's read">
          <option value="">Billable? — all</option>
          <option value="should">Should bill (still $0)</option>
          <option value="bill">Billable / likely</option>
          <option value="maybe">Maybe — needs a look</option>
          <option value="no">Not billable</option>
        </select>
        <select value={building} onChange={e => setBuilding(e.target.value)} className={sel} title="Building">
          <option value="">All buildings</option>
          {facets.buildings.map(([b, n]) => <option key={b} value={b}>{b} ({n})</option>)}
        </select>
        <select value={person} onChange={e => setPerson(e.target.value)} className={sel} title="Who did it">
          <option value="">Everyone</option>
          {facets.people.map(([p, n]) => <option key={p} value={p}>{p === '—' ? 'No one assigned' : p} ({n})</option>)}
        </select>
        <span className="inline-flex items-center gap-1 flex-wrap">
          {facets.depts.map(([d, n]) => {
            const on = depts.includes(d)
            return <button key={d} onClick={() => setDepts(x => on ? x.filter(y => y !== d) : [...x, d])} title={'Department: ' + d}
              className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold capitalize ' + (on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{d} <span className="opacity-60 tabular-nums">{n}</span></button>
          })}
        </span>
        {filtersOn ? <>
          <Pill tone="brand" title="What the filters show — the header strip stays the whole window">{visible.length} shown · {money(shownTotal)}</Pill>
          <button onClick={clearFilters} className="text-[12px] font-semibold text-muted hover:text-ink px-1">Clear</button>
        </> : null}
      </div>
      )}

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div> : null}

      {/* ── by owner, in an order that never changes ───────────────────────────────────────── */}
      {st === 'done' && apMode === 'summary' ? (
        <ApprovedByOwner owners={approved} open={apOpen} setOpen={setApOpen} winQS={winQS} isGm={isGm} onEdit={onEdit} picks={picks} checkMany={checkMany} filtered={filtersOn} />
      ) : !visible.length ? (
        <LeanEmpty>
          {st === 'ops' ? 'Nothing open for ops to review.' : st === 'gm' ? 'Nothing waiting on final review.' : st === 'done' ? 'Nothing final-approved yet in this window.' : 'No tasks in this window.'}
          {filtersOn ? ' (with the current filters)' : ''}
        </LeanEmpty>
      ) : groups.filter(g => g.rows.length).map(({ owner: o, rows }) => {
        const k = o.ownerId || '—'
        const isOpen = !collapsed[k]
        const actionable = rows.filter(inStage)
        return (
          <section key={k} className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
            <header className="px-4 py-2.5 flex items-center gap-3 flex-wrap bg-app/40 border-b border-line">
              <input type="checkbox" aria-label={'Select all of ' + o.ownerName + '’s rows shown'} title={'Select all ' + rows.length + ' of ' + o.ownerName + '’s rows shown'}
                checked={rows.length > 0 && rows.every(t => picks.has(t.id))} onChange={e => checkMany(rows.map(t => t.id), e.target.checked)} className="h-4 w-4 accent-brand-600 cursor-pointer" />
              <button onClick={() => setCollapsed(c => ({ ...c, [k]: !c[k] }))} className="flex items-center gap-2 text-left min-w-0">
                <ChevronDown size={14} className={'text-muted transition ' + (isOpen ? '' : '-rotate-90')} />
                <span className="text-[14px] font-bold text-ink truncate">{o.ownerName}</span>
              </button>
              <span className="text-[12px] text-muted tabular-nums" title={o.tasks + ' task' + (o.tasks === 1 ? '' : 's') + ' · ' + o.units + ' unit' + (o.units === 1 ? '' : 's') + ' this month'}>
                {money(o.billed)} · {o.tasks}t · {o.units}u
              </span>
              {filtersOn ? <Tag tone="brand" title="What the filters show for this owner">{rows.length} shown · {money(rows.reduce((a, t) => a + t.billedAmount, 0))}</Tag> : null}
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
              {o.ownerId ? <IconBtn title={'Download ' + o.ownerName + '’s sheet (Excel)'} href={'/api/billing/export?' + winQS + '&format=xls&done=1&owner=' + encodeURIComponent(o.ownerId)}><Download size={13} /></IconBtn> : null}
            </header>
            {isOpen ? (
              <ul>
                {rows.map(t => <Row key={t.id} t={t} stage={st} isGm={isGm} busy={busy.has(t.id)} open={openId === t.id} checked={picks.has(t.id)} onCheck={onCheck} onToggle={onToggle} onState={onState} onEdit={onEdit} onText={onText} extra={data.extras?.[t.id]} onExtra={onExtra} onReload={reload} />)}
              </ul>
            ) : null}
          </section>
        )
      })}

      {/* ── THE BULK BAR: what the ticked rows get, together ──────────────────────────────────── */}
      {picks.size ? (() => {
        const picked = tasks.filter(t => picks.has(t.id))
        const total = picked.reduce((a, t) => a + (t.excluded ? 0 : t.billedAmount), 0)
        const notFinal = picked.filter(t => t.reviewState !== 'gm_approved').map(t => t.id)
        const editable = isGm ? picked.map(t => t.id) : notFinal
        const toOps = picked.filter(t => t.reviewState === 'open').map(t => t.id)
        const toGm = picked.filter(t => t.reviewState !== 'gm_approved').map(t => t.id)
        const sendBack = picked.filter(t => t.reviewState !== 'open').map(t => t.id)
        const anyIncluded = picked.some(t => !t.excluded)
        const b = 'h-8 px-2.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40'
        const price = bulkPrice.trim() === '' ? null : Number(bulkPrice.replace(/[$,]/g, ''))
        return (
          <div className="sticky bottom-3 z-20 mx-auto max-w-5xl rounded-2xl bg-ink text-white shadow-2xl ring-1 ring-black/20 px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold tabular-nums">{picks.size} selected · {money(total)}</span>
            <span className="w-px h-5 bg-white/20" />
            {toOps.length ? <button disabled={!!bulkBusy || busy.size > 0} onClick={() => setState(toOps, 'ops_approved')} className={b + ' bg-brand-500 hover:bg-brand-400'}><Check size={13} /> Approve {toOps.length}</button> : null}
            {isGm && toGm.length ? <button disabled={!!bulkBusy || busy.size > 0} onClick={() => setState(toGm, 'gm_approved')} className={b + ' bg-emerald-500 hover:bg-emerald-400'}><Check size={13} /> Final approve {toGm.length}</button> : null}
            {sendBack.length ? <button disabled={!!bulkBusy || busy.size > 0} onClick={() => setState(sendBack, 'open')} className={b + ' bg-white/10 hover:bg-white/20'}><Undo2 size={12} /> Send back {sendBack.length}</button> : null}
            <span className="w-px h-5 bg-white/20" />
            <label className="inline-flex items-center gap-1 text-[12px]">
              <span className="text-white/70">Price all</span>
              <input value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} inputMode="decimal" placeholder="$" className="h-8 w-20 rounded-lg bg-white/10 border border-white/20 px-2 text-right tabular-nums text-white placeholder:text-white/40 outline-none focus:border-white/60" />
              <button disabled={!!bulkBusy || price == null || !Number.isFinite(price) || !editable.length} onClick={() => bulkEdit({ override_amount: price }, 'price').then(() => setBulkPrice(''))} className={b + ' bg-white/10 hover:bg-white/20'} title={isGm ? 'Set this price on every selected row — final-approved ones stay approved' : 'Set this price on every selected row that is not final-approved'}>{bulkBusy === 'price' ? <Loader2 size={12} className="animate-spin" /> : null}Set</button>
              <button disabled={!!bulkBusy || !picked.some(t => t.overrideAmount != null)} onClick={() => bulkEdit({ override_amount: null }, 'clear')} className={b + ' text-white/70 hover:text-white'} title="Back to Breezeway's price on every selected row">clear</button>
            </label>
            <label className="inline-flex items-center gap-1 text-[12px]">
              <span className="text-white/70">Note all</span>
              <input value={bulkNote} onChange={e => setBulkNote(e.target.value)} placeholder="in the owner's words" className="h-8 w-44 rounded-lg bg-white/10 border border-white/20 px-2 text-white placeholder:text-white/40 outline-none focus:border-white/60" maxLength={500} />
              <button disabled={!!bulkBusy || !bulkNote.trim()} onClick={() => bulkEdit({ note: bulkNote.trim() }, 'note').then(() => setBulkNote(''))} className={b + ' bg-white/10 hover:bg-white/20'}>{bulkBusy === 'note' ? <Loader2 size={12} className="animate-spin" /> : null}Add</button>
            </label>
            <button disabled={!!bulkBusy} onClick={() => bulkEdit({ excluded: anyIncluded }, 'excl')} className={b + ' bg-white/10 hover:bg-white/20'} title={anyIncluded ? 'Leave every selected row off the owner statements' : 'Put every selected row back on the owner statements'}>{bulkBusy === 'excl' ? <Loader2 size={12} className="animate-spin" /> : null}{anyIncluded ? 'Leave off statement' : 'Put back on statement'}</button>
            <div className="flex-1" />
            <button onClick={() => setPicks(new Set())} className={b + ' text-white/70 hover:text-white'}>Clear selection</button>
          </div>
        )
      })() : null}

    </div>
  )
}
