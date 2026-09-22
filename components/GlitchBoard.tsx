'use client'
import PolishButton from './PolishButton'
// GLITCH BOARD — the Asana "VR Glitch/Incident Reporting" workflow, rebuilt in-app.
// Pool → Ops → Guest Followup → Refund → Manager Review → Incident → Closed.
// Create a glitch by searching the guest name (reservation details auto-attach), push a
// Breezeway task for the field, and move the card along the escalation path.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, RefreshCw, Search, X, Camera, CalendarDays, User2, Sliders, Trash2, Loader2, Pencil } from 'lucide-react'
import CommentThread from './CommentThread'
import UnitCalendar from './UnitCalendar'
import { DeleteButton, UndoBar, TrashDrawer } from './DeleteControl'
import { Sheet } from './Sheet'
import { StepDots, StepBar, Field, Chips, type Step } from './Steps'
import { ImageDrop } from './ImageDrop'

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
  // How it reached us and how the guest sounded — both feed the refund model (migration 060).
  reported_via?: string | null; guest_tone?: string | null
  // Migration 086 — how this issue is treated, independent of any Breezeway task.
  priority?: string | null
  // Migration 085: the advisor's number kept beside the human decision, and the approval state.
  refund_recommended?: number | null; refund_reasoning?: any; refund_note?: string | null
  refund_needs_approval?: boolean | null; refund_approved_by?: string | null; refund_approved_at?: string | null
  closed_at?: string | null; closed_at_estimated?: boolean | null
  created_at: string
}
type ResMatch = { reservationId: string; listingId: string; unit: string; market: string; guestName: string; guestPhone: string | null; guestEmail: string | null; checkIn: string; checkOut: string; channel: string | null; total: number | null; notes: string | null; sentiment: { score?: number; band?: string; dissatisfied?: boolean; topIssue?: string | null; excerpt?: string | null } | null; guestyUrl: string }

