'use client'
import PolishButton from './PolishButton'
// GLITCH BOARD — the Asana "VR Glitch/Incident Reporting" workflow, rebuilt in-app.
// Pool → Ops → Guest Followup → Refund → Manager Review → Incident → Closed.
// Create a glitch by searching the guest name (reservation details auto-attach), push a
// Breezeway task for the field, and move the card along the escalation path.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, RefreshCw, Search, X, User2, Trash2, Loader2, Pencil, GraduationCap, Check } from 'lucide-react'
import { Pill, Tag, IconBtn } from './lean'
import { StayPanel } from './StayPanel'
import { VendorField, VendorName } from './VendorCard'
import CommentThread from './CommentThread'
import { DeleteButton, UndoBar, TrashDrawer } from './DeleteControl'
import { Sheet } from './Sheet'
import { StepDots, StepBar, Field, Chips, type Step } from './Steps'
import { ImageDrop } from './ImageDrop'
import { RefundTraining, TeachFromGlitch } from './RefundTraining'
import { useAccess } from '@/lib/useAccess'

type Glitch = {
  id: string; status: string; glitch_type: string | null; category: string | null
  listing_id: string | null; unit: string | null; market: string | null
  reservation_id: string | null; guest_name: string | null; guest_phone: string | null
  channel: string | null; check_in: string | null; check_out: string | null
  reservation_total: number | null; incident_date: string | null; overview: string | null
  refund_approved: number | null; reported_by: string | null; guest_email: string | null
  breezeway_task_id: string | null; photos: string[] | null; task_status: string | null; task_report_url?: string | null
  reservation_notes: string | null; sentiment: { score?: number; band?: string; dissatisfied?: boolean; topIssue?: string | null; excerpt?: string | null } | null
  due_date?: string | null; assignee?: string | null; assignee_person_id?: number | null; details?: string | null; progress?: number | null
  vendor_key?: string | null; vendor_name?: string | null
  vendor_visit_on?: string | null; vendor_visit_window?: string | null; vendor_team_told_at?: string | null; vendor_team_told_for?: string | null
  // How it reached us and how the guest sounded — both feed the refund model (migration 060).
  reported_via?: string | null; guest_tone?: string | null
  // Migration 086 — how this issue is treated, independent of any Breezeway task.
  priority?: string | null
  // Migration 085: the advisor's number kept beside the human decision, and the approval state.
  refund_recommended?: number | null; refund_reasoning?: any; refund_note?: string | null
  refund_needs_approval?: boolean | null; refund_approved_by?: string | null; refund_approved_at?: string | null
  closed_at?: string | null; closed_at_estimated?: boolean | null
  history?: any[] | null
  created_at: string
}
type ResMatch = { reservationId: string; listingId: string; unit: string; market: string; guestName: string; guestPhone: string | null; guestEmail: string | null; checkIn: string; checkOut: string; channel: string | null; total: number | null; notes: string | null; sentiment: { score?: number; band?: string; dissatisfied?: boolean; topIssue?: string | null; excerpt?: string | null } | null; guestyUrl: string }

function dueState(due: string | null | undefined, closed: boolean): { label: string; cls: string } | null {
  if (!due) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const days = Math.round((new Date(due + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000)
  if (closed) return { label: 'due ' + due.slice(5), cls: 'bg-app text-muted border-line' }
  if (days < 0) return { label: Math.abs(days) + 'd overdue', cls: 'bg-rose-600 text-white border-rose-600' }
  if (days === 0) return { label: 'due today', cls: 'bg-amber-500 text-white border-amber-500' }
  if (days === 1) return { label: 'due tomorrow', cls: 'bg-amber-50 text-amber-800 border-amber-300' }
  return { label: 'due ' + due.slice(5) + ' (' + days + 'd)', cls: 'bg-white text-muted border-line' }
}

// ── FOUR LANES, NOT SEVEN (Jon, 2026-09-15: "the way it looks is quite confusing") ─────────────
//
// The board had a lane each for Refund request, Manager review and Incident report. None of those
// is a stage of WORK — they are facts about a card that is still somewhere in the process. A glitch
// waiting on a refund decision is still with ops; filing it under "Refund request" moved it out of
// the queue it actually belonged to and cost a whole column to say one word that now fits on the
// card as a badge. Seven lanes also meant a sideways-scrolling board where five lanes were empty,
// so the two real cards were never on screen together.
//
// So: four lanes for where the work is, badges for what is true about it. `statuses` keeps every
// historical value readable — nothing in the database has to change for the board to make sense —
// and `write` is the one status a drop into that lane records.
export type Lane = { key: string; label: string; hint: string; write: string; statuses: string[] }
//
// SIX, SINCE 2026-10-02 (Sulaman via Jon: "can you create the 'refund' and 'manager review' columns,
// please?"). Refund and Manager review came back as lanes because the desk works them as queues —
// "what is waiting on a refund decision" and "what is waiting on a manager" are lists people open,
// not badges they scan for. Manager review is also where a card lands when the team marks it
// complete (the approval gate), so the column IS the manager's inbox.
export const LANES: Lane[] = [
  { key: 'open',     label: 'Open',            hint: 'nobody has picked it up',          write: 'pool',            statuses: ['pool', ''] },
  { key: 'ops',      label: 'With ops',        hint: 'being fixed',                      write: 'ops',             statuses: ['ops', 'incident'] },
  // The order is the order of the work (Jon, 2026-10-03: "after ops review, it should be Guest
  // follow-up"): fix it, tell the guest, settle any refund, then a manager signs it off.
  { key: 'followup', label: 'Guest follow-up', hint: 'fixed, guest still owed a reply',  write: 'guest_followup',  statuses: ['guest_followup'] },
  { key: 'refund',   label: 'Refund',          hint: 'waiting on a refund decision',     write: 'refund',          statuses: ['refund'] },
  { key: 'review',   label: 'Manager review',  hint: 'marked complete — a manager approves the close', write: 'manager_review', statuses: ['manager_review'] },
  { key: 'closed',   label: 'Closed',          hint: 'done and answered',                write: 'closed',          statuses: ['closed', 'done', 'resolved'] },
]
export function laneOf(status: string | null | undefined): Lane {
  const s = String(status || '')
  return LANES.find(l => l.statuses.indexOf(s) >= 0) || LANES[0]
}
const TYPES = ['Glitch (Quality Issue)', 'Security Incident', 'Injury']
const CATS = [
  'Maintenance - HVAC/Temperature', 'Maintenance - Water Heater', 'Maintenance - Plumbing',
  'Maintenance - Electrical', 'Maintenance - Building/Common Areas', 'Maintenance - Appliances',
  'Cleanliness - Inadequate Cleaning', 'Pests/Bed Bugs', 'Safety/Security Concern', 'Parking/Vehicle', 'Other',
]
// THE TRADE, NOT THE CATEGORY (Jon, 2026-09-15: "should show, pest or plumbing").
//
// The category was already on the card, but as prose sharing a line with the guest's name —
// "Maintenance - Plumbing" reads as a filing label. What a coordinator needs at a glance is WHO
// they are sending: a plumber, an exterminator, a housekeeper. Same field, said as the job, and
// coloured so a column can be sorted by eye without reading it.
function tradeOf(category: string | null | undefined): { label: string; cls: string } | null {
  const c = String(category || '')
  if (!c) return null
  if (/pest|bed\s*bug/i.test(c))   return { label: 'Pest',       cls: 'bg-lime-50 text-lime-800 ring-lime-200' }
  if (/plumb/i.test(c))            return { label: 'Plumbing',   cls: 'bg-sky-50 text-sky-800 ring-sky-200' }
  if (/hvac|temperature/i.test(c)) return { label: 'HVAC',       cls: 'bg-cyan-50 text-cyan-800 ring-cyan-200' }
  if (/water\s*heater/i.test(c))   return { label: 'Hot water',  cls: 'bg-cyan-50 text-cyan-800 ring-cyan-200' }
  if (/electric/i.test(c))         return { label: 'Electrical', cls: 'bg-amber-50 text-amber-800 ring-amber-200' }
  if (/applian/i.test(c))          return { label: 'Appliance',  cls: 'bg-violet-50 text-violet-800 ring-violet-200' }
  if (/clean/i.test(c))            return { label: 'Cleaning',   cls: 'bg-teal-50 text-teal-800 ring-teal-200' }
  if (/safety|security/i.test(c))  return { label: 'Safety',     cls: 'bg-rose-50 text-rose-800 ring-rose-200' }
  if (/parking|vehicle/i.test(c))  return { label: 'Parking',    cls: 'bg-app text-muted ring-line' }
  if (/building|common/i.test(c))  return { label: 'Building',   cls: 'bg-app text-muted ring-line' }
  // Anything unmapped still says something rather than nothing — minus the filing prefix.
  const short = c.replace(/^(Maintenance|Cleanliness)\s*-\s*/i, '').trim()
  return short && !/^other$/i.test(short) ? { label: short, cls: 'bg-app text-muted ring-line' } : null
}

/** Is the guest in the unit right now? That is what decides whether a job can be scheduled today. */
function stayState(checkIn: string | null | undefined, checkOut: string | null | undefined): { now: boolean; label: string } {
  const ci = String(checkIn || '').slice(0, 10)
  const co = String(checkOut || '').slice(0, 10)
  const today = todayET()
  if (!ci) return { now: false, label: '' }
  if (ci > today) return { now: false, label: 'Arrives' }
  if (co && co <= today) return { now: false, label: 'Checked out' }
  return { now: true, label: 'In house' }
}

function fmtShort(iso: string | null) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); if (isNaN(d.getTime())) return iso || ''; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function money(n: number | null) { return n == null ? null : '$' + Math.round(n).toLocaleString() }
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

// Stored photos used to be public bucket URLs. New ones are PRIVATE storage paths read back
// through a signed-url route (see app/api/glitches/photo/route.ts). Old rows keep working because
// anything that already looks like a URL is passed straight through.
function glitchPhotoSrc(u: string): string {
  const v = String(u || '')
  if (!v) return ''
  if (/^https?:\/\//i.test(v) || v.indexOf('data:') === 0) return v
  return '/api/glitches/photo?path=' + encodeURIComponent(v)
}

// The chips shown on the New-issue sheet. Short labels for a phone; the VALUES are the existing
// Asana categories verbatim, because `deptFor(category)` routes the Breezeway task off them and
// every historic glitch is filed under them. The first seven show by default, the rest behind
// "More categories" — a dropdown hides every option until you open it, chips do not.
const CAT_CHIPS: { value: string; label: string }[] = [
  { value: 'Maintenance - HVAC/Temperature', label: 'Temperature / AC' },
  { value: 'Maintenance - Water Heater', label: 'Hot water' },
  { value: 'Cleanliness - Inadequate Cleaning', label: 'Cleanliness' },
  { value: 'Maintenance - Plumbing', label: 'Plumbing' },
  { value: 'Maintenance - Appliances', label: 'Appliance' },
  { value: 'Maintenance - Electrical', label: 'Electrical' },
  { value: 'Pests/Bed Bugs', label: 'Pests' },
  { value: 'Maintenance - Building/Common Areas', label: 'Building / common areas' },
  { value: 'Safety/Security Concern', label: 'Safety / security' },
  { value: 'Parking/Vehicle', label: 'Parking' },
  { value: 'Other', label: 'Something else' },
]

// The order of the phone call, not the order of the table.
const STEPS: Step[] = [
  { key: 'who', label: 'Who' },
  { key: 'what', label: 'What happened' },
  { key: 'send', label: 'Send it' },
]
function SentimentChip({ s }: { s: { band?: string; dissatisfied?: boolean; topIssue?: string | null } | null }) {
  if (!s || !s.band) return null
  const bad = s.dissatisfied || /neg|bad|angry|upset/i.test(String(s.band))
  const mid = /mix|neutral|warn/i.test(String(s.band))
  return <span className={'text-[9px] font-semibold px-1.5 py-0.5 rounded border ' + (bad ? 'bg-rose-100 text-rose-800 border-rose-300' : mid ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>Sentiment: {s.band}{s.topIssue ? ' · ' + s.topIssue : ''}</span>
}

export function GlitchBoard() {
  const [glitches, setGlitches] = useState<Glitch[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)   // at least one successful read of the board
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [open, setOpen] = useState<string>('')
  const [people, setPeople] = useState<{ id: number; name: string; departments: string[] }[]>([])
  const [refundFor, setRefundFor] = useState('')  // glitch id whose refund logger is open
  const [showTrash, setShowTrash] = useState(false)
  const [undo, setUndo] = useState<{ trashId: string; label: string } | null>(null)
  // TRAIN THE ADVISOR (Jon, 2026-09-22) — admins and glitch-board leads only. Read once here and
  // handed to each card's refund section, which used to fetch it again on every open.
  const [canTrain, setCanTrain] = useState(false)
  const [showTrain, setShowTrain] = useState(false)
  useEffect(() => { fetch('/api/glitches/training', { cache: 'no-store' }).then(r => r.json()).then(j => setCanTrain(!!j?.canTrain)).catch(() => {}) }, [])
  // WHO SIGNS OFF A REFUND OVER THE CAP: full access on Glitches (the server checks the same).
  // Not shown while access is still loading — the hook reports full until it knows.
  const acc = useAccess()
  const canApprove = !acc.loading && acc.atLeast('glitches', 'full')

  // DEEP LINKS (2026-09-28 audit, D11). /glitches?id=<glitch> — the Slack vendor post, vendor jobs,
  // vendor visits and the Command Center — opens that card; ?q=<unit or words> narrows the board to
  // it. Both used to land on the whole unfiltered board (q only ever reached the History tab).
  const [q, setQ] = useState('')
  const linked = useRef('')
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const id = (sp.get('id') || '').trim()
      if (id) { linked.current = id; setOpen(id) }
      const qq = (sp.get('q') || '').trim()
      if (qq) setQ(qq)
    } catch { /* no URL, no deep link */ }
  }, [])
  // Closing a linked card drops ?id= from the address, so a reload does not reopen it.
  const closeCard = () => {
    setOpen(''); setRefundFor('')
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.has('id')) { u.searchParams.delete('id'); window.history.replaceState(null, '', u.pathname + u.search) }
    } catch { /* cosmetic */ }
  }

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/glitches', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setGlitches(j.glitches || [])
      setLoaded(true)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])

  const act = async (id: string, body: Record<string, any>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Action failed'); return }
      if (body.action === 'checkTask') {
        if (j.suggestFollowup && window.confirm('Breezeway task is ' + j.taskStatus + '. Move this glitch to Guest followup?')) { await act(id, { action: 'move', status: 'guest_followup' }); return }
        window.alert('Breezeway task status: ' + j.taskStatus)
        return
      }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  const needle = q.trim().toLowerCase()
  const rows = (market === 'all' ? glitches : glitches.filter(g => g.market === market))
    .filter(g => !needle || [g.unit, g.overview, g.guest_name].some(v => String(v || '').toLowerCase().indexOf(needle) >= 0))
  const markets = ['all', 'Miami', 'Broward', 'North', 'Vendor']
  // The open card is looked up from the live list, not copied into state, so an edit or a refund
  // refreshes what the sheet is showing without anyone having to close and reopen it.
  const openGlitch = open ? glitches.find(g => g.id === open) || null : null
  // A link to a card that is no longer on the board says so, instead of opening nothing.
  useEffect(() => {
    if (!loaded || !linked.current || open !== linked.current) return
    if (!glitches.some(g => g.id === linked.current)) { setErr('That glitch is not on the board any more — it may have been deleted (see Recently deleted).'); setOpen('') }
    linked.current = ''
  }, [loaded, glitches, open])

  if (loading && !glitches.length) return <div className="text-sm text-muted py-10 text-center">Loading glitch board…</div>

  return (
    <div>
      {/* ONE LINE: the verb, the market filter, the board's numbers, then the quiet tools. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <button onClick={() => setShowNew(true)} className="text-[12.5px] font-semibold px-2.5 py-1 rounded-lg bg-ink text-white inline-flex items-center gap-1"><Plus size={13} /> New glitch</button>
        <select value={market} onChange={e => setMarket(e.target.value)} title="Market" className="text-[12px] py-1 pl-2 pr-6 rounded-lg border border-line bg-white">
          {markets.map(m => <option key={m} value={m}>{m === 'all' ? 'All markets' : m}</option>)}
        </select>
        {q ? (
          <button onClick={() => setQ('')} title={'Showing only cards that mention “' + q + '” — click to show the whole board'}
            className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100">
            <Search size={11} /> {q} <X size={11} />
          </button>
        ) : null}
        <GlitchKpis rows={rows} />
        <span className="ml-auto flex items-center gap-1">
          {canTrain ? <IconBtn title="Train the refund advisor" tone="brand" onClick={() => setShowTrain(true)}><GraduationCap size={14} /></IconBtn> : null}
          <IconBtn title="Recently deleted glitches (restore)" onClick={() => setShowTrash(!showTrash)}><Trash2 size={13} /></IconBtn>
          <IconBtn title="Reload the board" onClick={() => { setLoading(true); load() }}><RefreshCw size={13} /></IconBtn>
        </span>
      </div>
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {showTrash && <TrashDrawer kind="glitch" onRestored={load} onClose={() => setShowTrash(false)} />}
      <Sheet open={showTrain} onClose={() => setShowTrain(false)} title="Train the refund advisor" subtitle="House guidance and saved cases — read on every recommendation">
        {showTrain ? <RefundTraining compact /> : null}
      </Sheet>
      {showNew && <NewGlitch onDone={() => { setShowNew(false); load() }} onCancel={() => setShowNew(false)} />}

      {/* FOR MANAGERS: what is waiting on your signature (Jon, 2026-10-02). Cards the team marked
          complete sit in Guest follow-up with a badge; this row puts them one click away. */}
      {canApprove && rows.some(g => String(g.status) === 'manager_review') ? (
        <div className="mb-3 rounded-2xl border border-violet-200 bg-violet-50/60 px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-bold text-violet-900">{rows.filter(g => String(g.status) === 'manager_review').length} awaiting your approval</span>
          {rows.filter(g => String(g.status) === 'manager_review').slice(0, 8).map(g => (
            <button key={g.id} onClick={() => setOpen(g.id)} className="text-[12px] font-semibold px-2 h-7 rounded-lg bg-white border border-violet-200 text-violet-900 hover:border-violet-400">
              {g.unit || 'No unit'}{g.assignee ? ' · ' + g.assignee.split(' ')[0] : ''}
            </button>
          ))}
        </div>
      ) : null}

      {/* FOUR LANES FIT. The old seven scrolled sideways on every screen, so the board could never
          be read in one look — which is most of what "confusing" meant. On a phone the lanes still
          snap one at a time; on a desktop they simply fit. */}
      {/* SIDEWAYS, LIKE ASANA (Sulaman via Jon, 2026-10-03: "the task width is becoming smaller, and
          even the unit number is now hidden … make the screen horizontally scrollable"). Every lane
          keeps a full card width whatever the count of lanes; the board scrolls across and snaps a
          lane at a time on a phone. */}
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory items-start" style={{ scrollbarGutter: 'stable' }}>
        {LANES.map(lane => {
          const cards = rows.filter(g => laneOf(g.status).key === lane.key)
          return (
            <div key={lane.key} className="rounded-2xl bg-app/70 border border-line w-[86vw] sm:w-[300px] shrink-0 snap-start">
              <div className="px-3 py-2 border-b border-line flex items-center gap-2" title={lane.label + ' — ' + lane.hint}>
                <span className="text-[12px] font-bold text-ink">{lane.label}</span>
                <span className={'text-[11px] font-bold tabular-nums px-1.5 rounded ' + (cards.length ? 'bg-ink text-white' : 'text-faint')}>{cards.length}</span>
              </div>
              <div className="p-1.5 space-y-1.5 min-h-[56px]"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  if (id) act(id, { action: 'move', status: lane.write })
                }}>
                {cards.map(g => (
                  <GlitchCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />
                ))}
                {cards.length === 0 && <p className="text-[11px] text-faint text-center py-4">Nothing here</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* THE DETAIL IS A SHEET, NOT AN ACCORDION. Everything below used to unfold inside a 288px
          lane: the refund logger, the stay, the photos, three panels and the comment thread, all
          stacked in a column narrower than a phone. The card is a summary now and the whole record
          opens in the same pop-up the New glitch form already uses. */}
      {openGlitch && (
        <GlitchDetail
          g={openGlitch}
          people={people}
          onClose={closeCard}
          onChanged={load}
          act={act}
          canTrain={canTrain}
          canApprove={canApprove}
          openRefund={refundFor === openGlitch.id}
          onDeleted={(trashId, label) => { setUndo({ trashId, label }); setOpen(''); load() }}
        />
      )}

      {undo && <UndoBar item={undo} onUndone={() => { setUndo(null); load() }} onDismiss={() => setUndo(null)} />}
    </div>
  )
}

// ── THE RECORD, ASANA-STYLE (Jon, 2026-09-22) ───────────────────────────────────────────────────
// "Tabs is not great vs Asana style — the team thinks it's a bit clunky, they are used to Asana."
// "We need to also be able to see reported date, check-in date and check-out date." "Maybe a
// ticker, days open."
//
// One scrolling page, the way an Asana task reads: a Mark complete button and a live "open for"
// clock at the top, the issue as the title, then a column of labelled fields — status, priority,
// assignee, due, reported, check-in, check-out, guest, booking, the Breezeway job, the refund —
// then the description, photos, and the sections that used to hide behind tabs, each with its own
// heading and a fold. Comments and the card's activity sit at the bottom, where Asana puts them.
// Nothing is behind a tab any more; the whole record is one scroll.

/** "3d 4h", "5h 12m", "14m" — the length of an interval, short. */
function span(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d > 0) return d + 'd ' + h + 'h'
  if (h > 0) return h + 'h ' + mm + 'm'
  return mm + 'm'
}
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtDay(ymd: string | null | undefined): string {
  const s = String(ymd || '').slice(0, 10)
  if (!s) return ''
  const d = new Date(s + 'T12:00:00')
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** A labelled row, Asana's field layout: label on the left, value on the right. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] sm:grid-cols-[140px_1fr] gap-3 items-start py-1.5">
      <span className="text-[12.5px] text-muted pt-0.5">{label}</span>
      <div className="text-[13px] text-ink min-w-0">{children}</div>
    </div>
  )
}

