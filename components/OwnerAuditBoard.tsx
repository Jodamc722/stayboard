'use client'
// OWNER STATEMENT AUDIT BOARD — one board, two homes: the internal /owner-audit page and the
// reviewer-facing /report/owner-audit share link (its own password). This replaces the monthly
// Google-Sheet download / edit / re-download cycle: the audit is computed live from the
// generated statements, and the review state (status, notes, comments) saves in place.
//
// Two ways in, same data:
//   WORKLIST    exception-first: every row across every owner, filterable by status and flag.
//   STATEMENTS  statement-first: an overview of every owner statement (payout, flags, progress,
//               sign-off), and a one-by-one statement view with prev/next — the format the
//               month-end review has always been done in.
//
// Statuses are deliberately simple: Needs review -> Action needed -> Completed. Flagged rows
// start at Needs review; clean rows start Completed so the reviewer only touches exceptions.
// A statement can be SIGNED OFF (by anyone with access) once every row on it is completed —
// that is the per-statement audit trail. Audit notes can be stamped onto the booking's Guesty
// "Reservation Notes" field (same field and safe-merge writer as the Claims board), and each
// row shows what is already written on the reservation in Guesty.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Download,
  ExternalLink, FileText, LayoutList, Lock, MessageSquare, RefreshCw, Scissors, Search,
  Send, Settings2, ShieldAlert, ShieldCheck, StickyNote, X,
} from 'lucide-react'

type FlagType = 'negative' | 'low_rate' | 'orphan_reimb' | 'refund' | 'zero_rev' | 'passthru' | 'no_reservation' | 'commission_off' | 'off_booking' | 'empty_statement' | 'owner_stay'
type Severity = 'high' | 'review' | 'info'
// 'clear' = the engine found nothing and no human decision is needed. It is computed, never saved,
// and never counted as completed work — see the ladder in lib/owner-audit.ts.
type Status = 'review' | 'action' | 'done' | 'clear'
type Flag = { type: FlagType; severity: Severity; detail: string; amount?: number }
type Line = { date: string; label: string; code: string; amount: number }
type Comment = { author: string; body: string; at: string }
type SignOff = { by: string; at: string }
type Rules = {
  lowRateMode: 'relative' | 'absolute'
  lowRatePct: number; lowRateFloor: number; lastMinDays: number; lastMinExtra: number; lowRate: number
  passthruLo: number; passthruHi: number
  commTolerance: number
  offBookingMin: number
  enabled: Record<FlagType, boolean>
}
type PrepItem = {
  ownerId: string; ownerName: string; resCode: string; guest: string; unit: string
  checkIn: string; checkOut: string; source: string; reservationId: string
  onStatement: boolean; rental: number; monthNights: number
  cleaningAmt: number | null; rmAmt: number | null
  folioClean: number | null; folioRm: number | null; folioLump: number | null
  splitDone: boolean; noFees: boolean
  saved: { by: string; at: string } | null
  note: string
}
// No fees on an Expedia folio = fees never set up — that's a WARNING, not a resolved row.
const prepResolved = (p: PrepItem) => p.splitDone || (p.cleaningAmt != null && p.rmAmt != null) || !!p.saved
type PrepFilter = '' | 'open' | 'nofees' | 'split' | 'marked'
type ResolutionClaim = {
  id: string; guest: string; property: string; unit: string
  resCode: string; reservationId: string; stage: string
  amountSought: number | null; amountPaid: number | null
  decidedOn: string; paidOn: string; summary: string
  onStatement: boolean; stmtAmount: number | null
  note: string
}
type ResolutionLine = {
  ownerId: string; ownerName: string; resCode: string
  label: string; date: string; amount: number; hasClaim: boolean
}
type Item = {
  key: string; kind: 'reservation' | 'line'; ownerId: string; resCode: string
  guest: string; checkIn: string; checkOut: string
  totalNights: number; monthNights: number; splitMonth: boolean
  listingId: string; unit: string; source: string; reservationId: string; resNote: string
  benchRate: number | null; benchLabel: string; benchPct: number | null; benchPrev: number | null
  mixWeekday: number; mixWeekend: number; leadDays: number | null
  stayTag: 'owner' | 'owner_guest' | 'ff' | null
  canceled: boolean
  statusTag: 'canceled' | 'inquiry' | 'declined' | 'expired' | null
  rental: number; commission: number; other: number; net: number
  rate: number | null; avgRate: number | null
  lines: Line[]; lineCount: number; lastPosted: string; posted: number; reversed: number; resValue: number | null
  flags: Flag[]; needsReview: boolean
  status: Status; touched: boolean; note: string; comments: Comment[]
  updatedBy: string | null; updatedAt: string | null
}
type Owner = {
  ownerId: string; ownerName: string; hasStatement: boolean; dueToOwner: number | null
  rental: number; commission: number; other: number; net: number; paid: number
  hasPayout: boolean; ties: boolean; stmtStatus: string; isDraft: boolean; generatedAt: string
  items: number; open: number; done: number; clear: number
  high: number; reviewFlags: number; notes: number; commentCount: number
  signOff: SignOff | null
  stmtNote: string
}
type MonthPick = { m: string; label: string; statements: number }
type Data = {
  month: string; label: string; owners: Owner[]; items: Item[]
  totals: {
    owners: number; statements: number; reservations: number; flagged: number; high: number
    review: number; action: number; done: number; clear: number; postedThisWeek: number; signedOff: number; prepOpen: number
    rental: number; commission: number; net: number; paid: number; dueToOwner: number
  }
  coverage: { ready: boolean; missing: string[]; syncedAt: string | null; resScanned: number; ownerStaysFound: number }
  rules: Rules
  prep: PrepItem[]
  resolutions: { claims: ResolutionClaim[]; lines: ResolutionLine[] }
}

const FLAG_LABEL: Record<FlagType, string> = {
  negative: 'Negative', low_rate: 'Low rate', orphan_reimb: 'Orphaned revenue',
  refund: 'Refund', zero_rev: '$0 revenue', passthru: 'Pass-through', no_reservation: 'No res match',
  commission_off: 'Commission off', off_booking: 'No booking behind it',
  empty_statement: 'Empty statement', owner_stay: 'Owner / F&F stay',
}
const FLAG_HELP: Record<FlagType, string> = {
  negative: 'Rental income below zero — erroneous refund, chargeback or duplicate reversal.',
  low_rate: 'Revenue far below what this stay’s night mix (midweek vs weekend) normally earns in its building/size cohort, with slack for last-minute bookings — or under the hard floor.',
  orphan_reimb: 'Rental income is zero but other revenue NETS to something real — channel-fee reimbursements, parking, cleaning. Fully reversed postings (net $0) do not count. The amount is on the flag.',
  refund: 'Any refund-looking line, captured with its amount.',
  zero_rev: '$0 reservations that are not obviously owner stays.',
  passthru: 'Commission fully offsets rental — a wash by design (informational).',
  no_reservation: 'Statement line items whose reservation code has no matching booking (informational).',
  commission_off: 'Commission % on this reservation strays from the owner’s usual rate — most often a canceled booking whose whole cancellation fee was taken as commission.',
  off_booking: 'Money on the statement with no booking behind it — management fees, owner charges, one-off adjustments.',
  empty_statement: 'A statement was generated with no line items at all — usually a listing that is not mapped to the owner.',
  owner_stay: 'Owner stays and friends & family stays. Discounted by design, never a pricing error — flagged so each one is confirmed as authorised and its costs land correctly.',
}
const FLAG_CLS: Record<Severity, string> = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
  review: 'bg-amber-50 text-amber-700 ring-amber-200',
  info: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
}
// Guesty books the owner and the owner's guest as two different sources, and the team treats them
// as two different things — one tag for both hid which was which.
const STAY_LABEL: Record<'owner' | 'owner_guest' | 'ff', string> = {
  owner: 'Owner stay', owner_guest: 'Owner’s guest', ff: 'Friends & family',
}
const STATUS_LABEL: Record<Status, string> = {
  review: 'Needs review', action: 'Action needed', done: 'Approved', clear: 'No issues found',
}
const STATUS_CLS: Record<Status, string> = {
  review: 'bg-amber-50 text-amber-700 ring-amber-200',
  action: 'bg-rose-50 text-rose-700 ring-rose-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  clear: 'bg-neutral-100 text-neutral-500 ring-neutral-200',
}
// The four buckets the worklist is organised into, worst first. Approving a row moves it out of
// the top two and into "Approved & closed", which is the whole point: the open list shrinks as
// the work gets done instead of every row sitting in one undifferentiated pile.
const SECTIONS: { key: Status; title: string; blurb: string; collapsed: boolean }[] = [
  { key: 'action', title: 'Action needed', blurb: 'someone has to fix these in Guesty', collapsed: false },
  { key: 'review', title: 'Needs review', blurb: 'flagged and waiting on a decision', collapsed: false },
  { key: 'done', title: 'Approved & closed', blurb: 'reviewed and signed off on', collapsed: true },
  { key: 'clear', title: 'No issues found', blurb: 'nothing flagged — no decision needed', collapsed: true },
]

