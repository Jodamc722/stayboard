'use client'
import PolishButton from './PolishButton'
// GLITCH BOARD — the Asana "VR Glitch/Incident Reporting" workflow, rebuilt in-app.
// Pool → Ops → Guest Followup → Refund → Manager Review → Incident → Closed.
// Create a glitch by searching the guest name (reservation details auto-attach), push a
// Breezeway task for the field, and move the card along the escalation path.
import { useState, useEffect, useCallback } from 'react'
import { Plus, RefreshCw, Search, X, Camera, CalendarDays, User2, Sliders, Trash2 } from 'lucide-react'
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

      {/* On a phone a 288px lane leaves a sliver of the next one showing and no way to land on a
          lane cleanly. Below sm each lane is nearly the full screen and the strip snaps to it, so
          swiping moves you one stage at a time and the page itself never travels sideways. */}
      <div className="sm:hidden text-[11px] text-muted mb-1.5">{COLS.length} lanes &mdash; swipe sideways</div>
      <div className="flex gap-3 overflow-x-auto pb-4 items-start snap-x snap-mandatory sm:snap-none scroll-pl-3 sm:scroll-pl-0 -mx-3 px-3 sm:mx-0 sm:px-0">
        {COLS.map(col => {
          const cards = rows.filter(g => g.status === col.key)
          return (
            <div key={col.key} className="w-[86vw] sm:w-72 shrink-0 snap-start sm:snap-align-none rounded-2xl bg-app/70 border border-line">
              <div className="px-3 py-2 flex items-center gap-2 border-b border-line">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink">{col.label}</span>
                <span className="text-[11px] font-semibold text-muted">{cards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[60px]" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) { act(id, { action: 'move', status: col.key }); if (col.key === 'refund') { setRefundFor(id); setOpen(id) } } }}>
                {cards.map(g => {
                  const ci = COLS.findIndex(c => c.key === g.status)
                  const isOpen = open === g.id
                  return (
                    <div key={g.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', g.id)} className="rounded-xl border border-line bg-white shadow-soft cursor-grab active:cursor-grabbing">
                      <button onClick={() => setOpen(isOpen ? '' : g.id)} className="w-full text-left px-3 py-2.5">
                        <div className="text-sm font-semibold text-ink leading-snug">{g.guest_name ? g.guest_name + ' · ' : ''}{g.unit || 'No unit'}</div>
                        <div className="text-xs text-muted mt-0.5 line-clamp-2">{g.overview}</div>
                        <div className="flex items-center gap-1 flex-wrap mt-1.5">
                          {g.glitch_type && g.glitch_type !== 'Glitch (Quality Issue)' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white">{g.glitch_type}</span>}
                          {g.category && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">{g.category.replace('Maintenance - ', '')}</span>}
                          {g.market && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted border border-line">{g.market}</span>}
                          {g.channel && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{g.channel}</span>}
                          {g.incident_date && <span className="text-[9px] text-muted">{fmtShort(g.incident_date)}</span>}
                          {(g.photos || []).length > 0 && <span className="text-[9px] text-muted inline-flex items-center gap-0.5"><Camera size={9} />{(g.photos || []).length}</span>}
                          {g.breezeway_task_id && <span className={'text-[9px] font-semibold px-1.5 py-0.5 rounded border ' + (g.task_status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : g.task_status === 'in_progress' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200')}>{g.task_status === 'completed' ? 'Task completed' : g.task_status === 'in_progress' ? 'Task in progress' : 'Task not started'}</span>}
                          {(g.refund_approved || 0) > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">Refund {money(g.refund_approved)}</span>}
                          {g.status === 'refund' && !(Number(g.refund_approved) > 0) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white" title="This card is in Refund request but no amount has been logged yet">Refund not logged</span>}
                          {(() => { const d = dueState(g.due_date, g.status === 'closed'); return d ? <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded border ' + d.cls}>{d.label}</span> : null })()}
                          {g.assignee && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 inline-flex items-center gap-0.5"><User2 size={8} />{g.assignee.split(' ')[0]}</span>}
                        </div>
                        {/* progress: follows the board stage unless someone sets it by hand */}
                        <div className="mt-1.5 h-1 rounded-full bg-app overflow-hidden" title={progressOf(g) + '% — ' + (COLS.filter(x => x.key === g.status)[0] || { label: g.status }).label}>
                          <div className={'h-full transition-all ' + (g.status === 'closed' ? 'bg-emerald-500' : progressOf(g) >= 65 ? 'bg-brand-500' : 'bg-amber-400')} style={{ width: progressOf(g) + '%' }} />
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-2.5 border-t border-line pt-2 space-y-1.5">
                          {(refundFor === g.id || (g.status === 'refund' && !(Number(g.refund_approved) > 0))) && (
                            <RefundLogger id={g.id} total={g.reservation_total ?? null} onDone={amt => { setRefundFor(''); setGlitches(prev => prev.map(x => x.id === g.id ? { ...x, refund_approved: amt } : x)) }} />
                          )}
                          {g.check_in && <div className="text-[11px] text-muted">Stay {fmtShort(g.check_in)} &rarr; {fmtShort(g.check_out)}{g.reservation_total ? ' · ' + money(g.reservation_total) : ''}{g.guest_phone ? ' · ' + g.guest_phone : ''}{g.guest_email ? ' · ' + g.guest_email : ''}</div>}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {g.reservation_id && <a href={'https://app.guesty.com/reservations/' + g.reservation_id + '/summary'} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-brand-600 hover:underline">Open reservation in Guesty ↗</a>}
                            <SentimentChip s={g.sentiment} />
                          </div>
                          {g.reservation_notes && <div className="text-[11px] text-muted">Reservation notes: {g.reservation_notes.slice(0, 200)}</div>}
                          {g.sentiment && g.sentiment.excerpt && <div className="text-[11px] text-muted">Guest said: &ldquo;{String(g.sentiment.excerpt).slice(0, 180)}&rdquo;</div>}
                          {(g.photos || []).length > 0 && (
                            <div className="flex gap-1 flex-wrap">{(g.photos || []).map((u, i) => <a key={i} href={glitchPhotoSrc(u)} target="_blank" rel="noreferrer"><img src={glitchPhotoSrc(u)} alt="" className="w-12 h-12 object-cover rounded border border-line" /></a>)}</div>
                          )}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {ci > 0 && <button onClick={() => act(g.id, { action: 'move', status: COLS[ci - 1].key })} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white hover:bg-app">&larr; {COLS[ci - 1].label}</button>}
                            {ci < COLS.length - 1 && <button onClick={() => act(g.id, { action: 'move', status: COLS[ci + 1].key })} className="text-[11px] font-medium px-2 py-1 rounded-md border border-ink bg-ink text-white">{COLS[ci + 1].label} &rarr;</button>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {!g.breezeway_task_id && <button onClick={() => setPanel(panel === g.id + ':push' ? '' : g.id + ':push')} className="text-[11px] font-medium px-2 py-1 rounded-md border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100">Push to Breezeway</button>}
                            <button onClick={() => setPanel(panel === g.id + ':edit' ? '' : g.id + ':edit')} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white hover:bg-app">Edit</button>
                            {g.breezeway_task_id && <a href={'https://app.breezeway.io/task/' + g.breezeway_task_id} target="_blank" rel="noreferrer" className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white text-brand-600 hover:underline" title="Open the ADMIN task in Breezeway — edit, assign, modify, check">Admin task</a>}{g.task_report_url && <a href={g.task_report_url} target="_blank" rel="noreferrer" className="text-[11px] font-medium px-2 py-1 rounded-md border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100" title="View the field report (read-only)">Report</a>}
                            {g.breezeway_task_id && <button onClick={() => act(g.id, { action: 'checkTask' })} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line bg-white hover:bg-app">Check status</button>}
                            <DeleteButton title="Delete this glitch record. The Breezeway task, if any, stays." onDelete={async () => {
                              try {
                                const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: 'delete' }) })
                                const j = await r.json()
                                if (!r.ok || !j.ok) return j.error || 'Delete failed'
                                setUndo({ trashId: String(j.trashId), label: String(j.label || 'glitch') })
                                load()
                                return null
                              } catch (e: any) { return String(e?.message || e) }
                            }} />
                          </div>
                          {panel === g.id + ':push' && <PushPanel g={g} people={people} onDone={() => { setPanel(''); load() }} act={act} />}
                          {panel === g.id + ':edit' && <EditGlitch g={g} onDone={() => { setPanel(''); load() }} />}
                          <GlitchManage g={g} people={people} onDone={load} />
                          {/* One thread per glitch. When the glitch has a Breezeway task, the crew's
                              Breezeway comments show here too and anything posted with Breezeway
                              ticked lands in their app. */}
                          <CommentThread type="glitch" id={g.id} label={(g.unit ? g.unit + ' \u2014 ' : '') + String(g.overview || 'glitch').split('\n')[0].slice(0, 60)} link="/glitches" taskId={g.breezeway_task_id || ''} reservationId={g.reservation_id || ''} />
                        </div>
                      )}
                    </div>
                  )
                })}
                {cards.length === 0 && <div className="text-[11px] text-muted text-center py-4">Empty</div>}
              </div>
            </div>
          )
        })}
      </div>
      {undo && <UndoBar item={undo} onUndone={() => { setUndo(null); load() }} onDismiss={() => setUndo(null)} />}
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
        glitchType, category, incidentDate, overview, photos, reportedBy, guestEmail,
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
  const [issue, setIssue] = useState((g.overview || '').split('\n')[0].slice(0, 70))
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  // Breezeway property override — building-level glitches (e.g. "Rustic Exterior") get pushed
  // to the BUILDING property instead of the guest's unit. Default: the unit.
  const [prop, setProp] = useState('')
  const [props, setProps] = useState<{ id: number; name: string }[]>([])
  useEffect(() => { fetch('/api/glitches/properties', { cache: 'no-store' }).then(r => r.json()).then(j => setProps(Array.isArray(j.properties) ? j.properties : [])).catch(() => {}) }, [])
  const pickedProp = props.find(x => x.name === prop.trim()) || null
  const doPush = async () => {
    setBusy(true)
    const nm = assignee.trim().replace(/\s*\([^)]*\)\s*$/, '')
    const p = people.find(x => x.name === nm)
    const body: Record<string, any> = { action: 'push', issue: issue.trim(), assigneeIds: p ? [p.id] : [] }
    if (pickedProp) { body.homeId = pickedProp.id; body.homeName = pickedProp.name }
    await act(g.id, body)
    setBusy(false); onDone()
  }
  return (
    <div className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50/50 p-2 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">Push to Breezeway (urgent)</div>
      <div className="text-[11px] text-muted">Task: <span className="text-ink">Guest Reported / Glitch - {issue || '…'}</span></div>
      <input value={issue} onChange={e => setIssue(e.target.value)} placeholder="Short issue (e.g. Hot water issue.)" className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
      <input list="glitch-board-ppl" value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Assignee (optional)…" className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
      <input list="glitch-board-props" value={prop} onChange={e => setProp(e.target.value)} placeholder={'Property: ' + (g.unit || 'unit') + ' (default) — type to push to a building, e.g. Rustic Exterior'} className={'w-full text-xs border rounded px-2 py-1.5 bg-white ' + (prop && !pickedProp ? 'border-amber-300' : 'border-line')} />
      {pickedProp && <div className="text-[10px] text-violet-700">Task will file under <span className="font-semibold">{pickedProp.name}</span> instead of the unit.</div>}
      <datalist id="glitch-board-ppl">{people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}</datalist>
      <datalist id="glitch-board-props">{props.map(x => <option key={x.id} value={x.name} />)}</datalist>
      <button onClick={doPush} disabled={busy || !issue.trim()} className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40">{busy ? 'Pushing…' : 'Create task'}</button>
    </div>
  )
}

// Edit panel — every field editable after creation.
function EditGlitch({ g, onDone }: { g: Glitch; onDone: () => void }) {
  const [f, setF] = useState({
    glitchType: g.glitch_type || TYPES[0], category: g.category || '', incidentDate: g.incident_date || '',
    overview: g.overview || '', refundApproved: String(g.refund_approved || ''),
    reportedBy: g.reported_by || '', guestName: g.guest_name || '', guestPhone: g.guest_phone || '', guestEmail: g.guest_email || '', unit: g.unit || '', channel: g.channel || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/glitches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, action: 'update', ...f }) })
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
      </div>
      <textarea value={f.overview} onChange={e => set('overview', e.target.value)} rows={3} className="w-full text-xs border border-line rounded px-2 py-1.5 bg-white" />
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