/** A heading with a fold — every section is on the page, any of them can be tucked away. */
function Fold({ title, hint, open: start = true, children }: { title: string; hint?: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(start)
  return (
    <section className="border-t border-line pt-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 text-left">
        <span className={'text-[11px] text-muted transition-transform ' + (open ? 'rotate-90' : '')}>▶</span>
        <span className="text-[14px] font-bold text-ink">{title}</span>
        {hint ? <span className="text-[12px] text-muted truncate">{hint}</span> : null}
      </button>
      {open ? <div className="mt-2.5">{children}</div> : null}
    </section>
  )
}

function fmtPhone(v: string | null | undefined): string {
  const d = String(v || '').replace(/\D/g, '')
  const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return t.length === 10 ? '(' + t.slice(0, 3) + ') ' + t.slice(3, 6) + '-' + t.slice(6) : String(v || '')
}

/** ASSIGN IT WHERE YOU SEE IT (Jon, 2026-09-22: "need to be able to assign"). The assignee and the
 *  due date are edited in their own rows, like Asana — pick a name and it saves, and when the
 *  glitch has a Breezeway task the crew's task is reassigned too (the update action does that). */
function AssignField({ g, people, onDone }: { g: Glitch; people: { id: number; name: string; departments?: string[]; role?: string | null }[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // App users only (Jon, 2026-09-22: "assignee should just be users in the app").
  const [users, setUsers] = useState<{ email: string; name: string }[]>([])
  useEffect(() => { fetch('/api/users/directory', { cache: 'no-store' }).then(r => r.json()).then(j => setUsers(Array.isArray(j.users) ? j.users : [])).catch(() => {}) }, [])
  const save = async (body: Record<string, any>) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: g.id, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) setErr(j.error || 'Could not save'); else onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  // SUPPORT IS THE DEFAULT OWNER (Jon, 2026-09-22). It is always first in the list; when there
  // is an app user for the support inbox, assigning to Support notifies that login.
  const supportUser = users.find(u => /^support@/.test(u.email)) || null
  const others = users.filter(u => u !== supportUser && u.name.toLowerCase() !== 'support')
  const current = g.assignee || 'Support'
  const known = current === 'Support' || others.some(u => u.name === current)
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <select value={current} disabled={busy}
        onChange={e => {
          const name = e.target.value
          const u = name === 'Support' ? supportUser : users.find(x => x.name === name)
          // If the same person is also in Breezeway, the crew task follows the assignment.
          const person = people.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase())
          save({ assignee: name, assigneeEmail: u ? u.email : '', assigneePersonId: person ? person.id : null })
        }}
        className="text-[13px] font-semibold text-ink border border-line rounded-lg px-2 h-8 bg-white max-w-[240px]">
        <option value="Support">Support</option>
        {!known ? <option value={current}>{current}</option> : null}
        {others.map(u => <option key={u.email} value={u.name}>{u.name}</option>)}
      </select>
      {busy ? <Loader2 size={13} className="animate-spin text-muted" /> : null}
      {err ? <span className="text-[12px] text-rose-700">{err}</span> : null}
    </span>
  )
}
function VendorGlitchField({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const call = async (body: Record<string, any>) => {
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) setErr(j.error || 'Could not save')
      else { if (body.action === 'vendorTell') setNote(j.posted ? 'Posted in ' + j.channel : 'Marked as told' + (j.error ? ' — ' + j.error : '')); onDone() }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const pick = (v: { key: string | null; name: string | null }) => call({ action: 'update', vendorKey: v.key, vendorName: v.name })
  // Told for THIS date; a moved visit re-arms the button on its own.
  const told = !!g.vendor_team_told_for && g.vendor_team_told_for === g.vendor_visit_on
  return (
    <div className="max-w-[420px] space-y-1.5">
      <VendorField vendorKey={g.vendor_key ?? null} vendorName={g.vendor_name ?? null} canEdit busy={busy} onPick={pick} />
      {/* WHEN THEY ARE COMING, AND HAS THE TEAM BEEN TOLD (2026-09-25) — the same three facts the
          project board keeps on a vendor job, so a plumber booked from a glitch is not a surprise at
          the door. */}
      {g.vendor_name ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input type="date" value={g.vendor_visit_on || ''} disabled={busy} onChange={e => call({ action: 'update', vendorVisitOn: e.target.value || null })}
            className="text-[12.5px] border border-line rounded-lg px-2 h-8 bg-white" />
          <input defaultValue={g.vendor_visit_window || ''} placeholder="9–11am" disabled={busy}
            onBlur={e => { if ((e.target.value || null) !== (g.vendor_visit_window || null)) call({ action: 'update', vendorVisitWindow: e.target.value }) }}
            className="text-[12.5px] border border-line rounded-lg px-2 h-8 bg-white w-[110px]" />
          {g.vendor_visit_on ? (told ? (
            <span className="text-[11.5px] font-semibold text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Team told</span>
          ) : (
            <button onClick={() => call({ action: 'vendorTell' })} disabled={busy}
              className="rounded-lg bg-ink text-white px-2.5 h-8 text-[11.5px] font-bold hover:bg-ink/85 disabled:opacity-40">Tell the team</button>
          )) : null}
          {busy ? <Loader2 size={13} className="animate-spin text-muted" /> : null}
        </div>
      ) : null}
      {err ? <span className="text-[12px] text-rose-700">{err}</span> : null}
      {note ? <span className="text-[12px] text-muted">{note}</span> : null}
    </div>
  )
}
function DueField({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const closed = laneOf(g.status).key === 'closed'
  const over = g.due_date && !closed && String(g.due_date).slice(0, 10) < todayET()
  const save = async (v: string) => {
    setBusy(true)
    try {
      await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: g.id, dueDate: v }) })
      onDone()
    } catch { /* the field just keeps its old value */ }
    setBusy(false)
  }
  return (
    <span className="inline-flex items-center gap-2">
      <input type="date" value={String(g.due_date || '').slice(0, 10)} disabled={busy} onChange={e => save(e.target.value)}
        className={'text-[13px] border rounded-lg px-2 h-8 bg-white ' + (over ? 'border-rose-300 text-rose-700 font-semibold' : 'border-line text-ink')} />
      {over ? <span className="text-[12px] font-semibold text-rose-700">overdue</span> : null}
    </span>
  )
}

