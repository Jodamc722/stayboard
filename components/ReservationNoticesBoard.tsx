'use client'
// THE DESK — today's building notifications, and what is coming after.
//
// The job this screen exists to prevent: a notice sitting unsent until the guest is at the door.
// TODAY leads, because that is the work; a sent notice STAYS on the day's list wearing a Sent chip
// rather than vanishing, so the day reads as a complete picture of who has been told and who has
// not. Anything overdue and still unsent is dragged into Today no matter how old it is.
//
// Elser is told on the day the guest arrives, so today's Elser forms build themselves on load —
// by the time anyone looks, the PDF is already made and filed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Mail, Loader2, Check, AlertTriangle, Plus, RefreshCw, Search, Paperclip, Copy,
  Trash2, X, Clock, Undo2, Settings, FileText, Download, DownloadCloud, CalendarClock, ChevronDown, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { ReservationEmailsAdmin } from './ReservationEmailsAdmin'

type Draft = { to: string; cc: string; subject: string; body: string; mailto: string; attach: boolean; attachName: string }
type Row = {
  id: string; property_id: string; propertyName: string; propertyMissing: boolean
  unit_no: string; guest_name: string; guest_phone?: string | null; guest_email?: string | null
  arrival_date: string; departure_date?: string | null; eta?: string | null
  adults?: number | null; children?: number | null; pets?: string | null; pet_breed?: string | null
  confirmation_code?: string | null; channel?: string | null
  sent_at?: string | null; sent_by?: string | null
  doc_path?: string | null; doc_name?: string | null
  leadHours: number | null; urgency: 'sent' | 'late' | 'due' | 'upcoming'
  attach: boolean; autoBuild?: boolean; propertyOrder?: number; hasRecipient: boolean; draft: Draft | null
}
type Property = { id: string; name: string; enabled: boolean; attachPdf: boolean; leadHours: number; to: string; timing?: string }
type Counts = { toSend: number; sentToday: number; upcoming: number; upcomingToSend: number; late: number; due: number; blocked: number }

const field = 'w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] bg-white'
const lbl = 'text-[11px] uppercase tracking-wider text-muted font-semibold mb-1 block'

const URGENCY: Record<string, { chip: string; text: string }> = {
  late: { chip: 'bg-rose-100 text-rose-700', text: 'Guest arriving — not sent' },
  due: { chip: 'bg-amber-100 text-amber-800', text: 'Send now — past cutoff' },
  upcoming: { chip: 'bg-app text-muted', text: '' },
  sent: { chip: 'bg-emerald-50 text-emerald-700', text: 'Sent' },
}

function fmt(d?: string | null): string {
  if (!d) return ''
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(d)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return MON[Number(m[2]) - 1] + ' ' + Number(m[3])
}

/**
 * A day heading for the Upcoming list: "Tomorrow · Sat Aug 1". Built from the date STRING, never
 * from `new Date(d)` — that parses a bare yyyy-mm-dd as UTC midnight and renders the day before in
 * Eastern, which on this screen would tell someone a guest arrives Friday when they arrive Saturday.
 */
function dayHeading(d: string, today: string): string {
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(d)
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  // Noon UTC keeps the weekday correct in every timezone west of the date line.
  const dow = DOW[new Date(d + 'T12:00:00Z').getUTCDay()]
  const label = dow + ' ' + fmt(d)
  if (!today) return label
  const days = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
  if (days === 0) return 'Today · ' + label
  if (days === 1) return 'Tomorrow · ' + label
  return label
}

const EMPTY = {
  property_id: '', unit_no: '', guest_name: '', guest_phone: '', guest_email: '',
  arrival_date: '', departure_date: '', eta: '4:00 PM', adults: '', children: '', pets: '', pet_breed: '',
  confirmation_code: '', channel: '',
}

/**
 * `isOwner` only gates EDITING the settings panel below — everyone who can reach this page can see
 * the desk and send. It is resolved on the server (see the page) so the browser cannot claim it.
 */
