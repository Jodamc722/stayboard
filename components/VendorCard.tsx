'use client'
// THE VENDOR, WHEREVER THEIR NAME APPEARS (Jon, 2026-09-24).
//
//   "visual read of project, maybe a hover feature, if you select vendor maybe then opens up
//    vendor info, add or select if a recurring vendor we use regularly … think through how this
//    all interacts with all our process and boards"
//
// Three pieces, shared by the project board, glitches, requests and the Command Center:
//
//   <VendorName>    the vendor's name as a chip. Hover on a desktop, tap on a phone, and the card
//                   opens: contact row (call / text / email), trade, insurance state, last visit,
//                   what is open with them across every board, what they were last here for, and
//                   what we have paid them this year. One fetch per vendor per minute, shared.
//   <VendorPicker>  the same picker everywhere: regulars pinned first with a badge, search by
//                   name / trade / contact, and a name not in the list becomes a vendor right
//                   there — trade, phone, "we use them regularly" and how often — no trip to
//                   Settings. Saving and picking are one action.
//   useVendorDirectory()  the list, fetched once and shared across the page.
//
// WHY A VENDOR IS NOT A PERSON. Our people are assignees: they get notified, they clock in, their
// tasks show in Breezeway. A vendor is a company we call. So the card leads with how to reach
// them and whether we should (insurance), and the picker never mixes them into the assignee list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Truck, Phone, Mail, MessageSquare, ShieldCheck, ShieldAlert, Repeat, ExternalLink, Star, Loader2, X, Clock } from 'lucide-react'
import { VENDOR_TRADES, CADENCES, CADENCE_LABEL, type VendorRecord, type Cadence } from '@/lib/projects-shared'

export type VendorHit = VendorRecord & { coi?: { tone: 'bad' | 'warn' | 'ok'; label: string } | null; lastVisit?: string | null; overdueBy?: number | null }
type Job = { kind: 'project' | 'glitch' | 'request'; id: string; title: string; where: string | null; when: string | null; href: string; done: boolean }
type Summary = {
  vendor: VendorHit; coi: { tone: 'bad' | 'warn' | 'ok'; label: string } | null
  lastVisit: string | null; overdueBy: number | null; open: Job[]; recent: Job[]; invoices: { count: number; cents: number }
}

// ── Directory (shared, one fetch per page) ─────────────────────────────────────────────────────
let dirCache: { at: number; list: VendorHit[] } | null = null
let dirInflight: Promise<VendorHit[]> | null = null
const DIR_TTL = 60_000
async function fetchDirectory(force = false): Promise<VendorHit[]> {
  if (!force && dirCache && Date.now() - dirCache.at < DIR_TTL) return dirCache.list
  if (!dirInflight) {
    dirInflight = fetch('/api/vendors', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const list = (Array.isArray(j?.vendors) ? j.vendors : []) as VendorHit[]
      dirCache = { at: Date.now(), list }; return list
    }).catch(() => dirCache?.list || []).finally(() => { dirInflight = null })
  }
  return dirInflight
}
export function useVendorDirectory() {
  const [vendors, setVendors] = useState<VendorHit[]>(dirCache?.list || [])
  const reload = useCallback(() => { fetchDirectory(true).then(setVendors) }, [])
  useEffect(() => { let on = true; fetchDirectory().then(l => { if (on) setVendors(l) }); return () => { on = false } }, [])
  return { vendors, reload }
}