const fmt = (n: number) => {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmt0 = (n: number) => {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
const dateShort = (d: string) => {
  if (!d) return ''
  const t = new Date(d + 'T00:00:00Z')
  return isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const shortWho = (s: string | null) => (s || '').replace(/^link · /, '').split('@')[0]
// Plain-language age of a timestamp, for the "how fresh is this data" line.
const hoursSince = (iso: string | null): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return isNaN(t) ? null : (Date.now() - t) / 3600000
}
const agoLabel = (iso: string | null): string => {
  const h = hoursSince(iso)
  if (h == null) return 'never'
  if (h < 1) return 'less than an hour ago'
  if (h < 2) return 'an hour ago'
  if (h < 24) return Math.round(h) + ' hours ago'
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : d + ' days ago (' + when(iso) + ')'
}
const gyUrl = (id: string) => 'https://app.guesty.com/reservations/' + id + '/summary'

// Booking-source display: friendly labels + a tone per channel family.
const sourceLabel = (s: string): string => {
  const v = s.toLowerCase()
  if (!v) return ''
  if (v.includes('airbnb')) return 'Airbnb'
  if (v.includes('booking')) return 'Booking.com'
  if (v === 'be-api' || v.includes('bookingengine')) return 'Direct'
  if (v.includes('expedia')) return 'Expedia'
  if (v.includes('hotels')) return 'Hotels.com'
  if (v.includes('orbitz')) return 'Orbitz'
  if (v.includes('travelocity')) return 'Travelocity'
  if (v.includes('vrbo') || v.includes('homeaway')) return 'Vrbo'
  if (v.includes('owner')) return 'Owner'
  if (v.includes('manual')) return 'Manual'
  return s
}
const SOURCE_CLS: Record<string, string> = {
  Airbnb: 'bg-rose-50 text-rose-700 ring-rose-200',
  'Booking.com': 'bg-blue-50 text-blue-700 ring-blue-200',
  Direct: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Expedia: 'bg-sky-50 text-sky-700 ring-sky-200',
  'Hotels.com': 'bg-sky-50 text-sky-700 ring-sky-200',
  Orbitz: 'bg-sky-50 text-sky-700 ring-sky-200',
  Travelocity: 'bg-sky-50 text-sky-700 ring-sky-200',
  Vrbo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Owner: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  Manual: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
}
const SourceChip = ({ source }: { source: string }) => {
  const label = sourceLabel(source)
  if (!label) return null
  return (
    <span title={source !== label ? source : undefined}
      className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + (SOURCE_CLS[label] || 'bg-neutral-100 text-neutral-600 ring-neutral-200')}>
      {label}
    </span>
  )
}

// What "Ties / Off by" actually means — owner statements are ACCOUNTING-level documents.
const TIE_HELP = 'Ties = adding up every line item on this statement (rental − commission + fees) lands on the money that actually moved to the owner. Once a payout has posted, that is the comparison. Until then the only figure available is the statement’s closing balance, which is NOT earnings — it carries prior balances and statement-level deductions, so a difference against it is normal and is not an error.'
// Shown when a statement has no payout posted yet: the difference against the closing balance is
// a balance difference, not money gone missing. This distinction is the whole reason 28 July
// statements looked "off by $113,067" when nothing was actually wrong.
const BALANCE_HELP = 'No payout has posted for this statement yet, so this compares earnings from the line items against the statement’s closing balance. The balance carries prior balances and statement-level deductions — expect a difference, and re-check once the payout posts.'
// Why a draft statement's balance is not something to reconcile against. This is the answer to
// "why is 3020 Seville off by $16,950.75": it isn't — Guesty had not finished the statement.
const DRAFT_HELP = 'Guesty still has this statement as a draft (PENDING). Its due-to-owner is provisional and is recalculated every time we pull — the balance and the line items will not agree until Guesty finalises it. Work the flagged rows now; reconcile the total once the statement is final and the payout posts.'

// One badge, four honest states, in the order that decides which comparison is even possible:
//   1. Guesty still calls the statement a DRAFT → its balance is provisional, so there is nothing
//      to reconcile against yet. Neutral, and it says draft rather than implying a discrepancy.
//   2. A payout posted and matches → ties.
//   3. A payout posted and does not match → a real gap, in red.
//   4. Statement final, no payout yet → note the balance difference, neutral.
function tieBadge(o: Owner): { text: string; cls: string; help: string } {
  const diff = Math.round((o.net - (o.hasPayout ? o.paid : (o.dueToOwner ?? o.net))) * 100) / 100
  if (o.isDraft && !o.hasPayout) {
    return {
      text: 'Draft in Guesty' + (o.generatedAt ? ' · rebuilt ' + agoLabel(o.generatedAt) : ''),
      cls: 'bg-sky-50 text-sky-700 ring-sky-200', help: DRAFT_HELP,
    }
  }
  if (o.ties) return { text: o.hasPayout ? 'Ties to payout' : 'Ties to statement', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', help: TIE_HELP }
  if (o.hasPayout) return { text: 'Earnings − payout: ' + fmt(diff), cls: 'bg-rose-50 text-rose-700 ring-rose-200', help: TIE_HELP }
  return { text: 'Payout not posted yet · balance differs by ' + fmt(diff), cls: 'bg-neutral-100 text-neutral-600 ring-neutral-200', help: BALANCE_HELP }
}

// Plain words for what a failed save was trying to do, so the Retry chip says something useful.
function describeSave(body: Record<string, any>): string {
  if (body.status) return body.status === 'done' ? 'approval' : body.status === 'action' ? 'action flag' : 'reopen'
  if (body.comment) return 'comment'
  if (body.note !== undefined) return 'note'
  return 'change'
}

function worstOf(it: Item): Severity | null {
  if (it.flags.some(f => f.severity === 'high')) return 'high'
  if (it.flags.some(f => f.severity === 'review')) return 'review'
  if (it.flags.length) return 'info'
  return null
}

export function OwnerAuditBoard({ share }: { share?: boolean }) {
  const [months, setMonths] = useState<MonthPick[]>([])
  const [month, setMonth] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [internal, setInternal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const [view, setView] = useState<'work' | 'stmt' | 'prep'>('work')
  const [stmtOwner, setStmtOwner] = useState('')          // '' = overview grid

  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState<'' | Status>('')
  const [fFlag, setFFlag] = useState<'' | 'flagged' | FlagType>('')
  const [fOwner, setFOwner] = useState('')
  const [fSource, setFSource] = useState('')                                 // channel filter (label)
  const [fTag, setFTag] = useState<'' | 'canceled' | 'inquiry' | 'declined' | 'expired' | 'owner' | 'owner_guest' | 'ff'>('')
  // The weekly lens: only rows whose line items moved in the last 7 days. This is what makes the
  // board a Monday-morning tool instead of a statement-day scramble — the team reviews what
  // CHANGED since last week, and by generation day there is nothing left to discover.
  const [fFresh, setFFresh] = useState(false)
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})
  // Worklist opens CLEAN: every statement collapsed to its totals row. expandedOwners is the
  // explicit open/close override; sections auto-open while filters or a search are active.
  const [expandedOwners, setExpandedOwners] = useState<Record<string, boolean>>({})
  const [showAllRows, setShowAllRows] = useState<Record<string, boolean>>({})
  const [expandedUnits, setExpandedUnits] = useState<Record<string, boolean>>({})
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})   // owner::status → expanded
  const [prepBusy, setPrepBusy] = useState('')
  const [fPrep, setFPrep] = useState<PrepFilter>('')
  const [recheckBusy, setRecheckBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rowSync, setRowSync] = useState('')   // item key currently being re-pulled from Guesty
  const [covBusy, setCovBusy] = useState(false)
  const [cov, setCov] = useState<any>(null)    // coverage check result (revenue not reaching the ledger)
  const [routineOpen, setRoutineOpen] = useState(false)
  // Changes the server never confirmed, keyed by row — shown on the row with a Retry button so a
  // dropped connection can never look like saved work.
  const [unsaved, setUnsaved] = useState<Record<string, { body: Record<string, any>; label: string }>>({})
  const [eNotes, setENotes] = useState<Record<string, string>>({})     // entity note drafts (statement / prep / resolution)
  const [drafts, setDrafts] = useState<Record<string, string>>({})           // note drafts
  const [cDrafts, setCDrafts] = useState<Record<string, string>>({})         // comment drafts
  const [savingKey, setSavingKey] = useState('')
  const [stamped, setStamped] = useState<Record<string, boolean>>({})        // stamp confirmations
  const [signBusy, setSignBusy] = useState('')
  const [me, setMe] = useState('')                                           // share-mode display name

  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesDraft, setRulesDraft] = useState<Rules | null>(null)
  const [rulesBusy, setRulesBusy] = useState(false)

  useEffect(() => {
    if (share) { try { setMe(localStorage.getItem('oa_name') || '') } catch { /* private mode */ } }
  }, [share])

  const load = useCallback(async (m?: string) => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/owner-audit' + (m ? '?month=' + m : ''), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 || j.needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!j.ok) { setError(j.error || 'Could not load the audit'); setLoading(false); return }
      setNeedsPw(false)
      setInternal(!!j.internal)
      setMonths(j.months || [])
      setData(j.data || null)
      setMonth(j.data ? j.data.month : (m || ''))
      setOpenItems({})
      setStamped({})
    } catch (e: any) {
      setError(String(e?.message || e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const unlock = async () => {
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/owner-audit-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); setPwBusy(false); return }
      setPw(''); setPwBusy(false)
      load()
    } catch (e: any) { setPwErr(String(e?.message || e)); setPwBusy(false) }
  }

  const patchItem = (it: Item, patch: Partial<Item>) => {
    setData(d => {
      if (!d) return d
      const items = d.items.map(x => (x.ownerId === it.ownerId && x.key === it.key) ? { ...x, ...patch } : x)
      const owners = d.owners.map(o => {
        if (o.ownerId !== it.ownerId) return o
        const mine = items.filter(x => x.ownerId === o.ownerId)
        // Open = waiting on a person. Rows with nothing flagged are NOT open — counting them
        // here would put 1,193 clean rows back in the way of sign-off the moment anyone clicks.
        const open = mine.filter(x => x.status === 'review' || x.status === 'action').length
        const done = mine.filter(x => x.status === 'done').length
        // A statement with open rows again loses its signature — same rule the server applies.
        return { ...o, open, done, clear: mine.length - open - done, signOff: open > 0 ? null : o.signOff }
      })
      const totals = {
        ...d.totals,
        review: items.filter(x => x.status === 'review').length,
        action: items.filter(x => x.status === 'action').length,
        done: items.filter(x => x.status === 'done').length,
        clear: items.filter(x => x.status === 'clear').length,
        signedOff: owners.filter(o => o.signOff).length,
      }
      return { ...d, items, owners, totals }
    })
  }

  // EVERY CLICK IS A SERVER WRITE, AND A FAILED WRITE MUST LOOK FAILED.
  // The board is worked on phones, on hotel wifi, halfway through a battery. The old version
  // painted the new status immediately and only whispered an error if the request died — so a
  // dropped connection left rows LOOKING approved that were never saved, and a refresh silently
  // undid the afternoon. Now a failure rolls the row back to what the server actually holds and
  // parks it in `unsaved` with a Retry button, so nothing is ever quietly lost.
  const save = async (it: Item, body: Record<string, any>, prev?: Partial<Item>) => {
    if (!data) return false
    const key = it.ownerId + '|' + it.key
    setSavingKey(key)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: data.month, ownerId: it.ownerId, itemKey: it.key, ...body }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        if (prev) patchItem(it, prev)
        setUnsaved(u => ({ ...u, [key]: { body, label: describeSave(body) } }))
        setError((j && j.error) || 'That did not save. Nothing was lost — press Retry on the row.')
        setSavingKey(''); return false
      }
      setUnsaved(u => { if (!u[key]) return u; const n = { ...u }; delete n[key]; return n })
      patchItem(it, { status: j.status, note: j.note, comments: j.comments || it.comments, touched: true, updatedBy: j.updatedBy, updatedAt: j.updatedAt })
    } catch (e: any) {
      if (prev) patchItem(it, prev)
      setUnsaved(u => ({ ...u, [key]: { body, label: describeSave(body) } }))
      setError('No connection — that change did not save. Press Retry on the row when you are back online.')
      setSavingKey(''); return false
    }
    setSavingKey('')
    return true
  }

  const retrySave = async (it: Item) => {
    const key = it.ownerId + '|' + it.key
    const pending = unsaved[key]
    if (!pending) return
    if (pending.body.status) patchItem(it, { status: pending.body.status as Status, touched: true })
    await save(it, pending.body, { status: it.status, touched: it.touched })
  }

  const setStatus = async (it: Item, s: Status) => {
    const prev = { status: it.status, touched: it.touched }
    // TOGGLE OFF (bookkeeper request): pressing the active Action button un-marks the row —
    // back to Needs review if it carries flags, back to No issues found if it does not. The
    // server stores 'clear', which the reader ignores, so the row reverts to its computed state.
    if (s === it.status && s === 'action') {
      const back: Status = it.needsReview ? 'review' : 'clear'
      patchItem(it, { status: back, touched: true })
      const ok = await save(it, { status: 'clear' }, prev)
      if (ok) patchItem(it, { status: back })
      return
    }
    if (it.status === s) return
    patchItem(it, { status: s, touched: true })
    save(it, { status: s }, prev)
  }

  const saveNote = (it: Item) => {
    const k = it.ownerId + '|' + it.key
    const v = drafts[k]
    if (v === undefined || v === it.note) return
    save(it, { note: v }, { note: it.note })
  }

  const addComment = (it: Item) => {
    const k = it.ownerId + '|' + it.key
    const v = (cDrafts[k] || '').trim()
    if (!v) return
    if (share && me.trim()) { try { localStorage.setItem('oa_name', me.trim()) } catch { /* private mode */ } }
    setCDrafts(prev => ({ ...prev, [k]: '' }))
    save(it, { comment: { body: v, author: me.trim() || 'reviewer' } })
  }

  // Stamp the audit note onto the reservation in Guesty (append, never overwrite).
  const stampToGuesty = async (it: Item) => {
    if (!data || !it.reservationId) return
    const k = it.ownerId + '|' + it.key
    const noteText = ((drafts[k] !== undefined ? drafts[k] : it.note) || '').trim()
    if (!noteText) { setError('Write the note first — that is what gets stamped onto the reservation.'); return }
    if (drafts[k] !== undefined && drafts[k] !== it.note) await save(it, { note: drafts[k] })
    setSavingKey(k)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stamp', month: data.month, ownerId: it.ownerId, itemKey: it.key, reservationId: it.reservationId, note: noteText, author: me.trim() || 'reviewer' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Guesty stamp failed'); setSavingKey(''); return }
      patchItem(it, { resNote: it.resNote ? it.resNote + '\n' + j.line : j.line })
      setStamped(prev => ({ ...prev, [k]: true }))
      setFlash('Stamped onto the reservation in Guesty.')
      setTimeout(() => setFlash(''), 3000)
    } catch (e: any) { setError(String(e?.message || e)) }
    setSavingKey('')
  }

  const signOff = async (ownerId: string, on: boolean) => {
    if (!data) return
    if (share && !me.trim()) { setError('Add your name first — the sign-off records who audited the statement.'); return }
    if (share && me.trim()) { try { localStorage.setItem('oa_name', me.trim()) } catch { /* private mode */ } }
    setSignBusy(ownerId)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signoff', month: data.month, ownerId, on, author: me.trim() || 'reviewer' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Sign-off failed'); setSignBusy(''); return }
      setData(d => {
        if (!d) return d
        const owners = d.owners.map(o => o.ownerId === ownerId ? { ...o, signOff: j.signOff || null } : o)
        return { ...d, owners, totals: { ...d.totals, signedOff: owners.filter(o => o.signOff).length } }
      })
      if (on) { setFlash('Statement signed off.'); setTimeout(() => setFlash(''), 3000) }
    } catch (e: any) { setError(String(e?.message || e)) }
    setSignBusy('')
  }

  const patchPrep = (p: PrepItem, saved: PrepItem['saved']) => {
    setData(d => {
      if (!d) return d
      const prepList = d.prep.map(x => x.resCode === p.resCode ? { ...x, saved } : x)
      const prepOpen = prepList.filter(x => !prepResolved(x)).length
      return { ...d, prep: prepList, totals: { ...d.totals, prepOpen } }
    })
  }

  // Mark one reservation's fee breakout done (the split itself is entered in Guesty).
  const savePrep = async (p: PrepItem, on: boolean) => {
    if (!data) return
    if (share && me.trim()) { try { localStorage.setItem('oa_name', me.trim()) } catch { /* private mode */ } }
    setPrepBusy(p.resCode)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prep', month: data.month, ownerId: '-', itemKey: 'prep:' + p.resCode, on, author: me.trim() || 'reviewer' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Prep save failed'); setPrepBusy(''); return }
      patchPrep(p, j.saved || null)
    } catch (e: any) { setError(String(e?.message || e)) }
    setPrepBusy('')
  }

  // A note on ANYTHING — statement, prep row, resolution. Saves only the note; whatever
  // status or sign-off the row carries is preserved server-side.
  const saveEntityNote = async (ownerId: string, itemKey: string, current: string, apply: (v: string) => void) => {
    if (!data) return
    const k = ownerId + '|' + itemKey
    const v = eNotes[k]
    if (v === undefined || v === current) return
    if (share && me.trim()) { try { localStorage.setItem('oa_name', me.trim()) } catch { /* private mode */ } }
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'note', month: data.month, ownerId, itemKey, note: v, author: me.trim() || 'reviewer' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Note save failed'); return }
      apply(j.note)
    } catch (e: any) { setError(String(e?.message || e)) }
  }

  // Pull the outstanding prep reservations fresh from Guesty, then rebuild the month —
  // fee breakouts done on the reservation map straight back into the app.
  const recheckGuesty = async () => {
    if (!data) return
    const ids = data.prep.filter(p => !prepResolved(p)).map(p => p.reservationId).filter(Boolean)
    if (!ids.length) { setFlash('Nothing outstanding to re-check.'); setTimeout(() => setFlash(''), 2500); return }
    setRecheckBusy(true)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prep-recheck', reservationIds: ids }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Re-check failed'); setRecheckBusy(false); return }
      setFlash('Pulled ' + j.pulled + ' reservation' + (j.pulled === 1 ? '' : 's') + ' fresh from Guesty.')
      setTimeout(() => setFlash(''), 3000)
      await load(month)
    } catch (e: any) { setError(String(e?.message || e)) }
    setRecheckBusy(false)
  }

  // Re-pull ONE booking from Guesty — the folio, notes, status and tags on that reservation.
  // Same engine as the Prep tab's bulk re-check, aimed at the row you are looking at.
  const refreshRow = async (it: Item) => {
    if (!it.reservationId || rowSync) return
    const k = it.ownerId + '|' + it.key
    setRowSync(k); setError('')
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prep-recheck', reservationIds: [it.reservationId] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error || 'Could not reach Guesty for that booking.'); setRowSync(''); return }
      setFlash('Pulled this booking fresh from Guesty.')
      setTimeout(() => setFlash(''), 2500)
      await load(month)
    } catch (e: any) { setError(String(e?.message || e)) }
    setRowSync('')
  }

  // COVERAGE — the other direction. The audit reads what IS on the statements; this asks what
  // never arrived: bookings with guest revenue and no line in the month's ledger. Run weekly, it
  // catches an unmapped listing in week one instead of on statement day.
  const checkCoverage = async () => {
    if (!month || covBusy) return
    setCovBusy(true); setCov(null)
    try {
      const r = await fetch('/api/sync/owner-statements?gap=1&month=' + month, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error || 'Coverage check failed — try again in a minute.'); setCovBusy(false); return }
      setCov(j)
    } catch (e: any) { setError(String(e?.message || e)) }
    setCovBusy(false)
  }

  // Pull this month's statements + line items straight from Guesty. The hourly sync keeps the
  // mirror current by itself; this is for the moment right after someone generates or re-recognizes
  // statements in Guesty and wants the board to reflect it immediately.
  const syncNow = async () => {
    if (!month || syncing) return
    setSyncing(true); setError('')
    setFlash('Pulling ' + (data ? data.label : 'this month') + ' from Guesty — this takes a minute or two.')
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', month }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        setFlash('')
        setError(j.error || 'The Guesty pull did not finish. It runs hourly on its own — try again in a minute.')
        setSyncing(false); return
      }
      setFlash('Statements refreshed from Guesty.')
      setTimeout(() => setFlash(''), 3000)
      await load(month)
    } catch (e: any) {
      setFlash('')
      setError(String(e?.message || e))
    }
    setSyncing(false)
  }

  const saveRules = async () => {
    if (!rulesDraft) return
    setRulesBusy(true)
    try {
      const r = await fetch('/api/owner-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rules', rules: rulesDraft }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Rules save failed'); setRulesBusy(false); return }
      setRulesOpen(false); setRulesBusy(false)
      setFlash('Rules saved — re-checking the month against them.')
      setTimeout(() => setFlash(''), 3000)
      load(month)                                   // flags are computed server-side; rebuild
    } catch (e: any) { setError(String(e?.message || e)); setRulesBusy(false) }
  }

  const ownerName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const o of (data?.owners || [])) m[o.ownerId] = o.ownerName
    return m
  }, [data])

  // Live per-owner rollups (note/comment counts move as the reviewer works).
  const stats = useMemo(() => {
    const m: Record<string, { notes: number; comments: number }> = {}
    for (const it of (data?.items || [])) {
      const s = m[it.ownerId] || (m[it.ownerId] = { notes: 0, comments: 0 })
      if (it.note) s.notes++
      s.comments += it.comments.length
    }
    return m
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return [] as Item[]
    const needle = q.trim().toLowerCase()
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    return data.items.filter(it => {
      if (fFresh && !(it.lastPosted && it.lastPosted >= weekAgo)) return false
      if (fOwner && it.ownerId !== fOwner) return false
      if (fStatus && it.status !== fStatus) return false
      if (fFlag === 'flagged' && !it.flags.some(f => f.severity !== 'info')) return false
      if (fFlag && fFlag !== 'flagged' && !it.flags.some(f => f.type === fFlag)) return false
      if (fSource && sourceLabel(it.source) !== fSource) return false
      if (fTag === 'owner' || fTag === 'owner_guest' || fTag === 'ff') { if (it.stayTag !== fTag) return false }
      else if (fTag) { if (it.statusTag !== fTag) return false }
      if (needle) {
        const hay = (it.guest + ' ' + it.resCode + ' ' + it.unit + ' ' + (ownerName[it.ownerId] || '') + ' ' + it.note).toLowerCase()
        if (hay.indexOf(needle) < 0) return false
      }
      return true
    })
  }, [data, q, fStatus, fFlag, fOwner, fSource, fTag, fFresh, ownerName])

  // Tag + channel counts for the filter chips.
  const tagCounts = useMemo(() => {
    const t: Record<string, number> = {}
    const src: Record<string, number> = {}
    for (const it of (data?.items || [])) {
      if (it.statusTag) t[it.statusTag] = (t[it.statusTag] || 0) + 1
      if (it.stayTag) t[it.stayTag] = (t[it.stayTag] || 0) + 1
      const s = sourceLabel(it.source)
      if (s) src[s] = (src[s] || 0) + 1
    }
    return { t, src }
  }, [data])

  const byOwner = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const it of filtered) (m[it.ownerId] = m[it.ownerId] || []).push(it)
    return m
  }, [filtered])

  // Flag chips count OPEN work only — an approved row is closed out and should stop counting
  // (bookkeeper: "I approved the F&F items after adding cleaning charges, but the count is
  // still at 4"). The row itself keeps its chips inside Approved & closed for the paper trail.
  const flagCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of (data?.items || [])) {
      if (it.status === 'done') continue
      const seen: Record<string, boolean> = {}
      for (const f of it.flags) { if (!seen[f.type]) { m[f.type] = (m[f.type] || 0) + 1; seen[f.type] = true } }
    }
    return m
  }, [data])
  const openFlagged = useMemo(() =>
    (data?.items || []).filter(it => it.status !== 'done' && it.flags.some(f => f.severity !== 'info')).length,
  [data])

  const exportCsv = () => {
    if (!data) return
    const esc = (v: any) => '"' + String(v ?? '').split('"').join('""') + '"'
    const head = ['Owner', 'Unit', 'Guest', 'Code', 'Source', 'Stay type', 'Check-in', 'Check-out', 'Nights (month)', 'Rental', 'Rate (month)', 'Avg rate (stay)', 'Expected/n', '% of expected', 'Commission', 'Net', 'Flags', 'Status', 'Note', 'Comments', 'Guesty note', 'Last touched by', 'Statement signed off']
    const src = view === 'stmt' && stmtOwner ? data.items.filter(i => i.ownerId === stmtOwner) : filtered
    const lines = src.map(it => {
      const o = data.owners.find(x => x.ownerId === it.ownerId)
      return [
        ownerName[it.ownerId] || it.ownerId, it.unit, it.guest, it.resCode || it.key,
        sourceLabel(it.source), it.statusTag ? it.statusTag.charAt(0).toUpperCase() + it.statusTag.slice(1) : it.stayTag ? STAY_LABEL[it.stayTag] : '',
        it.checkIn, it.checkOut, it.monthNights,
        it.rental.toFixed(2), it.rate == null ? '' : it.rate.toFixed(2), it.avgRate == null ? '' : it.avgRate.toFixed(2),
        it.benchRate == null ? '' : it.benchRate.toFixed(2), it.benchPct == null ? '' : it.benchPct + '%',
        it.commission.toFixed(2), it.net.toFixed(2),
        it.flags.map(f => FLAG_LABEL[f.type]).join('; '), STATUS_LABEL[it.status], it.note,
        it.comments.map(c => c.author + ': ' + c.body).join(' | '), it.resNote.split('\n').join(' / '),
        it.updatedBy || '', o?.signOff ? 'by ' + o.signOff.by + ' ' + o.signOff.at.slice(0, 10) : '',
      ].map(esc).join(',')
    })
    const blob = new Blob([head.map(esc).join(',') + '\n' + lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'owner-audit-' + data.month + (view === 'stmt' && stmtOwner ? '-' + (ownerName[stmtOwner] || stmtOwner).replace(/[^a-z0-9]+/gi, '-').toLowerCase() : '') + '.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── one audited row (shared by the worklist and the statement view) ────────
  const renderItem = (it: Item) => {
    const k = it.ownerId + '|' + it.key
    const open = !!openItems[k]
    const worst = worstOf(it)
    const saving = savingKey === k
    const done = it.status === 'done'
    const noteShown = drafts[k] !== undefined ? drafts[k] : it.note
    return (
      <div key={k} className={'border-l-2 ' + (done ? 'border-l-emerald-300 opacity-90' : it.status === 'action' ? 'border-l-rose-300' : worst === 'high' ? 'border-l-rose-400' : worst === 'review' ? 'border-l-amber-300' : 'border-l-transparent')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <button onClick={() => setOpenItems(prev => ({ ...prev, [k]: !open }))} className="shrink-0 text-muted hover:text-ink">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div className="min-w-[180px] flex-1">
            <div className="text-sm font-medium text-ink truncate flex items-center gap-1.5 flex-wrap">
              <span className="truncate">
                {done && it.touched && <Check size={12} className="inline -mt-0.5 mr-1 text-emerald-600" />}
                {it.kind === 'reservation' ? (it.guest || '(guest unknown)') : it.guest}
                {it.resCode && <span className="text-muted font-normal"> · {it.resCode}</span>}
              </span>
              {it.kind === 'reservation' && <SourceChip source={it.source} />}
              {it.stayTag && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200">
                  {STAY_LABEL[it.stayTag]}
                </span>
              )}
              {it.lastPosted && it.lastPosted >= freshCut && (
                <span title={'Line items posted ' + dateShort(it.lastPosted) + ' — new activity since last week'}
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-teal-50 text-teal-700 ring-teal-200">
                  posted {dateShort(it.lastPosted)}
                </span>
              )}
              {it.statusTag === 'canceled' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-neutral-100 text-neutral-600 ring-neutral-300 line-through decoration-neutral-400">Canceled</span>}
              {it.statusTag === 'inquiry' && <span title="Never a confirmed booking — worth checking why it carries statement line items" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200">Inquiry</span>}
              {it.statusTag === 'declined' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-neutral-100 text-neutral-600 ring-neutral-300">Declined</span>}
              {it.statusTag === 'expired' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-neutral-100 text-neutral-600 ring-neutral-300">Expired</span>}
            </div>
            <div className="text-[11px] text-muted truncate">
              {it.unit || (it.kind === 'line' ? 'Owner-level line items' : '')}
              {it.checkIn && <span> · {dateShort(it.checkIn)} &ndash; {dateShort(it.checkOut)} · {it.monthNights}n{it.splitMonth ? ' in month of ' + it.totalNights + 'n' : ''}</span>}
              {!it.checkIn && it.kind === 'reservation' && it.monthNights > 0 && <span> · ~{it.monthNights}n</span>}
              {it.leadDays != null && it.leadDays <= (data?.rules.lastMinDays ?? 3) && <span className="text-sky-700"> · last-minute ({it.leadDays}d out)</span>}
              {done && it.touched && it.updatedBy && <span className="text-emerald-700"> · completed by {shortWho(it.updatedBy)}</span>}
            </div>
          </div>
          <div className="text-right w-28" title={it.benchRate != null ? 'Vs ' + it.benchLabel + ': ' + fmt(it.benchRate) + '/n (this + last month)' + (it.benchPrev != null ? ' · last month ' + fmt(it.benchPrev) + '/n' : '') : undefined}>
            <div className="text-sm font-semibold text-ink">{fmt(it.rental)}</div>
            <div className="text-[11px] text-muted">
              {it.avgRate != null ? fmt(it.avgRate) + '/n avg' : it.rate != null ? fmt(it.rate) + '/n' : ''}
              {it.benchPct != null && (
                <span className={it.benchPct < (data?.rules.lowRatePct ?? 55) ? ' text-rose-600 font-semibold' : it.benchPct > 130 ? ' text-emerald-600' : ''}> · {it.benchPct}%</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 min-w-[90px]">
            {it.flags.filter(f => f.severity !== 'info').map((f, i) => (
              <span key={i} title={f.detail} className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS[f.severity]}>
                {FLAG_LABEL[f.type]}{f.type === 'orphan_reimb' && f.amount !== undefined ? ' ' + fmt(f.amount) : ''}
              </span>
            ))}
            {it.flags.filter(f => f.severity === 'info').map((f, i) => (
              <span key={'i' + i} title={f.detail} className={'text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.info}>{FLAG_LABEL[f.type]}</span>
            ))}
            {!it.flags.length && <span className="text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200"><Check size={10} className="inline -mt-0.5" /> Clean</span>}
          </div>
          {/* Approving moves the row into "Approved & closed" — the list you are working shrinks. */}
          <div className="flex items-center gap-1">
            {unsaved[k] && (
              <button onClick={() => retrySave(it)} disabled={savingKey === k}
                title={'Your ' + unsaved[k].label + ' never reached the server — press to try again'}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100">
                <AlertTriangle size={10} /> Not saved · Retry
              </button>
            )}
            {it.status === 'done' ? (
              <>
                <span className={'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset ' + STATUS_CLS.done}>
                  <Check size={10} /> Approved
                </span>
                <button onClick={() => setStatus(it, 'review')} disabled={saving}
                  title="Reopen — put this row back on the review list"
                  className="text-[10px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset bg-white text-muted ring-line hover:text-ink">Reopen</button>
              </>
            ) : (
              <>
                <button onClick={() => setStatus(it, 'done')} disabled={saving}
                  title="Approve and close this row out"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50">
                  <Check size={10} /> Approve
                </button>
                <button onClick={() => setStatus(it, 'action')} disabled={saving}
                  title={it.status === 'action' ? 'Un-mark — press again to take the Action flag off' : 'Needs fixing in Guesty — keep it open'}
                  className={'text-[10px] font-semibold px-2 py-1 rounded-lg ring-1 ring-inset transition ' + (it.status === 'action' ? STATUS_CLS.action : 'bg-white text-muted ring-line hover:text-ink')}>
                  Action
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            {it.comments.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200 px-1.5 py-0.5 rounded-full">
                <MessageSquare size={10} /> {it.comments.length}
              </span>
            )}
            {it.resNote && <span title={'On the reservation in Guesty:\n' + it.resNote}><FileText size={13} className="text-muted" /></span>}
            {it.reservationId && (
              <a href={gyUrl(it.reservationId)} target="_blank" rel="noopener noreferrer" title="Open in Guesty"
                className="p-1 rounded-md hover:bg-app text-muted hover:text-brand-700"><ExternalLink size={13} /></a>
            )}
          </div>
        </div>

        {/* notes and comments live ON the row, visible at all times — findings and the
            conversation about them never hide behind a click */}
        {!open && (it.note || it.comments.length > 0) && (
          /* The 44px indent that lines notes up under the row title on desktop is an eighth of a
             phone screen — indent only from 640px up. */
          <div className="px-4 pb-2.5 sm:pl-11 -mt-1 space-y-1">
            {it.note && (
              <div className="flex items-start gap-1.5 max-w-2xl text-[11px] text-amber-900 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-lg px-2 py-1">
                <StickyNote size={11} className="mt-0.5 shrink-0 text-amber-600" />
                <span className="whitespace-pre-wrap">{it.note}</span>
              </div>
            )}
            {it.comments.length > 4 && (
              <button onClick={() => setOpenItems(prev => ({ ...prev, [k]: true }))}
                className="text-[10px] font-medium text-brand-700 hover:underline">
                Show {it.comments.length - 4} earlier comment{it.comments.length - 4 === 1 ? '' : 's'}…
              </button>
            )}
            {it.comments.slice(-4).map((c, i) => (
              <div key={i} className="text-[11px] max-w-2xl flex items-start gap-1.5">
                <MessageSquare size={11} className="mt-0.5 shrink-0 text-brand-500" />
                <span>
                  <span className="font-semibold text-ink">{shortWho(c.author)}</span>
                  <span className="text-muted"> · {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className="text-ink"> — {c.body}</span>
                </span>
              </div>
            ))}
            <button onClick={() => setOpenItems(prev => ({ ...prev, [k]: true }))}
              className="text-[10px] font-medium text-muted hover:text-brand-700">+ Add note / comment</button>
          </div>
        )}

        {open && (
          <div className="px-4 pb-3 sm:pl-11">
            {worst && (
              <div className="space-y-1 mb-2">
                {it.flags.map((f, i) => (
                  <div key={i} className="text-xs text-ink flex items-start gap-1.5">
                    <span className={'mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS[f.severity]}>{FLAG_LABEL[f.type]}</span>
                    <span className="text-muted">{f.detail}{f.amount !== undefined ? ' (' + fmt(f.amount) + ')' : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {it.benchRate != null && (
              <div className="text-xs text-muted mb-2">
                Expected for this stay ({it.mixWeekday} midweek · {it.mixWeekend} weekend): <span className="font-semibold text-ink">{fmt(it.benchRate)}/n</span>
                <span className="text-[10px]"> ({it.benchLabel}, this + last month)</span>
                {it.benchPrev != null && <span> · last month blended {fmt(it.benchPrev)}/n</span>}
                {it.avgRate != null && it.benchPct != null && <span> — whole-stay avg <span className={'font-semibold ' + (it.benchPct < (data?.rules.lowRatePct ?? 55) ? 'text-rose-600' : 'text-ink')}>{fmt(it.avgRate)}/n ({it.benchPct}%)</span></span>}
                {it.leadDays != null && <span> · booked {it.leadDays}d before check-in</span>}
              </div>
            )}
            {/* WHAT THE OWNER GETS PAID ON THIS BOOKING — the question every row is really about,
                answered before the line items rather than left to be added up by eye. */}
            <div className="rounded-xl border border-line bg-app/40 px-3 py-2 mb-2 max-w-2xl">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">What the owner is paid on this booking</div>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-1 text-xs">
                <span>Room revenue <span className="font-semibold text-ink tabular-nums">{fmt(it.rental)}</span></span>
                <span className="text-muted">−</span>
                <span>Our commission <span className="font-semibold text-rose-700 tabular-nums">{fmt(it.commission)}</span>
                  {it.rental > 0.5 && it.commission > 0.005 && <span className="text-[10px] text-muted"> ({Math.round((it.commission / it.rental) * 100)}%)</span>}
                </span>
                <span className="text-muted">+</span>
                <span>Cleaning, fees &amp; reimbursements <span className={'font-semibold tabular-nums ' + (it.other < 0 ? 'text-rose-700' : 'text-ink')}>{fmt(it.other)}</span></span>
                <span className="ml-auto pl-3 border-l border-line">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted block leading-tight">Owner payout</span>
                  <span className={'text-base font-bold tabular-nums ' + (it.net < 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmt(it.net)}</span>
                </span>
              </div>
              {it.monthNights > 0 && it.net > 0 && (
                <div className="text-[10px] text-muted mt-1">
                  {fmt(it.net / it.monthNights)} per night across the {it.monthNights} night{it.monthNights === 1 ? '' : 's'} on this statement
                  {it.splitMonth ? ' (the rest of the stay pays out on another statement)' : ''}
                </div>
              )}
              {/* WHY THIS NUMBER IS NOT THE NUMBER ON THE BOOKING. Shown whenever the month
                  contains reversals, or the booking's own value differs — the exact confusion
                  the team hit on cancellations. */}
              {(it.reversed < -0.005 || (it.resValue != null && Math.abs(it.resValue - it.net) > 1)) && (
                <div className="mt-2 pt-2 border-t border-line text-[11px] text-muted space-y-0.5">
                  <div className="font-semibold text-ink text-[10px] uppercase tracking-wide">How this total was built</div>
                  <div>
                    Posted this month <span className="font-semibold text-ink tabular-nums">{fmt(it.posted)}</span>
                    {it.reversed < -0.005 && <> · taken back <span className="font-semibold text-rose-700 tabular-nums">{fmt(it.reversed)}</span></>}
                    {' '}· leaves <span className="font-semibold text-ink tabular-nums">{fmt(it.net)}</span>
                  </div>
                  {it.resValue != null && (
                    <div>
                      The booking in Guesty is worth <span className="font-semibold text-ink tabular-nums">{fmt(it.resValue)}</span> in total
                      {it.splitMonth ? ' across the whole stay, which spans two statements' : ''}
                      {it.canceled ? ' — it was canceled, so the statement carries only what was kept or reversed, not the full stay' : ''}
                      {!it.canceled && !it.splitMonth && ' — the statement figure is the owner’s share after commission and fees, so the two are not the same number'}
                      .
                    </div>
                  )}
                </div>
              )}
            </div>
            {it.lines.length > 0 && (
              /* Four columns of statement detail (date, label, code, amount). On a phone the code
                 and the amount were being crushed to a couple of characters each, so the table
                 keeps its widths and scrolls inside the card instead. */
              <div className="rounded-xl border border-line overflow-hidden mb-2 max-w-2xl">
                <div className="lh-hscroll">
                <table className="w-full min-w-[400px] sm:min-w-0 text-xs">
                  <tbody>
                    {it.lines.map((l, i) => (
                      <tr key={i} className={i % 2 ? 'bg-app/50' : 'bg-white'}>
                        <td className="px-2.5 py-1 text-muted whitespace-nowrap">{dateShort(l.date)}</td>
                        <td className="px-2.5 py-1 text-ink">{l.label}</td>
                        <td className="px-2.5 py-1 text-muted">{l.code}</td>
                        <td className={'px-2.5 py-1 text-right font-medium whitespace-nowrap ' + (l.amount < 0 ? 'text-rose-700' : 'text-ink')}>{fmt(l.amount)}</td>
                      </tr>
                    ))}
                    {/* Long stays post a line per night, so the table is capped. Say so out loud —
                        a truncated table whose numbers do not add up reads as a broken statement. */}
                    {it.lineCount > it.lines.length && (
                      <tr className="bg-white">
                        <td className="px-2.5 py-1 text-muted italic" colSpan={4}>
                          showing the first {it.lines.length} of {it.lineCount} line items — the payout above covers all {it.lineCount}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-line bg-white">
                      <td className="px-2.5 py-1 font-semibold text-ink" colSpan={3}>Owner payout on this booking</td>
                      <td className={'px-2.5 py-1 text-right font-semibold whitespace-nowrap ' + (it.net < 0 ? 'text-rose-700' : 'text-ink')}>{fmt(it.net)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>
            )}
            {/* Pull THIS booking again from Guesty. Folio edits (fee breakouts, corrections) are
                made on the reservation; without this you would be reading yesterday's copy of a
                booking you just fixed. Statement line items come from the monthly sync above. */}
            {it.reservationId && (
              <div className="mb-2 flex items-center gap-2 flex-wrap">
                <button onClick={() => refreshRow(it)} disabled={rowSync === k}
                  title="Pull this reservation and its folio from Guesty again"
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg ring-1 ring-inset bg-white text-brand-700 ring-line hover:bg-app disabled:opacity-50">
                  <RefreshCw size={11} className={rowSync === k ? 'animate-spin' : ''} />
                  {rowSync === k ? 'Refreshing from Guesty…' : 'Refresh folio from Guesty'}
                </button>
                <span className="text-[10px] text-muted">use this after editing the booking in Guesty</span>
              </div>
            )}
            {it.resNote && (
              <div className="max-w-2xl mb-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted flex items-center gap-1"><FileText size={11} /> On the reservation in Guesty</div>
                <div className="mt-0.5 text-xs text-ink bg-app/70 border border-line rounded-lg px-2.5 py-1.5 whitespace-pre-wrap max-h-32 overflow-y-auto">{it.resNote}</div>
              </div>
            )}
            <div className="max-w-2xl">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Audit note</label>
              <div className="flex gap-2 mt-0.5">
                <input
                  value={noteShown}
                  onChange={e => setDrafts(prev => ({ ...prev, [k]: e.target.value }))}
                  onBlur={() => saveNote(it)}
                  onKeyDown={e => { if (e.key === 'Enter') saveNote(it) }}
                  placeholder="What was found / what was done…"
                  className="flex-1 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
                {it.reservationId && (
                  <button onClick={() => stampToGuesty(it)} disabled={saving || !(noteShown || '').trim() || stamped[k]}
                    title="Append this note to the reservation's Guesty notes, stamped with month and author"
                    className={'shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg ring-1 ring-inset transition ' + (stamped[k] ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-muted ring-line hover:text-brand-700 disabled:opacity-40')}>
                    {stamped[k] ? <><Check size={11} /> Stamped</> : <><Send size={11} /> Send to Guesty</>}
                  </button>
                )}
              </div>
              {it.comments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {it.comments.map((c, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-semibold text-ink">{c.author}</span>
                      <span className="text-muted"> · {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      <div className="text-ink">{c.body}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                {share && (
                  <input value={me} onChange={e => setMe(e.target.value)} placeholder="Your name"
                    className="w-28 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                )}
                <input
                  value={cDrafts[k] || ''}
                  onChange={e => setCDrafts(prev => ({ ...prev, [k]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addComment(it) }}
                  placeholder="Add a comment…"
                  className="flex-1 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
                <button onClick={() => addComment(it)} disabled={saving || !(cDrafts[k] || '').trim()}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">Post</button>
              </div>
              {it.updatedBy && (
                <div className="text-[10px] text-muted mt-1.5">Last touched by {it.updatedBy}{it.updatedAt ? ' · ' + when(it.updatedAt) : ''}</div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── password gate (share link) ─────────────────────────────────────────────
  if (needsPw) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-1"><Lock size={16} className="text-muted" /><h1 className="font-semibold text-ink">Owner statement audit</h1></div>
          <p className="text-sm text-muted mb-4">Enter the audit password to review this month&rsquo;s statements.</p>
          <input
            type="password" value={pw} autoFocus
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') unlock() }}
            placeholder="Password"
            className="w-full text-sm border border-line rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          {pwErr && <div className="text-xs text-red-600 mb-2">{pwErr}</div>}
          <button onClick={unlock} disabled={pwBusy || !pw} className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{pwBusy ? 'Checking…' : 'Open the audit'}</button>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-line bg-white p-6 shadow-soft">
        <div className="text-sm text-muted">Loading the audit…</div>
        <div className="mt-3 h-24 rounded-xl bg-app animate-pulse" />
      </div>
    )
  }

  const staleHours = data ? hoursSince(data.coverage.syncedAt) : null
  const draftCount = data ? data.owners.filter(o => o.hasStatement && o.isDraft).length : 0
  const freshCut = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  // A month being audited BEFORE its statements exist — the daily/weekly mode.
  const preStatement = !!data && data.totals.statements === 0 && data.items.length > 0
  const t = data?.totals
  const total = t ? t.review + t.action + t.done : 0
  const pct = total ? Math.round((t!.done / total) * 100) : 0
  const curOwner = data && stmtOwner ? data.owners.find(o => o.ownerId === stmtOwner) || null : null
  const stmtIdx = data && curOwner ? data.owners.indexOf(curOwner) : -1

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Owner statements</div>
          <h1 className="text-lg font-semibold text-ink">Statement audit {data ? '· ' + data.label : ''}</h1>
        </div>
        {/* Worklist/Statements/Prep + the month select + three icon buttons are ~530px of toolbar:
            on a phone they used to run off the side of the screen. Let them wrap. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-white overflow-hidden">
            <button onClick={() => { setView('work') }}
              className={'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 transition ' + (view === 'work' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <LayoutList size={13} /> Worklist
            </button>
            <button onClick={() => { setView('stmt'); setStmtOwner('') }}
              className={'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 transition ' + (view === 'stmt' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <FileText size={13} /> Statements
            </button>
            <button onClick={() => setView('prep')}
              className={'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 transition ' + (view === 'prep' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <Scissors size={13} /> Prep
              {data && data.totals.prepOpen > 0 && (
                <span className={'text-[10px] font-bold px-1.5 rounded-full ' + (view === 'prep' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800')}>{data.totals.prepOpen}</span>
              )}
            </button>
          </div>
          <select
            value={month}
            onChange={e => { setStmtOwner(''); load(e.target.value) }}
            className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {months.map(m => <option key={m.m} value={m.m}>{m.label} ({m.statements})</option>)}
            {months.length === 0 && <option value="">No statements yet</option>}
          </select>
          {internal && data && (
            <button onClick={() => { setRulesDraft({ ...data.rules, enabled: { ...data.rules.enabled } }); setRulesOpen(true) }}
              title="Edit the flag rules (low-rate threshold, which checks run)"
              className="p-2 rounded-lg border border-line bg-white hover:bg-app"><Settings2 size={14} className="text-muted" /></button>
          )}
          <button onClick={() => load(month)} title="Refresh" className="p-2 rounded-lg border border-line bg-white hover:bg-app"><RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} /></button>
          <button onClick={exportCsv} title="Download CSV of the current view" className="p-2 rounded-lg border border-line bg-white hover:bg-app"><Download size={14} className="text-muted" /></button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-xs font-semibold hover:underline">Dismiss</button>
        </div>
      )}
      {flash && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm px-3 py-2 flex items-center gap-2">
          <Check size={14} /> {flash}
        </div>
      )}
      {data && !data.coverage.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> The statement line items for {data.label} are still syncing from Guesty — rows may be incomplete until the sync finishes.
        </div>
      )}
      {/* PRE-STATEMENT MONTH — the daily/weekly mode. Statements don't exist yet; the board is
          auditing the month as it accrues so that generation day is boring. */}
      {preStatement && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900 text-sm px-3 py-2 flex items-start gap-2">
          <Check size={14} className="mt-0.5 shrink-0 text-indigo-600" />
          <span>
            No statements have been generated for {data!.label} yet — you&rsquo;re auditing the month <span className="font-semibold">as it builds</span>.
            Work the flagged rows and the &ldquo;Posted this week&rdquo; filter each week, and by the time Guesty generates the statements there should be nothing left to find.
          </span>
        </div>
      )}
      {/* WEEKLY ROUTINE — the team's checklist, on the board where the work happens. */}
      {data && (
        <div className="rounded-xl border border-line bg-white">
          <button onClick={() => setRoutineOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-muted hover:text-ink">
            {routineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="font-semibold text-ink">How to run the week</span>
            <span className="text-xs">— the routine that keeps statement day boring</span>
          </button>
          {routineOpen && (
            <div className="px-4 pb-3 text-sm text-ink space-y-1.5">
              <div><span className="font-semibold">1 · Sync.</span> Hit <span className="font-semibold">Sync now</span> so the board reflects Guesty as of this morning (it also refreshes hourly on its own).</div>
              <div><span className="font-semibold">2 · Work what changed.</span> Turn on <span className="font-semibold">Posted this week</span> — that&rsquo;s everything with new line items since last review. Approve the clean ones, mark Action on anything that needs fixing in Guesty.</div>
              <div><span className="font-semibold">3 · Check coverage.</span> Run <span className="font-semibold">Check coverage</span> — bookings earning money that isn&rsquo;t reaching the ledger. An unmapped listing caught in week one is a five-minute fix; caught on statement day it&rsquo;s a re-generation.</div>
              <div><span className="font-semibold">4 · Prep + owner stays.</span> The Prep tab for Expedia fee breakouts; the <span className="font-semibold">Owner / F&amp;F stay</span> flags for cleaning fees that were never charged.</div>
              <div><span className="font-semibold">5 · Statement week.</span> When Guesty generates the statements, the only new work is the ties: confirm each statement matches the rows you already approved, then sign off owner by owner.</div>
            </div>
          )}
        </div>
      )}
      {/* DRAFT MONTH — Guesty has not finalised these statements, so their balances are still
          moving and cannot be reconciled yet. Said once, at the top, before anyone chases a
          difference that is only a draft in progress. */}
      {data && draftCount > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 text-sky-900 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-sky-600" />
          <span>
            {draftCount === data.owners.filter(o => o.hasStatement).length
              ? <>Guesty still has <span className="font-semibold">every {data.label} statement</span> as a draft.</>
              : <><span className="font-semibold">{draftCount}</span> of {data.owners.filter(o => o.hasStatement).length} {data.label} statements are still drafts in Guesty.</>}
            {' '}Their due-to-owner totals are provisional and change on every pull, so a difference against the line items is expected right now — work the flagged rows, and reconcile the totals once Guesty finalises them.
          </span>
        </div>
      )}
      {/* FRESHNESS — an audit run against stale accounting data is worse than no audit, and a
          sync that quietly stopped is invisible unless the page says so. */}
      {data && (
        <div className={'rounded-xl border text-sm px-3 py-2 flex items-center gap-2 flex-wrap '
          + (staleHours == null ? 'border-line bg-white text-muted'
            : staleHours > 26 ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-line bg-white text-muted')}>
          {staleHours != null && staleHours > 26 ? <AlertTriangle size={14} /> : <Check size={14} className="text-emerald-600" />}
          <span>
            {data.coverage.syncedAt
              ? <>Statement data for {data.label} last pulled from Guesty <span className="font-semibold">{agoLabel(data.coverage.syncedAt)}</span>.</>
              : <>This month has never been pulled from Guesty.</>}
            {staleHours != null && staleHours > 26 && ' It refreshes hourly on its own — if this keeps growing, the sync has stopped.'}
          </span>
          {internal && (
            <span className="ml-auto flex items-center gap-2">
              <button onClick={checkCoverage} disabled={covBusy}
                title="Find bookings earning money that isn't reaching the ledger — unmapped listings, unrecognised stays"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-50">
                <ShieldAlert size={12} /> {covBusy ? 'Checking…' : 'Check coverage'}
              </button>
              <button onClick={syncNow} disabled={syncing}
                title="Pull this month's statements and line items from Guesty right now"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-50">
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Pulling from Guesty…' : 'Sync now'}
              </button>
            </span>
          )}
        </div>
      )}
      {/* COVERAGE RESULT — revenue that exists on bookings but not in the month's ledger. */}
      {cov && (
        <div className={'rounded-xl border text-sm px-3 py-2 ' + (cov.earnedButNotOnAnyStatement.count ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          <div className="flex items-center gap-2">
            {cov.earnedButNotOnAnyStatement.count ? <AlertTriangle size={14} className="shrink-0" /> : <Check size={14} className="shrink-0" />}
            <span className="font-semibold">
              {cov.earnedButNotOnAnyStatement.count
                ? cov.earnedButNotOnAnyStatement.count + ' booking' + (cov.earnedButNotOnAnyStatement.count === 1 ? '' : 's') + ' · ' + fmt0(cov.earnedButNotOnAnyStatement.money) + ' of guest revenue is not ' + (cov.mode === 'pre-statement' ? 'reaching the ledger' : 'on any statement')
                : 'Every booking with revenue this month is ' + (cov.mode === 'pre-statement' ? 'flowing into the ledger' : 'on a statement') + '.'}
            </span>
            <button onClick={() => setCov(null)} className="ml-auto text-xs font-semibold hover:underline">Dismiss</button>
          </div>
          {cov.earnedButNotOnAnyStatement.count > 0 && (
            <div className="mt-1.5 text-xs space-y-0.5 max-h-44 overflow-y-auto">
              {cov.earnedButNotOnAnyStatement.rows.slice(0, 25).map((r: any, i: number) => (
                <div key={i} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{r.unit}</span>
                  <span>{r.guest}</span>
                  <span className="opacity-70">{dateShort(r.checkIn)}–{dateShort(r.checkOut)}</span>
                  <span className="font-semibold tabular-nums ml-auto">{fmt(r.money)}</span>
                  <span className="opacity-70">{r.owner}</span>
                </div>
              ))}
              {cov.earnedButNotOnAnyStatement.count > 25 && <div className="italic opacity-70">…and {cov.earnedButNotOnAnyStatement.count - 25} more</div>}
            </div>
          )}
        </div>
      )}

      {/* rules editor */}
      {rulesOpen && rulesDraft && (
        <div className="rounded-2xl border border-line bg-white shadow-soft p-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 size={15} className="text-muted" />
            <div className="text-sm font-semibold text-ink">Audit rules</div>
            <span className="text-[11px] text-muted">changes re-check every month against the new rules</span>
            <button onClick={() => setRulesOpen(false)} className="ml-auto p-1 rounded-md hover:bg-app text-muted"><X size={14} /></button>
          </div>
          <div className="flex flex-wrap items-end gap-4 mb-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Low-rate check</label>
              <select value={rulesDraft.lowRateMode}
                onChange={e => setRulesDraft(rd => rd ? { ...rd, lowRateMode: e.target.value as Rules['lowRateMode'] } : rd)}
                className="block mt-0.5 text-sm border border-line rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="relative">Vs building average (recommended)</option>
                <option value="absolute">Flat $/night threshold</option>
              </select>
              <div className="text-[10px] text-muted mt-0.5">
                {rulesDraft.lowRateMode === 'relative'
                  ? 'Each stay vs its building + size average, this month + last month, in-month nights only.'
                  : 'Every stay against one flat number, in-month nights only.'}
              </div>
            </div>
            {rulesDraft.lowRateMode === 'relative' ? (
              <>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Flag under (% of average)</label>
                  <input type="number" min={10} max={95} step={5} value={rulesDraft.lowRatePct}
                    onChange={e => setRulesDraft(rd => rd ? { ...rd, lowRatePct: Number(e.target.value) } : rd)}
                    className="block mt-0.5 w-24 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <div className="text-[10px] text-muted mt-0.5">e.g. 55 = flag below 55% of the average.</div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Hard floor ($/night)</label>
                  <input type="number" min={0} step={5} value={rulesDraft.lowRateFloor}
                    onChange={e => setRulesDraft(rd => rd ? { ...rd, lowRateFloor: Number(e.target.value) } : rd)}
                    className="block mt-0.5 w-24 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <div className="text-[10px] text-muted mt-0.5">Always flag under this, any building.</div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Last-minute = booked within (days)</label>
                  <input type="number" min={0} max={30} step={1} value={rulesDraft.lastMinDays}
                    onChange={e => setRulesDraft(rd => rd ? { ...rd, lastMinDays: Number(e.target.value) } : rd)}
                    className="block mt-0.5 w-24 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <div className="text-[10px] text-muted mt-0.5">We cut rates to fill these nights.</div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Last-minute slack (pts)</label>
                  <input type="number" min={0} max={40} step={5} value={rulesDraft.lastMinExtra}
                    onChange={e => setRulesDraft(rd => rd ? { ...rd, lastMinExtra: Number(e.target.value) } : rd)}
                    className="block mt-0.5 w-24 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <div className="text-[10px] text-muted mt-0.5">e.g. 20 → last-minute flags below {Math.max(10, rulesDraft.lowRatePct - rulesDraft.lastMinExtra)}%.</div>
                </div>
              </>
            ) : (
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Threshold ($/night)</label>
                <input type="number" min={0} step={5} value={rulesDraft.lowRate}
                  onChange={e => setRulesDraft(rd => rd ? { ...rd, lowRate: Number(e.target.value) } : rd)}
                  className="block mt-0.5 w-28 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <div className="text-[10px] text-muted mt-0.5">Computed on in-month nights only.</div>
              </div>
            )}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Pass-through band (commission ÷ rental)</label>
              <div className="flex items-center gap-1.5 mt-0.5">
                <input type="number" min={0.5} max={1} step={0.05} value={rulesDraft.passthruLo}
                  onChange={e => setRulesDraft(rd => rd ? { ...rd, passthruLo: Number(e.target.value) } : rd)}
                  className="w-20 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <span className="text-xs text-muted">to</span>
                <input type="number" min={1} max={2} step={0.05} value={rulesDraft.passthruHi}
                  onChange={e => setRulesDraft(rd => rd ? { ...rd, passthruHi: Number(e.target.value) } : rd)}
                  className="w-20 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
              <div className="text-[10px] text-muted mt-0.5">Ratio treated as a wash (informational flag).</div>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Commission tolerance (pts)</label>
              <input type="number" min={1} max={30} step={1} value={rulesDraft.commTolerance}
                onChange={e => setRulesDraft(rd => rd ? { ...rd, commTolerance: Number(e.target.value) } : rd)}
                className="block mt-0.5 w-24 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <div className="text-[10px] text-muted mt-0.5">Flag when a reservation’s commission % strays this far from the owner’s usual rate.</div>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">Money with no revenue behind it ($)</label>
              <input type="number" min={0} step={5} value={rulesDraft.offBookingMin}
                onChange={e => setRulesDraft(rd => rd ? { ...rd, offBookingMin: Number(e.target.value) } : rd)}
                className="block mt-0.5 w-24 text-sm border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <div className="text-[10px] text-muted mt-0.5">Owner charges, and money on bookings with no room revenue, from this size up.</div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5 max-w-2xl">
            {(Object.keys(FLAG_LABEL) as FlagType[]).map(f => (
              <label key={f} className="flex items-start gap-2 text-xs rounded-lg border border-line px-2.5 py-1.5 cursor-pointer hover:bg-app/60">
                <input type="checkbox" checked={rulesDraft.enabled[f]}
                  onChange={e => setRulesDraft(rd => rd ? { ...rd, enabled: { ...rd.enabled, [f]: e.target.checked } } : rd)}
                  className="mt-0.5 accent-ink" />
                <span><span className="font-semibold text-ink">{FLAG_LABEL[f]}</span> <span className="text-muted">— {FLAG_HELP[f]}</span></span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={saveRules} disabled={rulesBusy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{rulesBusy ? 'Saving…' : 'Save rules'}</button>
            <button onClick={() => setRulesOpen(false)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink">Cancel</button>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* progress + money strip */}
          <div className="rounded-2xl border border-line bg-white shadow-soft p-4">
            {/* Nine label+number blocks. Wrapped as a flex row on a phone they landed in a ragged
                one-and-a-bit-per-line stagger; a plain two-column grid reads down the screen.
                From 640px it is the same wrapping flex row it has always been. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-y-2">
              {/* Progress counts ONLY rows that needed a person. Clean rows are reported separately
                  instead of being folded in — see the status ladder in lib/owner-audit.ts. */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Issues closed out</div>
                <div className="text-sm font-semibold text-ink">
                  {total === 0 ? 'Nothing flagged this month' : t!.done + ' of ' + total + ' · ' + pct + '%'}
                </div>
                <div className="mt-1.5 w-full sm:w-44 h-[8px] rounded-full bg-brand-100 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: pct + '%' }} />
                </div>
                <div className="text-[10px] text-muted mt-1">{t!.clear.toLocaleString()} more rows had nothing flagged</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Signed off</div>
                <div className="text-sm font-semibold text-ink">{t!.signedOff} of {t!.statements} statements</div>
                <div className="mt-1.5 w-full sm:w-28 h-[8px] rounded-full bg-emerald-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: (t!.statements ? Math.round((t!.signedOff / t!.statements) * 100) : 0) + '%' }} />
                </div>
              </div>
              {/* Two different numbers, never blended: what the statements say is owed, and what
                  has actually gone out the door. */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Owed to owners</div>
                <div className="text-sm font-semibold text-ink" title="Total of the statements' closing balances (due to owner)">{fmt0(t!.dueToOwner)}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Paid out so far</div>
                <div className={'text-sm font-semibold ' + (t!.paid ? 'text-ink' : 'text-muted')} title="Payout movements posted on these statements">{t!.paid ? fmt0(t!.paid) : 'none posted'}</div>
              </div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Statements</div><div className="text-sm font-semibold text-ink">{t!.statements} · {t!.owners} owners</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Reservations</div><div className="text-sm font-semibold text-ink">{t!.reservations}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rental income</div><div className="text-sm font-semibold text-ink">{fmt0(t!.rental)}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Commission</div><div className="text-sm font-semibold text-ink">{fmt0(t!.commission)}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Owner earnings</div><div className="text-sm font-semibold text-ink" title="Rental − commission + fees, from the statement line items">{fmt0(t!.net)}</div></div>
            </div>
          </div>

          {/* ═══ STATEMENTS: overview grid ═══ */}
          {view === 'stmt' && !curOwner && (
            <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
              {/* PHONE: eight columns of statement state will not fit, and this is the list you
                  actually work from — so the same rows render as tapable cards below 640px and the
                  table takes over from `sm:` up. Same data, same click, nothing dropped. */}
              <div className="divide-y divide-line sm:hidden">
                {data.owners.map(o => {
                  const s = stats[o.ownerId] || { notes: 0, comments: 0 }
                  const off = o.dueToOwner == null ? null : Math.round((o.net - o.dueToOwner) * 100) / 100
                  const toClose = o.done + o.open
                  const p = toClose ? Math.round((o.done / toClose) * 100) : 100
                  return (
                    <button key={o.ownerId} onClick={() => { setStmtOwner(o.ownerId); window.scrollTo({ top: 0 }) }}
                      className="w-full text-left px-4 py-3 active:bg-app/60">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink truncate">{o.ownerName}</div>
                          <div className="text-[11px] text-muted">{o.items} row{o.items === 1 ? '' : 's'}{o.open ? ' · ' + o.open + ' to review' : ''}{o.hasStatement ? '' : ' · no statement generated'}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-ink whitespace-nowrap">{o.dueToOwner != null ? fmt(o.dueToOwner) : fmt(o.net)}</div>
                          <div className="text-[10px] uppercase tracking-wide text-muted">payout</div>
                        </div>
                        <ChevronRight size={15} className="text-muted shrink-0 mt-0.5" />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {!o.hasStatement
                          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">No stmt</span>
                          : (() => { const b = tieBadge(o); return <span title={b.help} className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + b.cls}>{o.isDraft && !o.hasPayout ? 'Draft' : o.ties ? b.text : (o.hasPayout ? fmt(off || 0) : 'balance ' + fmt(off || 0))}</span> })()}
                        {o.high > 0 && <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.high}>{o.high} high</span>}
                        {o.reviewFlags > 0 && <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.review}>{o.reviewFlags} review</span>}
                        {o.high === 0 && o.reviewFlags === 0 && <span className="text-[10px] text-muted">clean</span>}
                        {o.stmtNote && <span title={o.stmtNote} className="inline-flex items-center px-1 rounded bg-amber-50 ring-1 ring-inset ring-amber-200"><StickyNote size={11} className="text-amber-600" /></span>}
                        {s.notes > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-muted"><StickyNote size={11} className="text-amber-600" /> {s.notes}</span>}
                        {s.comments > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-muted"><MessageSquare size={11} className="text-brand-600" /> {s.comments}</span>}
                        {o.signOff
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200"><ShieldCheck size={11} /> {shortWho(o.signOff.by)}</span>
                          : o.open > 0
                            ? <span className="text-[11px] text-muted">{o.open} open</span>
                            : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-brand-50 text-brand-700 ring-brand-200">Ready to sign</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="w-16 h-[6px] rounded-full bg-brand-100 overflow-hidden">
                          <div className={'h-full rounded-full ' + (p === 100 ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: p + '%' }} />
                        </div>
                        <span className="text-[11px] text-muted whitespace-nowrap" title={o.clear + ' rows had nothing flagged'}>
                          {toClose ? o.done + '/' + toClose + ' closed out' : 'nothing flagged'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              <table className="hidden sm:table w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted border-b border-line">
                    <th className="px-4 py-2.5">Owner</th>
                    <th className="px-3 py-2.5 text-right">Payout</th>
                    <th className="px-3 py-2.5">Ties</th>
                    <th className="px-3 py-2.5">Flags</th>
                    <th className="px-3 py-2.5">Notes</th>
                    <th className="px-3 py-2.5">Audit</th>
                    <th className="px-3 py-2.5">Sign-off</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.owners.map(o => {
                    const s = stats[o.ownerId] || { notes: 0, comments: 0 }
                    const off = o.dueToOwner == null ? null : Math.round((o.net - o.dueToOwner) * 100) / 100
                    // Progress across the rows that actually needed a decision, not across every
                    // row on the statement — clean rows were never work.
                    const toClose = o.done + o.open
                    const p = toClose ? Math.round((o.done / toClose) * 100) : 100
                    return (
                      <tr key={o.ownerId} onClick={() => { setStmtOwner(o.ownerId); window.scrollTo({ top: 0 }) }}
                        className="cursor-pointer hover:bg-app/60 transition">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink">{o.ownerName}</div>
                          <div className="text-[11px] text-muted">{o.items} row{o.items === 1 ? '' : 's'}{o.open ? ' · ' + o.open + ' to review' : ''}{o.hasStatement ? '' : ' · no statement generated'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-ink whitespace-nowrap">{o.dueToOwner != null ? fmt(o.dueToOwner) : fmt(o.net)}</td>
                        <td className="px-3 py-2.5">
                          {!o.hasStatement
                            ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">No stmt</span>
                            : (() => { const b = tieBadge(o); return <span title={b.help} className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + b.cls}>{o.isDraft && !o.hasPayout ? 'Draft' : o.ties ? b.text : (o.hasPayout ? fmt(off || 0) : 'balance ' + fmt(off || 0))}</span> })()}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {o.high > 0 && <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset mr-1 ' + FLAG_CLS.high}>{o.high} high</span>}
                          {o.reviewFlags > 0 && <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.review}>{o.reviewFlags} review</span>}
                          {o.high === 0 && o.reviewFlags === 0 && <span className="text-[10px] text-muted">clean</span>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-muted">
                          {o.stmtNote && <span title={o.stmtNote} className="inline-flex items-center mr-2 px-1 rounded bg-amber-50 ring-1 ring-inset ring-amber-200"><StickyNote size={11} className="text-amber-600" /></span>}
                          {s.notes > 0 && <span className="inline-flex items-center gap-0.5 mr-2"><StickyNote size={11} className="text-amber-600" /> {s.notes}</span>}
                          {s.comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} className="text-brand-600" /> {s.comments}</span>}
                          {!o.stmtNote && s.notes === 0 && s.comments === 0 && <span>—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 h-[6px] rounded-full bg-brand-100 overflow-hidden">
                              <div className={'h-full rounded-full ' + (p === 100 ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: p + '%' }} />
                            </div>
                            <span className="text-[11px] text-muted whitespace-nowrap" title={o.clear + ' rows had nothing flagged'}>
                              {toClose ? o.done + '/' + toClose : 'nothing flagged'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {o.signOff
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200"><ShieldCheck size={11} /> {shortWho(o.signOff.by)}</span>
                            : o.open > 0
                              ? <span className="text-[11px] text-muted">{o.open} open</span>
                              : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-brand-50 text-brand-700 ring-brand-200">Ready to sign</span>}
                        </td>
                        <td className="px-2 py-2.5 text-muted"><ChevronRight size={15} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ═══ STATEMENTS: one statement, one by one ═══ */}
          {view === 'stmt' && curOwner && (
            <>
              <div className="rounded-2xl border border-line bg-white shadow-soft p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button onClick={() => setStmtOwner('')} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
                    <ArrowLeft size={13} /> All statements
                  </button>
                  <span className="ml-auto text-[11px] text-muted">Statement {stmtIdx + 1} of {data.owners.length}</span>
                  <button disabled={stmtIdx <= 0} onClick={() => { setStmtOwner(data.owners[stmtIdx - 1].ownerId); window.scrollTo({ top: 0 }) }}
                    className="p-1.5 rounded-lg border border-line bg-white hover:bg-app disabled:opacity-30"><ChevronLeft size={14} className="text-muted" /></button>
                  <button disabled={stmtIdx >= data.owners.length - 1} onClick={() => { setStmtOwner(data.owners[stmtIdx + 1].ownerId); window.scrollTo({ top: 0 }) }}
                    className="p-1.5 rounded-lg border border-line bg-white hover:bg-app disabled:opacity-30"><ChevronRight size={14} className="text-muted" /></button>
                </div>
                {/* Same story as the totals strip: eight money blocks read as a two-column list on
                    a phone, and as the original wrapping row from 640px up. */}
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-y-2">
                  <div className="col-span-2 sm:col-auto">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{data.label} statement</div>
                    <div className="text-lg font-semibold text-ink">{curOwner.ownerName}</div>
                    {!curOwner.hasStatement && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">No statement generated</span>}
                  </div>
                  {/* The money, in the order it happens: what the bookings earned, what we took,
                      what the owner is owed, and what has actually been paid. */}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Owner earnings</div>
                    <div className="text-xl font-semibold text-ink">{fmt(curOwner.net)}</div>
                    <div className="text-[10px] text-muted">from this statement&rsquo;s line items</div>
                  </div>
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Room revenue</div><div className="text-sm font-semibold text-ink">{fmt(curOwner.rental)}</div></div>
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Our commission</div><div className="text-sm font-semibold text-ink">{fmt(curOwner.commission)}</div></div>
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Fees &amp; reimbursements</div><div className="text-sm font-semibold text-ink">{fmt(curOwner.other)}</div></div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Statement balance</div>
                    <div className="text-sm font-semibold text-ink">{curOwner.dueToOwner != null ? fmt(curOwner.dueToOwner) : '—'}</div>
                    <div className="text-[10px] text-muted">{curOwner.isDraft ? 'draft — still moving' : 'due to owner'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Actually paid out</div>
                    <div className={'text-sm font-semibold ' + (curOwner.hasPayout ? 'text-ink' : 'text-muted')}>{curOwner.hasPayout ? fmt(curOwner.paid) : 'not yet'}</div>
                  </div>
                  <div>
                    {curOwner.hasStatement && (() => { const b = tieBadge(curOwner); return (
                      <span title={b.help} className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + b.cls}>{b.text}</span>
                    ) })()}
                  </div>
                </div>
                {/* statement-level note — always visible, saves on blur */}
                <div className="mt-3 flex items-center gap-1.5 max-w-3xl">
                  <StickyNote size={13} className="text-amber-600 shrink-0" />
                  <input
                    value={eNotes[curOwner.ownerId + '|__statement__'] !== undefined ? eNotes[curOwner.ownerId + '|__statement__'] : curOwner.stmtNote}
                    onChange={e => setENotes(prev => ({ ...prev, [curOwner.ownerId + '|__statement__']: e.target.value }))}
                    onBlur={() => saveEntityNote(curOwner.ownerId, '__statement__', curOwner.stmtNote, v => setData(d => d ? { ...d, owners: d.owners.map(o => o.ownerId === curOwner.ownerId ? { ...o, stmtNote: v } : o) } : d))}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    placeholder="Statement note — anything the next reviewer of this statement should know…"
                    className="flex-1 text-xs border border-amber-200 bg-amber-50/60 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
              </div>

              {/* UNIT SUMMARY — the statement rolls up per unit; reservation detail only opens
                  when a unit is clicked. High level first, detail on demand. */}
              {(() => {
                const mine = data.items.filter(i => i.ownerId === curOwner.ownerId)
                if (mine.length === 0) {
                  return (
                    <div className="rounded-2xl border border-line bg-white shadow-soft p-6 text-sm text-muted text-center">
                      No statement line items for {data.label}.
                    </div>
                  )
                }
                const byUnit: Record<string, Item[]> = {}
                for (const it of mine) {
                  const u = it.unit || (it.kind === 'line' ? 'Owner-level items' : '(no unit)')
                  ;(byUnit[u] = byUnit[u] || []).push(it)
                }
                const units = Object.keys(byUnit).sort((a, b) => a.localeCompare(b))
                return (
                  <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden divide-y divide-line">
                    {units.map(u => {
                      const rows = byUnit[u]
                      const nights = rows.reduce((a, r) => a + r.monthNights, 0)
                      const rental = rows.reduce((a, r) => a + r.rental, 0)
                      const commission = rows.reduce((a, r) => a + r.commission, 0)
                      const netU = rows.reduce((a, r) => a + r.net, 0)
                      const resCount = rows.filter(r => r.kind === 'reservation').length
                      const flagged = rows.filter(r => r.flags.some(f => f.severity !== 'info')).length
                      const openN = rows.filter(r => r.status !== 'done').length
                      const notesN = rows.filter(r => r.note || r.comments.length).length
                      const uk = curOwner.ownerId + '|' + u
                      const openU = !!expandedUnits[uk]
                      return (
                        <div key={uk}>
                          <button onClick={() => setExpandedUnits(prev => ({ ...prev, [uk]: !openU }))}
                            className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-app/60">
                            {openU ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
                            <span className="text-sm font-semibold text-ink min-w-[140px]">{u}</span>
                            <span className="text-[11px] text-muted">{resCount} res · {nights}n</span>
                            {flagged > 0 && <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.review}>{flagged} flagged</span>}
                            {openN > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">{openN} open</span>}
                            {notesN > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200 px-1.5 py-0.5 rounded-full"><MessageSquare size={10} /> {notesN}</span>}
                            {/* Rental / avg / commission / net: on a phone they wrapped onto their
                                own line anyway, so give them the whole line and space them out. */}
                            <span className="ml-auto flex w-full justify-between sm:w-auto sm:justify-start items-center gap-4 text-right">
                              <span><span className="text-[10px] uppercase tracking-wide text-muted block">Rental</span><span className="text-sm font-semibold text-ink">{fmt0(rental)}</span></span>
                              <span><span className="text-[10px] uppercase tracking-wide text-muted block">Avg/n</span><span className="text-sm font-semibold text-ink">{nights > 0 ? fmt0(rental / nights) : '—'}</span></span>
                              <span><span className="text-[10px] uppercase tracking-wide text-muted block">Comm.</span><span className="text-sm font-semibold text-ink">{fmt0(commission)}</span></span>
                              <span><span className="text-[10px] uppercase tracking-wide text-muted block">Net</span><span className={'text-sm font-semibold ' + (netU < 0 ? 'text-rose-700' : 'text-ink')}>{fmt0(netU)}</span></span>
                            </span>
                          </button>
                          {openU && (
                            <div className="border-t border-line divide-y divide-line bg-app/20">
                              {rows.map(it => renderItem(it))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* sign-off */}
              <div className={'rounded-2xl border p-4 shadow-soft ' + (curOwner.signOff ? 'border-emerald-200 bg-emerald-50' : 'border-line bg-white')}>
                {curOwner.signOff ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    <div className="text-sm text-emerald-800">
                      <span className="font-semibold">Statement audited and signed off</span> by {curOwner.signOff.by}{curOwner.signOff.at ? ' · ' + when(curOwner.signOff.at) : ''}
                    </div>
                    <button onClick={() => signOff(curOwner.ownerId, false)} disabled={signBusy === curOwner.ownerId}
                      className="ml-auto text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">Reopen</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck size={18} className={curOwner.open === 0 ? 'text-brand-600' : 'text-muted'} />
                    <div className="text-sm text-ink">
                      {curOwner.open === 0
                        ? <span>{curOwner.done > 0
                          ? 'Every flagged row is closed out'
                          : 'Nothing was flagged on this statement'} — sign off to close this audit.</span>
                        : <span className="text-muted">{curOwner.open} flagged row{curOwner.open === 1 ? '' : 's'} still open — approve or resolve {curOwner.open === 1 ? 'it' : 'them'} to enable sign-off.</span>}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {share && (
                        <input value={me} onChange={e => setMe(e.target.value)} placeholder="Your name"
                          className="w-32 text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                      )}
                      <button onClick={() => signOff(curOwner.ownerId, true)} disabled={curOwner.open > 0 || signBusy === curOwner.ownerId}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">
                        {signBusy === curOwner.ownerId ? 'Signing…' : 'Sign off this statement'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ═══ OWNER PREP — the Expedia fee breakout ═══ */}
          {view === 'prep' && (() => {
            const isSplit = (p: PrepItem) => p.splitDone || (p.cleaningAmt != null && p.rmAmt != null)
            const total = data.prep.length
            const split = data.prep.filter(isSplit).length
            const marked = data.prep.filter(p => !isSplit(p) && p.saved).length
            const noFees = data.prep.filter(p => !prepResolved(p) && p.noFees).length
            const outstanding = data.prep.filter(p => !prepResolved(p) && !p.noFees).length
            const chip = (key: PrepFilter, label: string, cls: string) => (
              <button onClick={() => setFPrep(fPrep === key ? '' : key)}
                className={'text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset transition ' + cls + (fPrep === key ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                {label}
              </button>
            )
            const list = data.prep.filter(p => {
              switch (fPrep) {
                case 'open': return !prepResolved(p) && !p.noFees
                case 'nofees': return !prepResolved(p) && p.noFees
                case 'split': return isSplit(p)
                case 'marked': return !isSplit(p) && !!p.saved
                default: return true
              }
            })
            return (
              <>
                <div className="rounded-2xl border border-line bg-white shadow-soft p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Scissors size={15} className="text-muted" />
                    <div className="text-sm font-semibold text-ink">Statement prep — Expedia fee breakout</div>
                  </div>
                  <p className="text-xs text-muted max-w-3xl">
                    Every Expedia-family booking (Expedia, Hotels.com, Orbitz, Travelocity…) touching {data.label}, pulled from
                    reservations — not just what&rsquo;s on a statement. The split is entered <span className="font-semibold text-ink">on the
                    reservation in Guesty</span> (Cleaning fee + Revenue fee on the guest folio); rows where the folio already
                    shows the split clear automatically. For the rest: open the reservation, break out the fees, then mark it done.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {chip('', total + ' Expedia-family', 'bg-white text-ink ring-line')}
                    {chip('open', outstanding + ' to break out', outstanding ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}
                    {chip('nofees', noFees + ' fees not set up', noFees ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-neutral-100 text-neutral-600 ring-neutral-200')}
                    {chip('split', split + ' split already', 'bg-emerald-50 text-emerald-700 ring-emerald-200')}
                    {marked > 0 && chip('marked', marked + ' marked done', 'bg-emerald-50 text-emerald-700 ring-emerald-200')}
                    <button onClick={recheckGuesty} disabled={recheckBusy}
                      title="Pull the outstanding reservations fresh from Guesty so folio edits show up now"
                      className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line bg-white text-brand-700 hover:bg-app disabled:opacity-40">
                      <RefreshCw size={12} className={recheckBusy ? 'animate-spin' : ''} /> {recheckBusy ? 'Re-checking…' : 'Re-check Guesty'}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
                  <div className="divide-y divide-line">
                    {list.map(p => {
                      const resolved = prepResolved(p)
                      const busy = prepBusy === p.resCode
                      return (
                        <div key={p.resCode} className={'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-l-2 ' + (resolved ? 'border-l-emerald-300' : p.noFees ? 'border-l-rose-400' : 'border-l-amber-300')}>
                          <div className="min-w-[200px] flex-1">
                            <div className="text-sm font-medium text-ink truncate">
                              {resolved && <Check size={12} className="inline -mt-0.5 mr-1 text-emerald-600" />}
                              {p.guest || '(guest unknown)'} <span className="text-muted font-normal">· {p.resCode}</span>
                            </div>
                            <div className="text-[11px] text-muted truncate">
                              {(p.ownerName || ownerName[p.ownerId] || (p.onStatement ? p.ownerId : ''))}{p.unit ? (p.ownerName || p.onStatement ? ' · ' : '') + p.unit : ''} · {dateShort(p.checkIn)} &ndash; {dateShort(p.checkOut)} · {p.monthNights}n in month
                              <span className="ml-1"><SourceChip source={p.source} /></span>
                              {!p.onStatement && (
                                <span title="This booking has no line items on any owner statement for this month yet" className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">Not on statement</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right w-24">
                            <div className="text-sm font-semibold text-ink">{p.onStatement ? fmt(p.rental) : '—'}</div>
                            <div className="text-[11px] text-muted">{p.onStatement ? 'rental' : 'no stmt yet'}</div>
                          </div>
                          {p.splitDone ? (
                            <div className="text-xs text-emerald-700 font-medium">
                              Split on reservation · Cleaning {fmt(Math.abs(p.folioClean || 0))} · Revenue {fmt(Math.abs(p.folioRm || 0))}
                            </div>
                          ) : (p.cleaningAmt != null && p.rmAmt != null) ? (
                            <div className="text-xs text-emerald-700 font-medium">
                              Split on statement · Cleaning {fmt(Math.abs(p.cleaningAmt))} · RM {fmt(Math.abs(p.rmAmt))}
                            </div>
                          ) : p.saved ? (
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-emerald-700 font-medium">
                                Marked broken out<span className="text-muted font-normal"> — {shortWho(p.saved.by)}{p.saved.at ? ' · ' + when(p.saved.at) : ''}</span>
                              </div>
                              <button onClick={() => savePrep(p, false)} disabled={busy}
                                className="text-[11px] font-medium px-2 py-1 rounded-lg border border-line bg-white text-muted hover:text-ink disabled:opacity-40">Reopen</button>
                            </div>
                          ) : (
                            /* Chips + "Edit in Guesty" + the name box + "Mark broken out" is far
                               wider than a phone; without wrap the row ran off the screen. */
                            <div className="flex flex-wrap items-center gap-1.5">
                              {p.noFees && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200" title="Expedia-family booking with NO fees on the folio at all — the fees were never set up on this reservation">⚠ Fees not set up</span>
                              )}
                              {!p.noFees && p.folioLump != null && p.folioLump > 0.5 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">Lump {fmt(p.folioLump)} on folio</span>
                              )}
                              {!p.noFees && p.folioLump == null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-neutral-100 text-neutral-600 ring-neutral-200" title="The reservation's folio isn't in the mirror yet — verify in Guesty">folio unknown</span>
                              )}
                              {p.reservationId && (
                                <a href={gyUrl(p.reservationId)} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line bg-white text-brand-700 hover:bg-app">
                                  <ExternalLink size={12} /> Edit in Guesty
                                </a>
                              )}
                              {share && (
                                <input value={me} onChange={e => setMe(e.target.value)} placeholder="Your name"
                                  className="w-24 text-xs border border-line rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                              )}
                              <button onClick={() => savePrep(p, true)} disabled={busy}
                                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy ? 'Saving…' : 'Mark broken out'}</button>
                            </div>
                          )}
                          {resolved && p.reservationId && (
                            <a href={gyUrl(p.reservationId)} target="_blank" rel="noopener noreferrer" title="Open in Guesty"
                              className="p-1 rounded-md hover:bg-app text-muted hover:text-brand-700"><ExternalLink size={13} /></a>
                          )}
                          <div className="w-full flex items-center gap-1.5 pl-1">
                            <StickyNote size={11} className={'shrink-0 ' + (p.note ? 'text-amber-600' : 'text-neutral-300')} />
                            <input
                              value={eNotes['-|prep:' + p.resCode] !== undefined ? eNotes['-|prep:' + p.resCode] : p.note}
                              onChange={e => setENotes(prev => ({ ...prev, ['-|prep:' + p.resCode]: e.target.value }))}
                              onBlur={() => saveEntityNote('-', 'prep:' + p.resCode, p.note, v => setData(d => d ? { ...d, prep: d.prep.map(x => x.resCode === p.resCode ? { ...x, note: v } : x) } : d))}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              placeholder="Note…"
                              className="flex-1 max-w-xl text-[11px] border border-line rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-amber-200"
                            />
                          </div>
                        </div>
                      )
                    })}
                    {list.length === 0 && (
                      <div className="p-8 text-center text-sm text-muted">
                        {data.prep.length === 0 ? 'No Expedia-family reservations touch ' + data.label + '.' : 'Nothing matches this filter.'}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── AIRBNB RESOLUTIONS — every Resolution Center case for the month,
                    reconciled against what actually landed on the statements ── */}
                {(() => {
                  const rc = data.resolutions.claims
                  const orphans = data.resolutions.lines.filter(l => !l.hasClaim)
                  const pending = rc.filter(c => !c.paidOn && !c.decidedOn)
                  const decided = rc.filter(c => c.decidedOn && !c.paidOn)
                  const paid = rc.filter(c => !!c.paidOn)
                  const collected = paid.reduce((a, c) => a + (c.amountPaid || 0), 0)
                  const missing = rc.filter(c => (c.paidOn || c.decidedOn) && !c.onStatement)
                  const stageChip = (c: ResolutionClaim) => c.paidOn
                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">Paid {dateShort(c.paidOn)}</span>
                    : c.decidedOn
                      ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-sky-50 text-sky-700 ring-sky-200">Decided {dateShort(c.decidedOn)}</span>
                      : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">Pending with Airbnb</span>
                  return (
                    <>
                      <div className="rounded-2xl border border-line bg-white shadow-soft p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <ShieldAlert size={15} className="text-muted" />
                          <div className="text-sm font-semibold text-ink">Airbnb resolutions — {data.label}</div>
                          <a href="/claims" className="ml-auto text-xs font-medium text-brand-700 hover:underline">Open the claims board →</a>
                        </div>
                        <p className="text-xs text-muted max-w-3xl">
                          Every Airbnb Resolution Center case decided or paid this month (plus anything still pending while this
                          month is being prepped), pulled from the claims board and reconciled against the statements: a paid
                          resolution that hasn&rsquo;t landed on the owner&rsquo;s statement is money the owner hasn&rsquo;t seen.
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-white text-ink ring-line">{rc.length} resolution{rc.length === 1 ? '' : 's'}</span>
                          {pending.length > 0 && <span className="text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">{pending.length} pending</span>}
                          {decided.length > 0 && <span className="text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-sky-50 text-sky-700 ring-sky-200">{decided.length} decided</span>}
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">{paid.length} paid · {fmt0(collected)}</span>
                          {missing.length > 0 && <span className="text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200">⚠ {missing.length} not on a statement</span>}
                        </div>
                      </div>

                      {(rc.length > 0 || orphans.length > 0) && (
                        <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
                          <div className="divide-y divide-line">
                            {rc.map(c => (
                              <div key={c.id} className={'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 border-l-2 ' + ((c.paidOn || c.decidedOn) && !c.onStatement ? 'border-l-rose-400' : c.onStatement ? 'border-l-emerald-300' : 'border-l-amber-300')}>
                                <div className="min-w-[200px] flex-1">
                                  <div className="text-sm font-medium text-ink truncate">
                                    {c.guest || '(guest unknown)'} {c.resCode && <span className="text-muted font-normal">· {c.resCode}</span>}
                                  </div>
                                  <div className="text-[11px] text-muted truncate">
                                    {[c.property, c.unit].filter(Boolean).join(' ')}{c.summary ? ' · ' + c.summary : ''}
                                  </div>
                                </div>
                                <div className="text-right w-32">
                                  <div className="text-sm font-semibold text-ink">{c.amountPaid != null ? fmt(c.amountPaid) : c.amountSought != null ? fmt(c.amountSought) : '—'}</div>
                                  <div className="text-[11px] text-muted">{c.amountPaid != null ? 'paid' : 'sought'}{c.amountPaid != null && c.amountSought != null && c.amountSought !== c.amountPaid ? ' of ' + fmt0(c.amountSought) : ''}</div>
                                </div>
                                {stageChip(c)}
                                {(c.paidOn || c.decidedOn) && (
                                  c.onStatement
                                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">On statement{c.stmtAmount != null ? ' ' + fmt(c.stmtAmount) : ''}</span>
                                    : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200" title="No resolution line found on this month's statements for this reservation — add it in Guesty so the owner sees the money">⚠ Not on a statement</span>
                                )}
                                {c.reservationId && (
                                  <a href={gyUrl(c.reservationId)} target="_blank" rel="noopener noreferrer" title="Open in Guesty"
                                    className="p-1 rounded-md hover:bg-app text-muted hover:text-brand-700"><ExternalLink size={13} /></a>
                                )}
                                <div className="w-full flex items-center gap-1.5 pl-1">
                                  <StickyNote size={11} className={'shrink-0 ' + (c.note ? 'text-amber-600' : 'text-neutral-300')} />
                                  <input
                                    value={eNotes['-|resl:' + c.id] !== undefined ? eNotes['-|resl:' + c.id] : c.note}
                                    onChange={e => setENotes(prev => ({ ...prev, ['-|resl:' + c.id]: e.target.value }))}
                                    onBlur={() => saveEntityNote('-', 'resl:' + c.id, c.note, v => setData(d => d ? { ...d, resolutions: { ...d.resolutions, claims: d.resolutions.claims.map(x => x.id === c.id ? { ...x, note: v } : x) } } : d))}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                    placeholder="Note…"
                                    className="flex-1 max-w-xl text-[11px] border border-line rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-amber-200"
                                  />
                                </div>
                              </div>
                            ))}
                            {orphans.map((l, i) => (
                              <div key={'o' + i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-l-2 border-l-neutral-200 bg-app/30">
                                <div className="min-w-[200px] flex-1">
                                  <div className="text-sm text-ink truncate">{l.label}</div>
                                  <div className="text-[11px] text-muted truncate">{l.ownerName}{l.resCode ? ' · ' + l.resCode : ''} · {dateShort(l.date)}</div>
                                </div>
                                <div className={'text-sm font-semibold ' + (l.amount < 0 ? 'text-rose-700' : 'text-ink')}>{fmt(l.amount)}</div>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset bg-neutral-100 text-neutral-600 ring-neutral-200" title="A resolution-looking line on a statement with no matching record on the claims board">on statement · no claim record</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {rc.length === 0 && orphans.length === 0 && (
                        <div className="rounded-2xl border border-line bg-white shadow-soft p-6 text-center text-sm text-muted">
                          No Airbnb resolutions found for {data.label}.
                        </div>
                      )}
                    </>
                  )
                })()}
              </>
            )
          })()}

          {/* ═══ WORKLIST ═══ */}
          {view === 'work' && (
            <>
              {/* filters — row 1: work state (statuses + flags) */}
              <div className="flex flex-wrap items-center gap-2">
                {(['action', 'review', 'done', 'clear'] as Status[]).map(s => (
                  <button key={s} onClick={() => setFStatus(fStatus === s ? '' : s)}
                    className={'text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset transition ' + STATUS_CLS[s] + (fStatus === s ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                    {STATUS_LABEL[s]} {s === 'review' ? t!.review : s === 'action' ? t!.action : s === 'done' ? t!.done : t!.clear}
                  </button>
                ))}
                <span className="w-px h-5 bg-line mx-1" />
                {/* The weekly lens: what moved since last week's review. */}
                <button onClick={() => setFFresh(v => !v)}
                  title="Only rows with line items posted in the last 7 days — review what changed since last week"
                  className={'text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-teal-50 text-teal-700 ring-teal-200 transition' + (fFresh ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                  <RefreshCw size={11} className="inline -mt-0.5 mr-1" />Posted this week {t!.postedThisWeek}
                </button>
                <button onClick={() => setFFlag(fFlag === 'flagged' ? '' : 'flagged')}
                  className={'text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200 transition' + (fFlag === 'flagged' ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                  <ShieldAlert size={11} className="inline -mt-0.5 mr-1" />Flagged {openFlagged}
                </button>
                {(Object.keys(FLAG_LABEL) as FlagType[]).filter(f => flagCounts[f]).map(f => (
                  <button key={f} onClick={() => setFFlag(fFlag === f ? '' : f)}
                    className={'text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset bg-white text-muted ring-line hover:text-ink transition' + (fFlag === f ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                    {FLAG_LABEL[f]} {flagCounts[f]}
                  </button>
                ))}
              </div>

              {/* filters — row 2: what the booking IS (tags + channel), plus owner + search */}
              <div className="flex flex-wrap items-center gap-2">
                {([['canceled', 'Canceled'], ['inquiry', 'Inquiry'], ['declined', 'Declined'], ['expired', 'Expired'], ['owner', 'Owner stay'], ['owner_guest', 'Owner’s guest'], ['ff', 'Friends & family']] as [typeof fTag, string][])
                  .filter(([k]) => tagCounts.t[k as string])
                  .map(([k, label]) => (
                    <button key={k} onClick={() => setFTag(fTag === k ? '' : k)}
                      className={'text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition '
                        + (k === 'owner' || k === 'owner_guest' || k === 'ff' ? 'bg-violet-50 text-violet-700 ring-violet-200' : k === 'inquiry' ? 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200' : 'bg-neutral-100 text-neutral-600 ring-neutral-300')
                        + (fTag === k ? ' outline outline-2 outline-offset-1 outline-brand-300' : '')}>
                      {label} {tagCounts.t[k as string]}
                    </button>
                  ))}
                <span className="ml-auto" />
                <select value={fSource} onChange={e => setFSource(e.target.value)}
                  className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 max-w-[170px]">
                  <option value="">All channels</option>
                  {Object.keys(tagCounts.src).sort().map(s => <option key={s} value={s}>{s} ({tagCounts.src[s]})</option>)}
                </select>
                <select value={fOwner} onChange={e => setFOwner(e.target.value)}
                  className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 max-w-[220px]">
                  <option value="">All owners</option>
                  {data.owners.map(o => <option key={o.ownerId} value={o.ownerId}>{o.ownerName}</option>)}
                </select>
                <div className="relative w-full sm:w-auto">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, unit, code…"
                    className="text-xs border border-line rounded-lg pl-7 pr-2.5 py-1.5 w-full sm:w-48 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
                </div>
                {(fStatus || fFlag || fTag || fSource || fOwner || q || fFresh) && (
                  <button onClick={() => { setFStatus(''); setFFlag(''); setFTag(''); setFSource(''); setFOwner(''); setQ(''); setFFresh(false) }}
                    className="text-[11px] font-medium text-muted hover:text-ink underline">Clear all</button>
                )}
              </div>

              {/* owner sections — collapsed to totals by default; expanding shows the flagged
                  and open rows first, with the full statement one click further */}
              {data.owners.filter(o => byOwner[o.ownerId] && byOwner[o.ownerId].length).map(o => {
                const items = byOwner[o.ownerId]
                const filterActive = !!(q.trim() || fStatus || fFlag || fOwner || fSource || fTag || fFresh)
                const isOpen = expandedOwners[o.ownerId] !== undefined ? expandedOwners[o.ownerId] : filterActive
                const off = o.dueToOwner == null ? null : Math.round((o.net - o.dueToOwner) * 100) / 100
                const s = stats[o.ownerId] || { notes: 0, comments: 0 }
                const attention = items.filter(it => it.status !== 'done' || it.flags.some(f => f.severity !== 'info') || it.note || it.comments.length > 0)
                const showAll = !!showAllRows[o.ownerId] || filterActive
                const visible = showAll ? items : attention
                // Bucket the visible rows so approving one visibly moves it down into
                // "Approved & closed" and out of the pile that still needs working.
                const buckets = SECTIONS.map(sec => ({ ...sec, rows: visible.filter(it => it.status === sec.key) }))
                  .filter(b => b.rows.length > 0)
                return (
                  <div key={o.ownerId} className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
                    <button onClick={() => setExpandedOwners(prev => ({ ...prev, [o.ownerId]: !isOpen }))}
                      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-app/60">
                      {isOpen ? <ChevronDown size={15} className="text-muted shrink-0" /> : <ChevronRight size={15} className="text-muted shrink-0" />}
                      <span className="font-semibold text-ink text-sm">{o.ownerName}</span>
                      {!o.hasStatement && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200">No statement generated</span>
                      )}
                      {o.hasStatement && (() => { const b = tieBadge(o); return (
                        <span title={b.help} className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + b.cls}>{b.text}</span>
                      ) })()}
                      {o.high > 0 && <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.high}>{o.high} high</span>}
                      {o.reviewFlags > 0 && <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ' + FLAG_CLS.review}>{o.reviewFlags} flagged</span>}
                      {o.signOff && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">
                          <ShieldCheck size={11} /> Signed off · {shortWho(o.signOff.by)}
                        </span>
                      )}
                      {s.notes > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 rounded-full">
                          <StickyNote size={10} /> {s.notes}
                        </span>
                      )}
                      {s.comments > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200 px-1.5 py-0.5 rounded-full">
                          <MessageSquare size={10} /> {s.comments}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted">
                        {o.dueToOwner != null ? 'Payout ' + fmt(o.dueToOwner) + ' · ' : ''}Net {fmt(o.net)} · {items.length} row{items.length === 1 ? '' : 's'} · {o.open ? o.open + ' to review' : 'nothing open'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-line">
                        {buckets.map(b => {
                          const secKey = o.ownerId + '::' + b.key
                          const shown = openSections[secKey] !== undefined ? openSections[secKey] : !b.collapsed
                          return (
                            <div key={b.key} className="border-b border-line last:border-b-0">
                              <button onClick={() => setOpenSections(prev => ({ ...prev, [secKey]: !shown }))}
                                className="w-full flex items-center gap-2 px-4 py-1.5 text-left bg-app/40 hover:bg-app/70">
                                {shown ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
                                <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ' + STATUS_CLS[b.key]}>{b.title}</span>
                                <span className="text-[11px] font-semibold text-ink">{b.rows.length}</span>
                                <span className="text-[10px] text-muted">{b.blurb}</span>
                              </button>
                              {shown && <div className="divide-y divide-line">{b.rows.map(it => renderItem(it))}</div>}
                            </div>
                          )
                        })}
                        {visible.length === 0 && (
                          <div className="px-4 py-3 text-xs text-muted">Nothing flagged on this statement.</div>
                        )}
                        {!filterActive && attention.length < items.length && (
                          <button onClick={() => setShowAllRows(prev => ({ ...prev, [o.ownerId]: !showAllRows[o.ownerId] }))}
                            className="w-full px-4 py-2 text-left text-[11px] font-medium text-brand-700 hover:bg-app/60">
                            {showAllRows[o.ownerId]
                              ? 'Show issues only (' + attention.length + ')'
                              : 'Show all ' + items.length + ' rows (' + (items.length - attention.length) + ' with nothing flagged)'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {filtered.length === 0 && (
                <div className="rounded-2xl border border-line bg-white shadow-soft p-8 text-center text-sm text-muted">
                  Nothing matches these filters{data.items.length === 0 ? ' — no statement line items found for ' + data.label : ''}.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