// Progress is derived from where the card sits on the board, so the bar moves as work moves.
// A manual `progress` on the row overrides it when someone wants to be explicit.
const STAGE_PROGRESS: Record<string, number> = { pool: 5, ops: 30, guest_followup: 50, refund: 65, manager_review: 80, incident: 90, closed: 100 }
function progressOf(g: Glitch): number {
  const manual = Number(g.progress)
  if (Number.isFinite(manual) && manual >= 0 && manual <= 100) return Math.round(manual)
  return STAGE_PROGRESS[String(g.status)] ?? 0
}
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
export const LANES: Lane[] = [
  { key: 'open',     label: 'Open',            hint: 'nobody has picked it up',     write: 'pool',            statuses: ['pool', ''] },
  { key: 'ops',      label: 'With ops',        hint: 'being fixed',                 write: 'ops',             statuses: ['ops', 'incident'] },
  { key: 'followup', label: 'Guest follow-up', hint: 'fixed, guest still owed a reply', write: 'guest_followup', statuses: ['guest_followup', 'refund', 'manager_review'] },
  { key: 'closed',   label: 'Closed',          hint: 'done and answered',           write: 'closed',          statuses: ['closed', 'done', 'resolved'] },
]
export function laneOf(status: string | null | undefined): Lane {
  const s = String(status || '')
  return LANES.find(l => l.statuses.indexOf(s) >= 0) || LANES[0]
}
/** Kept for the legacy stage arrows and the progress fallback. */
const COLS: { key: string; label: string }[] = [
  { key: 'pool', label: 'Glitch pool' },
  { key: 'ops', label: 'VR Ops' },
  { key: 'guest_followup', label: 'Guest followup' },
  { key: 'refund', label: 'Refund request' },
  { key: 'manager_review', label: 'Manager review' },
  { key: 'incident', label: 'Incident report' },
  { key: 'closed', label: 'Closed' },
]
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
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [open, setOpen] = useState<string>('')
  const [people, setPeople] = useState<{ id: number; name: string; departments: string[] }[]>([])
  const [refundFor, setRefundFor] = useState('')  // glitch id whose refund logger is open
  const [panel, setPanel] = useState<string>('')  // '<id>:edit' | '<id>:push'
  const [showTrash, setShowTrash] = useState(false)
  const [undo, setUndo] = useState<{ trashId: string; label: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/glitches', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setGlitches(j.glitches || [])
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

  const rows = market === 'all' ? glitches : glitches.filter(g => g.market === market)
  const markets = ['all', 'Miami', 'Broward', 'North', 'Vendor']
  // The open card is looked up from the live list, not copied into state, so an edit or a refund
  // refreshes what the sheet is showing without anyone having to close and reopen it.
  const openGlitch = open ? glitches.find(g => g.id === open) || null : null

  if (loading && !glitches.length) return <div className="text-sm text-muted py-10 text-center">Loading glitch board…</div>

  return (
    <div>
      <div className="lh-actions flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setShowNew(true)} className="text-sm font-medium px-3 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1.5"><Plus size={14} /> New glitch</button>
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <button onClick={() => setShowTrash(!showTrash)} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><Trash2 size={13} /> Recently deleted</button>
        <button onClick={() => { setLoading(true); load() }} className="text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
      </div>
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {showTrash && <TrashDrawer kind="glitch" onRestored={load} onClose={() => setShowTrash(false)} />}
      {showNew && <NewGlitch onDone={() => { setShowNew(false); load() }} onCancel={() => setShowNew(false)} />}

      <GlitchKpis rows={rows} />

      {/* FOUR LANES FIT. The old seven scrolled sideways on every screen, so the board could never
          be read in one look — which is most of what "confusing" meant. On a phone the lanes still
          snap one at a time; on a desktop they simply fit. */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-start">
        {LANES.map(lane => {
          const cards = rows.filter(g => laneOf(g.status).key === lane.key)
          return (
            <div key={lane.key} className="rounded-2xl bg-app/70 border border-line min-w-0">
              <div className="px-3 py-2.5 border-b border-line">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold text-ink">{lane.label}</span>
                  <span className={'text-[11px] font-bold tabular-nums px-1.5 rounded ' + (cards.length ? 'bg-ink text-white' : 'text-faint')}>{cards.length}</span>
                </div>
                <p className="text-[10.5px] text-muted mt-0.5">{lane.hint}</p>
              </div>
              <div className="p-2 space-y-2 min-h-[64px]"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  if (id) act(id, { action: 'move', status: lane.write })
                }}>
                {cards.map(g => (
                  <GlitchCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />
                ))}
                {cards.length === 0 && <p className="text-[11px] text-faint text-center py-5">Nothing here</p>}
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
          onClose={() => { setOpen(''); setRefundFor('') }}
          onChanged={load}
          act={act}
          openRefund={refundFor === openGlitch.id}
          onDeleted={(trashId, label) => { setUndo({ trashId, label }); setOpen(''); load() }}
        />
      )}

      {undo && <UndoBar item={undo} onUndone={() => { setUndo(null); load() }} onDismiss={() => setUndo(null)} />}
    </div>
  )
}

// ── THE RECORD ──────────────────────────────────────────────────────────────────────────────────
// One sheet, in the order somebody actually works it: what happened → who it happened to → what we
// know about this unit → the job → the money → the conversation. Everything here used to unfold
// inside the lane itself, which is why the board felt like it fell apart when you clicked a card.
function GlitchDetail({ g, people, onClose, onChanged, act, openRefund, onDeleted }: {
  g: Glitch
  people: { id: number; name: string; departments: string[] }[]
  onClose: () => void
  onChanged: () => void
  act: (id: string, body: Record<string, any>, c?: string) => Promise<void>
  openRefund: boolean
  onDeleted: (trashId: string, label: string) => void
}) {
  const [tab, setTab] = useState<'work' | 'money' | 'talk'>('work')
  const [panel, setPanel] = useState<'' | 'edit' | 'push'>('')
  // FIXING A TYPO SHOULD START WHERE THE TYPO IS (Sulaman, 2026-09-17: "once the Glitch is created,
  // there is no option to edit or modify the details in case there is a typo or any other error").
  //
  // There was an option — "Edit the details", a quiet outline button at the FOOT of this tab, past
  // the photos, the stay and the whole crew section. Somebody re-reading what they just typed is
  // looking at the words, not scrolling to the bottom of a tab to find a settings-shaped control.
  // So the same editor is now reachable from beside the text it edits, and opening it scrolls to
  // it — a panel that appears off-screen has not really opened.
  const editRef = useRef<HTMLElement | null>(null)
  const openEdit = useCallback(() => {
    setPanel('edit')
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }, [])
  const lane = laneOf(g.status)
  const refund = Number(g.refund_approved) || 0

  const Tab = ({ k, label }: { k: 'work' | 'money' | 'talk'; label: string }) => (
    <button onClick={() => setTab(k)}
      className={'text-[12.5px] font-semibold px-3 h-8 rounded-xl border transition ' +
        (tab === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
      {label}
    </button>
  )

  return (
    <Sheet open onClose={onClose} wide
      title={g.unit || 'Guest issue'}
      subtitle={<span>{g.guest_name || 'Guest'}{g.category ? ' · ' + g.category : ''} · <span className="font-semibold">{lane.label}</span></span>}
      footer={
        <div className="flex items-center gap-2 flex-wrap">
          {LANES.filter(l => l.key !== lane.key).map(l => (
            <button key={l.key} onClick={() => act(g.id, { action: 'move', status: l.write })}
              className={'text-[12px] font-semibold px-3 h-9 rounded-xl border ' +
                (l.key === 'closed' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
              {l.key === 'closed' ? 'Close it' : 'Move to ' + l.label}
            </button>
          ))}
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

      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        <Tab k="work" label="The issue" />
        <Tab k="money" label={refund > 0 ? 'Money · ' + money(refund) : 'Money'} />
        <Tab k="talk" label="Comments" />
      </div>

      {tab === 'work' ? (
        <div className="space-y-4">
          {/* HOW LOUD IS THIS — settable before any task exists, which is when triage happens. */}
          <section className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider font-bold text-muted">Priority</span>
            {[['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([k, label]) => {
              const on = String(g.priority || 'urgent').toLowerCase() === k
              return (
                <button key={k} onClick={() => act(g.id, { action: 'priority', priority: k })}
                  className={'text-[12px] font-bold px-2.5 h-8 rounded-xl border transition ' +
                    (on
                      ? (k === 'urgent' ? 'bg-rose-600 text-white border-rose-600' : 'bg-ink text-white border-ink')
                      : 'bg-white text-muted border-line hover:text-ink')}>
                  {label}
                </button>
              )
            })}
          </section>

          <section>
            <div className="flex items-baseline gap-2 mb-1.5">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted">What the guest said</p>
              <button onClick={openEdit} title="Fix a typo, or change the unit, guest or category"
                className="text-[11px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">
                <Pencil size={11} /> Edit
              </button>
            </div>
            <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">{g.overview}</p>
            {g.sentiment && g.sentiment.excerpt ? (
              <p className="text-[12.5px] text-muted mt-2 border-l-2 border-line pl-3 italic">&ldquo;{String(g.sentiment.excerpt).slice(0, 300)}&rdquo;</p>
            ) : null}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <SentimentChip s={g.sentiment} />
              {g.reported_via ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">via {String(g.reported_via).replace(/_/g, ' ')}</span> : null}
              {g.guest_tone ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">guest {g.guest_tone}</span> : null}
              {g.incident_date ? <span className="text-[10px] text-muted">happened {fmtShort(g.incident_date)}</span> : null}
            </div>
          </section>

          {(g.photos || []).length > 0 ? (
            <section>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">Photos</p>
              <div className="flex gap-1.5 flex-wrap">
                {(g.photos || []).map((u, i) => (
                  <a key={i} href={glitchPhotoSrc(u)} target="_blank" rel="noreferrer">
                    <img src={glitchPhotoSrc(u)} alt="" className="w-20 h-20 object-cover rounded-lg border border-line" />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl bg-app ring-1 ring-line px-3.5 py-3">
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">The stay</p>
            <p className="text-[12.5px] text-ink">
              {g.check_in ? fmtShort(g.check_in) + ' → ' + fmtShort(g.check_out) : 'No reservation linked'}
              {g.reservation_total ? ' · ' + money(g.reservation_total) : ''}
              {g.channel ? ' · ' + g.channel : ''}
            </p>
            <p className="text-[12px] text-muted mt-0.5">
              {[g.guest_phone, g.guest_email].filter(Boolean).join(' · ') || 'No contact on file'}
            </p>
            {g.reservation_notes ? <p className="text-[12px] text-muted mt-1.5">Notes: {String(g.reservation_notes).slice(0, 300)}</p> : null}
            {g.reservation_id ? (
              <a href={'https://app.guesty.com/reservations/' + g.reservation_id + '/summary'} target="_blank" rel="noreferrer"
                className="text-[12px] font-semibold text-brand-700 hover:underline mt-1.5 inline-block">Open in Guesty ↗</a>
            ) : null}
          </section>

          <UnitSignals g={g} />

          <section>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">The Breezeway job</p>
            {g.breezeway_task_id ? (
              <div className="rounded-xl ring-1 ring-line bg-white px-3.5 py-3">
                <p className="text-[12.5px] text-ink">
                  <span className="font-semibold">{g.task_status === 'completed' ? 'Completed' : g.task_status === 'in_progress' ? 'In progress' : 'Not started'}</span>
                  {g.assignee ? ' · ' + g.assignee : ' · nobody assigned'}
                  {g.due_date ? ' · due ' + fmtShort(g.due_date) : ''}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <a href={'https://app.breezeway.io/task/' + g.breezeway_task_id} target="_blank" rel="noreferrer"
                    className="text-[12px] font-semibold px-2.5 h-8 inline-flex items-center rounded-lg border border-line bg-white text-brand-700">Open in Breezeway ↗</a>
                  {g.task_report_url ? <a href={g.task_report_url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold px-2.5 h-8 inline-flex items-center rounded-lg border border-line bg-white">Field report</a> : null}
                  <button onClick={() => act(g.id, { action: 'checkTask' })} className="text-[12px] font-semibold px-2.5 h-8 rounded-lg border border-line bg-white">Check status</button>
                </div>
                <div className="mt-2.5"><GlitchManage g={g} people={people} onDone={onChanged} /></div>
              </div>
            ) : (
              <>
                <p className="text-[12.5px] text-muted mb-2">Nothing has been filed for the crew yet.</p>
                <button onClick={() => setPanel(panel === 'push' ? '' : 'push')}
                  className="text-[12.5px] font-bold px-3.5 h-9 rounded-xl bg-ink text-white">Create the task</button>
                {panel === 'push' ? <div className="mt-2"><PushPanel g={g} people={people} onDone={() => { setPanel(''); onChanged() }} act={act} /></div> : null}
              </>
            )}
          </section>

          <section ref={editRef as any}>
            <button onClick={() => (panel === 'edit' ? setPanel('') : openEdit())}
              className="text-[12px] font-semibold px-2.5 h-8 rounded-lg border border-line bg-white text-muted hover:text-ink inline-flex items-center gap-1.5">
              <Pencil size={12} /> {panel === 'edit' ? 'Done editing' : 'Edit the details'}
            </button>
            {panel === 'edit' ? (
              <div className="mt-2">
                <p className="text-[11.5px] text-muted mb-2">Anything typed in wrong — the words, the unit, the guest, the category, the date.</p>
                <EditGlitch g={g} onDone={() => { setPanel(''); onChanged() }} />
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === 'money' ? <MoneyTab g={g} openRefund={openRefund} onChanged={onChanged} /> : null}

      {tab === 'talk' ? (
        <CommentThread type="glitch" id={g.id}
          label={(g.unit ? g.unit + ' — ' : '') + String(g.overview || 'glitch').split('\n')[0].slice(0, 60)}
          link="/glitches" taskId={g.breezeway_task_id || ''} reservationId={g.reservation_id || ''} />
      ) : null}
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

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="min-w-0 rounded-2xl bg-white ring-1 ring-line px-4 py-3">
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">{label}</p>
      <p className={'text-[20px] font-bold tabular-nums leading-tight mt-0.5 ' + (tone || 'text-ink')}>{value}</p>
      {sub ? <p className="text-[11px] text-muted mt-0.5 break-words">{sub}</p> : null}
    </div>
  )

  return (
    <div className="grid gap-2.5 grid-cols-2 lg:grid-cols-4 mb-4">
      <Tile label="Open now" value={String(stat.open)}
        tone={stat.open ? 'text-ink' : 'text-emerald-700'}
        sub={stat.open && stat.oldest > 0 ? 'oldest is ' + stat.oldest + ' day' + (stat.oldest === 1 ? '' : 's') + ' old' : 'nothing outstanding'} />
      <Tile label="Typical time to close"
        value={stat.median != null ? dur(stat.median) : '—'}
        sub={stat.median != null
          ? 'median of ' + stat.measured + ' closed' + (stat.estimated ? ' · ' + stat.estimated + ' older ones estimated' : '')
          : (stat.estimated ? stat.estimated + ' closed before we timed them' : 'nothing closed yet')} />
      <Tile label="Refunds given" value={stat.refundTotal ? money(stat.refundTotal) || '—' : '$0'}
        tone={stat.refundTotal ? 'text-emerald-700' : 'text-ink'}
        sub={stat.refundCount ? 'across ' + stat.refundCount + ' issue' + (stat.refundCount === 1 ? '' : 's') : 'none logged'} />
      <Tile label="Waiting on approval" value={String(stat.awaitingApproval)}
        tone={stat.awaitingApproval ? 'text-violet-700' : 'text-ink'}
        sub={stat.awaitingApproval ? 'over the cap, unsigned' : 'nothing pending'} />
    </div>
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
function MoneyTab({ g, openRefund, onChanged }: { g: Glitch; openRefund: boolean; onChanged: () => void }) {
  const [rec, setRec] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showLog, setShowLog] = useState(openRefund)
  const refund = Number(g.refund_approved) || 0

  const ask = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/advise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not work out a recommendation.')
      setRec(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

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
              <p className="text-[12px] font-bold text-violet-700 mt-1.5">Waiting on a manager to sign this off.</p>
            ) : null}
          </>
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
              <p className="text-[11.5px] font-bold text-amber-700">Provisional — it is missing facts, see below.</p>
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
        {(rec?.questions || []).length ? (
          <div className="mt-2">
            <p className="text-[11.5px] font-bold text-amber-800">It needs to know:</p>
            <ul className="list-disc pl-4">
              {(rec.questions || []).map((q: string, i: number) => <li key={i} className="text-[12px] text-amber-900">{q}</li>)}
            </ul>
          </div>
        ) : null}
        {why.length ? (
          <ul className="list-disc pl-4 mt-2">
            {why.map((line, i) => <li key={i} className="text-[12px] text-muted leading-relaxed">{line}</li>)}
          </ul>
        ) : null}
        {rec?.classification ? (
          <p className="text-[11.5px] text-muted mt-1.5">
            {[rec.classification.category, rec.classification.severity, rec.stay?.channel,
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
          {rec ? 'Ask again' : 'Work out a recommendation'}
        </button>
        {err ? <p className="text-[12px] font-semibold text-rose-700 mt-1.5">{err}</p> : null}
      </section>

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

  return (
    <div draggable onDragStart={e => e.dataTransfer.setData('text/plain', g.id)}
      className={'rounded-xl border bg-white shadow-soft cursor-grab active:cursor-grabbing ' +
        (urgent ? 'border-rose-300' : 'border-line')}>
      <button onClick={onOpen} className="w-full text-left px-3 py-2.5 min-w-0">
        {/* WHERE. Unit is what ops navigates by; market is how they filter. */}
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-[13.5px] font-bold text-ink leading-snug truncate flex-1 min-w-0">{g.unit || 'No unit'}</p>
          {g.market ? (
            <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">{g.market}</span>
          ) : null}
        </div>
        <p className="text-[11.5px] text-muted truncate">{g.guest_name || 'Guest'}</p>

        {/* CAN I ACT ON THIS TODAY? (Jon, 2026-09-15: "should show check in and checkout date".)
            A guest in the unit tonight is a different job from a unit that emptied last week, and
            that was only discoverable by opening the card. "In house" is the answer; the dates are
            the evidence behind it. */}
        {g.check_in ? (
          <p className="text-[11.5px] mt-1 flex items-center gap-1.5 min-w-0">
            <CalendarDays size={11} className={stay.now ? 'text-emerald-600 shrink-0' : 'text-muted shrink-0'} />
            <span className={stay.now ? 'font-semibold text-emerald-700 shrink-0' : 'text-muted shrink-0'}>{stay.label}</span>
            <span className="text-faint truncate">{fmtShort(g.check_in)} → {fmtShort(g.check_out)}</span>
          </p>
        ) : null}

        <p className="text-[12px] text-ink/70 mt-1 line-clamp-2 leading-snug">{g.overview}</p>

        {/* WHO DO I SEND, AND HOW LOUD IS IT. Urgent is red and first because it is the only thing
            here that changes the ORDER work gets done in. */}
        <div className="flex items-center gap-1 flex-wrap mt-2">
          {urgent ? (
            <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white">Urgent</span>
          ) : null}
          {incident ? (
            <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 ring-1 ring-rose-200">{g.glitch_type}</span>
          ) : null}
          {trade ? <span className={'text-[9.5px] font-bold px-1.5 py-0.5 rounded ring-1 ' + trade.cls}>{trade.label}</span> : null}
          {g.breezeway_task_id ? (
            <span className={'text-[9.5px] font-bold px-1.5 py-0.5 rounded ' +
              (g.task_status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                : g.task_status === 'in_progress' ? 'bg-sky-100 text-sky-700'
                : 'bg-app text-muted ring-1 ring-line')}>
              {g.task_status === 'completed' ? 'Task done' : g.task_status === 'in_progress' ? 'Task running' : 'Task not started'}
            </span>
          ) : (
            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">No task yet</span>
          )}
          {refund > 0 ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">Refunded {money(refund)}</span> : null}
          {owedRefund ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">Refund not logged</span> : null}
          {(g as any).refund_needs_approval ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-600 text-white">Needs approval</span> : null}
          {due ? <span className={'text-[9.5px] font-bold px-1.5 py-0.5 rounded border ' + due.cls}>{due.label}</span> : null}
          {g.assignee ? (
            <span className="text-[9.5px] font-semibold text-muted inline-flex items-center gap-0.5 ml-auto">
              <User2 size={9} />{g.assignee.split(' ')[0]}
            </span>
          ) : null}
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


// Comments + @tags on a glitch — uses the SYSTEM-WIDE /api/comments (mentions notify via the
// Shell bell). Tag with the picker or type @name in the text; the glitch creator is notified too.
// OWNERSHIP + SCHEDULE for a glitch: who owns it, when it is due (on a calendar that shows the
// unit's reservations so work is not booked into a guest's stay), how far along, and the running
// detail notes. Everything writes straight to the glitch record the board reads.
function GlitchManage({ g, people, onDone }: { g: Glitch; people: { id: number; name: string }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [cal, setCal] = useState(false)
  const [due, setDue] = useState(g.due_date || '')
  const [who, setWho] = useState(g.assignee || '')
  const [prog, setProg] = useState<string>(g.progress == null ? '' : String(g.progress))
  const [details, setDetails] = useState(g.details || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { setDue(g.due_date || ''); setWho(g.assignee || ''); setProg(g.progress == null ? '' : String(g.progress)); setDetails(g.details || '') }, [g.id, g.due_date, g.assignee, g.progress, g.details])

  const save = async (patch: Record<string, any>, note: string) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const person = people.filter(p => p.name === who)[0]
      const body = Object.assign({ action: 'update', id: g.id, assigneePersonId: person ? person.id : null }, patch)
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not save'); setBusy(false); return }
      setMsg(note); onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const pct = progressOf(g)
  return (
    <div className="rounded-lg border border-line bg-app/40 p-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Owner &amp; schedule</div>
        <span className="text-[10px] text-muted">{pct}% {'\u00b7'} {(COLS.filter(x => x.key === g.status)[0] || { label: g.status }).label}</span>
        <button onClick={() => setOpen(!open)} className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-md border border-line bg-white text-muted hover:text-ink hover:bg-app inline-flex items-center gap-1"><Sliders size={10} />{open ? 'Hide' : 'Edit'}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setCal(!cal)} className="text-[11px] font-medium px-2 py-1.5 rounded-md border border-line bg-white hover:bg-app inline-flex items-center gap-1"><CalendarDays size={12} />{due ? 'Due ' + due : 'Set due date'}</button>
            {due && <button onClick={() => { setDue(''); save({ dueDate: '' }, 'Due date cleared') }} className="text-[11px] text-muted hover:text-rose-700">clear</button>}
            <input list="glitch-people" value={who} onChange={e => setWho(e.target.value)} placeholder="Assign to&hellip;" className="text-[11px] border border-line rounded-md px-2 py-1.5 bg-white w-40" />
            <datalist id="glitch-people">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
            <select value={prog} onChange={e => setProg(e.target.value)} className="text-[11px] border border-line rounded-md px-2 py-1.5 bg-white" title="Leave on Auto to follow the board stage">
              <option value="">Auto ({STAGE_PROGRESS[g.status] ?? 0}%)</option>
              {[0, 10, 25, 50, 75, 90, 100].map(v => <option key={v} value={v}>{v}%</option>)}
            </select>
            <button onClick={() => save({ dueDate: due, assignee: who, progress: prog === '' ? null : Number(prog) }, 'Saved')} disabled={busy} className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-ink text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
          </div>
          {cal && (
            <UnitCalendar listingId={g.listing_id} value={due || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())} onChange={d => { setDue(d); setCal(false) }} compact />
          )}
          <textarea value={details} onChange={e => setDetails(e.target.value)} onBlur={() => { if ((g.details || '') !== details) save({ details }, 'Details saved') }} rows={3} placeholder="Add details — what has been tried, parts ordered, what the guest was told…" className="w-full text-xs border border-line rounded-md px-2 py-1.5 bg-white" />
          {msg && <div className="text-[11px] text-emerald-700">{msg}</div>}
          {err && <div className="text-[11px] text-rose-700">{err}</div>}
        </div>
      )}
      {!open && (g.details || g.due_date || g.assignee) && (
        <div className="mt-1 text-[11px] text-muted">
          {g.assignee ? <span className="text-ink font-medium">{g.assignee}</span> : 'Unassigned'}
          {g.due_date ? ' · due ' + g.due_date : ''}
          {g.details ? ' · ' + String(g.details).slice(0, 90) + (String(g.details).length > 90 ? '…' : '') : ''}
        </div>
      )}
    </div>
  )
}

function GlitchComments({ g }: { g: Glitch }) {
  const [items, setItems] = useState<any[]>([])
  const [team, setTeam] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagQ, setTagQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    fetch('/api/comments?type=glitch&id=' + g.id, { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j && j.ok) { setItems(Array.isArray(j.comments) ? j.comments : []); setTeam(Array.isArray(j.team) ? j.team : []); setLoaded(true) }
    }).catch(() => {})
  }, [g.id, tick])
  const post = async () => {
    if (!body.trim()) return
    setBusy(true); setErr('')
    try {
      const label = (g.unit ? g.unit + ' — ' : '') + ((g.overview || '').split('\n')[0].slice(0, 60) || 'glitch')
      const r = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'glitch', id: g.id, body: body.trim(), mentions: tags, label }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not post') } else { setBody(''); setTags([]); setTick(t => t + 1) }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const addTag = (v: string) => { const e2 = v.trim().toLowerCase(); if (e2 && team.indexOf(e2) >= 0 && tags.indexOf(e2) < 0) setTags(prev => prev.concat([e2])); setTagQ('') }
  const who = (e2: string) => String(e2 || '').split('@')[0]
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  return (
    <div className="mt-2 rounded-lg border border-line bg-app/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Comments{loaded ? ' (' + items.length + ')' : ''}</div>
      <div className="space-y-1 max-h-44 overflow-y-auto">
        {items.map(cm => (
          <div key={cm.id} className="bg-white border border-line rounded-md px-2 py-1.5">
            <div className="text-[10px] text-muted"><span className="font-semibold text-ink">{who(cm.author_email)}</span> · {when(cm.created_at)}{(cm.mentions || []).length > 0 && <span> · tagged {(cm.mentions || []).map(who).join(', ')}</span>}</div>
            <div className="text-[12px] text-ink whitespace-pre-wrap">{cm.body}</div>
          </div>
        ))}
        {loaded && items.length === 0 && <div className="text-[11px] text-muted">No comments yet.</div>}
      </div>
      <div className="mt-1.5 space-y-1">
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Add a comment… (@name in the text also tags)" rows={2} className="w-full text-xs border border-line rounded-md px-2 py-1.5 bg-white" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <input list={'cmt-team-' + g.id} value={tagQ} onChange={e => { setTagQ(e.target.value); if (team.indexOf(e.target.value.trim().toLowerCase()) >= 0) addTag(e.target.value) }} placeholder="Tag teammate…" className="text-[11px] border border-line rounded-md px-2 py-1 bg-white w-44" />
          <datalist id={'cmt-team-' + g.id}>{team.map(t => <option key={t} value={t} />)}</datalist>
          {tags.map(t2 => <span key={t2} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 inline-flex items-center gap-1">@{who(t2)}<button onClick={() => setTags(prev => prev.filter(x => x !== t2))} className="hover:text-rose-600">{'\u00d7'}</button></span>)}
          <button onClick={post} disabled={busy || !body.trim()} className="ml-auto text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-ink text-white disabled:opacity-40">{busy ? 'Posting…' : 'Comment'}</button>
        </div>
        {err && <div className="text-[11px] text-rose-700">{err}</div>}
      </div>
    </div>
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