/** Save (create or update) a vendor and refresh the shared directory. */
export async function saveVendorInline(v: Record<string, any>): Promise<VendorHit | null> {
  try {
    const r = await fetch('/api/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor: v }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j?.vendor) return null
    dirCache = null; sumCache.delete(String(j.vendor.key))
    return j.vendor as VendorHit
  } catch { return null }
}

// ── Summary (one per vendor per minute) ─────────────────────────────────────────────────────────
const sumCache = new Map<string, { at: number; s: Summary | null; p?: Promise<Summary | null> }>()
function fetchSummary(key: string): Promise<Summary | null> {
  const c = sumCache.get(key)
  if (c && c.s && Date.now() - c.at < DIR_TTL) return Promise.resolve(c.s)
  if (c?.p) return c.p
  const p = fetch('/api/vendors/' + encodeURIComponent(key), { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
    .then(j => { const s = j && j.vendor ? (j as Summary) : null; sumCache.set(key, { at: Date.now(), s }); return s })
    .catch(() => { sumCache.delete(key); return null })
  sumCache.set(key, { at: Date.now(), s: null, p })
  return p
}

const telHref = (p: string | null) => p ? 'tel:' + String(p).replace(/[^\d+]/g, '') : null
const smsHref = (p: string | null) => p ? 'sms:' + String(p).replace(/[^\d+]/g, '') : null
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s
const dollars = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US')
function daysAgo(iso: string | null, today: string): string {
  if (!iso) return 'never'
  const d = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86400_000)
  if (d === 0) return 'today'; if (d === 1) return 'yesterday'; if (d < 0) return `in ${-d}d`
  return d < 60 ? `${d} days ago` : d < 400 ? `${Math.round(d / 30)} months ago` : 'over a year ago'
}
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export const KIND_LABEL: Record<Job['kind'], string> = { project: 'Project', glitch: 'Glitch', request: 'Request' }

// ── The card ───────────────────────────────────────────────────────────────────────────────────
function VendorPop({ vendorKey, name, anchor, onClose, pinned }: { vendorKey: string; name: string; anchor: DOMRect; onClose: () => void; pinned: boolean }) {
  const [s, setS] = useState<Summary | null | undefined>(undefined)
  useEffect(() => { let on = true; fetchSummary(vendorKey).then(x => { if (on) setS(x) }); return () => { on = false } }, [vendorKey])
  const today = todayLocal()
  // Below the name when there is room, above it otherwise; never off the right edge.
  const W = 340, H = 360
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200, vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(8, Math.min(anchor.left, vw - W - 8))
  const below = anchor.bottom + 6 + H <= vh || anchor.top - 6 - H < 0
  const style: React.CSSProperties = below ? { top: anchor.bottom + 6, left } : { bottom: vh - anchor.top + 6, left }
  const v = s?.vendor
  const coi = s?.coi
  return (
    <div role="dialog" style={{ position: 'fixed', width: W, zIndex: 70, ...style }}
      className="rounded-2xl border border-line bg-white shadow-xl text-[12.5px] text-ink overflow-hidden"
      onMouseDown={e => e.stopPropagation()}>
      <div className="px-3 pt-2.5 pb-2 border-b border-line flex items-start gap-2">
        <Truck size={14} className="text-muted mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[13.5px] leading-tight truncate">{v?.label || name}</p>
          <p className="text-[11.5px] text-muted truncate">
            {[v?.trade ? cap(v.trade) : null, v?.contact_name].filter(Boolean).join(' · ') || (s === undefined ? 'Loading…' : s === null ? 'Not in the directory' : 'No details saved')}
          </p>
        </div>
        {v?.regular && <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 ring-1 ring-amber-200"><Star size={9} /> Regular</span>}
        {pinned && <button onClick={onClose} className="shrink-0 text-muted hover:text-ink"><X size={13} /></button>}
      </div>
      {s === undefined && <div className="px-3 py-4 text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Looking them up…</div>}
      {s === null && <div className="px-3 py-3 text-muted">Nothing saved for this vendor yet. Pick them from the directory to keep their details.</div>}
      {s && v && (
        <div className="max-h-[300px] overflow-y-auto">
          {/* Reach them */}
          <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap border-b border-line">
            {v.phone ? (<>
              <a href={telHref(v.phone) || '#'} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2 py-1 text-[11.5px] font-bold hover:bg-ink/85"><Phone size={11} /> Call</a>
              <a href={smsHref(v.phone) || '#'} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold hover:bg-app"><MessageSquare size={11} /> Text</a>
              <span className="text-[11.5px] text-muted tabular-nums">{v.phone}</span>
            </>) : <span className="text-[11.5px] text-muted">No phone saved</span>}
            {v.email && <a href={'mailto:' + v.email} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink hover:underline truncate max-w-[150px]"><Mail size={11} /> {v.email}</a>}
          </div>
          {/* Should we send them */}
          <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] border-b border-line">
            <span className={'inline-flex items-center gap-1 font-semibold ' + (coi ? (coi.tone === 'bad' ? 'text-rose-700' : coi.tone === 'warn' ? 'text-amber-700' : 'text-emerald-700') : 'text-muted')}>
              {coi && coi.tone !== 'ok' ? <ShieldAlert size={11} /> : <ShieldCheck size={11} />} {coi ? coi.label : 'No insurance on file'}
            </span>
            <span className="text-muted">{v.w9_on_file ? 'W-9 on file' : 'No W-9'}{v.rate_cents ? ` · ${dollars(v.rate_cents)}/${v.rate_unit || 'job'}` : ''}</span>
            <span className="inline-flex items-center gap-1 text-muted"><Clock size={11} /> Last visit {daysAgo(s.lastVisit, today)}</span>
            {v.regular && v.cadence ? (
              <span className={'inline-flex items-center gap-1 font-semibold ' + (s.overdueBy ? 'text-rose-700' : 'text-muted')}>
                <Repeat size={11} /> {CADENCE_LABEL[v.cadence]}{s.overdueBy ? ` · ${s.overdueBy}d overdue` : ''}
              </span>
            ) : <span className="text-muted">{s.invoices.count ? `${s.invoices.count} invoice${s.invoices.count === 1 ? '' : 's'} · ${dollars(s.invoices.cents)} this year` : 'No invoices this year'}</span>}
            {v.buildings?.length ? <span className="col-span-2 text-muted truncate">Covers {v.buildings.join(', ')}</span> : null}
          </div>
          {/* Open with them, across boards */}
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">{s.open.length ? `Open with them · ${s.open.length}` : 'Nothing open with them'}</p>
            {s.open.map(j => (
              <a key={j.kind + j.id} href={j.href} className="flex items-center gap-2 py-1 hover:bg-app -mx-1 px-1 rounded-md min-w-0">
                <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-app text-muted ring-1 ring-line">{KIND_LABEL[j.kind]}</span>
                <span className="min-w-0 flex-1 truncate">{j.title}</span>
                <span className="shrink-0 text-[11px] text-muted truncate max-w-[90px]">{j.where || ''}</span>
                {j.when && <span className="shrink-0 text-[11px] text-muted tabular-nums">{j.when.slice(5)}</span>}
              </a>
            ))}
            {s.recent.length > 0 && (<>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mt-2 mb-1">Last here for</p>
              {s.recent.slice(0, 3).map(j => (
                <a key={j.kind + j.id} href={j.href} className="flex items-center gap-2 py-0.5 text-muted hover:text-ink min-w-0">
                  <span className="min-w-0 flex-1 truncate">{j.title}</span>
                  {j.when && <span className="shrink-0 text-[11px] tabular-nums">{j.when}</span>}
                </a>
              ))}
            </>)}
          </div>
          {v.notes && <p className="px-3 pb-2 text-[11.5px] text-muted whitespace-pre-line line-clamp-3">{v.notes}</p>}
          <a href="/users?tab=vendors" className="block px-3 py-1.5 border-t border-line text-[11px] text-muted hover:text-ink inline-flex items-center gap-1"><ExternalLink size={10} /> Edit in the directory</a>
        </div>
      )}
    </div>
  )
}

/**
 * The vendor's name, with the card behind it. Hover opens after a short pause and closes when the
 * pointer leaves both the name and the card; a click or tap pins it until dismissed. Without a key
 * (a name typed before the directory existed) it is plain text — nothing to look up.
 */
export function VendorName({ vendorKey, name, className, icon = true, size = 11 }: {
  vendorKey?: string | null; name: string; className?: string; icon?: boolean; size?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState<null | { rect: DOMRect; pinned: boolean }>(null)
  const timer = useRef<any>(null)
  const leave = useRef<any>(null)
  const show = (pinned: boolean) => { if (!ref.current) return; clearTimeout(leave.current); setOpen({ rect: ref.current.getBoundingClientRect(), pinned }) }
  useEffect(() => {
    if (!open?.pinned) return
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as any)) setOpen(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open?.pinned])
  if (!vendorKey) return <span className={'inline-flex items-center gap-1 ' + (className || '')}>{icon && <Truck size={size} className="text-muted shrink-0" />}<span className="truncate">{name}</span></span>
  return (
    <span ref={ref} className={'relative inline-flex items-center gap-1 cursor-pointer ' + (className || '')}
      onMouseEnter={() => { clearTimeout(leave.current); timer.current = setTimeout(() => { if (!open?.pinned) show(false) }, 260) }}
      onMouseLeave={() => { clearTimeout(timer.current); if (!open?.pinned) leave.current = setTimeout(() => setOpen(o => o?.pinned ? o : null), 180) }}
      onClick={e => { e.preventDefault(); e.stopPropagation(); clearTimeout(timer.current); open?.pinned ? setOpen(null) : show(true) }}>
      {icon && <Truck size={size} className="text-muted shrink-0" />}
      <span className="truncate underline decoration-dotted decoration-line underline-offset-2">{name}</span>
      {open && (
        <span onMouseEnter={() => clearTimeout(leave.current)} onMouseLeave={() => { if (!open.pinned) leave.current = setTimeout(() => setOpen(null), 180) }}>
          <VendorPop vendorKey={vendorKey} name={name} anchor={open.rect} pinned={open.pinned} onClose={() => setOpen(null)} />
        </span>
      )}
    </span>
  )
}

// ── The picker ─────────────────────────────────────────────────────────────────────────────────
export type VendorDraft = {
  key: string | null; name: string; contact: string; phone: string; email: string; trade: string
  regular: boolean; cadence: Cadence | ''; save: boolean
}
export const blankVendorDraft = (): VendorDraft => ({ key: null, name: '', contact: '', phone: '', email: '', trade: '', regular: false, cadence: '', save: true })

/**
 * Pick a saved vendor, or type a new one and keep it. Regulars first, always. The "save" tick is ON
 * by default: a vendor typed once and not kept is a vendor typed again next month.
 */
export function VendorPicker({ value, onChange, vendors, disabled, placeholder, autoFocus }: {
  value: VendorDraft; onChange: (v: VendorDraft) => void; vendors: VendorHit[]; disabled?: boolean; placeholder?: string; autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const chosen = value.key ? vendors.find(v => v.key === value.key) || null : null
  const q = value.name.trim().toLowerCase()
  const ordered = useMemo(() => [...vendors].sort((a, b) => Number(!!b.regular) - Number(!!a.regular) || a.label.localeCompare(b.label)), [vendors])
  const hits = q && !chosen
    ? ordered.filter(v => v.label.toLowerCase().includes(q) || String(v.trade || '').toLowerCase().includes(q) || String(v.contact_name || '').toLowerCase().includes(q)).slice(0, 8)
    : ordered.slice(0, 10)
  const exact = q ? ordered.find(v => v.label.toLowerCase() === q) : null

  if (chosen) {
    return (
      <div className="rounded-lg border border-line bg-app/50 px-2.5 py-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-ink truncate inline-flex items-center gap-1.5">
              <VendorName vendorKey={chosen.key} name={chosen.label} icon={false} />
              {chosen.regular && <Star size={10} className="text-amber-600 shrink-0" />}
            </p>
            <p className="text-[11.5px] text-muted truncate">
              {[chosen.trade ? cap(chosen.trade) : null, chosen.contact_name, chosen.phone].filter(Boolean).join(' · ') || 'No contact details saved'}
            </p>
            {chosen.coi && chosen.coi.tone !== 'ok' && (
              <p className={'text-[11px] font-bold mt-0.5 ' + (chosen.coi.tone === 'bad' ? 'text-rose-700' : 'text-amber-700')}>{chosen.coi.label}</p>
            )}
          </div>
          {!disabled && (
            <button type="button" onClick={() => onChange({ ...blankVendorDraft(), save: value.save })} className="text-muted hover:text-rose-600 shrink-0"><X size={12} /></button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <input value={value.name} disabled={disabled} autoFocus={autoFocus}
          onChange={e => { onChange({ ...value, name: e.target.value }); setOpen(true) }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder || 'Which vendor?'}
          className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-ink" />
        {open && hits.length > 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-line bg-white shadow-lg overflow-hidden max-h-64 overflow-y-auto">
            {hits.map(v => (
              <button type="button" key={v.key} onMouseDown={e => e.preventDefault()} onClick={() => { onChange({ ...value, key: v.key, name: v.label, save: false }); setOpen(false) }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-app flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink font-semibold truncate">{v.label}</span>
                  <span className="block text-[11px] text-muted truncate">{[v.trade ? cap(v.trade) : null, v.phone].filter(Boolean).join(' · ') || 'no details saved'}</span>
                </span>
                {v.regular && <span className="shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-50 text-amber-800 ring-1 ring-amber-200"><Star size={8} /> Regular</span>}
                {v.coi && v.coi.tone === 'bad' && <ShieldAlert size={11} className="text-rose-600 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* A NAME NOT IN THE LIST becomes a vendor right here. */}
      {value.name.trim() && !chosen && !exact && !disabled && (
        <div className="mt-1.5 rounded-lg border border-dashed border-line bg-app/40 p-2 space-y-1.5">
          <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
            <input type="checkbox" checked={value.save} onChange={e => onChange({ ...value, save: e.target.checked })} />
            Save “{value.name.trim()}” to the directory
          </label>
          {value.save && (<>
            <div className="grid grid-cols-2 gap-1.5">
              <select value={value.trade} onChange={e => onChange({ ...value, trade: e.target.value })} className="rounded-md border border-line bg-white px-2 py-1 text-[12px]">
                <option value="">Trade…</option>
                {VENDOR_TRADES.map(t => <option key={t} value={t}>{cap(t)}</option>)}
              </select>
              <input value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} placeholder="Phone" inputMode="tel" className="rounded-md border border-line bg-white px-2 py-1 text-[12px]" />
              <input value={value.contact} onChange={e => onChange({ ...value, contact: e.target.value })} placeholder="Contact name" className="rounded-md border border-line bg-white px-2 py-1 text-[12px]" />
              <input value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} placeholder="Email" inputMode="email" className="rounded-md border border-line bg-white px-2 py-1 text-[12px]" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ink">
                <input type="checkbox" checked={value.regular} onChange={e => onChange({ ...value, regular: e.target.checked })} />
                <Star size={10} className="text-amber-600" /> We use them regularly
              </label>
              {value.regular && (
                <select value={value.cadence} onChange={e => onChange({ ...value, cadence: e.target.value as Cadence | '' })} className="rounded-md border border-line bg-white px-1.5 py-0.5 text-[11.5px]">
                  <option value="">How often?</option>
                  {CADENCES.map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
                </select>
              )}
            </div>
          </>)}
        </div>
      )}
    </div>
  )
}

/** Turn a draft into the body saveVendor expects (only the fields the form showed). */
export function vendorDraftBody(d: VendorDraft) {
  return { label: d.name.trim(), contact_name: d.contact, phone: d.phone, email: d.email, trade: d.trade, regular: d.regular, cadence: d.cadence || null }
}

/**
 * A vendor field for a drawer (glitch, request, project task): shows the chosen vendor with the
 * card behind it, or the picker. A new name is saved to the directory first, then picked, so the
 * board row always carries a key and the history follows the vendor across boards.
 */
export function VendorField({ vendorKey, vendorName, canEdit, busy, onPick }: {
  vendorKey: string | null | undefined; vendorName: string | null | undefined; canEdit: boolean; busy?: boolean
  onPick: (v: { key: string | null; name: string | null }) => void | Promise<void>
}) {
  const { vendors, reload } = useVendorDirectory()
  const [draft, setDraft] = useState<VendorDraft>(blankVendorDraft())
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const chosen = vendorKey ? vendors.find(v => v.key === vendorKey) : null
  if (vendorName && !editing) {
    return (
      <div className="flex items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold text-ink truncate inline-flex items-center gap-1.5">
            <VendorName vendorKey={vendorKey} name={vendorName} icon={false} />
            {chosen?.regular && <Star size={10} className="text-amber-600 shrink-0" />}
          </p>
          {chosen && <p className="text-[11.5px] text-muted truncate">{[chosen.trade ? cap(chosen.trade) : null, chosen.phone].filter(Boolean).join(' · ') || 'No contact details saved'}</p>}
          {chosen?.coi && chosen.coi.tone !== 'ok' && <p className={'text-[11px] font-bold ' + (chosen.coi.tone === 'bad' ? 'text-rose-700' : 'text-amber-700')}>{chosen.coi.label}</p>}
          {!chosen && vendorKey === null && canEdit && <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-muted hover:text-ink">Not in the directory · pick or add</button>}
        </div>
        {canEdit && <button type="button" onClick={() => onPick({ key: null, name: null })} disabled={busy} className="text-muted hover:text-rose-600 shrink-0"><X size={12} /></button>}
      </div>
    )
  }
  if (!canEdit) return <p className="text-[12px] text-muted">No vendor picked.</p>
  const commit = async () => {
    if (draft.key) { await onPick({ key: draft.key, name: draft.name }); setEditing(false); setDraft(blankVendorDraft()); return }
    const name = draft.name.trim(); if (!name) return
    setSaving(true)
    const saved = draft.save ? await saveVendorInline(vendorDraftBody(draft)) : null
    setSaving(false)
    if (saved) reload()
    await onPick({ key: saved ? saved.key : null, name: saved ? saved.label : name })
    setEditing(false); setDraft(blankVendorDraft())
  }
  return (
    <div className="space-y-1.5">
      <VendorPicker value={draft} onChange={setDraft} vendors={vendors} disabled={busy || saving} placeholder="Who is doing this?" autoFocus={editing} />
      {(draft.key || draft.name.trim()) && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={commit} disabled={busy || saving}
            className="rounded-lg bg-ink text-white px-2.5 py-1 text-[11.5px] font-bold hover:bg-ink/85 disabled:opacity-40 inline-flex items-center gap-1">
            {saving ? <Loader2 size={11} className="animate-spin" /> : null} {draft.key ? 'Use this vendor' : draft.save ? 'Save and use' : 'Use this name'}
          </button>
          {editing && <button type="button" onClick={() => { setEditing(false); setDraft(blankVendorDraft()) }} className="text-[11.5px] text-muted hover:text-ink">Cancel</button>}
        </div>
      )}
    </div>
  )
}

/**
 * Regular vendors who are past their own cadence — the pest company that has not been out this
 * month. Says nothing when nobody is overdue. Meant for the Command Center.
 */
export function RegularVendorsDue({ className }: { className?: string }) {
  const { vendors } = useVendorDirectory()
  const today = todayLocal()
  const due = vendors.filter(v => v.regular && v.cadence && (v.overdueBy || (!v.lastVisit)))
  if (!due.length) return null
  return (
    <section className={className || 'rounded-2xl border border-line bg-white overflow-hidden'}>
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <Repeat size={14} className="text-muted" />
        <h2 className="text-[13.5px] font-bold text-ink">Regular vendors due <span className="text-muted font-semibold tabular-nums">{due.length}</span></h2>
      </div>
      <div className="divide-y divide-line">
        {due.slice(0, 6).map(v => (
          <div key={v.key} className="px-4 py-2 flex items-center gap-2 min-w-0">
            <span className="text-[12.5px] font-semibold text-ink truncate flex-1 min-w-0"><VendorName vendorKey={v.key} name={v.label} icon={false} /></span>
            <span className="shrink-0 text-[11px] text-muted">{v.cadence ? CADENCE_LABEL[v.cadence] : ''} · last {daysAgo(v.lastVisit || null, today)}</span>
            {v.overdueBy ? <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200">{v.overdueBy}d overdue</span>
              : <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">never booked</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