export function ReservationNoticesBoard({ isOwner = false }: { isOwner?: boolean }) {
  const [today, setToday] = useState<Row[]>([])
  const [upcoming, setUpcoming] = useState<Row[]>([])
  const [props, setProps] = useState<Property[]>([])
  const [counts, setCounts] = useState<Counts>({ toSend: 0, sentToday: 0, upcoming: 0, upcomingToSend: 0, late: 0, due: 0, blocked: 0 })
  const [loading, setLoading] = useState(true)
  const [todayDate, setTodayDate] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // Future bookings are visible by default: Salato, Nomad and District 225 are told as soon as
  // the booking exists, so their work lives in Upcoming — hiding it hides most of the job.
  const [showUpcoming, setShowUpcoming] = useState(true)
  const [q, setQ] = useState('')
  const [form, setForm] = useState<any | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [openDraft, setOpenDraft] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Escape closes the open draft. It is the reflex everyone already has for "get this panel off my
  // screen", and it works no matter how far down the draft you have scrolled.
  useEffect(() => {
    if (!openDraft) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenDraft(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDraft])

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/reservation-notices', { cache: 'no-store' })
      const j = await r.json()
      setProps(Array.isArray(j.properties) ? j.properties : [])
      setToday(Array.isArray(j.today) ? j.today : [])
      setUpcoming(Array.isArray(j.upcoming) ? j.upcoming : [])
      setCounts(j.counts || { toSend: 0, sentToday: 0, upcoming: 0, upcomingToSend: 0, late: 0, due: 0, blocked: 0 })
      // The server's idea of "today" in Eastern, not the browser's — a laptop on another clock
      // must not shift which day the Upcoming headings call Tomorrow.
      setTodayDate(typeof j.todayDate === 'string' ? j.todayDate : '')
      setNeedsMigration(!!j.needsMigration)
      if (!j.ok && !j.needsMigration && j.error) setErr(j.error)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  // Arrival days move; a desk left open overnight should not still be showing yesterday's urgency.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus); window.addEventListener('focus', onFocus)
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
  }, [load])

  /**
   * TODAY'S FORMS BUILD THEMSELVES.
   *
   * Elser is told on the day the guest arrives and the email needs the registration form attached,
   * so waiting for someone to press a button just adds a step that can be forgotten. Anything
   * arriving today that needs a form and hasn't got one gets built and filed on load.
   *
   * Deliberately: only TODAY (never the upcoming list), only unsent rows, only buildings with
   * auto-build left on in Users & admin, one at a time so a dozen arrivals don't fire a dozen
   * uploads at once, and each row is attempted once per session — a failing row must not retry
   * forever on every refresh.
   */
  const autoTried = useRef<Set<string>>(new Set())
  const autoRunning = useRef(false)
  useEffect(() => {
    const queue = today.filter(r => r.autoBuild && !r.doc_path && !r.sent_at && !autoTried.current.has(r.id))
    if (!queue.length || autoRunning.current) return
    autoRunning.current = true
    ;(async () => {
      let built = 0
      for (const r of queue) {
        autoTried.current.add(r.id)
        try { if (await makePdf(r, true)) built++ } catch { /* row-level, keep going */ }
      }
      autoRunning.current = false
      if (built) { setMsg('Built ' + built + " form" + (built === 1 ? '' : 's') + " for today's arrivals — downloaded and filed."); load() }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  const match = useCallback((r: Row) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return (r.guest_name + ' ' + r.unit_no + ' ' + r.propertyName + ' ' + (r.confirmation_code || '')).toLowerCase().includes(needle)
  }, [q])
  const todayShown = useMemo(() => today.filter(match), [today, match])
  const upcomingShown = useMemo(() => upcoming.filter(match), [upcoming, match])

  async function save() {
    if (!form) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const body = editing ? { id: editing, fields: form } : form
      const r = await fetch('/api/reservation-notices', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not save.')
      setForm(null); setEditing(null); setMsg(editing ? 'Updated.' : 'Filed.'); load()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setSaving(false) }
  }

  /**
   * Mark a notice sent.
   *
   * Initials are asked for every time and are required — "sent" with nobody's name against it is
   * the record that falls apart the moment a building says it never arrived. The last initials used
   * are remembered so it is one keystroke, not an interrogation.
   *
   * The same action writes Guesty's "reservation email sent" custom field, so the booking itself
   * shows it too. If that write fails the notice is STILL marked sent here and the banner says the
   * write-back missed — losing our own record because an external API blipped would be worse.
   */
  async function markSent(r: Row) {
    setErr(null); setMsg(null)
    const last = (() => { try { return localStorage.getItem('rn_initials') || '' } catch { return '' } })()
    const initials = (window.prompt('Your initials — recorded against ' + r.guest_name + ' · ' + r.propertyName + ' ' + r.unit_no, last) || '').trim()
    if (!initials) return
    try { localStorage.setItem('rn_initials', initials.toUpperCase()) } catch { /* private mode */ }
    try {
      const j = await fetch('/api/reservation-notices/mark-sent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, initials }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not mark it sent.')
      setMsg('Marked sent by ' + j.initials + '.' + (j.guesty?.ok ? ' Guesty updated.' : ' Guesty not updated — ' + (j.guesty?.note || 'unknown reason') + '.'))
      load()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  /** Undo — puts the notice back on the list as work. */
  async function unmarkSent(id: string) {
    setErr(null)
    try {
      const j = await fetch('/api/reservation-notices', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, markSent: false }),
      }).then(x => x.json())
      if (!j.ok) throw new Error(j.error || 'Could not update.')
      load()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  async function remove(id: string, who: string) {
    if (!confirm('Delete the notice for ' + who + '?\n\nIt stops showing here but is kept as a record.')) return
    try {
      const r = await fetch('/api/reservation-notices?id=' + encodeURIComponent(id), { method: 'DELETE' })
      const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Could not delete.')
      load()
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  /**
   * Fetch upcoming arrivals from Guesty and file whatever is missing.
   *
   * A cron does this every 20 minutes; the button is for when the desk needs to be current right
   * now. Safe to press repeatedly — the pull skips anything already on file.
   */
  async function pull() {
    setPulling(true); setErr(null); setMsg(null)
    try {
      const j = await fetch('/api/reservation-notices/pull', { method: 'POST' }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not pull from Guesty.')
      const per = Object.entries(j.byProperty || {}).map(([k, v]) => k + ' ' + v).join(', ')
      setMsg(
        j.created
          ? 'Filed ' + j.created + ' new notice' + (j.created === 1 ? '' : 's') + (per ? ' — ' + per : '') +
            (j.alreadySent ? ' (' + j.alreadySent + ' already marked sent in Guesty)' : '')
          : 'Nothing new — all ' + j.scanned + ' upcoming arrival' + (j.scanned === 1 ? '' : 's') + ' are already on file.' +
            (j.error ? ' ' + j.error : ''),
      )
      load()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setPulling(false) }
  }

  /**
   * Generate the registration form: download it so it can be attached to the email, AND file it to
   * StayBoard's document store so there is a record of exactly what the building was sent.
   *
   * Built once and used twice — regenerating for the upload would risk the stored copy differing
   * from the one that actually went out.
   */
  async function makePdf(r: Row, silent = false) {
    setPdfBusy(r.id); if (!silent) { setErr(null); setMsg(null) }
    try {
      const mod = await import('@/lib/elser-pdf')
      const doc = await mod.buildElserPdf(r as any)
      // Settings owns the filename (property docName). elserPdfName is only the safety net for a
      // row whose building fell out of the config and therefore has no draft.
      const name = (r.draft && r.draft.attachName) || mod.elserPdfName(r as any)
      doc.save(name)
      const raw = String(doc.output('datauristring'))
      const b64 = raw.slice(raw.indexOf(',') + 1)
      const res = await fetch('/api/reservation-notices/document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, name, pdfBase64: b64 }),
      })
      const j = await res.json()
      // The download already happened, so a failed FILING must not read as total failure.
      if (!j.ok) { setErr('Form downloaded, but it could not be filed: ' + (j.error || 'unknown error')); return }
      if (!silent) setMsg('Form downloaded and filed. Attach it to the email before sending.')
      return true
    } catch (e: any) {
      if (!silent) setErr('Could not build the form: ' + String(e?.message || e))
      return false
    } finally { setPdfBusy(null) }
  }

  /** Re-open a form filed earlier. Links are signed and short-lived, so one is minted on demand. */
  async function openFiled(r: Row) {
    setErr(null)
    try {
      const j = await fetch('/api/reservation-notices/document?id=' + encodeURIComponent(r.id), { cache: 'no-store' }).then(x => x.json())
      if (!j.ok || !j.url) throw new Error(j.error || 'No document filed yet.')
      window.open(j.url, '_blank', 'noopener')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  function copyDraft(d: Draft) {
    const text = 'To: ' + d.to + '\nCC: ' + d.cc + '\nSubject: ' + d.subject + '\n\n' + d.body
    navigator.clipboard.writeText(text).then(() => setMsg('Email copied — paste it into Gmail or Outlook.')).catch(() => setErr('Could not copy.'))
  }

  function startEdit(r: Row) {
    setEditing(r.id)
    setForm({
      property_id: r.property_id, unit_no: r.unit_no, guest_name: r.guest_name,
      guest_phone: r.guest_phone || '', guest_email: r.guest_email || '',
      arrival_date: String(r.arrival_date || '').slice(0, 10),
      departure_date: String(r.departure_date || '').slice(0, 10),
      eta: r.eta || '', adults: r.adults ?? '', children: r.children ?? '',
      pets: r.pets || '', pet_breed: r.pet_breed || '',
      confirmation_code: r.confirmation_code || '', channel: r.channel || '',
    })
  }

  if (needsMigration) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-[13px] text-amber-900 space-y-2">
        <div className="font-semibold flex items-center gap-2"><AlertTriangle size={15} /> One migration to run first</div>
        <div>Run <code className="px-1 rounded bg-white border border-amber-200">supabase/migrations/015_reservation_notices.sql</code> in the Supabase SQL editor, then reload this page.</div>
        {/* PostgREST caches the schema, so a freshly-created table still reads as missing until it
            reloads. Same trap as migration 013 — say the fix here rather than let it look broken. */}
        <div>Already ran it and still seeing this? PostgREST is holding a stale schema. Run <code className="px-1 rounded bg-white border border-amber-200">NOTIFY pgrst, &apos;reload schema&apos;;</code> and reload.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setEditing(null); setForm({ ...EMPTY, property_id: (props.find(p => p.enabled) || props[0] || { id: '' }).id }) }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold hover:bg-brand-700">
          <Plus size={14} /> New notice
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, unit, building, code…"
            className="rounded-lg border border-line pl-8 pr-2.5 py-1.5 text-[13px] w-64" />
          {q.trim() && (
            <button onClick={() => setQ('')} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={13} /></button>
          )}
        </div>
        <button onClick={pull} disabled={pulling}
          title="File any upcoming Guesty arrival that isn't on the desk yet. Runs automatically every 20 minutes."
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40">
          {pulling ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />} Pull from Guesty
        </button>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
        <button onClick={() => setShowSettings(v => !v)}
          title="Recipients, wording, lead time and what gets created automatically"
          className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (showSettings ? 'border-brand-300 text-brand-700 bg-brand-50' : 'border-line text-muted hover:text-ink')}>
          {showSettings ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Settings size={13} /> Settings
        </button>
        <div className="ml-auto flex items-center gap-2 text-[12px]">
          {counts.late > 0 && <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 font-semibold">{counts.late} arriving, unsent</span>}
          {counts.due > 0 && <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-800 font-semibold">{counts.due} past cutoff</span>}
          <span className="text-muted">{counts.toSend} to send today{counts.sentToday ? ' · ' + counts.sentToday + ' sent' : ''}</span>
        </div>
      </div>

      {q.trim() && (
        <div className="text-[12px] text-muted">
          {todayShown.length + upcomingShown.length} match{todayShown.length + upcomingShown.length === 1 ? '' : 'es'} for &ldquo;{q.trim()}&rdquo;
          <span className="text-muted/70"> · searching today and upcoming</span>
        </div>
      )}

      {counts.blocked > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 flex items-center gap-2 flex-wrap">
          <AlertTriangle size={14} />
          {counts.blocked} notice{counts.blocked === 1 ? '' : 's'} can&apos;t be sent — that building has no recipient yet.
          <button onClick={() => setShowSettings(true)} className="inline-flex items-center gap-1 font-semibold underline"><Settings size={12} /> Add one in Settings</button>
        </div>
      )}
      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}
      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

      {/* The same card as Users & admin, rendered here so the rules can be changed where the work
          happens. Closing it reloads the desk, because a recipient or timing change alters what the
          rows say about themselves. */}
      {showSettings && (
        <div className="space-y-2">
          <ReservationEmailsAdmin isOwner={isOwner} />
          <button onClick={() => { setShowSettings(false); load() }}
            className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
            Done — back to the list
          </button>
        </div>
      )}

      {form && (
        <div className="rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <Mail size={15} className="text-brand-600" />
            <span className="text-sm font-bold text-ink">{editing ? 'Edit notice' : 'New notice'}</span>
            <button onClick={() => { setForm(null); setEditing(null) }} className="ml-auto text-muted hover:text-ink"><X size={15} /></button>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className={lbl}>Building *</span>
                <select value={form.property_id} onChange={e => setForm({ ...form, property_id: e.target.value })} className={field}>
                  <option value="">Choose…</option>
                  {props.map(p => <option key={p.id} value={p.id}>{p.name}{p.to.trim() ? '' : ' (no recipient yet)'}</option>)}
                </select>
              </div>
              <div><span className={lbl}>Unit *</span><input value={form.unit_no} onChange={e => setForm({ ...form, unit_no: e.target.value })} className={field} placeholder="e.g. 4418" /></div>
              <div><span className={lbl}>Guest *</span><input value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} className={field} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><span className={lbl}>Arrival *</span><input type="date" value={form.arrival_date} onChange={e => setForm({ ...form, arrival_date: e.target.value })} className={field} /></div>
              <div><span className={lbl}>Departure</span><input type="date" value={form.departure_date} onChange={e => setForm({ ...form, departure_date: e.target.value })} className={field} /></div>
              <div><span className={lbl}>ETA</span><input value={form.eta} onChange={e => setForm({ ...form, eta: e.target.value })} className={field} placeholder="e.g. 4:00 PM" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div><span className={lbl}>Guest phone</span><input value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} className={field} /></div>
              <div><span className={lbl}>Guest email</span><input value={form.guest_email} onChange={e => setForm({ ...form, guest_email: e.target.value })} className={field} /></div>
              <div><span className={lbl}>Adults</span><input type="number" min={0} value={form.adults} onChange={e => setForm({ ...form, adults: e.target.value })} className={field} /></div>
              <div><span className={lbl}>Children</span><input type="number" min={0} value={form.children} onChange={e => setForm({ ...form, children: e.target.value })} className={field} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><span className={lbl}>Pet(s)</span><input value={form.pets} onChange={e => setForm({ ...form, pets: e.target.value })} className={field} placeholder="blank if none" /></div>
              <div><span className={lbl}>Breed</span><input value={form.pet_breed} onChange={e => setForm({ ...form, pet_breed: e.target.value })} className={field} /></div>
              <div><span className={lbl}>Confirmation code</span><input value={form.confirmation_code} onChange={e => setForm({ ...form, confirmation_code: e.target.value })} className={field} /></div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-40">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {editing ? 'Save changes' : 'File it'}
              </button>
              <button onClick={() => { setForm(null); setEditing(null) }} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {section('Today', todayShown, loading)}
      {(counts.upcoming > 0 || upcomingShown.length > 0) && (
        <div>
          <button onClick={() => setShowUpcoming(v => !v)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink mb-2">
            <CalendarClock size={13} />
            {showUpcoming ? 'Hide upcoming' : 'Show upcoming'} · {counts.upcomingToSend} to send
          </button>
          {/* A search must never be swallowed by a collapsed section — while something is typed the
              upcoming block is forced open, otherwise a matching future booking looks like no result. */}
          {(showUpcoming || q.trim().length > 0) && section('Upcoming', upcomingShown, false, true)}
        </div>
      )}
    </div>
  )

  // One row, used by both sections.
  function renderRow(r: Row) {
    const u = URGENCY[r.sent_at ? 'sent' : r.urgency] || URGENCY.upcoming
    return (
            <div key={r.id} className={'border-b border-line last:border-b-0 ' + (r.sent_at ? 'bg-emerald-50/30' : '')}>
              <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink">{r.guest_name}</span>
                    <span className="text-[13px] text-muted">· {r.propertyName} {r.unit_no}</span>
                    {r.attach && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-50 text-brand-700"><Paperclip size={10} /> PDF</span>}
                    {u.text && <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + u.chip}>{u.text}</span>}
                    {r.propertyMissing && <span className="text-[11px] font-semibold text-rose-600">building not configured</span>}
                    {!r.hasRecipient && !r.propertyMissing && <span className="text-[11px] font-semibold text-amber-700">no recipient</span>}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">
                    {fmt(r.arrival_date)}{r.departure_date ? ' – ' + fmt(r.departure_date) : ''}
                    {r.eta ? ' · ETA ' + r.eta : ''}
                    {r.leadHours != null ? ' · ' + r.leadHours + 'h lead' : ''}
                    {r.sent_at ? ' · sent ' + fmt(String(r.sent_at).slice(0, 10)) + (r.sent_by ? ' by ' + r.sent_by : '') : ''}
                  </div>
                </div>
                <button onClick={() => startEdit(r)} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">Edit</button>
                {r.attach && (
                  <button onClick={() => makePdf(r)} disabled={pdfBusy === r.id}
                    title={r.doc_path ? 'Rebuild the registration form and replace the filed copy' : 'Build the registration form, download it and file it'}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40">
                    {pdfBusy === r.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                    {r.doc_path ? 'Rebuild form' : 'Build form'}
                  </button>
                )}
                {r.attach && r.doc_path && (
                  <button onClick={() => openFiled(r)} title={r.doc_name || 'Filed form'}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    <Download size={13} /> Filed
                  </button>
                )}
                {r.draft && (
                  // Toggles. When it IS open the button says so and says how to close it, because a
                  // draft is tall enough to push this row off screen — someone who scrolled down to
                  // read it should not have to hunt back up to work out how to get rid of it.
                  <button onClick={() => setOpenDraft(openDraft === r.id ? null : r.id)}
                    aria-expanded={openDraft === r.id}
                    className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (openDraft === r.id ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700' : 'border-brand-300 text-brand-700 hover:bg-brand-50')}>
                    {openDraft === r.id ? <><X size={13} /> Close draft</> : <><Mail size={13} /> Email draft</>}
                  </button>
                )}
                {r.sent_at
                  ? <button onClick={() => unmarkSent(r.id)} title="Put it back on the list as still to send" className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink"><Undo2 size={13} /> Not sent</button>
                  : <button onClick={() => markSent(r)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50"><Check size={13} /> Mark sent</button>}
                <button onClick={() => remove(r.id, r.guest_name)} className="text-muted hover:text-rose-600" title="Delete"><Trash2 size={14} /></button>
              </div>

              {openDraft === r.id && r.draft && (
                <div className="px-4 pb-4">
                  <div className="rounded-xl border border-line overflow-hidden">
                    <div className="px-3 py-2 bg-app border-b border-line text-[12px] space-y-0.5 relative">
                      <button onClick={() => setOpenDraft(null)} title="Close this draft (Esc)" aria-label="Close draft"
                        className="absolute top-1.5 right-1.5 p-1 rounded-md text-muted hover:text-ink hover:bg-line/60">
                        <X size={14} />
                      </button>
                      <div className="pr-7"><strong>To:</strong> {r.draft.to || <span className="text-rose-600">nobody — add a recipient in Settings</span>}</div>
                      <div><strong>CC:</strong> {r.draft.cc}</div>
                      <div><strong>Subject:</strong> {r.draft.subject}</div>
                      {r.draft.attach && (
                        <div className={'flex items-start gap-1.5 pt-1 ' + (r.doc_path ? 'text-emerald-700' : 'text-amber-800')}>
                          <Paperclip size={12} className="mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>Attach {r.draft.attachName}</strong> before sending — a mail link can&apos;t carry the file.
                            {r.doc_path ? ' It is filed and in your downloads.' : ' Hit Build form first.'}
                          </span>
                        </div>
                      )}
                    </div>
                    <pre className="px-3 py-2 text-[12px] whitespace-pre-wrap font-sans text-ink">{r.draft.body}</pre>
                    <div className="px-3 py-2 border-t border-line flex items-center gap-2 flex-wrap">
                      <a href={r.draft.mailto} className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg ' + (r.hasRecipient ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-app text-muted pointer-events-none opacity-50')}>
                        <Mail size={13} /> Open in mail app
                      </a>
                      <button onClick={() => copyDraft(r.draft!)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                        <Copy size={13} /> Copy email
                      </button>
                      {/* A second way out, at the bottom — where you end up after reading the draft. */}
                      <button onClick={() => setOpenDraft(null)}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink">
                        <X size={13} /> Close
                      </button>
                      <span className="text-[11px] text-muted inline-flex items-center gap-1"><Clock size={11} /> Hit Mark sent once it&apos;s gone.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
    )
  }

  /**
   * A titled block of rows. Sent notices STAY here rather than disappearing — the day should read
   * as a complete record of who has been told and who has not.
   */
  function section(title: string, list: Row[], busy: boolean, byDay = false) {
    const tally = (rows: Row[]) =>
      rows.filter(r => !r.sent_at).length + ' to send' +
      (rows.some(r => r.sent_at) ? ' · ' + rows.filter(r => r.sent_at).length + ' sent' : '')

    // Buildings inside one day, which is what byDay renders under each date heading.
    const buildingBlocks = (rows: Row[]) => groupByProperty(rows).map(g => (
      <div key={g.name}>
        <div className="px-4 py-1.5 bg-app border-b border-line flex items-center gap-2">
          <span className="text-[12px] font-bold text-ink">{g.name}</span>
          <span className="text-[11px] text-muted">{tally(g.rows)}</span>
        </div>
        {g.rows.map(renderRow)}
      </div>
    ))

    return (
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">
          {title} <span className="text-muted/70">· {tally(list)}</span>
        </div>
        <div className="rounded-2xl border border-line bg-white overflow-hidden">
          {busy && list.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
          ) : list.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted">
              {title === 'Today' ? 'Nothing arriving today — every building has been told.' : 'Nothing upcoming.'}
            </div>
          ) : byDay ? (
            // UPCOMING READS AS A CALENDAR, NOT A FILING CABINET. What someone needs from the days
            // ahead is "what is landing on Saturday", across every building at once — grouping by
            // building first buries Saturday's single Nomad arrival forty Elser rows down. So the
            // day leads and the buildings nest inside it, which keeps each building's own block
            // (own recipients, own wording) without hiding the shape of the week.
            groupByDay(list).map(d => (
              <div key={d.date}>
                <div className="px-4 py-2 bg-brand-50/70 border-b border-line flex items-center gap-2 sticky top-0 z-[1]">
                  <CalendarClock size={13} className="text-brand-700 flex-shrink-0" />
                  <span className="text-[12px] font-bold text-brand-800">{dayHeading(d.date, todayDate)}</span>
                  <span className="text-[11px] text-brand-700/80">{tally(d.rows)}</span>
                </div>
                {buildingBlocks(d.rows)}
              </div>
            ))
          ) : buildingBlocks(list)}
        </div>
      </div>
    )
  }

  /**
   * Rows split into arrival days, soonest first, with each day's rows ordered the way the building
   * blocks want them: building order from Settings, then unsent above sent, then guest name.
   *
   * The API sorts Upcoming building-first, so this re-sorts rather than just regrouping — walking
   * the list and starting a new group on each change of date would otherwise scatter one day across
   * as many blocks as there are buildings.
   */
  function groupByDay(list: Row[]): { date: string; rows: Row[] }[] {
    const key = (r: Row) => String(r.arrival_date || '').slice(0, 10)
    const sorted = list.slice().sort((a, b) =>
      key(a).localeCompare(key(b)) ||
      ((a.propertyOrder ?? 999) - (b.propertyOrder ?? 999)) ||
      ((a.sent_at ? 1 : 0) - (b.sent_at ? 1 : 0)) ||
      String(a.guest_name || '').localeCompare(String(b.guest_name || '')))
    const out: { date: string; rows: Row[] }[] = []
    for (const r of sorted) {
      const d = key(r)
      const last = out[out.length - 1]
      if (last && last.date === d) last.rows.push(r)
      else out.push({ date: d, rows: [r] })
    }
    return out
  }

  /** Rows split into building blocks, keeping the order the API already sorted them into. */
  function groupByProperty(list: Row[]): { name: string; rows: Row[] }[] {
    const out: { name: string; rows: Row[] }[] = []
    for (const r of list) {
      const name = r.propertyName || 'Unassigned'
      const last = out[out.length - 1]
      if (last && last.name === name) last.rows.push(r)
      else out.push({ name, rows: [r] })
    }
    return out
  }
}
