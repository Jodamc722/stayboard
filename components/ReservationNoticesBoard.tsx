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
  Trash2, X, Clock, Undo2, Settings, FileText, Download, DownloadCloud, ExternalLink,
} from 'lucide-react'
import { ReservationEmailsAdmin } from './ReservationEmailsAdmin'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Pill, Tag, IconBtn, Tip } from '@/components/lean'

type NTab = 'today' | 'upcoming' | 'sent'

type Draft = { to: string; cc: string; subject: string; body: string; mailto: string; attach: boolean; attachName: string }
type Row = {
  id: string; property_id: string; propertyName: string; propertyMissing: boolean
  unit_no: string; guest_name: string; guest_phone?: string | null; guest_email?: string | null
  arrival_date: string; departure_date?: string | null; eta?: string | null
  adults?: number | null; children?: number | null; pets?: string | null; pet_breed?: string | null
  confirmation_code?: string | null; channel?: string | null
  // Set when the notice came from a Guesty booking rather than being typed by hand — it is what
  // makes the guest name a link straight to that booking.
  reservation_id?: string | null
  // Frozen copy of the email as it went out (migration 016). Present only on sent notices.
  sent_to?: string | null; sent_cc?: string | null; sent_subject?: string | null
  sent_body?: string | null; sent_doc_name?: string | null
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

/** A sent_at timestamp as Eastern "Sep 22, 3:14 PM". */
function when(ts?: string | null): string {
  const t = Date.parse(String(ts || ''))
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
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
  // TODAY · UPCOMING · SENT are tabs (lean pass, 2026-09-22). Upcoming carries its count on the tab:
  // Salato, Nomad and District 225 are told as soon as the booking exists, so their work lives
  // there. Sent work CLOSES OUT into its own tab — still reachable, because a building claiming it
  // was never told is exactly when you need the record, but not in the list you are working.
  const [tab, setTab] = useState<NTab>('today')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<any | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [openDraft, setOpenDraft] = useState<string | null>(null)
  // "Add to drafts" — one click puts this email into support@'s Gmail Drafts (Jon, 2026-08-17).
  const [draftBusy, setDraftBusy] = useState<string | null>(null)
  const [drafted, setDrafted] = useState<Record<string, boolean>>({})
  // The failure reason, shown NEXT TO the button. The first version pushed errors to the banner at
  // the top of the page — invisible from inside a tall draft panel, so a refusal read as "nothing
  // happened" (Jon, 2026-08-17: "not working").
  const [draftErr, setDraftErr] = useState<Record<string, string>>({})
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)

  async function addToDrafts(id: string, d: { to: string; cc: string; subject: string; body: string; wantsForm?: boolean }) {
    setDraftBusy(id); setDraftErr(x => ({ ...x, [id]: '' }))
    try {
      const r = await fetch('/api/reservation-notices/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeId: id, wantsForm: d.wantsForm === true, to: d.to, cc: d.cc, subject: d.subject, body: d.body }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not create the draft.')
      setDrafted(x => ({ ...x, [id]: true }))
      // Say exactly what rode along. A bare draft when a form was expected is the one case the desk
      // must hear about — sending the notice without the registration form is the old failure mode.
      setMsg(j.attached
        ? `Draft created in ${j.from} with ${j.attached} attached — just review and send.`
        : j.formMissing
          ? `Draft created in ${j.from} — but NO form is filed for this notice yet. Hit Build form, then Add to drafts again (it replaces the draft).`
          : `Draft created in ${j.from} — review and send.`)
    } catch (e: any) { setDraftErr(x => ({ ...x, [id]: e.message || String(e) })) } finally { setDraftBusy(null) }
  }
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
    // Reconcile Gmail first: any support@ draft that was SENT since the last visit marks its
    // notice sent before the list below renders (Jon, 2026-08-17). Best-effort and quick — a
    // failure here never blocks the board.
    try { await fetch('/api/reservation-notices/draft?check=1', { cache: 'no-store' }) } catch { /* board loads regardless */ }
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
      if (built) { setMsg('Built ' + built + " form" + (built === 1 ? '' : 's') + " for today's arrivals — filed, and attached to the email drafts by the pipeline."); load() }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  const match = useCallback((r: Row) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return (r.guest_name + ' ' + r.unit_no + ' ' + r.propertyName + ' ' + (r.confirmation_code || '')).toLowerCase().includes(needle)
  }, [q])
  // Today and Upcoming are WORK: unsent only. Everything already sent — whatever day it was for —
  // pools into Sent, newest first, because that list is read as history and not as a queue.
  const todayShown = useMemo(() => today.filter(r => !r.sent_at).filter(match), [today, match])
  const upcomingShown = useMemo(() => upcoming.filter(r => !r.sent_at).filter(match), [upcoming, match])
  const sentShown = useMemo(() => {
    const at = (r: Row) => String(r.sent_at || '')
    return [...today, ...upcoming].filter(r => r.sent_at).filter(match).sort((a, b) => at(b).localeCompare(at(a)))
  }, [today, upcoming, match])

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
      // Download ONLY on a deliberate click. The auto-build on page load used to save too, so
      // just opening the board dumped PDFs into the desk's Downloads — but those forms are
      // already attached to the Gmail drafts by the pipeline (Jon, 2026-08-21: "it automatically
      // requested me to download the files generated... there's no need to do that").
      if (!silent) doc.save(name)
      const raw = String(doc.output('datauristring'))
      const b64 = raw.slice(raw.indexOf(',') + 1)
      const res = await fetch('/api/reservation-notices/document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, name, pdfBase64: b64 }),
      })
      const j = await res.json()
      // On a manual click the download already happened, so a failed FILING must not read as
      // total failure.
      if (!j.ok) { setErr('Form ' + (silent ? 'built' : 'downloaded') + ', but it could not be filed: ' + (j.error || 'unknown error')); return }
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

  const head = (
    <LeanHead title={<span title="Buildings that won't let a guest in until their front desk has been told who is coming. Red means the guest is arriving and nothing has gone out. Recipients, wording and automation live under Settings.">Front-Desk Notices</span>}>
      {counts.late > 0 && <Pill tone="rose" title="Guest arriving today and no notice has gone out">{counts.late} arriving, unsent</Pill>}
      {counts.due > 0 && <Pill tone="amber" title="Past the building's cutoff — send now">{counts.due} past cutoff</Pill>}
      <Pill tone={counts.toSend ? 'brand' : 'emerald'} title="Notices still to send for today">{counts.toSend} to send today</Pill>
      {counts.sentToday > 0 && <Pill tone="emerald" title="Sent for today's arrivals">{counts.sentToday} sent</Pill>}
      {counts.blocked > 0 && <Pill tone="amber" onClick={() => setShowSettings(true)} title="That building has no recipient yet — click to add one in Settings">{counts.blocked} no recipient</Pill>}
    </LeanHead>
  )

  if (needsMigration) {
    return (
      <>
        {head}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-[13px] text-amber-900 space-y-2">
          <div className="font-semibold flex items-center gap-2"><AlertTriangle size={15} /> One migration to run first</div>
          <div>Run <code className="px-1 rounded bg-white border border-amber-200">supabase/migrations/015_reservation_notices.sql</code> in the Supabase SQL editor, then reload this page.</div>
          {/* PostgREST caches the schema, so a freshly-created table still reads as missing until it
              reloads. Same trap as migration 013 — say the fix here rather than let it look broken. */}
          <div>Already ran it and still seeing this? PostgREST is holding a stale schema. Run <code className="px-1 rounded bg-white border border-amber-200">NOTIFY pgrst, &apos;reload schema&apos;;</code> and reload.</div>
        </div>
      </>
    )
  }

  return (
    <div>
      {head}
      <LeanTabs<NTab>
        tabs={[
          { key: 'today', label: 'Today', n: todayShown.length },
          { key: 'upcoming', label: 'Upcoming', n: upcomingShown.length },
          { key: 'sent', label: 'Sent', n: sentShown.length },
        ]}
        value={tab} onChange={setTab}
        right={<>
          {/* Search counts show on every tab, so a match on another tab is never invisible. */}
          <div className="relative w-full sm:w-52">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, unit, building, code…"
              className="rounded-lg border border-line pl-7 pr-6 py-1 text-[12px] w-full" />
            {q.trim() && (
              <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={12} /></button>
            )}
          </div>
          <button onClick={() => { setEditing(null); setForm({ ...EMPTY, property_id: (props.find(p => p.enabled) || props[0] || { id: '' }).id }) }}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 text-white px-2.5 py-1 text-[12px] font-semibold hover:bg-brand-700">
            <Plus size={13} /> New
          </button>
          <IconBtn title="Pull new arrivals from Guesty (runs by itself every 20 min)" onClick={pull} disabled={pulling}>
            {pulling ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
          </IconBtn>
          <IconBtn title="Refresh the list" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </IconBtn>
          <IconBtn title="Settings — recipients, wording, lead time, automation" tone={showSettings ? 'brand' : undefined} onClick={() => setShowSettings(v => !v)}>
            <Settings size={14} />
          </IconBtn>
        </>}
      />

      <div className="space-y-3">
        {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12.5px] text-rose-700 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> {err}</div>}
        {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] text-emerald-700 flex items-center gap-2"><Check size={13} className="shrink-0" /> {msg}</div>}

        {/* The same card as Users & admin, rendered here so the rules can be changed where the work
            happens. Closing it reloads the desk, because a recipient or timing change alters what the
            rows say about themselves. */}
        {showSettings && (
          <div className="space-y-2">
            <ReservationEmailsAdmin isOwner={isOwner} />
            <button onClick={() => { setShowSettings(false); load() }}
              className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line text-muted hover:text-ink">
              Done — back to the list
            </button>
          </div>
        )}

        {form && (
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
              <Mail size={15} className="text-brand-600" />
              <span className="text-sm font-bold text-ink">{editing ? 'Edit notice' : 'New notice'}</span>
              <span className="ml-auto"><Tip label="Close without saving"><button onClick={() => { setForm(null); setEditing(null) }} aria-label="Close without saving" className="text-muted hover:text-ink"><X size={15} /></button></Tip></span>
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

        {tab === 'today' && (
          loading && todayShown.length === 0
            ? <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading…</LeanEmpty>
            : todayShown.length === 0
              ? <LeanEmpty>{q.trim() ? 'No match today.' : 'Nothing arriving today — every building has been told.'}</LeanEmpty>
              : <LeanList>{todayShown.map(renderRow)}</LeanList>
        )}

        {/* UPCOMING READS AS A CALENDAR, NOT A FILING CABINET. What someone needs from the days ahead
            is "what is landing on Saturday", across every building at once — so the day leads, and
            each day's rows keep the building order from Settings. */}
        {tab === 'upcoming' && (
          upcomingShown.length === 0
            ? <LeanEmpty>Nothing upcoming.</LeanEmpty>
            : groupByDay(upcomingShown).map(d => (
              <LeanSection key={d.date} title={dayHeading(d.date, todayDate)} n={d.rows.length}>
                <LeanList>{d.rows.map(renderRow)}</LeanList>
              </LeanSection>
            ))
        )}

        {/* SENT — the closed-out work, grouped by the day it went out, newest first. It reads as a
            record of what was told to whom (the thing you need when a building says it never
            arrived), not as another queue. */}
        {tab === 'sent' && (
          sentShown.length === 0
            ? <LeanEmpty>Nothing sent yet.</LeanEmpty>
            : groupBySentDay(sentShown).map(d => (
              <LeanSection key={d.date} title={'Sent ' + dayHeading(d.date, todayDate)} n={d.rows.length}>
                <LeanList>{d.rows.map(renderRow)}</LeanList>
              </LeanSection>
            ))
        )}
      </div>
    </div>
  )

  // ONE LINE PER NOTICE: Mark sent · guest · building unit · dates · tags · icon actions. The
  // details, the form buttons, Edit / Delete and the email itself are behind the row.
  function renderRow(r: Row) {
    const open = openDraft === r.id
    const pdfTitle = r.doc_path ? 'Registration form built and filed' : 'This building needs the registration form — not built yet'
    return (
      <LeanRow key={r.id} tint={r.sent_at ? 'emerald' : r.urgency === 'late' ? 'rose' : undefined}
        open={open} onToggle={() => setOpenDraft(open ? null : r.id)}
        lead={r.sent_at ? undefined : (
          <Tip label={'Mark sent — asks for your initials and ticks it in Guesty'}>
            <button onClick={() => markSent(r)} className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white text-emerald-700 px-2.5 h-8 text-[12px] font-semibold hover:bg-emerald-50">
              <Check size={13} /> Mark sent
            </button>
          </Tip>
        )}
        name={r.guest_name}
        meta={`${r.propertyName} ${r.unit_no} · ${fmt(r.arrival_date)}${r.departure_date ? '–' + fmt(r.departure_date) : ''}`}
        tags={<>
          {!r.sent_at && r.urgency === 'late' && <Tag tone="roseSolid" title={URGENCY.late.text}>Arriving · unsent</Tag>}
          {!r.sent_at && r.urgency === 'due' && <Tag tone="amber" title={URGENCY.due.text}>Past cutoff</Tag>}
          {r.attach && <Tag tone={r.doc_path ? 'brand' : 'amber'} title={pdfTitle}>{r.doc_path ? 'Form filed' : 'Needs form'}</Tag>}
          {r.propertyMissing && <Tag tone="rose" title="This building is not in Settings">Not configured</Tag>}
          {!r.hasRecipient && !r.propertyMissing && <Tag tone="amber" title="Add a recipient for this building in Settings">No recipient</Tag>}
          {drafted[r.id] && !r.sent_at && <Tag tone="brand" title="Draft is waiting in support@'s Gmail">In drafts</Tag>}
          {r.sent_at && <Tag tone="emerald" title={'Sent ' + when(r.sent_at)}>Sent {fmt(String(r.sent_at).slice(0, 10))}{r.sent_by ? ' · ' + r.sent_by : ''}</Tag>}
        </>}
        actions={<>
          {r.reservation_id && (
            <IconBtn title="Open this booking in Guesty" href={'https://app.guesty.com/reservations/' + encodeURIComponent(r.reservation_id) + '/summary'}><ExternalLink size={14} /></IconBtn>
          )}
          {r.attach && r.doc_path && (
            <IconBtn title={'Open the filed form' + (r.doc_name ? ' — ' + r.doc_name : '')} tone="ok" onClick={() => openFiled(r)}><Download size={14} /></IconBtn>
          )}
          {r.sent_at && <IconBtn title="Not sent — put it back on the list" onClick={() => unmarkSent(r.id)}><Undo2 size={14} /></IconBtn>}
        </>}
      >
        <div className="text-[12px] text-muted flex items-center gap-x-3 gap-y-1 flex-wrap">
          {r.eta && <span>ETA {r.eta}</span>}
          {r.leadHours != null && <span>{r.leadHours}h lead</span>}
          {(r.adults || r.children) ? <span>{r.adults || 0} adult{r.adults === 1 ? '' : 's'}{r.children ? ' · ' + r.children + ' child' + (r.children === 1 ? '' : 'ren') : ''}</span> : null}
          {r.pets && <span>Pet: {r.pets}{r.pet_breed ? ' (' + r.pet_breed + ')' : ''}</span>}
          {r.confirmation_code && <span>{r.channel ? r.channel + ' ' : ''}{r.confirmation_code}</span>}
          {r.sent_at && <span>Sent {when(r.sent_at)}{r.sent_by ? ' by ' + r.sent_by : ''}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {r.attach && !r.sent_at && (
            <button onClick={() => makePdf(r)} disabled={pdfBusy === r.id}
              title={r.doc_path ? 'Rebuild the registration form and replace the filed copy' : 'Build the registration form, download it and file it'}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40">
              {pdfBusy === r.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              {r.doc_path ? 'Rebuild form' : 'Build form'}
            </button>
          )}
          <button onClick={() => startEdit(r)} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line text-muted hover:text-ink">Edit</button>
          <button onClick={() => remove(r.id, r.guest_name)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line text-muted hover:text-rose-600"><Trash2 size={12} /> Delete</button>
        </div>

        {(r.draft || r.sent_body) && (() => {
          // A SENT NOTICE SHOWS WHAT WENT OUT, NOT WHAT WOULD GO OUT NOW. The snapshot is frozen at
          // mark-sent; re-rendering from the current template would quietly rewrite history every
          // time somebody edits a recipient or a line of wording.
          const sentCopy = !!(r.sent_at && r.sent_body)
          const to = sentCopy ? (r.sent_to || '') : (r.draft ? r.draft.to : '')
          const cc = sentCopy ? (r.sent_cc || '') : (r.draft ? r.draft.cc : '')
          const subject = sentCopy ? (r.sent_subject || '') : (r.draft ? r.draft.subject : '')
          const body = sentCopy ? (r.sent_body || '') : (r.draft ? r.draft.body : '')
          const attachName = sentCopy ? (r.sent_doc_name || '') : (r.draft && r.draft.attach ? r.draft.attachName : '')
          return (
            <div className={'rounded-xl border overflow-hidden ' + (sentCopy ? 'border-emerald-300' : 'border-line')}>
              <div className={'px-3 py-2 border-b border-line text-[12px] space-y-0.5 ' + (sentCopy ? 'bg-emerald-50/60' : 'bg-app')}>
                {sentCopy && (
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 pb-1">
                    Sent {fmt(String(r.sent_at).slice(0, 10))}{r.sent_by ? ' by ' + r.sent_by : ''} — exactly as it went out
                  </div>
                )}
                <div><strong>To:</strong> {to || <span className="text-rose-600">nobody — add a recipient in Settings</span>}</div>
                <div><strong>CC:</strong> {cc}</div>
                <div><strong>Subject:</strong> {subject}</div>
                {attachName && (
                  <div className={'flex items-start gap-1.5 pt-1 ' + (r.doc_path ? 'text-emerald-700' : 'text-amber-800')}>
                    <Paperclip size={12} className="mt-0.5 flex-shrink-0" />
                    {sentCopy ? (
                      <span>
                        <strong>{attachName}</strong> went with it.
                        {r.doc_path
                          ? <button onClick={() => openFiled(r)} className="ml-1 font-semibold underline decoration-dotted underline-offset-2 hover:text-emerald-900">Open the report</button>
                          : ' The filed copy is no longer available.'}
                      </span>
                    ) : (
                      <span>
                        <strong>Attach {attachName}</strong> before sending — a mail link can&apos;t carry the file.
                        {r.doc_path
                          ? <> It&apos;s already on the Gmail draft; if you need a copy,<button onClick={() => openFiled(r)} className="ml-1 font-semibold underline decoration-dotted underline-offset-2">open the filed form</button>.</>
                          : ' Hit Build form first.'}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <pre className="px-3 py-2 text-[12px] whitespace-pre-wrap font-sans text-ink">{body}</pre>
              <div className="px-3 py-2 border-t border-line flex items-center gap-2 flex-wrap">
                {!sentCopy && r.draft && (
                  <button onClick={() => addToDrafts(r.id, { to, cc, subject, body, wantsForm: !!r.attach })} disabled={!r.hasRecipient || draftBusy === r.id}
                    title="Creates a ready-to-send draft in support@stay-hospitality.com's Gmail"
                    className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg ' + (drafted[r.id] ? 'border border-emerald-300 text-emerald-700 bg-emerald-50' : r.hasRecipient ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-app text-muted opacity-50 cursor-not-allowed')}>
                    {draftBusy === r.id ? <Loader2 size={13} className="animate-spin" /> : drafted[r.id] ? <Check size={13} /> : <Mail size={13} />}
                    {drafted[r.id] ? 'In support@ drafts' : 'Add to drafts'}
                  </button>
                )}
                {!sentCopy && r.draft && (
                  <a href={r.draft.mailto} className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line ' + (r.hasRecipient ? 'text-muted hover:text-ink' : 'text-muted pointer-events-none opacity-50')}>
                    <Mail size={13} /> Open in mail app
                  </a>
                )}
                <button onClick={() => copyDraft({ to, cc, subject, body } as any)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line text-muted hover:text-ink">
                  <Copy size={13} /> Copy email
                </button>
                {sentCopy && r.doc_path && (
                  <button onClick={() => openFiled(r)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    <Download size={13} /> Open the report
                  </button>
                )}
                {/* A way out at the bottom — where you end up after reading a tall draft. Esc works too. */}
                <button onClick={() => setOpenDraft(null)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line text-muted hover:text-ink">
                  <X size={13} /> Close
                </button>
                {!sentCopy && <span className="text-[11px] text-muted inline-flex items-center gap-1"><Clock size={11} /> Hit Mark sent once it&apos;s gone.</span>}
              </div>
              {draftErr[r.id] && (
                <div className="px-3 pb-2 text-[12px] text-rose-700 flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{draftErr[r.id]}{/support@/.test(draftErr[r.id]) ? <> — connect it under <b>Users &rarr; Morning Ops Brief &rarr; Mailbox connections</b>, signing into Google as support@.</> : null}</span>
                </div>
              )}
            </div>
          )
        })()}
      </LeanRow>
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

  /** Sent rows split by the day they actually went out, newest day first. */
  function groupBySentDay(list: Row[]): { date: string; rows: Row[] }[] {
    // sent_at is a timestamp; the day is read in Eastern so a 9pm send does not file under tomorrow.
    const dayOf = (r: Row) => {
      const t = Date.parse(String(r.sent_at || ''))
      if (!Number.isFinite(t)) return ''
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t))
    }
    const out: { date: string; rows: Row[] }[] = []
    for (const r of list) {
      const d = dayOf(r)
      const last = out[out.length - 1]
      if (last && last.date === d) last.rows.push(r)
      else out.push({ date: d, rows: [r] })
    }
    return out
  }
}