/** Work notes, typed straight onto the record and saved when you click away. */
function WorkNotes({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [v, setV] = useState(g.details || '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setV(g.details || '') }, [g.id, g.details])
  const save = async () => {
    if ((g.details || '') === v) return
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: g.id, details: v }) })
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); onDone() }
    } catch { /* keeps the text in the box */ }
  }
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-muted">Work notes</span>
        {saved ? <span className="text-[11.5px] text-emerald-700">Saved</span> : null}
      </div>
      <textarea value={v} onChange={e => setV(e.target.value)} onBlur={save} rows={v ? 3 : 1}
        placeholder="What's been tried, parts ordered, what the guest was told…"
        className="mt-1 w-full text-[13px] border border-line rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
    </div>
  )
}

/** The live clock: how long this has been open, or how long it took to close. */
function OpenClock({ g }: { g: Glitch }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  const start = Date.parse(g.created_at)
  if (!Number.isFinite(start)) return null
  const closed = laneOf(g.status).key === 'closed'
  const end = closed && g.closed_at ? Date.parse(g.closed_at) : now
  const days = (end - start) / 86400000
  const tone = closed ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
    : days >= 3 ? 'bg-rose-50 text-rose-800 ring-rose-200'
    : days >= 1 ? 'bg-amber-50 text-amber-800 ring-amber-200'
    : 'bg-sky-50 text-sky-800 ring-sky-200'
  return (
    <span className={'inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 h-8 rounded-xl ring-1 tabular-nums ' + tone}
      title={'Reported ' + fmtStamp(g.created_at) + (closed && g.closed_at ? ' · closed ' + fmtStamp(g.closed_at) : '')}>
      {closed ? null : <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {closed ? 'Closed in ' + span(end - start) : 'Open ' + span(end - start)}
    </span>
  )
}

function GlitchDetail({ g, people, onClose, onChanged, act, canTrain, canApprove, openRefund, onDeleted }: {
  g: Glitch
  people: { id: number; name: string; departments: string[] }[]
  onClose: () => void
  onChanged: () => void
  act: (id: string, body: Record<string, any>, c?: string) => Promise<void>
  canTrain: boolean
  canApprove: boolean
  openRefund: boolean
  onDeleted: (trashId: string, label: string) => void
}) {
  const [panel, setPanel] = useState<'' | 'edit' | 'push'>('')
  // FIXING A TYPO SHOULD START WHERE THE TYPO IS (Sulaman, 2026-09-17). The editor opens beside
  // the description and scrolls into view.
  const editRef = useRef<HTMLElement | null>(null)
  const openEdit = useCallback(() => {
    setPanel('edit')
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }, [])
  const refundRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { if (openRefund) setTimeout(() => refundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120) }, [openRefund])

  const lane = laneOf(g.status)
  const closed = lane.key === 'closed'
  const awaiting = String(g.status) === 'manager_review'
  const lastClose = (Array.isArray(g.history) ? g.history : []).slice().reverse().find((h: any) => h && /^completion_/.test(String(h.action || '')))
  const sentBack = !awaiting && !closed && lastClose?.action === 'completion_rejected' ? lastClose : null
  const refund = Number(g.refund_approved) || 0
  const rec = Number.isFinite(Number(g.refund_recommended)) && g.refund_recommended != null ? Number(g.refund_recommended) : null
  const stay = stayState(g.check_in, g.check_out)
  const nights = g.check_in && g.check_out
    ? Math.round((Date.parse(String(g.check_out).slice(0, 10)) - Date.parse(String(g.check_in).slice(0, 10))) / 86400000) : null
  const trade = tradeOf(g.category)
  const overview = String(g.overview || '').trim()
  // The issue is the title, the way an Asana task is named: the first sentence, not the whole report.
  const headline = (() => {
    const first = overview.split(/\n/)[0].replace(/^(the\s+)?guests?\s+(has\s+|have\s+)?(reported|said|says|mentioned|complained)\s+(that\s+)?/i, '')
    const dot = first.search(/[.!?](\s|$)/)
    const t = (dot > 10 ? first.slice(0, dot) : first).trim()
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Guest issue'
  })()
  const dueOver = g.due_date && !closed && String(g.due_date).slice(0, 10) < todayET()
  const hist: any[] = Array.isArray((g as any).history) ? (g as any).history : []
  // refund_approved defaults to 0, so "$0" is only a real decision when one was logged.
  const refundLogged = refund > 0 || hist.some((h: any) => h && h.action === 'refund_logged')
  // A refund over the cap that a manager turned down is back at $0 and waiting for a new amount —
  // not "declined", which is a decision somebody made about the guest.
  const refundRejected = refund === 0 && lastRefundEvent(g)?.action === 'refund_rejected'
  const [showActivity, setShowActivity] = useState(false)
  const taskLabel = g.task_status === 'completed' ? 'Completed' : g.task_status === 'in_progress' ? 'In progress' : g.task_status ? 'Not started' : ''
  const taskTone = g.task_status === 'completed' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : g.task_status === 'in_progress' ? 'bg-sky-50 text-sky-800 ring-sky-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
  const chip = 'text-[11.5px] font-semibold px-2 py-0.5 rounded-md ring-1'

  return (
    <Sheet open onClose={onClose} wide
      title={g.unit || 'Guest issue'}
      subtitle={<span>{g.market ? g.market + ' · ' : ''}{lane.label}</span>}
      footer={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-muted">Created {fmtStamp(g.created_at)}{g.reported_by ? ' by ' + String(g.reported_by).split('@')[0] : ''}</span>
          <div className="flex-1" />
          <DeleteButton title="Delete this glitch record. The Breezeway task, if any, stays." onDelete={async () => {
            try {
              const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: 'delete' }) })
              const j = await r.json()
              if (!r.ok || !j.ok) return j.error || 'Delete failed'
              onDeleted(String(j.trashId), String(j.label || 'glitch'))
              return null
            } catch (e: any) { return String(e?.message || e) }
          }} />
        </div>
      }>

      {/* TOP BAR: complete it, where it sits, and how long it has been open. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* MANAGER APPROVAL (Jon, 2026-10-02). The team marks a card complete; it waits here for a
            manager (full access on Glitches) to approve the close or send it back with a reason.
            A manager's own "Mark complete" closes at once. */}
        {awaiting ? (
          canApprove
            ? <CloseSignOff g={g} onDone={onChanged} />
            : <span className={chip + ' bg-violet-50 text-violet-800 ring-violet-200 h-8'} title="Waiting on a manager to approve the close">Awaiting manager approval</span>
        ) : (
          <button onClick={() => act(g.id, { action: 'move', status: closed ? 'ops' : 'closed' })}
            title={closed ? 'Reopen the card' : canApprove ? 'Close the card' : 'Send to a manager to approve the close'}
            className={'inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 h-8 rounded-xl border transition ' +
              (closed ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-ink border-line hover:border-emerald-500 hover:text-emerald-700')}>
            <Check size={14} /> {closed ? 'Completed — reopen' : canApprove ? 'Mark complete' : 'Mark complete → manager'}
          </button>
        )}
        {awaiting && !canApprove ? (
          <button onClick={() => act(g.id, { action: 'move', status: 'ops' })} className="text-[12px] font-semibold text-muted hover:text-ink">Take it back</button>
        ) : null}
        {sentBack ? <span className={chip + ' bg-rose-50 text-rose-800 ring-rose-200'} title={'Sent back by ' + String(sentBack.by || 'a manager').split('@')[0] + ' · ' + fmtStamp(sentBack.at)}>Sent back{sentBack.note ? ': ' + String(sentBack.note).slice(0, 80) : ''}</span> : null}
        <OpenClock g={g} />
        {dueOver ? <span className={chip + ' bg-rose-50 text-rose-800 ring-rose-200'}>Overdue</span> : null}
        {g.refund_needs_approval ? (
          <span className={chip + ' bg-violet-50 text-violet-800 ring-violet-200'}
            title={canApprove ? 'Over the approval cap — approve or reject it here' : 'Over the approval cap — waiting on someone with full access on Glitches to sign it off'}>
            Refund awaiting approval
          </span>
        ) : null}
        {g.refund_needs_approval && canApprove ? <RefundSignOff g={g} onDone={onChanged} /> : null}
      </div>

      <h2 className="text-[20px] sm:text-[22px] font-bold text-ink leading-snug mt-3">{headline}</h2>
      {trade || g.glitch_type && g.glitch_type !== 'Glitch (Quality Issue)' ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          {g.glitch_type && g.glitch_type !== 'Glitch (Quality Issue)' ? <span className={chip + ' bg-rose-50 text-rose-800 ring-rose-200'}>{g.glitch_type}</span> : null}
          {trade ? <span className={chip + ' ' + trade.cls} title={g.category || ''}>{trade.label}</span> : null}
        </div>
      ) : null}

      {/* THE FIELDS — one column, Asana-style. Every row is either a fact or the control that
          changes it; nothing is repeated below. */}
      <div className="mt-3 divide-y divide-line/60">
        <FieldRow label="Assignee"><AssignField g={g} people={people} onDone={onChanged} /></FieldRow>
        {/* THE VENDOR (Jon, 2026-09-24): who outside is fixing it. Same directory as the project
            board and requests, so the plumber's history follows them across every board. */}
        <FieldRow label="Vendor"><VendorGlitchField g={g} onDone={onChanged} /></FieldRow>
        <FieldRow label="Due date"><DueField g={g} onDone={onChanged} /></FieldRow>
        <FieldRow label="Status">
          <span className="inline-flex items-center gap-2 flex-wrap">
            <select value={lane.key} onChange={e => { const l = LANES.find(x => x.key === e.target.value); if (l) act(g.id, { action: 'move', status: l.write }) }}
              className="text-[13px] font-semibold border border-line rounded-lg px-2 h-8 bg-white">
              {LANES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
            <select value={String(g.priority || 'urgent').toLowerCase()} onChange={e => act(g.id, { action: 'priority', priority: e.target.value })}
              className={'text-[13px] font-semibold border rounded-lg px-2 h-8 ' + (String(g.priority || 'urgent').toLowerCase() === 'urgent' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-white border-line text-ink')}>
              {[['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </span>
        </FieldRow>
        <FieldRow label="Reported">
          <span className="font-semibold">{fmtStamp(g.created_at)}</span>
          {g.incident_date && String(g.incident_date).slice(0, 10) !== String(g.created_at).slice(0, 10)
            ? <span className="text-muted"> · happened {fmtDay(g.incident_date)}</span> : null}
          {g.reported_via ? <span className="text-muted"> · via {String(g.reported_via).replace(/_/g, ' ')}</span> : null}
        </FieldRow>
        <FieldRow label="Check-in">
          {g.check_in ? <span className="font-semibold">{fmtDay(g.check_in)}</span> : <span className="text-muted">No reservation linked</span>}
        </FieldRow>
        <FieldRow label="Check-out">
          {g.check_out ? (
            <span>
              <span className="font-semibold">{fmtDay(g.check_out)}</span>
              {nights ? <span className="text-muted"> · {nights} night{nights === 1 ? '' : 's'}</span> : null}
              {stay.label ? <span className={'ml-1.5 ' + (stay.now ? 'text-emerald-700 font-semibold' : 'text-muted')}>· {stay.label.toLowerCase()}</span> : null}
            </span>
          ) : <span className="text-muted">—</span>}
        </FieldRow>
        <FieldRow label="Guest">
          <span className="font-semibold">{g.guest_name || 'Guest'}</span>
          {g.guest_phone ? <a href={'tel:' + String(g.guest_phone).replace(/[^\d+]/g, '')} className="text-muted hover:text-ink"> · {fmtPhone(g.guest_phone)}</a> : null}
          {g.guest_tone && g.guest_tone !== 'understanding' ? <span className="text-amber-800 font-semibold"> · {g.guest_tone}</span> : null}
          {g.sentiment && g.sentiment.dissatisfied ? <span className="text-rose-700 font-semibold"> · unhappy in messages</span> : null}
        </FieldRow>
        {g.reservation_id ? (
          <FieldRow label="Booking">
            {[g.channel ? String(g.channel).replace(/\d+$/, '').replace(/^./, c => c.toUpperCase()) : '', g.reservation_total ? money(g.reservation_total) : ''].filter(Boolean).join(' · ') || 'Linked'}
            <a href={'https://app.guesty.com/reservations/' + g.reservation_id + '/summary'} target="_blank" rel="noreferrer"
              className="ml-2 font-semibold text-brand-700 hover:underline">Guesty ↗</a>
          </FieldRow>
        ) : null}
        <FieldRow label="Breezeway">
          {g.breezeway_task_id ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              {taskLabel ? <span className={chip + ' ' + taskTone}>{taskLabel}</span> : null}
              <a href={'https://app.breezeway.io/task/' + g.breezeway_task_id} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">Task ↗</a>
              {g.task_report_url ? <a href={g.task_report_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">Report ↗</a> : null}
            </span>
          ) : (
            <button onClick={() => setPanel(panel === 'push' ? '' : 'push')} className="text-[12px] font-bold px-2.5 h-7 rounded-lg bg-ink text-white">Create the task</button>
          )}
        </FieldRow>
        <FieldRow label="Refund">
          <button onClick={() => refundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="text-left">
            {refundRejected
              ? <span className="font-semibold text-rose-700">Not approved — log a new amount</span>
              : refundLogged
              ? <span className={'font-semibold ' + (g.refund_needs_approval ? 'text-violet-700' : 'text-emerald-700')}>{refund > 0 ? money(refund) + (g.refund_needs_approval ? ' — awaiting sign-off' : ' given') : 'Declined ($0)'}</span>
              : <span className="text-muted">None logged</span>}
            {rec != null && !refundLogged ? <span className="text-muted"> · suggested {money(rec)}</span> : null}
          </button>
        </FieldRow>
      </div>
      {panel === 'push' && !g.breezeway_task_id ? <div className="mt-2"><PushPanel g={g} people={people} onDone={() => { setPanel(''); onChanged() }} act={act} /></div> : null}

      {/* DESCRIPTION — the guest's words, in full. */}
      <section className="border-t border-line pt-3 mt-3" ref={editRef as any}>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-ink">Description</span>
          <button onClick={() => (panel === 'edit' ? setPanel('') : openEdit())} title="Fix a typo, or change the unit, guest or category"
            className="text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">
            <Pencil size={12} /> {panel === 'edit' ? 'Done editing' : 'Edit'}
          </button>
        </div>
        {panel === 'edit' ? (
          <div className="mt-2"><EditGlitch g={g} onDone={() => { setPanel(''); onChanged() }} /></div>
        ) : (
          <>
            <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap mt-1.5">{overview || 'Nothing written.'}</p>
          </>
        )}
        {(g.photos || []).length > 0 ? (
          <div className="flex gap-1.5 flex-wrap mt-3">
            {(g.photos || []).map((u, i) => (
              <a key={i} href={glitchPhotoSrc(u)} target="_blank" rel="noreferrer">
                <img src={glitchPhotoSrc(u)} alt="" className="w-24 h-24 object-cover rounded-lg border border-line" />
              </a>
            ))}
          </div>
        ) : null}
        <WorkNotes g={g} onDone={onChanged} />
      </section>

      <div className="space-y-3 mt-3">
        <div ref={refundRef}>
          <Fold title="Refund" open={openRefund} hint={refundRejected ? 'not approved' : refundLogged ? (refund > 0 ? money(refund) + (g.refund_needs_approval ? ' awaiting sign-off' : ' given') : 'declined') : rec != null ? 'suggested ' + money(rec) : 'work out a recommendation'}>
            <MoneyTab g={g} openRefund={openRefund} onChanged={onChanged} canTrain={canTrain} canApprove={canApprove} />
          </Fold>
        </div>

        {g.reservation_id ? (
          <Fold title="The stay" hint="messages, calls, other issues on this booking" open={false}>
            <StayPanel reservationId={g.reservation_id} compact hide={['issues']} />
          </Fold>
        ) : null}

        <Fold title="This unit" hint="history and signals" open={false}>
          <UnitSignals g={g} />
        </Fold>

        {/* COMMENTS AND ACTIVITY — at the bottom, where Asana keeps them. */}
        <Fold title="Comments">
          <CommentThread type="glitch" id={g.id}
            label={(g.unit ? g.unit + ' — ' : '') + String(g.overview || 'glitch').split('\n')[0].slice(0, 60)}
            link="/glitches" taskId={g.breezeway_task_id || ''} reservationId={g.reservation_id || ''} />
          {hist.length ? (
            <div className="mt-3 border-t border-line/60 pt-2">
              <button onClick={() => setShowActivity(v => !v)} className="text-[12px] font-semibold text-muted hover:text-ink">
                {showActivity ? 'Hide activity' : 'Show activity (' + hist.length + ')'}
              </button>
              {showActivity ? <ul className="space-y-0.5 mt-1">
                {hist.slice().reverse().slice(0, 25).map((h: any, i: number) => (
                  <li key={i} className="text-[12px] text-muted">
                    <span className="text-ink font-medium">{String(h.by || 'team').split('@')[0]}</span>{' '}
                    {String(h.action || '').replace(/_/g, ' ')}
                    {h.to ? ' → ' + (LANES.find(l => l.statuses.indexOf(String(h.to)) >= 0)?.label || h.to) : ''}
                    {h.amount != null ? ' · $' + h.amount : ''}
                    {h.note ? <span className="text-ink/80"> — “{String(h.note).slice(0, 160)}”</span> : null}
                    <span className="text-faint"> · {fmtStamp(h.at)}</span>
                  </li>
                ))}
              </ul> : null}
            </div>
          ) : null}
        </Fold>
      </div>
    </Sheet>
  )
}

// ── THE TWO NUMBERS THAT SAY WHETHER THIS BOARD IS WORKING ──────────────────────────────────────
// Jon, 2026-09-15: "track time of created, to glitch closed. thei should be a KPI. It should also
// show refund provided as well."
//
// MEDIAN, NOT MEAN. One card left open over a holiday drags an average into uselessness, and the
// number people then stop trusting. The median says what a typical issue actually takes.
//
// Rows closed before migration 085 have an ESTIMATED closure time (backfilled from updated_at),
// and they are counted separately rather than silently mixed in — a measurement and a guess should
// never be added together without saying so.
function GlitchKpis({ rows }: { rows: Glitch[] }) {
  const stat = useMemo(() => {
    const hours: number[] = []
    let estimated = 0
    for (const g of rows) {
      const closedAt = (g as any).closed_at
      if (!closedAt || !g.created_at) continue
      const h = (Date.parse(closedAt) - Date.parse(g.created_at)) / 3600000
      if (!Number.isFinite(h) || h < 0) continue
      if ((g as any).closed_at_estimated) { estimated++; continue }
      hours.push(h)
    }
    hours.sort((a, b) => a - b)
    const median = hours.length ? hours[Math.floor(hours.length / 2)] : null
    const open = rows.filter(g => laneOf(g.status).key !== 'closed')
    const oldest = open.reduce((acc: number, g) => {
      const d = (Date.now() - Date.parse(g.created_at)) / 86400000
      return Number.isFinite(d) && d > acc ? d : acc
    }, 0)
    const refunds = rows.map(g => Number(g.refund_approved) || 0).filter(n => n > 0)
    return {
      median, measured: hours.length, estimated,
      open: open.length, oldest: Math.floor(oldest),
      refundTotal: refunds.reduce((a, b) => a + b, 0),
      refundCount: refunds.length,
      awaitingApproval: rows.filter(g => (g as any).refund_needs_approval).length,
    }
  }, [rows])

  const dur = (h: number) => h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'

  // Pills, not tiles (lean pass). What each number means lives in its hover.
  return (
    <>
      <Pill tone={stat.open ? 'slate' : 'emerald'}
        title={stat.open && stat.oldest > 0 ? 'Open now — oldest is ' + stat.oldest + ' day' + (stat.oldest === 1 ? '' : 's') + ' old' : 'Nothing outstanding'}>
        {stat.open} open{stat.open && stat.oldest > 0 ? ' · ' + stat.oldest + 'd oldest' : ''}
      </Pill>
      <Pill title={stat.median != null
        ? 'Typical time to close: median of ' + stat.measured + ' closed' + (stat.estimated ? ' · ' + stat.estimated + ' older ones estimated, not counted' : '')
        : (stat.estimated ? stat.estimated + ' closed before we timed them' : 'Nothing closed yet')}>
        {stat.median != null ? dur(stat.median) : '—'} to close
      </Pill>
      <Pill tone={stat.refundTotal ? 'emerald' : 'slate'} title={stat.refundCount ? 'Refunds given across ' + stat.refundCount + ' issue' + (stat.refundCount === 1 ? '' : 's') : 'No refunds logged'}>
        {stat.refundTotal ? money(stat.refundTotal) || '$0' : '$0'} refunded
      </Pill>
      {stat.awaitingApproval > 0 && <Pill tone="violet" title="Refunds over the cap, not yet signed off">{stat.awaitingApproval} need approval</Pill>}
    </>
  )
}

// ── WHAT WE KNOW ABOUT THIS UNIT ────────────────────────────────────────────────────────────────
// Jon, 2026-09-15: flags that "help us determine how we respond to that particular unit".
// Shown beside the issue, not behind a click, because it changes the answer.
function UnitSignals({ g }: { g: Glitch }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let dead = false
    fetch('/api/glitches/signals?id=' + encodeURIComponent(g.id), { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (dead) return; if (j.ok) setD(j); else setErr(String(j.error || '')) })
      .catch(e => { if (!dead) setErr(String(e?.message || e)) })
    return () => { dead = true }
  }, [g.id])

  if (err) return null
  if (!d) return (
    <section className="rounded-xl bg-app ring-1 ring-line px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-wider font-bold text-muted">This unit</p>
      <p className="text-[12px] text-muted mt-1"><Loader2 size={11} className="animate-spin inline mr-1" /> Checking its reviews and history…</p>
    </section>
  )

  const TONE: Record<string, string> = {
    bad: 'bg-rose-50 ring-rose-200 text-rose-900',
    warn: 'bg-amber-50 ring-amber-200 text-amber-900',
    good: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
  }
  return (
    <section className="rounded-xl bg-app ring-1 ring-line px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">This unit</p>
      <p className="text-[12.5px] text-ink">
        {d.unitAvg != null
          ? <>Rated <span className="font-bold">{d.unitAvg}★</span> over {d.reviewCount} review{d.reviewCount === 1 ? '' : 's'}
              {d.portfolioAvg != null ? <span className="text-muted"> · portfolio {d.portfolioAvg}★</span> : null}</>
          : <span className="text-muted">{d.hasListing ? 'No reviews on this unit yet.' : 'No listing linked, so no review history.'}</span>}
      </p>
      {d.lastReview ? (
        <p className="text-[12px] text-muted mt-0.5">
          Last review {d.lastReview.rating ? d.lastReview.rating + '★' : ''} on {d.lastReview.at}
          {d.lastReview.channel ? ' · ' + d.lastReview.channel : ''}
        </p>
      ) : null}
      {(d.flags || []).length ? (
        <div className="space-y-1.5 mt-2.5">
          {(d.flags || []).map((f: any) => (
            <div key={f.key} className={'rounded-lg ring-1 px-2.5 py-2 ' + (TONE[f.tone] || TONE.warn)}>
              <p className="text-[12px] font-bold">{f.label}</p>
              <p className="text-[11.5px] opacity-90">{f.detail}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-muted mt-2">Nothing on this unit argues for special treatment.</p>
      )}
    </section>
  )
}

// ── THE MONEY ───────────────────────────────────────────────────────────────────────────────────
// Two numbers that must never be confused: what the model RECOMMENDS and what a person DECIDED.
// They sit side by side on purpose — the gap between them, across many cards, is the only way to
// find out whether the policy matches what the team actually does.
function MoneyTab({ g, openRefund, onChanged, canTrain, canApprove }: { g: Glitch; openRefund: boolean; onChanged: () => void; canTrain: boolean; canApprove: boolean }) {
  const [rec, setRec] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showLog, setShowLog] = useState(openRefund)
  const refund = Number(g.refund_approved) || 0
  // Answers to its questions and the tone, sent back with the next ask.
  const [answers, setAnswers] = useState('')
  const [tone, setTone] = useState('')

  const ask = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/advise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, answers, tone }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not work out a recommendation.')
      setRec(j)
      onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const read = rec?.read || null
  const S = read?.sources || null
  const hrs = (h: number | null | undefined) => h == null ? '—' : h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h + ' h' : (Math.round(h / 2.4) / 10) + ' days'
  const when = (v: string) => v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

  // THE FIELD IS `recommendation.refund`. The first version read `recommendation.amount ?? provisional`
  // — and `provisional` is a BOOLEAN ("this needs more facts"), so Number(true) rendered every
  // recommendation as $1. It looked like a broken policy engine; it was a broken read.
  const recommended = rec
    ? (Number.isFinite(Number(rec?.recommendation?.refund)) ? Number(rec.recommendation.refund) : null)
    : (Number.isFinite(Number(g.refund_recommended)) ? Number(g.refund_recommended) : null)
  const isProvisional = !!(rec && rec.provisional)
  const why: string[] = Array.isArray(rec?.recommendation?.reasoning) ? rec.recommendation.reasoning : []

  const exp = rec?.exposure || null
  const ladder = rec?.ladder || null
  const auth = rec?.authority || null

  return (
    <div className="space-y-4">
      {/* THE LADDER, BEFORE THE MONEY. A money tab that opens with a number teaches the team that
          money is the first move; Jon's rule (2026-09-22) is that it is the last one. */}
      <section className="rounded-xl ring-1 ring-brand-200 bg-brand-50/60 px-3.5 py-2.5">
        <p className="text-[12.5px] font-bold text-brand-900">Fix it first. The refund is what is left when that was not enough.</p>
        {ladder ? (
          <p className="text-[12px] text-brand-900/80 mt-0.5">
            {ladder.label}: a human within {ladder.firstResponseMins < 60 ? ladder.firstResponseMins + ' min' : Math.round(ladder.firstResponseMins / 60) + ' hr'},
            fixed within {ladder.fixTargetHours} hours. <a href="/refunds" className="underline font-semibold">The playbook</a>
          </p>
        ) : (
          <p className="text-[12px] text-brand-900/80 mt-0.5">Work out a recommendation below and it will show the clock for this category. <a href="/refunds" className="underline font-semibold">The playbook</a></p>
        )}
        {ladder?.escalate ? <p className="text-[12px] font-bold text-rose-800 mt-1">{ladder.escalate}</p> : null}
      </section>

      <section className="rounded-xl ring-1 ring-line bg-white px-3.5 py-3">
        <p className="text-[11px] uppercase tracking-wider font-bold text-muted">What we actually gave</p>
        {refund > 0 ? (
          <>
            <p className="text-[24px] font-bold text-emerald-700 tabular-nums leading-tight">{money(refund)}</p>
            {g.reservation_total ? (
              <p className="text-[12px] text-muted">{Math.round((refund / Number(g.reservation_total)) * 100)}% of the {money(g.reservation_total)} stay</p>
            ) : null}
            {g.refund_note ? <p className="text-[12px] text-muted mt-1">{g.refund_note}</p> : null}
            {g.refund_needs_approval ? (
              canApprove
                ? <div className="mt-2"><RefundSignOff g={g} onDone={onChanged} /></div>
                : <p className="text-[12px] font-bold text-violet-700 mt-1.5">Waiting on a manager to sign this off.</p>
            ) : g.refund_approved_by ? (
              <p className="text-[12px] text-muted mt-1">Signed off by {String(g.refund_approved_by).split('@')[0]}{g.refund_approved_at ? ' · ' + fmtStamp(g.refund_approved_at) : ''}</p>
            ) : null}
          </>
        ) : lastRefundEvent(g)?.action === 'refund_rejected' ? (
          <p className="text-[13px] font-semibold text-rose-700 mt-0.5">
            {money(Number(lastRefundEvent(g)?.amount) || 0)} was not approved{g.refund_approved_by ? ' by ' + String(g.refund_approved_by).split('@')[0] : ''}{lastRefundEvent(g)?.note ? ': ' + String(lastRefundEvent(g)?.note) : ''}. Log a new amount — 0 if the guest gets nothing.
          </p>
        ) : (
          <p className="text-[13px] text-muted mt-0.5">Nothing logged yet. Zero is a real answer — log it as declined so the question stops coming back.</p>
        )}
        <button onClick={() => setShowLog(v => !v)}
          className="mt-2 text-[12.5px] font-bold px-3 h-9 rounded-xl border border-line bg-white text-ink">
          {refund > 0 ? 'Change it' : 'Log a refund'}
        </button>
        {showLog ? (
          <div className="mt-2">
            <RefundLogger id={g.id} total={g.reservation_total ?? null} onDone={() => { setShowLog(false); onChanged() }} />
          </div>
        ) : null}
      </section>

      <section className="rounded-xl ring-1 ring-line bg-app px-3.5 py-3">
        <p className="text-[11px] uppercase tracking-wider font-bold text-muted">What the policy suggests</p>
        {recommended != null ? (
          <>
            <p className="text-[20px] font-bold text-ink tabular-nums leading-tight">
              {money(recommended)}
              {rec?.recommendation?.pctOfStay ? <span className="text-[12px] font-semibold text-muted ml-1.5">{rec.recommendation.pctOfStay}% of the stay</span> : null}
            </p>
            {isProvisional ? (
              <p className="text-[11.5px] font-bold text-amber-700">{rec?.guessed ? 'Best judgment — some facts are assumed. Confirm them below to firm it up.' : 'Provisional — it is missing facts, see below.'}</p>
            ) : null}
          </>
        ) : rec ? (
          // It RAN and deliberately withheld a number. Saying so is the point: a blank where a
          // figure should be reads as a broken feature, when what actually happened is the policy
          // refusing to guess. The questions below are the price of an answer.
          <p className="text-[12.5px] font-semibold text-amber-800 mt-0.5">
            No number yet — the policy will not guess. Answer the questions below and ask again.
          </p>
        ) : (
          <p className="text-[12.5px] text-muted mt-0.5">
            Runs the house framework over this case — severity, how fast it was fixed, what was offered
            instead, and the channel. Advice only; nothing is saved until you log it above.
          </p>
        )}
        {rec?.summary ? <p className="text-[12.5px] text-ink mt-1.5 leading-relaxed">{rec.summary}</p> : null}
        {(rec?.evidence || []).length ? (
          <div className="mt-2">
            <p className="text-[11.5px] font-bold text-ink">What decided it</p>
            <ul className="mt-0.5 space-y-0.5">
              {rec.evidence.map((e: any, i: number) => (
                <li key={i} className="text-[12px] text-ink/85 leading-snug">
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted mr-1.5">{e.source}</span>{e.fact}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(rec?.questions || []).length ? (
          <div className="mt-2">
            <p className="text-[11.5px] font-bold text-amber-800">To firm it up:</p>
            <ul className="list-disc pl-4">
              {(rec.questions || []).map((q: string, i: number) => <li key={i} className="text-[12px] text-amber-900">{q}</li>)}
            </ul>
          </div>
        ) : null}
        {rec ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11.5px] font-semibold text-muted mr-1">Guest tone:</span>
              {['understanding', 'frustrated', 'angry', 'fishing'].map(t => (
                <button key={t} onClick={() => setTone(tone === t ? '' : t)}
                  className={'text-[11.5px] font-semibold px-2 h-7 rounded-lg border ' + ((tone || (rec?.classification?.toneSource && !String(rec.classification.toneSource).startsWith('read') ? rec.classification.tone : '')) === t ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>
                  {t === 'fishing' ? 'angling for a discount' : t}
                </button>
              ))}
            </div>
            <textarea value={answers} onChange={e => setAnswers(e.target.value)} rows={2}
              placeholder="Answer its questions here — e.g. “fixed at 4pm same day, we brought a portable AC, guest was fine after”"
              className="w-full text-[12.5px] border border-line rounded-lg px-2.5 py-1.5 bg-white" />
          </div>
        ) : null}
        {why.length ? (
          <ul className="list-disc pl-4 mt-2">
            {why.map((line, i) => <li key={i} className="text-[12px] text-muted leading-relaxed">{line}</li>)}
          </ul>
        ) : null}
        {rec?.classification ? (
          <p className="text-[11.5px] text-muted mt-1.5">
            {[(rec.classification.issues || []).map((i: any) => i.label + ' (' + i.severity + ')').join(', '), rec.classification.tone ? 'tone ' + rec.classification.tone : '', rec.stay?.channel,
              rec.stay?.nights ? rec.stay.nights + ' nights' : '',
              rec.stay?.nightlyRate ? money(rec.stay.nightlyRate) + '/night' : '',
              rec.confidence ? rec.confidence + ' confidence' : ''].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {auth ? (
          <div className="mt-2 rounded-lg ring-1 ring-line bg-white px-2.5 py-2">
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Who signs this</p>
            <p className="text-[12.5px] font-bold text-ink">{auth.who}</p>
            <p className="text-[12px] text-muted">{auth.why}</p>
            <p className="text-[12px] text-muted mt-0.5">{auth.then}</p>
          </div>
        ) : null}
        <button onClick={ask} disabled={busy}
          className="mt-2 text-[12.5px] font-bold px-3 h-9 rounded-xl bg-ink text-white disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {rec ? (answers.trim() || tone ? 'Ask again with these answers' : 'Ask again') : 'Work out a recommendation'}
        </button>
        {busy ? <p className="text-[11.5px] text-muted mt-1">Reading the booking, messages, calls, texts, voicemails and the Breezeway clock…</p> : null}
        {err ? <p className="text-[12px] font-semibold text-rose-700 mt-1.5">{err}</p> : null}
      </section>

      {/* WHAT IT READ (Jon, 2026-09-22: "it should look at every single aspect of the reservation").
          Shown so the team can see the recommendation is built on the whole record, and can spot a
          missing source (no calls matched, no task linked) before trusting the number. */}
      {read ? (
        <section className="rounded-xl ring-1 ring-line bg-white px-3.5 py-3">
          <p className="text-[11px] uppercase tracking-wider font-bold text-muted">What it read</p>
          {S ? (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {[
                ['Guest messages', S.guestMessages], ['Our replies', S.ourMessages],
                ['Calls', S.calls + (S.calls ? ' (' + S.answeredCalls + ' answered)' : '')], ['Texts', S.texts], ['Voicemails', S.voicemails],
                ['Breezeway tasks', S.tasks], ['Team comments', S.comments], ['Card events', S.historyEvents],
              ].map(([k, v]) => (
                <span key={String(k)} className={'text-[11.5px] px-2 py-0.5 rounded-md ring-1 ' + (String(v) === '0' ? 'ring-line text-faint' : 'ring-line text-ink bg-app')}>
                  {k} <b className="tabular-nums">{String(v)}</b>
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-[11px] uppercase tracking-wider font-bold text-muted mt-3">The Breezeway clock</p>
          <p className="text-[12px] text-muted">Reported {when(read.clock?.reportedAt)}{read.clock?.band ? ' · reads as ' + String(read.clock.band).replace('_', ' ') : ''}{read.clock?.fixHours != null ? ' · fixed ' + hrs(read.clock.fixHours) + ' after the report' : ''}</p>
          {(read.tasks || []).length ? (
            <div className="mt-1.5 space-y-1.5">
              {read.tasks.map((t: any) => (
                <div key={t.id} className={'rounded-lg ring-1 px-2.5 py-1.5 ' + (t.linked ? 'ring-brand-200 bg-brand-50/50' : 'ring-line')}>
                  <p className="text-[12px] font-semibold text-ink">{t.linked ? 'This issue’s task' : 'Other job during the stay'}: {t.name}{t.assignee ? ' · ' + t.assignee : ''}</p>
                  <p className="text-[11.5px] text-muted tabular-nums">
                    Created {when(t.createdAt)} (+{hrs(t.toCreatedH)}) → started {when(t.startedAt)} (+{hrs(t.toStartedH)}) → finished {when(t.finishedAt)} (+{hrs(t.toFinishedH)})
                    {t.minutesWorked != null ? ' · ' + t.minutesWorked + ' min on site' : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-faint mt-1">No Breezeway task linked or found on the unit during the stay.</p>}
        </section>
      ) : null}

      {(rec?.precedents || []).length ? (
        <section className="rounded-xl ring-1 ring-line bg-white px-3.5 py-3">
          <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Cases like this the team saved</p>
          {rec.precedents.map((p: any, i: number) => (
            <div key={i} className="mt-1.5">
              <p className="text-[12px] text-ink"><b>{money(p.paid)}</b>{p.pct != null ? ' (' + p.pct + '%)' : ''} · {p.unit} · {p.category} — {p.what}</p>
              {p.lesson ? <p className="text-[11.5px] text-muted">Lesson: {p.lesson}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {canTrain ? <TeachFromGlitch glitchId={g.id} paidDefault={refund > 0 || g.refund_approved === 0 ? refund : (recommended ?? null)} /> : null}

      {/* WHAT A BAD REVIEW WOULD COST ON THIS UNIT — arithmetic from its real reviews on this
          channel. It moves urgency and where in the band we land, never the band itself, and it is
          never said to the guest. */}
      {exp ? (
        <section className={'rounded-xl ring-1 px-3.5 py-3 ' + (
          exp.level === 'critical' ? 'ring-rose-200 bg-rose-50' :
          exp.level === 'high' ? 'ring-amber-200 bg-amber-50' :
          exp.level === 'raised' ? 'ring-sky-200 bg-sky-50' : 'ring-emerald-200 bg-emerald-50')}>
          <p className="text-[11px] uppercase tracking-wider font-bold opacity-70">If this stay ends in a bad review</p>
          <p className="text-[13px] font-bold text-ink">{exp.headline}</p>
          {(exp.lines || []).map((l: string, i: number) => (
            <p key={i} className="text-[12px] text-ink/85 leading-snug mt-1">{l}</p>
          ))}
          {(exp.actions || []).length ? (
            <ul className="mt-2 space-y-0.5">
              {exp.actions.map((a: string, i: number) => <li key={i} className="text-[12px] font-semibold text-ink/90">· {a}</li>)}
            </ul>
          ) : null}
          {exp.movedTheDial ? (
            <p className="text-[11.5px] text-ink/70 mt-2 pt-2 border-t border-black/10">
              This pushed the recommendation to the top of the band its severity earns — never above it.
              Do not mention the review to the guest.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

// ── THE CARD ────────────────────────────────────────────────────────────────────────────────────
// A card answers four questions and stops: which unit, what happened, who holds it, what it cost.
//
// What came off it, and why. The old card carried up to ten chips — market, channel, category,
// date, photo count, task status, refund, due, assignee, type — plus a progress bar. Market and
// channel are already filters; the photo count is visible the moment you open it; and the progress
// bar encoded the lane the card was sitting in, so it told you the one thing the column heading
// had already said. Ten equally-loud chips is the same as none: nothing stands out, so everything
// has to be read.
function GlitchCard({ g, onOpen }: { g: Glitch; onOpen: () => void }) {
  const refund = Number(g.refund_approved) || 0
  const owedRefund = String(g.status) === 'refund' && !refund
  const incident = g.glitch_type && g.glitch_type !== 'Glitch (Quality Issue)'
  const closed = String(g.status) === 'closed'
  const due = dueState(g.due_date, closed)
  const urgent = String(g.priority || '').toLowerCase() === 'urgent' && !closed
  const trade = tradeOf(g.category)
  const stay = stayState(g.check_in, g.check_out)
  // DAYS OPEN on the card (Jon, 2026-09-22: "a ticker, days open"). Grey under a day, amber from
  // one, red from three — the age of the complaint is what the board should make hard to ignore.
  const ageMs = Date.now() - Date.parse(g.created_at)
  const ageDays = ageMs / 86400000
  const age = !closed && Number.isFinite(ageMs) ? (ageDays >= 1 ? Math.floor(ageDays) + 'd' : Math.max(1, Math.floor(ageMs / 3600000)) + 'h') : ''

  const taskTag = g.breezeway_task_id
    ? (g.task_status === 'completed' ? <Tag tone="emerald" title="Breezeway task completed">Task done</Tag>
      : g.task_status === 'in_progress' ? <Tag tone="sky" title="Breezeway task in progress">Task running</Tag>
      : <Tag title="Breezeway task not started">Task not started</Tag>)
    : <Tag tone="amber" title="No Breezeway task filed for the crew yet">No task</Tag>
  // TWO LINES (lean pass, 2026-09-22): the unit, then the tags. What the guest said, the guest,
  // market and dates are one click away in the sheet — and in the hover here.
  const hover = [g.overview ? String(g.overview).slice(0, 200) : '', g.guest_name || '', g.market || '',
    g.check_in ? stay.label + ' ' + fmtShort(g.check_in) + ' → ' + fmtShort(g.check_out) : ''].filter(Boolean).join('\n')

  return (
    <div draggable onDragStart={e => e.dataTransfer.setData('text/plain', g.id)}
      className={'rounded-xl border bg-white cursor-grab active:cursor-grabbing ' +
        (urgent ? 'border-rose-300' : 'border-line')}>
      <button onClick={onOpen} title={hover} className="w-full text-left px-2.5 py-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* UNIT · GUEST (Sulaman via Jon, 2026-10-02: "show the guest name in the title as well"). */}
          <p className="text-[13px] font-semibold text-ink flex-1 min-w-0 flex items-baseline gap-1">
            <span className="shrink-0">{g.unit || 'No unit'}</span>
            {g.guest_name ? <span className="font-medium text-ink/70 truncate min-w-0">· {g.guest_name}</span> : null}
          </p>
          {age ? (
            <span title={'Open for ' + age} className={'shrink-0 text-[10.5px] font-bold tabular-nums px-1.5 py-[2px] rounded-md ' +
              (ageDays >= 3 ? 'bg-rose-50 text-rose-700' : ageDays >= 1 ? 'bg-amber-50 text-amber-800' : 'bg-app text-muted')}>{age}</span>
          ) : null}
          {g.assignee ? (
            <span className="shrink-0 text-[10.5px] font-semibold text-muted inline-flex items-center gap-0.5" title={'Assigned to ' + g.assignee}>
              <User2 size={10} />{g.assignee.split(' ')[0]}
            </span>
          ) : null}
          {g.vendor_name ? (
            <VendorName vendorKey={g.vendor_key} name={g.vendor_name} size={10} className="shrink-0 text-[10.5px] font-semibold text-muted max-w-[110px]" />
          ) : null}
        </div>
        {/* WHO DO I SEND, HOW LOUD, CAN I ACT TODAY. Urgent first — it is the only tag that
            changes the ORDER work gets done in. */}
        <div className="flex items-center gap-1 flex-wrap mt-1">
          {urgent ? <Tag tone="roseSolid">Urgent</Tag> : null}
          {incident ? <Tag tone="rose">{g.glitch_type}</Tag> : null}
          {trade ? <span title={g.category || ''} className={'shrink-0 whitespace-nowrap text-[10.5px] font-semibold leading-none px-1.5 py-[3px] rounded-md ring-1 ' + trade.cls}>{trade.label}</span> : null}
          {stay.now ? <Tag tone="emerald" title={'Guest in the unit: ' + fmtShort(g.check_in) + ' → ' + fmtShort(g.check_out)}>In house</Tag> : null}
          {taskTag}
          {refund > 0 ? <Tag tone="emerald" title="Refund given">{money(refund)}</Tag> : null}
          {owedRefund ? <Tag tone="amber" title="Sitting in refund but no amount logged">Refund?</Tag> : null}
          {(g as any).refund_needs_approval ? <Tag tone="violet" title="Refund over the cap, waiting on approval">Approval</Tag> : null}
          {String(g.status) === 'manager_review' ? <Tag tone="violet" title="Marked complete by the team — waiting on a manager to approve the close">Awaiting manager approval</Tag> : null}
          {due ? <span className={'shrink-0 whitespace-nowrap text-[10.5px] font-semibold leading-none px-1.5 py-[3px] rounded-md border ' + due.cls}>{due.label}</span> : null}
        </div>
      </button>
    </div>
  )
}

// ── NEW GLITCH ───────────────────────────────────────────────────────────────────────────────
// A POP-UP, in three steps (Jon, 2026-08-20). It used to be an inline panel that opened
// full-width above the kanban and pushed the whole board off the bottom of the screen — which is
// why it read as "a page". Now the board stays exactly where it was, behind the sheet.
//
// The three steps follow the phone call, not the database: WHO is calling, WHAT went wrong, then
// the bookkeeping nobody has at minute one. Step 1 auto-fills unit, market, channel, dates, phone,
// email, reservation total and the guest's current sentiment, so step 2 is the only real typing.
function NewGlitch({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<ResMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [res, setRes] = useState<ResMatch | null>(null)
  const [noRes, setNoRes] = useState(false)
  const [glitchType, setGlitchType] = useState(TYPES[0])
  const [category, setCategory] = useState('')
  const [moreCats, setMoreCats] = useState(false)
  const [incidentDate, setIncidentDate] = useState(todayET())
  const [overview, setOverview] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // TONE IS SELECTED, NEVER INFERRED. Jon, 2026-08-27: "we select the tone, cause it could of been
  // a call." Plenty of complaints never touch the message thread, and the only person who knows how
  // the guest sounded is whoever spoke to them.
  const [guestTone, setGuestTone] = useState('')
  const [reportedVia, setReportedVia] = useState('')
  const [reportedBy, setReportedBy] = useState('')
  const [guestEmail, setGuestEmail] = useState('')

  // DEFAULT search = guests in-house today (most glitches are live stays). "All stays"
  // reaches past/upcoming bookings; inquiries & canceled never show (server-filtered).
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [searched, setSearched] = useState(false)
  const search = async (sc?: 'active' | 'all') => {
    if (!q.trim()) return
    const useScope = sc || scope
    if (sc) setScope(sc)
    setSearching(true); setErr('')
    try {
      const r = await fetch('/api/glitches?guest=' + encodeURIComponent(q.trim()) + '&scope=' + useScope, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Search failed') } else { setMatches(j.matches || []); setSearched(true) }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setSearching(false)
  }
  const stayTag = (m: ResMatch) => {
    const today = todayET()
    if (m.checkIn && m.checkIn <= today && m.checkOut && m.checkOut >= today) return { label: 'In-house', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    if (m.checkIn && m.checkIn > today) return { label: 'Upcoming', cls: 'bg-sky-50 text-sky-700 border-sky-200' }
    return { label: 'Past stay', cls: 'bg-app text-muted border-line' }
  }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const body: Record<string, any> = {
        glitchType, category, incidentDate, overview, guestTone, reportedVia, photos, reportedBy, guestEmail,
      }
      if (res) Object.assign(body, { reservationId: res.reservationId, listingId: res.listingId, unit: res.unit, market: res.market, guestName: res.guestName, guestPhone: res.guestPhone, channel: res.channel, checkIn: res.checkIn, checkOut: res.checkOut, reservationTotal: res.total, reservationNotes: res.notes, sentiment: res.sentiment })
      const r = await fetch('/api/glitches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not create'); setBusy(false); return }
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  // Why each step will not advance — shown next to the button, never a silent grey control.
  const blockedAt = (i: number): string => {
    if (i === 0) return (res || noRes) ? '' : 'Pick the stay, or choose "no reservation"'
    if (i === 1) {
      if (!category) return 'Pick a category'
      if (!overview.trim()) return 'Add a short description'
      if (!incidentDate) return 'Set the incident date'
    }
    return ''
  }
  const blocked = blockedAt(step)
  const go = (i: number) => { setStep(i); if (i > furthest) setFurthest(i) }
  const next = () => { if (step >= STEPS.length - 1) { create(); return } go(step + 1) }

  const catChips = (moreCats ? CAT_CHIPS : CAT_CHIPS.slice(0, 7))
  const stayLine = res
    ? res.unit + ' · ' + fmtShort(res.checkIn) + ' → ' + fmtShort(res.checkOut) + (res.channel ? ' · ' + res.channel : '')
    : 'No reservation attached'

  return (
    <Sheet
      open
      onClose={onCancel}
      title="New guest issue"
      subtitle={<StepDots steps={STEPS} current={step} furthest={furthest} onGo={go} />}
      footer={
        <div>
          <StepBar
            current={step} total={STEPS.length} blocked={blocked} busy={busy}
            onBack={() => go(Math.max(0, step - 1))} onNext={next}
            nextLabel="Next" finishLabel="Create issue"
          />
          {err ? <p className="text-[11.5px] text-rose-700 font-semibold mt-2">{err}</p> : null}
        </div>
      }
    >
      {/* ── STEP 1 · WHO ───────────────────────────────────────────────────────────────── */}
      {step === 0 && (
        <div>
          {!res ? (
            <div>
              <Field label="Which guest?" hint="Everything else — unit, market, channel, dates, phone, email, stay value — fills itself in from the booking.">
                <div className="flex gap-2">
                  <span className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input value={q} autoFocus onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }}
                      placeholder="Guest name…" className="w-full text-[13.5px] border border-line rounded-xl pl-8 pr-2.5 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  </span>
                  <button type="button" onClick={() => search()} disabled={searching || !q.trim()}
                    className="text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl bg-ink text-white disabled:bg-line disabled:text-faint shrink-0">
                    {searching ? 'Searching…' : 'Find'}
                  </button>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button type="button" onClick={() => search('active')} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (scope === 'active' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>In-house now</button>
                  <button type="button" onClick={() => search('all')} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (scope === 'all' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>All stays</button>
                </div>
              </Field>

              {matches.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {matches.map(m => (
                    <button type="button" key={m.reservationId} onClick={() => { setRes(m); setNoRes(false); if (m.guestEmail) setGuestEmail(m.guestEmail); go(1) }}
                      className="w-full text-left border border-line rounded-xl px-3 py-2.5 bg-white hover:border-ink/30 hover:bg-app/50">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold text-ink">{m.guestName}</span>
                        {(() => { const t = stayTag(m); return <span className={'text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded border ' + t.cls}>{t.label}</span> })()}
                        <SentimentChip s={m.sentiment} />
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5">{m.unit} · {fmtShort(m.checkIn)} &rarr; {fmtShort(m.checkOut)}{m.channel ? ' · ' + m.channel : ''}{m.total ? ' · ' + money(m.total) : ''}</div>
                    </button>
                  ))}
                </div>
              )}
              {searched && !searching && matches.length === 0 && scope === 'active' && q.trim() !== '' && (
                <p className="text-[12.5px] text-muted mb-4">
                  Nobody in-house matches &ldquo;{q.trim()}&rdquo;.{' '}
                  <button type="button" onClick={() => search('all')} className="font-bold text-ink underline">Search past &amp; upcoming stays</button>
                </p>
              )}
              {searched && !searching && matches.length === 0 && scope === 'all' && (
                <p className="text-[12.5px] text-muted mb-4">No booked reservation matches &ldquo;{q.trim()}&rdquo;. Inquiries and canceled bookings never show here.</p>
              )}

              <button type="button" onClick={() => { setNoRes(true); go(1) }}
                className={'w-full text-left rounded-xl border px-3 py-2.5 ' + (noRes ? 'border-ink bg-app' : 'border-line bg-white hover:border-ink/30')}>
                <p className="text-[13px] font-bold text-ink">No reservation &mdash; log it anyway</p>
                <p className="text-[11.5px] text-muted mt-0.5">For a building or common-area problem that is not tied to one stay.</p>
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-app/60 px-3.5 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-bold text-ink">{res.guestName}</span>
                <SentimentChip s={res.sentiment} />
                <button type="button" onClick={() => { setRes(null); setMatches([]); setSearched(false) }} className="ml-auto text-[11.5px] font-semibold text-muted hover:text-ink underline">change</button>
              </div>
              <p className="text-[12px] text-muted mt-1">
                {res.unit} · {res.market} · {fmtShort(res.checkIn)} &rarr; {fmtShort(res.checkOut)}
                {res.channel ? ' · ' + res.channel : ''}{res.total ? ' · ' + money(res.total) : ''}
              </p>
              {res.guestPhone || res.guestEmail ? <p className="text-[11.5px] text-muted mt-0.5">{[res.guestPhone, res.guestEmail].filter(Boolean).join(' · ')}</p> : null}
              <a href={res.guestyUrl} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-600 hover:underline inline-block mt-1.5">Open in Guesty &#8599;</a>
              {res.notes ? <p className="text-[11.5px] text-muted mt-1.5">Reservation notes: {res.notes.slice(0, 220)}</p> : null}
              {res.sentiment && res.sentiment.excerpt ? <p className="text-[11.5px] text-muted mt-1">Guest said: &ldquo;{String(res.sentiment.excerpt).slice(0, 180)}&rdquo;</p> : null}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2 · WHAT ──────────────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div>
          <p className="text-[12px] text-muted mb-3.5">{stayLine}</p>

          <Field label="What kind of issue">
            <Chips options={TYPES.map(t => ({ value: t, label: t.replace(/\s*\(.*\)$/, '') }))} value={glitchType} onChange={v => setGlitchType(v || TYPES[0])} />
          </Field>

          <Field label="Category" hint={!moreCats ? <button type="button" onClick={() => setMoreCats(true)} className="font-semibold text-ink underline">More categories</button> : null}>
            <Chips options={catChips} value={category} onChange={setCategory} />
          </Field>

          <Field label="How did they tell us?" hint="A call leaves no message thread, so the record needs to say so.">
            <Chips
              options={[
                { value: 'message', label: 'Message' },
                { value: 'call', label: 'Phone call' },
                { value: 'in_person', label: 'In person' },
                { value: 'at_checkout', label: 'At checkout' },
                { value: 'review', label: 'In a review' },
              ]}
              value={reportedVia}
              onChange={v => setReportedVia(v || '')}
            />
          </Field>

          <Field label="How did the guest sound?" hint="You spoke to them, so only you know this. It changes what a fair refund looks like.">
            <Chips
              options={[
                { value: 'understanding', label: 'Understanding' },
                { value: 'frustrated', label: 'Frustrated' },
                { value: 'angry', label: 'Angry' },
                { value: 'fishing', label: 'Angling for a discount' },
              ]}
              value={guestTone}
              onChange={v => setGuestTone(v || '')}
            />
          </Field>

          <Field label="What happened">
            <textarea value={overview} onChange={e => setOverview(e.target.value)} rows={3}
              placeholder="One or two sentences. The team and Breezeway will read this."
              className="w-full text-[13.5px] border border-line rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
            {/* Rewrites for clarity only — never adds or drops a fact, and you approve it. */}
            <PolishButton
              text={overview} kind="glitch" className="mt-1.5"
              context={category || undefined}
              onAccept={setOverview}
              label="Tidy the wording"
            />
          </Field>

          <Field label="Proof" hint="Screenshot the guest's message and paste it straight in.">
            <ImageDrop items={photos} onChange={setPhotos} endpoint="/api/glitches/photo" srcFor={glitchPhotoSrc} label="Add a photo or screenshot" />
          </Field>

          <Field label="When it happened">
            <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)}
              className="text-[13px] border border-line rounded-xl px-3 py-2 bg-white" />
          </Field>
        </div>
      )}

      {/* ── STEP 3 · SEND ──────────────────────────────────────────────────────────────── */}
      {step === 2 && (
        <div>
          <div className="rounded-xl border border-line bg-app/60 px-3.5 py-3 mb-4">
            <p className="text-[13px] font-bold text-ink">{res ? res.guestName : 'No reservation'}</p>
            <p className="text-[11.5px] text-muted mt-0.5">{stayLine}</p>
            <p className="text-[12.5px] text-ink mt-2">{(CAT_CHIPS.filter(c => c.value === category)[0] || { label: category }).label}{overview ? ' — ' + overview.slice(0, 160) : ''}</p>
            <p className="text-[11.5px] text-muted mt-1">{incidentDate}{photos.length ? ' · ' + photos.length + (photos.length === 1 ? ' photo' : ' photos') : ' · no photo'}</p>
          </div>

          <Field label="Who reported it" hint="The person who took the call, so the next reader knows who to ask.">
            <input value={reportedBy} onChange={e => setReportedBy(e.target.value)} placeholder="e.g. CCS, Amna"
              className="w-full text-[13.5px] border border-line rounded-xl px-3 py-2.5 bg-white" />
          </Field>

          <Field label="Guest email" hint="Prefilled from the booking when there is one.">
            <input value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="optional"
              className="w-full text-[13.5px] border border-line rounded-xl px-3 py-2.5 bg-white" />
          </Field>

        </div>
      )}
    </Sheet>
  )
}


// Push panel — issue text uses the Breezeway template naming ("Guest Reported / Glitch - <issue>")
// and an assignee can be picked right here. Pushes are URGENT: guest glitches are priority field issues.
function PushPanel({ g, people, onDone, act }: { g: Glitch; people: { id: number; name: string; departments: string[] }[]; onDone: () => void; act: (id: string, body: Record<string, any>, c?: string) => Promise<void> }) {
  // THE BREEZEWAY JOB, AS A FORM (Jon, 2026-09-15: "should function like the today in ops add task
  // form but use the glitch guest template").
  //
  // The old panel asked for a title, an optional assignee and a property, then the SERVER decided
  // everything that actually matters to a crew: department from the category, priority always
  // urgent, date always today — and it ignored the due date already on the card. So a glitch you
  // had scheduled for Thursday arrived in Breezeway as a fire, and there was no way to say "this
  // is a normal-priority housekeeping job for tomorrow" without opening Breezeway and redoing it.
  //
  // Same four decisions as the Today-in-Ops sheet — what, who, when, how urgent — with the glitch
  // guest template and the description block already attached by the server.
  const firstLine = (g.overview || '').split('\n')[0].slice(0, 70)
  const [issue, setIssue] = useState(firstLine)
  const [assignee, setAssignee] = useState(g.assignee || '')
  const [dept, setDept] = useState('')
  // Priority is the GLITCH's, not the form's (migration 086). Whatever gets filed is written back,
  // so the card and Breezeway cannot disagree about how urgent this is.
  const [prio, setPrio] = useState(String(g.priority || 'urgent'))
  const [date, setDate] = useState(() => {
    if (g.due_date && /^\d{4}-\d{2}-\d{2}$/.test(g.due_date)) return g.due_date
    return todayET()
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // THE UNIT FILLS ITSELF IN (Jon, 2026-09-15: "it should auto populate the unit in breezeway when
  // creating a task"). The box used to sit EMPTY with the unit name as grey placeholder text. The
  // server did resolve the unit behind the scenes, so it worked — but an empty required-looking
  // field reads as something you forgot, and there was no way to see WHICH Breezeway property you
  // were about to file against until the task already existed. Now it is filled from the glitch's
  // own listing the moment the property list arrives, and typing a building over it is the
  // deliberate override rather than the only way to put anything there at all.
  const [prop, setProp] = useState('')
  const [props, setProps] = useState<{ id: number; name: string }[]>([])
  const [autoFilled, setAutoFilled] = useState(false)
  useEffect(() => {
    let dead = false
    fetch('/api/glitches/properties', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (dead) return
        const list: { id: number; name: string }[] = Array.isArray(j.properties) ? j.properties : []
        setProps(list)
        // Exact name first; then a unique case-insensitive match. Never guess between two.
        const want = String(g.unit || '').trim()
        if (!want) return
        const exact = list.find(x => x.name === want)
        if (exact) { setProp(exact.name); setAutoFilled(true); return }
        const ci = list.filter(x => x.name.toLowerCase() === want.toLowerCase())
        if (ci.length === 1) { setProp(ci[0].name); setAutoFilled(true) }
      })
      .catch(() => {})
    return () => { dead = true }
  }, [g.unit])
  const pickedProp = props.find(x => x.name === prop.trim()) || null

  // The department Breezeway will get if nobody overrides it — shown, not hidden, so the person
  // filing can see the guess and correct it.
  const impliedDept = /cleanliness/i.test(String(g.category || '')) ? 'housekeeping'
    : /safety|security/i.test(String(g.category || '')) ? 'safety' : 'maintenance'
  const cleanName = (v: string) => v.trim().replace(/\s*\([^)]*\)\s*$/, '')
  const person = people.find(x => x.name === cleanName(assignee)) || null
  const blocked = !issue.trim() ? 'Give the task a title.'
    : (assignee.trim() && !person) ? 'That name is not on the Breezeway roster.'
    : (prop.trim() && !pickedProp) ? 'That property is not in Breezeway.'
    : ''

  const doPush = async () => {
    setBusy(true); setErr('')
    const body: Record<string, any> = {
      action: 'push',
      issue: issue.trim(),
      assigneeIds: person ? [person.id] : [],
      assigneeName: person ? person.name : '',
      department: dept || impliedDept,
      priority: prio,
      scheduledDate: date,
    }
    if (pickedProp) { body.homeId = pickedProp.id; body.homeName = pickedProp.name }
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(String(j?.message || j?.error || 'Breezeway refused the task.')); setBusy(false); return }
      // A task that exists but could not be assigned is a half-success, and saying so is the point.
      if (j.assignError) { setErr(String(j.assignError)); setBusy(false); return }
      setBusy(false); onDone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }

  const Lbl = ({ children }: { children: any }) => (
    <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted mb-1">{children}</p>
  )
  const field = 'w-full h-9 px-2.5 rounded-xl border border-line bg-white text-base sm:text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-200'

  return (
    <div className="rounded-xl ring-1 ring-line bg-white p-3.5 space-y-3">
      <div>
        <Lbl>Task title</Lbl>
        <input value={issue} onChange={e => setIssue(e.target.value)} className={field}
          placeholder="What the crew needs to do" />
        <p className="text-[11px] text-muted mt-1">
          Files as <span className="text-ink font-medium">Guest Reported / Glitch - {issue || '…'}</span>, on the glitch guest template.
        </p>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <Lbl>Assign to</Lbl>
          <input list="glitch-board-ppl" value={assignee} onChange={e => setAssignee(e.target.value)}
            className={field} placeholder="Nobody yet" />
        </div>
        <div>
          <Lbl>Scheduled for</Lbl>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
        </div>
        <div>
          <Lbl>Department</Lbl>
          <select value={dept} onChange={e => setDept(e.target.value)} className={field}>
            <option value="">From the category — {impliedDept}</option>
            <option value="maintenance">Maintenance</option>
            <option value="housekeeping">Housekeeping</option>
            <option value="safety">Safety</option>
            <option value="inspection">Inspection</option>
          </select>
        </div>
        <div>
          <Lbl>Priority</Lbl>
          <select value={prio} onChange={e => setPrio(e.target.value)} className={field}>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div>
        <Lbl>File against</Lbl>
        <input list="glitch-board-props" value={prop} onChange={e => { setProp(e.target.value); setAutoFilled(false) }}
          className={field + (prop && !pickedProp ? ' border-amber-300' : '')}
          placeholder={(g.unit || 'the unit') + ' — type a building to file there instead'} />
        {prop && !pickedProp ? (
          <p className="text-[11px] text-amber-700 mt-1">No Breezeway property by that name.</p>
        ) : autoFilled && pickedProp ? (
          <p className="text-[11px] text-muted mt-1">The guest&rsquo;s unit, filled in for you. Type a building to file there instead.</p>
        ) : pickedProp ? (
          <p className="text-[11px] text-violet-700 mt-1">Filing under <span className="font-semibold">{pickedProp.name}</span>.</p>
        ) : (
          <p className="text-[11px] text-muted mt-1">Not matched to a Breezeway property &mdash; the server will resolve it from the unit.</p>
        )}
      </div>

      <datalist id="glitch-board-ppl">{people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}</datalist>
      <datalist id="glitch-board-props">{props.map(x => <option key={x.id} value={x.name} />)}</datalist>

      <div className="flex items-center gap-2.5 flex-wrap">
        <button onClick={doPush} disabled={busy || !!blocked}
          className="text-[12.5px] font-bold px-4 h-9 rounded-xl bg-ink text-white disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} Create the task
        </button>
        {/* A disabled button always says why. */}
        {blocked ? <span className="text-[11.5px] font-semibold text-amber-700">{blocked}</span> : null}
        {err ? <span className="text-[11.5px] font-semibold text-rose-700">{err}</span> : null}
      </div>
    </div>
  )
}

/**
 * EVERYTHING ON THE CARD, EDITABLE (Jon, 2026-09-17: "just want to be editable").
 *
 * Three things were shown on the issue and could not be changed anywhere: how it came in, how the
 * guest sounded, and the photos. The server's update action has always accepted all three — only
 * the form had never offered them. A chip that reads "via message" when it arrived as a phone call,
 * on a card whose whole point is being an accurate record, is the same class of problem as the typo
 * Sulaman could not fix.
 *
 * PHOTOS ARE REMOVE-ONLY HERE, and deliberately: attaching the wrong picture is the mistake worth
 * undoing, and adding one belongs with the camera on the main card rather than buried in a
 * corrections form.
 */
function EditGlitch({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [f, setF] = useState({
    glitchType: g.glitch_type || TYPES[0], category: g.category || '', incidentDate: g.incident_date || '',
    overview: g.overview || '', refundApproved: String(g.refund_approved || ''),
    reportedBy: g.reported_by || '', guestName: g.guest_name || '', guestPhone: g.guest_phone || '', guestEmail: g.guest_email || '', unit: g.unit || '', channel: g.channel || '',
    reportedVia: g.reported_via || '', guestTone: g.guest_tone || '',
  })
  // Photos are an array, so they travel beside `f` rather than in it, and only when one was dropped
  // — an unchanged list is not sent, so a photo added on the card while this form sits open is not
  // quietly reverted by pressing Save.
  const [photos, setPhotos] = useState<string[]>(() => (g.photos || []).slice())
  const photosChanged = photos.length !== (g.photos || []).length
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: 'update', ...f, ...(photosChanged ? { photos } : {}) }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Save failed'); setBusy(false); return }
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="mt-1.5 rounded-lg border border-line bg-app/60 p-2 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Edit glitch</div>
      {/* Two columns of fields inside a lane is ~145px per field, and iOS forces the text to 16px:
          "Refund approved $" was unreadable. One field per line on a phone. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        <select value={f.glitchType} onChange={e => set('glitchType', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white">{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={f.category} onChange={e => set('category', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white"><option value="">Category…</option>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <input type="date" value={f.incidentDate} onChange={e => set('incidentDate', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="Unit" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.guestName} onChange={e => set('guestName', e.target.value)} placeholder="Guest name" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.guestPhone} onChange={e => set('guestPhone', e.target.value)} placeholder="Guest phone" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.guestEmail} onChange={e => set('guestEmail', e.target.value)} placeholder="Guest email" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.channel} onChange={e => set('channel', e.target.value)} placeholder="Channel (Airbnb…)" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.refundApproved} onChange={e => set('refundApproved', e.target.value)} placeholder="Refund approved $" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white" />
        <input value={f.reportedBy} onChange={e => set('reportedBy', e.target.value)} placeholder="Reported by" className="text-xs border border-line rounded px-1.5 py-1.5 bg-white sm:col-span-2" />
        <select value={f.reportedVia} onChange={e => set('reportedVia', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white">
          <option value="">How it came in…</option>
          {[['message', 'Message'], ['call', 'Phone call'], ['in_person', 'In person'], ['at_checkout', 'At checkout'], ['review', 'In a review'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={f.guestTone} onChange={e => set('guestTone', e.target.value)} className="text-xs border border-line rounded px-1.5 py-1.5 bg-white">
          <option value="">Guest sounded…</option>
          {[['understanding', 'Understanding'], ['frustrated', 'Frustrated'], ['angry', 'Angry'], ['fishing', 'Fishing']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider font-bold text-muted mb-1">What the guest said</span>
        <textarea value={f.overview} onChange={e => set('overview', e.target.value)} rows={3} className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
      </label>

      {photos.length > 0 ? (
        <div>
          <span className="block text-[10px] uppercase tracking-wider font-bold text-muted mb-1">Photos &mdash; tap the cross to drop a wrong one</span>
          <div className="flex gap-1.5 flex-wrap">
            {photos.map((u, i) => (
              <div key={u + i} className="relative">
                <img src={glitchPhotoSrc(u)} alt="" className="w-14 h-14 object-cover rounded-md border border-line" />
                <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  title="Remove this photo" aria-label="Remove this photo"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-ink text-white text-[11px] leading-none shadow">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          {photosChanged ? <p className="text-[10px] text-muted mt-1">Not removed until you press Save.</p> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <button onClick={save} disabled={busy} className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-ink text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        {err && <span className="text-[10px] text-rose-700">{err}</span>}
      </div>
    </div>
  )
}

/** The latest refund decision in the card's history — logged, approved or rejected — or null. */
function lastRefundEvent(g: Glitch): any | null {
  const h: any[] = Array.isArray(g.history) ? g.history : []
  for (let i = h.length - 1; i >= 0; i--) {
    const a = String((h[i] && h[i].action) || '')
    if (a === 'refund_logged' || a === 'refund_approved' || a === 'refund_rejected') return h[i]
  }
  return null
}

/**
 * SIGN OFF A REFUND OVER THE CAP (2026-09-28 audit, D12). Shown only to approvers — full access on
 * Glitches — and the server checks the same thing. Approve keeps the amount and puts the approver
 * on the card; Reject sends it back to $0 with a reason, until someone logs a new amount.
 */
/** A manager's decision on a card the team marked complete: approve (closes it) or send back (to ops, with why). */
function CloseSignOff({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const chip = 'text-[11.5px] font-semibold px-2 py-0.5 rounded-md ring-1 inline-flex items-center'
  const [busy, setBusy] = useState<'' | 'approve' | 'reject'>('')
  const [why, setWhy] = useState('')
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState('')
  const decide = async (approve: boolean) => {
    if (!approve && !why.trim()) { setAsking(true); return }
    setBusy(approve ? 'approve' : 'reject'); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: approve ? 'approveClose' : 'rejectClose', note: why.trim() }) })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j.ok) setErr(j.error || 'Could not save the decision.')
      else onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={chip + ' bg-violet-50 text-violet-800 ring-violet-200 h-8'}>Awaiting your approval</span>
      <button onClick={() => decide(true)} disabled={!!busy} title="Approve — the card closes and your name goes on it"
        className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 h-8 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve & close
      </button>
      {asking ? (
        <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); decide(false) }}>
          <input autoFocus value={why} onChange={e => setWhy(e.target.value)} placeholder="What still needs doing?" maxLength={300}
            className="h-8 w-56 rounded-xl border border-line bg-white px-2.5 text-[12px] text-ink" />
          <button type="submit" disabled={!!busy || !why.trim()} className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 h-8 rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
            {busy === 'reject' ? <Loader2 size={12} className="animate-spin" /> : null} Send back
          </button>
          <button type="button" onClick={() => { setAsking(false); setWhy('') }} className="text-[12px] text-muted hover:text-ink px-1">Cancel</button>
        </form>
      ) : (
        <button onClick={() => decide(false)} disabled={!!busy} title="Not done yet — send it back to ops with a reason"
          className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 h-8 rounded-xl border border-line bg-white text-ink hover:border-rose-400 hover:text-rose-700 disabled:opacity-50">Send back</button>
      )}
      {err ? <span className="text-[11px] text-rose-700">{err}</span> : null}
    </span>
  )
}

function RefundSignOff({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [busy, setBusy] = useState<'' | 'approve' | 'reject'>('')
  const [err, setErr] = useState('')
  const amt = money(Number(g.refund_approved) || 0) || '$0'
  const decide = async (approve: boolean) => {
    let note = ''
    if (approve) {
      if (!window.confirm('Approve the ' + amt + ' refund' + (g.guest_name ? ' for ' + g.guest_name : '') + '?')) return
    } else {
      const why = window.prompt('Reject the ' + amt + ' refund? Say why — whoever logged it will see this. It goes back to $0 until a new amount is logged.', '')
      if (why === null) return
      note = why
    }
    setBusy(approve ? 'approve' : 'reject'); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: 'approveRefund', approve, note }) })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j.ok) setErr(j.error || 'Could not save the decision.')
      else onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <button onClick={() => decide(true)} disabled={!!busy} title={'Sign off the ' + amt + ' refund — the amount stands and your name goes on the card'}
        className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 h-8 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve {amt}
      </button>
      <button onClick={() => decide(false)} disabled={!!busy} title="Reject it — the refund goes back to $0 until someone logs a new amount"
        className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 h-8 rounded-xl border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50">
        {busy === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Reject
      </button>
      {err ? <span className="text-[12px] text-rose-700">{err}</span> : null}
    </span>
  )
}

// LOG THE REFUND at the moment of the decision. Dropping a card into "Refund request" opens this,
// and a card sitting in that column with no amount shows it until someone answers. Amount 0 is a
// real answer ("declined") — the point is that the question never goes unanswered.
function RefundLogger({ id, total, onDone }: { id: string; total: number | null; onDone: (amt: number) => void }) {
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    const n = Number(amt)
    if (!Number.isFinite(n) || n < 0) { setErr('Enter the refund amount (0 = declined).'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'refund', amount: n, note }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not log it'); setBusy(false); return }
      onDone(n)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-2 space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Log the refund decision{total ? ' \u00b7 stay total ' + '$' + Math.round(Number(total)).toLocaleString() : ''}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={amt} onChange={e => setAmt(e.target.value)} inputMode="decimal" placeholder="Amount $ (0 = declined)" className="text-xs border border-amber-300 rounded px-2 py-1.5 bg-white w-40" />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why / how (OTA credit, card refund\u2026)" className="text-xs border border-line rounded px-2 py-1.5 bg-white flex-1 min-w-[140px]" />
        <button onClick={save} disabled={busy} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy ? 'Saving\u2026' : 'Log it'}</button>
      </div>
      {err && <div className="text-[11px] text-rose-700">{err}</div>}
    </div>
  )
}
