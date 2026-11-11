'use client'
// Owner Reports desk: list of generated reports + the New-report flow
// (pick an owner / units / a building, a period → see what the report will carry → generate →
// open the share page). Each row answers three things at a glance: what it is, whether it has
// gone to the owner, and whether they opened it — and shares the owner link in one tap.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, ExternalLink, Sparkles, Paperclip, Image as ImageIcon, X, Share2, Check, Send, Search, RefreshCw, Building2, BookOpen } from 'lucide-react'
import { AUDIENCES, type Audience } from '@/lib/sales-audience'
import { LibraryCompPicker } from '@/components/LibraryCompPicker'
import { SalesCmaEditor } from '@/components/SalesCmaEditor'
import { LeanHead, Pill, Tag, LeanTabs, LeanList, LeanRow, LeanEmpty, IconBtn, Tip } from '@/components/lean'

type StatementPick = {
  id: string; ownerId: string; ownerName: string; month: string; label: string
  periodStart: string; periodEnd: string; dueToOwner: number
  net: number | null; paid: number | null
}

type ReportRow = {
  id: string; code: string; title: string; scope_label: string | null
  period_start: string; period_end: string; as_of: string; theme: string; status: string
  created_at: string; updated_at: string
  created_by?: string | null
  /** Share-link sessions by people who are NOT signed in — i.e. the owner, not the team. */
  views?: number; last_viewed?: string | null
}

type DocKind = 'review' | 'projection' | 'onboarding' | 'sales'

// ---------- dates, said the way a person says them ----------
// The list used to print raw ISO pairs ("2026-10-01 – 2026-10-31"); every date on this page now
// goes through these so a period reads "Oct 1 – 31, 2026" everywhere.
const pad2 = (n: number) => String(n).padStart(2, '0')
/** A LOCAL calendar day as YYYY-MM-DD (toISOString would hand back the UTC day after 8pm ET). */
const isoOf = (d: Date) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
const isIso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string, withYear = true): string {
  const v = String(iso || '').slice(0, 10)
  if (!isIso(v)) return v || '—'
  const m = MON[Number(v.slice(5, 7)) - 1] || ''
  return m + ' ' + Number(v.slice(8, 10)) + (withYear ? ', ' + v.slice(0, 4) : '')
}
function fmtRange(a: string, b: string): string {
  const x = String(a || '').slice(0, 10), y = String(b || '').slice(0, 10)
  if (!isIso(x) || !isIso(y)) return fmtDay(x) + ' – ' + fmtDay(y)
  if (x === y) return fmtDay(x)
  if (x.slice(0, 7) === y.slice(0, 7)) return fmtDay(x, false) + ' – ' + Number(y.slice(8, 10)) + ', ' + y.slice(0, 4)
  if (x.slice(0, 4) === y.slice(0, 4)) return fmtDay(x, false) + ' – ' + fmtDay(y)
  return fmtDay(x) + ' – ' + fmtDay(y)
}
/** Whole days from one ISO day to another (b − a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}
/** "today", "yesterday", "3 days ago", then the date — for when an owner last opened a link. */
function ago(ts: string | null | undefined, today: string): string {
  if (!ts) return ''
  const d = new Date(String(ts))
  if (Number.isNaN(d.getTime())) return ''
  const day = isoOf(d)
  const n = dayDiff(day, today)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 7) return n + ' days ago'
  return fmtDay(day, day.slice(0, 4) !== today.slice(0, 4))
}

// One-tap periods. A review is nearly always one of these four windows; typing two dates by
// hand was the slowest part of making one.
type Preset = { id: string; label: string; hint: string; range: () => { start: string; end: string } }
const PRESETS: Preset[] = [
  { id: 'this', label: 'This month', hint: 'The month in progress — numbers are on-the-books and will keep moving.', range: () => {
    const n = new Date(); return { start: isoOf(new Date(n.getFullYear(), n.getMonth(), 1)), end: isoOf(new Date(n.getFullYear(), n.getMonth() + 1, 0)) } } },
  { id: 'last', label: 'Last month', hint: 'The last closed month — final numbers, and the one a statement exists for.', range: () => {
    const n = new Date(); return { start: isoOf(new Date(n.getFullYear(), n.getMonth() - 1, 1)), end: isoOf(new Date(n.getFullYear(), n.getMonth(), 0)) } } },
  { id: 'qtd', label: 'This quarter', hint: 'The calendar quarter in progress.', range: () => {
    const n = new Date(); const q = Math.floor(n.getMonth() / 3) * 3
    return { start: isoOf(new Date(n.getFullYear(), q, 1)), end: isoOf(new Date(n.getFullYear(), q + 3, 0)) } } },
  { id: 'ytd', label: 'Year to date', hint: 'January 1 through today.', range: () => {
    const n = new Date(); return { start: n.getFullYear() + '-01-01', end: isoOf(n) } } },
]
// Which kind a stored row is. The kind lives in the title at generation ("… — Owner Onboarding
// — Sep 16, 2026"), so rows generated before onboarding existed still classify correctly.
function kindOfRow(r: { title?: string | null }): DocKind {
  const t = String(r.title || '')
  return /onboarding/i.test(t) ? 'onboarding' : /proposal/i.test(t) ? 'sales' : /projection/i.test(t) ? 'projection' : 'review'
}
/** Scope labels compare as sets: "17WEST + 906" is the same scope as "906 + 17WEST". */
const labelKey = (v: string | null | undefined) => String(v || '').split('+').map(x => x.trim().toLowerCase()).filter(Boolean).sort().join('+')

// Figures on statement rows are exact dollars from the recognised ledger; round for display
// only, never for anything that is sent to the generator.
const usd0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// How the statement picker fills itself in. Jon's ask, verbatim: "I should be able to select
// one owner statement for review. I should be able to select all of them if I want to."
//   period — statements whose month sits inside the report window (the old default)
//   one    — exactly one statement, review-a-single-owner-month
//   all    — every synced statement in scope, bulk
// Rows stay clickable in every mode, so hand-picking still works; the counter is always the
// truth about what will be pulled.
type StmtMode = 'period' | 'one' | 'all'

const STMT_MODES: Array<{ id: StmtMode; label: string; hint: string }> = [
  { id: 'one', label: 'One statement', hint: 'Review a single owner statement in detail.' },
  { id: 'period', label: 'In this period', hint: 'Statements whose month falls inside the report window.' },
  { id: 'all', label: 'All statements', hint: 'Every synced statement for these owners — the full history.' },
]

/** Which statement ids a mode selects. Never picks an unsynced month: the generator refuses those. */
function idsForMode(mode: StmtMode, list: StatementPick[], from: string, to: string): string[] {
  const synced = list.filter(s => s.net != null)
  if (mode === 'all') return synced.map(s => s.id)
  const inWindow = synced.filter(s => s.month >= from && s.month <= to)
  if (mode === 'one') {
    // Newest statement inside the window, falling back to the newest synced one overall so
    // "one statement" never lands on an empty selection.
    const pool = inWindow.length ? inWindow : synced
    const best = pool.slice().sort((a, b) => b.month.localeCompare(a.month))[0]
    return best ? [best.id] : []
  }
  return inWindow.map(s => s.id)
}

function monthDefaults(): { start: string; end: string } {
  return PRESETS[0].range()
}

// scope 'sales' (Jon, 2026-11-11: "create a sales tab… separate, and those builds should live there")
// is this same desk on /sales showing only sales decks; Owner Reports no longer lists or makes them.
export function ReportsDesk({ scope = 'owners' }: { scope?: 'owners' | 'sales' } = {}) {
  const salesOnly = scope === 'sales'
  const [reports, setReports] = useState<ReportRow[]>([])
  const [buildings, setBuildings] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  // SCOPE BY OWNER, NOT BUILDING (Jon, 2026-09-16: "owner reports need to be by owner, not
  // building"). An owner can hold units across several buildings, or a handful inside one — so
  // a building-scoped report showed them their neighbours' numbers next to their own, and titled
  // the cover after a building instead of after them. Owner is now the default; building stays
  // for the cases where the report really is about a whole property.
  // Three ways to say who a document is about. UNIT matters most for onboarding (Jon,
  // 2026-09-16: "also have create by unit, multiple select") — a new owner usually arrives with
  // one unit, not a building and not a portfolio, and picking their building would put their
  // neighbours' units in their welcome deck.
  const [scopeMode, setScopeMode] = useState<'owner' | 'building' | 'unit'>('owner')
  const [units, setUnits] = useState<{ id: string; name: string; building: string }[]>([])
  const [pickedUnits, setPickedUnits] = useState<string[]>([])
  const [unitQ, setUnitQ] = useState('')
  const [owners, setOwners] = useState<{ id: string; name: string; units: number; listingIds: string[] }[]>([])
  const [pickedOwners, setPickedOwners] = useState<string[]>([])
  const [ownerQ, setOwnerQ] = useState('')
  const defaults = monthDefaults()
  // 'review' = the full performance review; 'projection' = the next-season projection report
  // built from Money → Projections (Jon, 2026-08-22). Projection needs no period — the season
  // IS the period — and skips the AI pass, so it generates in a few seconds.
  // 'onboarding' = the welcome presentation for a NEW owner (Jon, 2026-09-16). Also periodless —
  // the unit has no history yet, which is why we are having the call.
  const [kind, setKind] = useState<DocKind>(scope === 'sales' ? 'sales' : 'review')
  // The building pages a new sales deck starts with (lib/sales-cma): none, The Rider example, or empty.
  // '' none · 'blank' · 'rider' · 'lib:<id>' a copy of a building in the projections library (lib/sales-library).
  const [cmaPick, setCmaPick] = useState<string>('')
  const [libBuildings, setLibBuildings] = useState<{ id: string; name: string; area: string; plans: number }[]>([])
  // Who the deck is for (lib/sales-audience): one owner, buyers and agents, or a building's sales team.
  const [audience, setAudience] = useState<Audience>('owner')
  // The unit types of the chosen library building, and which of them go in the deck (all by default).
  const [libPlans, setLibPlans] = useState<{ id: string; name: string; sf: string }[]>([])
  const [planPick, setPlanPick] = useState<string[]>([])
  // Comparables picked from the library or typed in, added to the deck's comparable set (lib/sales-comps).
  const [extraComps, setExtraComps] = useState<any[]>([])
  const [compsOpen, setCompsOpen] = useState(false)
  useEffect(() => {
    if (!cmaPick.startsWith('lib:')) { setLibPlans([]); setPlanPick([]); return }
    let live = true
    fetch('/api/sales/buildings?id=' + encodeURIComponent(cmaPick.slice(4)), { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!live) return
      const ps = ((d?.building?.cma?.plans) || []).map((p: any) => ({ id: String(p.id), name: String(p.name || ''), sf: String(p.sf || '') }))
      setLibPlans(ps); setPlanPick(ps.map((p: any) => p.id))
    }).catch(() => {})
    return () => { live = false }
  }, [cmaPick])
  useEffect(() => {
    if (!salesOnly) return
    fetch('/api/sales/buildings', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.ok) setLibBuildings(d.buildings) }).catch(() => {})
    // "New deck" on a library building (components/SalesLibrary) lands here.
    const on = (e: Event) => { const d = (e as CustomEvent).detail || {}; if (d.id) { setCmaPick('lib:' + d.id); setIntake(p => ({ ...p, building: p.building || d.name || '' })); if (audience === 'owner') setAudience('building') } }
    window.addEventListener('sales:start-from', on)
    // From the Projections library page: /sales?from=<building id>.
    try {
      const from = new URLSearchParams(window.location.search).get('from')
      if (from) { setShowNew(true); setKind('sales'); setCmaPick('lib:' + from); setAudience('building'); fetch('/api/sales/buildings?id=' + encodeURIComponent(from)).then(r => r.json()).then(d => { if (d?.building?.name) setIntake(p => ({ ...p, building: p.building || d.building.name })) }).catch(() => {}) }
    } catch { /* no query string */ }
    return () => window.removeEventListener('sales:start-from', on)
  }, [salesOnly])
  const [cmaFor, setCmaFor] = useState<ReportRow | null>(null)
  const [ownerName, setOwnerName] = useState('')
  /** Who is presenting the sales deck. Seeds the contact card; the photo is added on the slide. */
  const [presenter, setPresenter] = useState('')
  /** Short is the deck you send to earn a meeting; Full is the one you present at it. */
  const [deckLength, setDeckLength] = useState<'short' | 'full'>('short')
  // WHAT THE DECK ASKS BEFORE IT BUILDS (Jon, 2026-10-27: "when you're generating the sales deck,
  // it should ask you some basic questions, maybe property address, building name, number of
  // units, bed type — whatever you think you need to ask in order to generate a really robust
  // deck"). These are the fields the revenue one-pager we already send is built from: the unit and
  // building name it with, the bedroom count picks the comparable set the market slide is measured
  // against, and the rest fill the property slide.
  const [intake, setIntake] = useState<Record<string, string>>({})
  const iv = (k: string) => intake[k] || ''
  const setIv = (k: string, v: string) => setIntake(p => ({ ...p, [k]: v }))
  const [goLive, setGoLive] = useState('')
  // The list below mixes three document types once you have a few of each; this filters it.
  const [listKind, setListKind] = useState<'all' | DocKind>('all')
  const [listQ, setListQ] = useState('')
  /** Why the list is empty when it is not really empty — a failed load used to read "No reports yet". */
  const [listErr, setListErr] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [busyId, setBusyId] = useState('')
  /** A report that was created but needs a word said about it before it is opened. */
  const [made, setMade] = useState<{ code: string; note: string } | null>(null)
  const today = isoOf(new Date())
  const [periodStart, setPeriodStart] = useState(defaults.start)
  const [periodEnd, setPeriodEnd] = useState(defaults.end)
  const [showNew, setShowNew] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [pacing, setPacing] = useState<{ name: string; url: string } | null>(null)
  const [heroImg, setHeroImg] = useState<{ name: string; url: string } | null>(null)
  const [uploading, setUploading] = useState<string>('')
  // Real Guesty owner statements for the picked properties. Statements are SELECTED, never
  // uploaded — the figures come from the recognised owner-ledger mirror.
  const [stmtList, setStmtList] = useState<StatementPick[]>([])
  const [stmtPicked, setStmtPicked] = useState<string[]>([])
  const [stmtLoading, setStmtLoading] = useState(false)
  const [stmtMode, setStmtMode] = useState<StmtMode>('period')
  // The fetch effect must read the CURRENT mode without re-running when the mode changes —
  // switching between one and all is a pure re-pick over the list already in hand, and
  // refetching would re-aggregate the whole ledger for nothing.
  const stmtModeRef = useRef<StmtMode>('period')
  const pacingRef = useRef<HTMLInputElement>(null)
  const heroRef = useRef<HTMLInputElement>(null)

  async function uploadOne(file: File): Promise<{ name: string; url: string } | null> {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d?.ok && d?.url) return { name: file.name, url: d.url }
      setMsg(d?.error || 'Upload failed')
    } catch { setMsg('Upload failed') }
    return null
  }
  async function onPacingPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setUploading('pacing')
    const up = await uploadOne(f)
    if (up) setPacing(up)
    setUploading('')
    e.target.value = ''
  }
  // In one-statement mode a row click REPLACES the selection, so the list behaves like radio
  // buttons and you can never accidentally end up reviewing two owner-months as if they were one.
  function toggleStatement(id: string) {
    if (stmtMode === 'one') { setStmtPicked([id]); return }
    setStmtPicked(prev => prev.indexOf(id) >= 0 ? prev.filter(x => x !== id) : [...prev, id])
  }
  function pickMode(m: StmtMode) {
    stmtModeRef.current = m
    setStmtMode(m)
    setStmtPicked(idsForMode(m, stmtList, periodStart.slice(0, 7), periodEnd.slice(0, 7)))
  }
  async function onHeroPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setUploading('hero')
    const up = await uploadOne(f)
    if (up) setHeroImg(up)
    setUploading('')
    e.target.value = ''
  }

  function loadReports() {
    fetch('/api/reports').then(async r => {
      const d = await r.json().catch(() => null)
      if (r.ok && Array.isArray(d?.reports)) { setReports(d.reports); setListErr('') }
      else setListErr(r.status === 401 ? 'You are signed out — sign in again to see the reports.' : (d?.error || 'The report list did not load (' + r.status + ').'))
      setLoading(false)
    }).catch(() => { setListErr('The report list did not load — check the connection and retry.'); setLoading(false) })
  }
  useEffect(() => {
    loadReports()
    fetch('/api/reports/budgets?buildings=1').then(r => r.json()).then(d => {
      if (Array.isArray(d?.buildings)) setBuildings(d.buildings)
    }).catch(() => {})
    fetch('/api/reports/budgets?owners=1').then(r => r.json()).then(d => {
      if (Array.isArray(d?.owners)) setOwners(d.owners)
    }).catch(() => {})
    fetch('/api/listings?slim=1').then(r => r.json()).then(d => {
      const rows: any[] = Array.isArray(d?.results) ? d.results : []
      setUnits(rows
        .filter(l => ['inactive', 'disabled', 'archived', 'deleted'].indexOf(String(l.status || '').toLowerCase()) < 0)
        .map(l => ({ id: String(l.id), name: String(l.nickname || l.title || l.id), building: String(l.building || '') }))
        .sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => {})
  }, [])

  // Statements follow the property selection. Anything whose period sits inside the report
  // window is preselected, since that is nearly always what the report is about. Statements
  // whose month hasn't been swept into the ledger mirror can't be picked — the generator
  // refuses them rather than report a silently empty ledger.
  // One scope, whichever way it was picked. Everything downstream — statements, the generator —
  // already speaks listingIds, so owner mode just resolves to the union of their live units.
  const ownerRows = owners.filter(o => pickedOwners.indexOf(o.id) >= 0)
  const ownerListingIds = Array.from(new Set(ownerRows.flatMap(o => o.listingIds)))
  const ownerLabel = ownerRows.map(o => o.name).join(' + ')
  // PICKING AN OWNER SELECTS THEIR PROPERTIES (Jon, 2026-09-16: "when I pick my owner, it should
  // select their properties"). Their units come on as a set you can see and then trim — an owner
  // with eight units often wants a document about three of them.
  const ownerKey = pickedOwners.join(',')
  useEffect(() => {
    if (scopeMode !== 'owner') return
    const ids = Array.from(new Set(owners.filter(o => pickedOwners.indexOf(o.id) >= 0).flatMap(o => o.listingIds)))
    setPickedUnits(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, scopeMode, owners.length])

  const unitRows = units.filter(u => pickedUnits.indexOf(u.id) >= 0)
  // Two units read better as their names; a dozen read better as a count.
  const unitLabel = unitRows.length <= 2
    ? unitRows.map(u => u.name).join(' + ')
    : unitRows.length + ' units'
  const scopeIds = scopeMode === 'owner'
    ? (pickedUnits.length ? pickedUnits : ownerListingIds)
    : scopeMode === 'unit' ? pickedUnits : []
  const scopeLabel = scopeMode === 'owner' ? ownerLabel : scopeMode === 'unit' ? unitLabel : ''
  const byIds = scopeMode === 'owner' || scopeMode === 'unit'
  // A sales deck is the one document that does not need a property (see the generator).
  const scopeReady = kind === 'sales' ? true : (byIds ? scopeIds.length > 0 : picked.length > 0)
  const pickedKey = byIds ? scopeIds.join(',') : picked.join(',')
  // FETCH ON SCOPE, RE-PICK ON PERIOD (2026-11-09). This was one effect keyed on scope AND both
  // dates, so every keystroke in a date box re-aggregated the whole owner ledger. The list only
  // depends on who the report is for; which rows are ticked depends on the period. Statements are
  // also a review-only section, so the other three document types no longer fetch them at all.
  const wantStatements = kind === 'review' && !!pickedKey
  useEffect(() => {
    if (!wantStatements) { setStmtList([]); setStmtPicked([]); setStmtLoading(false); return }
    let cancelled = false
    setStmtLoading(true)
    // Drop the previous owner's statements the moment the scope changes, so a fast Generate can
    // never carry another owner's statement ids while the new list is still loading.
    setStmtList([])
    fetch('/api/reports/statements?' + (byIds ? 'listingIds=' : 'buildings=') + encodeURIComponent(pickedKey))
      .then(r => r.json())
      .then(d => { if (!cancelled) setStmtList(Array.isArray(d?.statements) ? d.statements : []) })
      .catch(() => { if (!cancelled) setStmtList([]) })
      .then(() => { if (!cancelled) setStmtLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, wantStatements])
  useEffect(() => {
    const from = periodStart.slice(0, 7)
    const to = periodEnd.slice(0, 7)
    let mode = stmtModeRef.current
    let ids = idsForMode(mode, stmtList, from, to)
    // The period defaults to the month we are IN, and a statement for the current month
    // does not exist yet — so "in this period" would open on an empty selection and look
    // broken. Drop to the most recent statement instead, and say so by moving the mode.
    if (!ids.length && mode === 'period' && stmtList.some(s => s.net != null)) {
      mode = 'one'
      ids = idsForMode(mode, stmtList, from, to)
      stmtModeRef.current = mode
      setStmtMode(mode)
    }
    setStmtPicked(ids)
  }, [stmtList, periodStart, periodEnd])

  function toggleBuilding(b: string) {
    setPicked(prev => prev.indexOf(b) >= 0 ? prev.filter(x => x !== b) : [...prev, b])
  }

  // ---------- ready or not ----------
  // What this report will and will not contain, said BEFORE the thirty-second generate rather
  // than discovered on the finished page. Everything here is read from data already on screen.
  const periodOk = isIso(periodStart) && isIso(periodEnd) && periodStart <= periodEnd
  const periodOpen = periodOk && periodEnd >= today
  const daysLeft = periodOpen ? Math.max(0, dayDiff(today, periodEnd)) : 0
  const periodFuture = periodOk && periodStart > today
  const syncedStmts = stmtList.filter(s => s.net != null)
  const unsyncedInWindow = stmtList.filter(s => s.net == null && s.month >= periodStart.slice(0, 7) && s.month <= periodEnd.slice(0, 7))
  const targetLabel = byIds ? scopeLabel : picked.join(' + ')
  // THE SAME REPORT, ALREADY MADE. Generating a second review for the same owner and window mints
  // a second share link — and the owner may be holding the first. Offer the one that exists.
  const existing = kind === 'review' && periodOk && targetLabel
    ? reports.find(r => kindOfRow(r) === 'review' && String(r.period_start).slice(0, 10) === periodStart
        && String(r.period_end).slice(0, 10) === periodEnd && labelKey(r.scope_label) === labelKey(targetLabel)) || null
    : null
  const canGenerate = scopeReady && (kind !== 'review' || periodOk)

  async function generate() {
    if (!scopeReady) {
      setMsg(scopeMode === 'owner' ? 'Pick an owner.' : scopeMode === 'unit' ? 'Pick at least one unit.' : 'Pick at least one property.')
      return
    }
    if (kind === 'review' && !periodOk) { setMsg('The period needs a start date on or before its end date.'); return }
    setGenerating(true)
    setMade(null)
    setMsg(kind === 'projection' ? 'Building the projection report… (~5s)'
      : kind === 'sales' ? 'Building the sales deck… (~10s)'
      : kind === 'onboarding' ? 'Building the onboarding presentation… (~10s)'
      : 'Pulling data + writing the report… (~20s)')
    try {
      const r = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          ...(byIds
            ? { listingIds: scopeIds, scopeLabel }
            : { buildings: picked }),
          periodStart, periodEnd,
          ownerName: ownerName || undefined,
          goLive: goLive || undefined,
          contact: kind === 'sales' && presenter ? { name: presenter } : undefined,
          length: kind === 'sales' ? deckLength : undefined,
          intake: kind === 'sales' ? intake : undefined,
          market: kind === 'sales' ? (intake.market || undefined) : undefined,
          cma: kind === 'sales' && cmaPick ? cmaPick : undefined,
          audience: kind === 'sales' ? audience : undefined,
          extraComps: kind === 'sales' && cmaPick && extraComps.length ? extraComps : undefined,
          planIds: kind === 'sales' && cmaPick.startsWith('lib:') && planPick.length && planPick.length < libPlans.length ? planPick : undefined,
          // Review-only attachments. The statement picker is not on screen for the other three
          // document types, so nothing it holds may ride along with them.
          pacingUrl: kind === 'review' && pacing ? pacing.url : undefined,
          statementIds: kind === 'review' && stmtPicked.length ? stmtPicked : undefined,
          heroImageUrl: heroImg ? heroImg.url : undefined,
        }),
      })
      // A timeout or a gateway error comes back as HTML, not JSON. That used to throw into the
      // catch below and read "Generate failed" — while the report had often been created anyway.
      const d = await r.json().catch(() => null)
      if (d?.ok && d?.code) {
        // The writing pass can fail on its own (no key, model error) and the report still builds,
        // on plain default headlines with no guest themes. Say so instead of opening it silently.
        if (kind === 'review' && d.aiUsed === false) {
          setMade({ code: String(d.code), note: 'Report created, but the AI writing pass did not run — headlines are plain defaults and the guest themes are empty. Open it and use Ask AI on those slides, or generate again.' })
          setMsg('')
          setGenerating(false)
          loadReports()
          return
        }
        window.location.href = '/r/' + d.code
        return
      }
      if (!d) {
        setMsg(r.status === 504 || r.status === 502 || r.status === 408
          ? 'That took too long to answer. The report may still have been created — the list below has been refreshed; check it before generating again.'
          : 'Generate failed (' + r.status + '). Nothing was created.')
        loadReports()
      } else setMsg(d?.message || d?.error || 'Generate failed')
    } catch { setMsg('Generate failed — no connection. Nothing was created.') }
    setGenerating(false)
  }

  async function remove(r: ReportRow) {
    const opened = r.views ? ' An owner has opened this link ' + r.views + ' time' + (r.views === 1 ? '' : 's') + '.' : ''
    if (!window.confirm('Delete "' + r.title + '"? The share link will stop working.' + opened)) return
    setBusyId(r.id)
    try {
      const res = await fetch('/api/reports?id=' + encodeURIComponent(r.id), { method: 'DELETE' })
      const d = await res.json().catch(() => null)
      // A refused delete (view-only access, signed out) used to look exactly like a successful one
      // until the row was still there after the reload.
      if (!res.ok || !d?.ok) setListErr(d?.message || d?.error || 'Could not delete that report (' + res.status + ').')
      else setListErr('')
    } catch { setListErr('Could not delete that report — no connection.') }
    setBusyId('')
    loadReports()
  }

  // SHARE IN ONE TAP. On a phone this opens the system share sheet (Messages, Mail, WhatsApp);
  // on a desktop it copies the owner link. Either way the row confirms it for a moment.
  async function share(r: ReportRow) {
    const url = window.location.origin + '/r/' + r.code
    const flash = () => { setCopiedId(r.id); window.setTimeout(() => setCopiedId(c => (c === r.id ? '' : c)), 1800) }
    const nav: any = navigator
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    if (phone && typeof nav.share === 'function') {
      try { await nav.share({ title: r.title, url }); flash(); return } catch (e: any) {
        if (e && e.name === 'AbortError') return // they closed the sheet; nothing to report
      }
    }
    try { await nav.clipboard.writeText(url); flash() } catch {
      // Clipboard blocked (http, permissions): hand them the link to copy by hand.
      window.prompt('Copy the owner link:', url)
    }
  }

  // Draft ↔ Sent. Every row has said "draft" since the table was created because nothing ever
  // wrote the column; now it records whether the link has gone to the owner.
  async function setStatus(r: ReportRow, status: 'draft' | 'sent') {
    setBusyId(r.id)
    try {
      const res = await fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, status }) })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) setListErr(d?.message || d?.error || 'Could not update that report (' + res.status + ').')
      else { setListErr(''); setReports(prev => prev.map(x => x.id === r.id ? { ...x, status } : x)) }
    } catch { setListErr('Could not update that report — no connection.') }
    setBusyId('')
  }

  const q = listQ.trim().toLowerCase()
  const shownReports = reports
    .filter(r => salesOnly ? kindOfRow(r) === 'sales' : kindOfRow(r) !== 'sales')
    .filter(r => listKind === 'all' || kindOfRow(r) === listKind)
    .filter(r => !q || (String(r.title || '') + ' ' + String(r.scope_label || '')).toLowerCase().indexOf(q) >= 0)

  const nKind = (k: DocKind) => reports.filter(r => kindOfRow(r) === k).length
  const shownCount = reports.filter(r => salesOnly ? kindOfRow(r) === 'sales' : kindOfRow(r) !== 'sales').length
  const nSent = reports.filter(r => String(r.status) === 'sent').length
  const nUnopened = reports.filter(r => String(r.status) === 'sent' && !r.views).length
  const KIND_TAG: Record<DocKind, { l: string; t: 'brand' | 'violet' | 'emerald' | 'amber' }> = {
    review: { l: 'Review', t: 'brand' }, projection: { l: 'Projection', t: 'violet' }, onboarding: { l: 'Onboarding', t: 'emerald' },
    sales: { l: 'Proposal', t: 'amber' },
  }
  // Hover text for the three document types — the explainer paragraphs that used to sit under the toggle.
  const KIND_HELP: Record<DocKind, string> = {
    review: 'Performance review for a period: revenue, occupancy, reviews and completed work pulled automatically.',
    projection: 'Next season’s net owner revenue per unit, with property health and ADR-upside recommendations. Edit any wording in place after generating.',
    onboarding: 'The kickoff call as a document: listing reviewed on every channel, strategy, ramp, team, billables and a worked statement. Answers save live on the call; the boilerplate is the house template.',
    sales: 'A management proposal for someone who has not signed: who we are, how operations works, marketing, distribution, revenue, the technology, onboarding and what happens next. Pick a building to fill it with that building\u2019s photographs, or generate it on a name alone. Share link, PDF and PowerPoint, and every word editable.',
  }

  return (
    <div className="space-y-4">
      <LeanHead title={salesOnly ? 'Sales decks' : 'Owner Reports'}>
        <Pill title={salesOnly ? 'Sales decks made so far' : 'Owner documents generated so far'}>{shownCount} {salesOnly ? 'deck' : 'report'}{shownCount === 1 ? '' : 's'}</Pill>
        {nSent > 0 && <Pill tone="brand" title="Marked as sent to the owner">{nSent} sent</Pill>}
        {nUnopened > 0 && <Pill tone="amber" title="Sent, but the owner link has not been opened yet">{nUnopened} not opened</Pill>}
        {!showNew && (
          <button onClick={() => { setShowNew(true); setMade(null) }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-3 py-1.5 hover:bg-brand-700">
            <Plus size={14} /> {salesOnly ? 'New sales deck' : 'New report'}
          </button>
        )}
        {salesOnly && !showNew && (
          <button title="A deck for The Rider Residences sales team: every floor plan, the comps, the partner program and Stay as a second option, as a magazine and as keynote slides"
            onClick={() => { setShowNew(true); setMade(null); setKind('sales'); setCmaPick('lib:rider'); setAudience('building'); setOwnerName('The Rider sales team'); setIv('building', 'The Rider Residences'); setIv('address', 'Wynwood, Miami'); if (!presenter) setPresenter('Nick Carline') }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white text-ink text-[12.5px] font-semibold px-3 py-1.5 hover:bg-app">
            <Sparkles size={14} /> The Rider example
          </button>
        )}
      </LeanHead>
      {made && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap">
          <p className="text-[13px] text-amber-900 flex-1 min-w-[14rem]">{made.note}</p>
          <a href={'/r/' + made.code} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-1.5">Open the report</a>
          <IconBtn title="Dismiss" onClick={() => setMade(null)}><X size={14} /></IconBtn>
        </div>
      )}
      {/* New report — only on screen while it is being built */}
      {showNew && (
      <section className="rounded-2xl border border-line bg-white p-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[13.5px] font-bold text-ink flex items-center gap-1.5 mr-1"><Sparkles size={14} className="text-brand-600" /> New report</h2>
              {!salesOnly && <div className="flex items-center rounded-lg border border-line bg-neutral-50 overflow-x-auto max-w-full w-fit whitespace-nowrap">
                <button onClick={() => setKind('review')} title={KIND_HELP.review}
                  className={'px-3 py-1 text-[12px] font-semibold ' + (kind === 'review' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Owner review
                </button>
                <button onClick={() => setKind('projection')} title={KIND_HELP.projection}
                  className={'px-3 py-1 text-[12px] font-semibold ' + (kind === 'projection' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Season projection
                </button>
                <button onClick={() => setKind('onboarding')} title={KIND_HELP.onboarding}
                  className={'px-3 py-1 text-[12px] font-semibold ' + (kind === 'onboarding' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  Owner onboarding
                </button>
              </div>}
              {/* THE PROJECTION BUILDER LIVES HERE (Jon, 2026-08-25): projections are built for an
                  owner from this toggle; the model editor is one link off it (own page, API, gate). */}
              {kind === 'projection' && (
                <a href="/projections"
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-lg border border-line bg-white hover:border-ink/30 text-ink"
                  title="Every month, unit and lever behind these numbers — occupancy, ADR, length of stay, management and building splits">
                  Adjust the model &rarr;
                </a>
              )}
              <span className="ml-auto"><IconBtn title="Close without generating" onClick={() => { setShowNew(false); setMsg('') }}><X size={14} /></IconBtn></span>
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">For</p>
                <span className="inline-flex items-center rounded-lg border border-line bg-neutral-50 overflow-hidden">
                  <button onClick={() => setScopeMode('owner')}
                    className={'px-3 py-1 text-[12px] font-semibold ' + (scopeMode === 'owner' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                    An owner
                  </button>
                  <button onClick={() => setScopeMode('unit')}
                    className={'px-3 py-1 text-[12px] font-semibold ' + (scopeMode === 'unit' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                    Specific units
                  </button>
                  <button onClick={() => setScopeMode('building')}
                    className={'px-3 py-1 text-[12px] font-semibold ' + (scopeMode === 'building' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                    A building
                  </button>
                </span>
              </div>

              {scopeMode === 'owner' ? (
                <div>
                  <input
                    value={ownerQ} onChange={e => setOwnerQ(e.target.value)}
                    placeholder={owners.length ? 'Search ' + owners.length + ' owners…' : 'Loading owners…'}
                    className="mb-2 w-full max-w-sm rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                  />
                  <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
                    {owners
                      .filter(o => !ownerQ.trim() || o.name.toLowerCase().indexOf(ownerQ.trim().toLowerCase()) >= 0)
                      .slice(0, 80)
                      .map(o => {
                        const on = pickedOwners.indexOf(o.id) >= 0
                        return (
                          <button key={o.id}
                            onClick={() => setPickedOwners(p => on ? p.filter(x => x !== o.id) : [...p, o.id])}
                            className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                            {o.name} <span className={on ? 'opacity-70' : 'text-muted'}>· {o.units}</span>
                          </button>
                        )
                      })}
                    {!owners.length && <span className="text-sm text-muted italic">Loading owners…</span>}
                  </div>
                  {ownerRows.length > 0 && (
                    <div className="mt-3 rounded-xl border border-line bg-app/40 p-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                          Their properties · {scopeIds.length} of {ownerListingIds.length} selected
                        </p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setPickedUnits(ownerListingIds)} className="text-[12px] font-semibold text-muted hover:text-ink">Select all</button>
                          <button onClick={() => setPickedUnits([])} className="text-[12px] font-semibold text-muted hover:text-ink">Clear</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
                        {ownerListingIds.map(id => {
                          const u = units.find(x => x.id === id)
                          const on = pickedUnits.indexOf(id) >= 0
                          return (
                            <button key={id}
                              onClick={() => setPickedUnits(p => on ? p.filter(x => x !== id) : [...p, id])}
                              className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:border-brand-300')}>
                              {u ? u.name : id}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-[12px] text-muted" title="The document is titled for them and covers the units ticked above">
                        For <b className="text-ink">{ownerLabel}</b>
                      </p>
                    </div>
                  )}
                </div>
              ) : scopeMode === 'unit' ? (
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <input
                      value={unitQ} onChange={e => setUnitQ(e.target.value)}
                      placeholder={units.length ? 'Search ' + units.length + ' units…' : 'Loading units…'}
                      className="w-full max-w-sm rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
                    />
                    {pickedUnits.length > 0 && (
                      <button onClick={() => setPickedUnits([])} className="text-[12px] font-semibold text-muted hover:text-ink">Clear {pickedUnits.length}</button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
                    {units
                      .filter(u => {
                        const q = unitQ.trim().toLowerCase()
                        return !q || u.name.toLowerCase().indexOf(q) >= 0 || u.building.toLowerCase().indexOf(q) >= 0
                      })
                      .slice(0, 120)
                      .map(u => {
                        const on = pickedUnits.indexOf(u.id) >= 0
                        return (
                          <button key={u.id}
                            onClick={() => setPickedUnits(p => on ? p.filter(x => x !== u.id) : [...p, u.id])}
                            className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                            {u.name}
                          </button>
                        )
                      })}
                    {!units.length && <span className="text-sm text-muted italic">Loading units…</span>}
                  </div>
                  {unitRows.length > 0 && (
                    <p className="mt-2 text-[12px] text-muted" title="The document covers these units and nothing else">
                      For <b className="text-ink">{unitLabel}</b>
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {buildings.map(b => {
                    const on = picked.indexOf(b) >= 0
                    return (
                      <button key={b} onClick={() => toggleBuilding(b)}
                        className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                        {b}
                      </button>
                    )
                  })}
                  {!buildings.length && <span className="text-sm text-muted italic">Loading properties…</span>}
                </div>
              )}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              {kind === 'review' ? (
                <>
                  <div className="w-full">
                    <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Period</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {PRESETS.map(pz => {
                        const rg = pz.range()
                        const on = rg.start === periodStart && rg.end === periodEnd
                        return (
                          <button key={pz.id} type="button" title={pz.hint} aria-pressed={on}
                            onClick={() => { setPeriodStart(rg.start); setPeriodEnd(rg.end) }}
                            className={'rounded-md border px-2 py-1 text-[11.5px] font-semibold ' + (on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink hover:border-ink/40')}>
                            {pz.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">From</span>
                    <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">To</span>
                    <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                </>
              ) : kind === 'sales' ? (
                <>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Who it is for</span>
                    <input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Owner or developer"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Presented by</span>
                    <input value={presenter} onChange={e => setPresenter(e.target.value)} placeholder="Your name"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Building</span>
                    <input value={iv('building')} onChange={e => setIv('building', e.target.value)} placeholder="Domus Brickell Park"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Address</span>
                    <input value={iv('address')} onChange={e => setIv('address', e.target.value)} placeholder="1611 SW 2nd Ave, Brickell"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Type</span>
                    <select value={iv('kind')} onChange={e => setIv('kind', e.target.value)}
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
                      <option value="">Type…</option>
                      {['Condo', 'Townhome', 'House', 'Whole building', 'Hotel'].map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Units</span>
                    <input value={iv('units')} onChange={e => setIv('units', e.target.value)} placeholder="1" inputMode="numeric"
                      className="mt-1 block w-20 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Beds</span>
                    <input value={iv('bedrooms')} onChange={e => setIv('bedrooms', e.target.value)} placeholder="2" inputMode="numeric"
                      className="mt-1 block w-20 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Baths</span>
                    <input value={iv('baths')} onChange={e => setIv('baths', e.target.value)} placeholder="2" inputMode="numeric"
                      className="mt-1 block w-20 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Sleeps</span>
                    <input value={iv('sleeps')} onChange={e => setIv('sleeps', e.target.value)} placeholder="4" inputMode="numeric"
                      className="mt-1 block w-20 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Beds in it</span>
                    <input value={iv('beds')} onChange={e => setIv('beds', e.target.value)} placeholder="King + 2 queens"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Furnished</span>
                    <select value={iv('furnished')} onChange={e => setIv('furnished', e.target.value)}
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
                      <option value="">—</option>
                      {['Fully furnished', 'Part furnished', 'Unfurnished', 'New build'].map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">What it sells on</span>
                    <input value={iv('goal')} onChange={e => setIv('goal', e.target.value)} placeholder="Bay view, 34th floor, free parking"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Market</span>
                    <select value={iv('market')} onChange={e => setIv('market', e.target.value)}
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
                      <option value="">From the property</option>
                      {[['Miami', 'Miami'], ['Broward', 'Fort Lauderdale'], ['North', 'Palm Beach']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Length</span>
                    <select value={deckLength} onChange={e => setDeckLength(e.target.value === 'full' ? 'full' : 'short')}
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
                      <option value="short">Short — send it</option>
                      <option value="full">Full — present it</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Who it is for</span>
                    <select value={audience} onChange={e => setAudience(e.target.value as Audience)} title={AUDIENCES[audience].hint}
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
                      {(Object.keys(AUDIENCES) as Audience[]).map(k => <option key={k} value={k}>{AUDIENCES[k].label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Projections from</span>
                    <select value={cmaPick} onChange={e => { const v = e.target.value; setCmaPick(v); const b = libBuildings.find(x => 'lib:' + x.id === v); if (b && !iv('building')) setIv('building', b.name) }} title="A copy of a building's comps and floor-plan projections from the library below. Tune it for this deck without changing the library."
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
                      <option value="">None, a proposal only</option>
                      {libBuildings.length ? <optgroup label="Projections library">{libBuildings.map(b => <option key={b.id} value={'lib:' + b.id}>{b.name}{b.area ? ' · ' + b.area : ''} ({b.plans} plans)</option>)}</optgroup> : null}
                      <option value="blank">Empty floor plans and comps</option>
                    </select>
                  </label>
                  {cmaPick && (
                    <div className="basis-full rounded-xl border border-line bg-white p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Comparables</span>
                        <span className="text-[12px] text-muted">{extraComps.length ? extraComps.length + ' added: ' + extraComps.map(c => c.name).join(', ') : 'Add comparables from the Projections library, or your own.'}</span>
                        {extraComps.length > 0 && <button type="button" onClick={() => setExtraComps([])} className="text-[11.5px] text-muted hover:underline">Clear</button>}
                        <button type="button" onClick={() => setCompsOpen(o => !o)} className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app">{compsOpen ? 'Done' : 'Add comparables'}</button>
                      </div>
                      {compsOpen && <div className="mt-2"><LibraryCompPicker exclude={cmaPick.startsWith('lib:') ? cmaPick.slice(4) : undefined} onAdd={add => setExtraComps(x => [...x, ...add])} /></div>}
                    </div>
                  )}
                  {libPlans.length > 0 && (
                    <div className="basis-full">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Unit types in this deck</span>
                        <button type="button" onClick={() => setPlanPick(libPlans.map(p => p.id))} className="text-[11.5px] font-semibold text-brand-700 hover:underline">All</button>
                        <a href={'/sales/projections'} className="text-[11.5px] text-muted hover:underline ml-auto">Edit them in the Projections library</a>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {libPlans.map(p => { const on = planPick.includes(p.id); return (
                          <button key={p.id} type="button" title={p.sf} onClick={() => setPlanPick(x => on ? (x.length > 1 ? x.filter(y => y !== p.id) : x) : [...x, p.id])}
                            className={'rounded-full border px-3 py-1 text-[12.5px] font-semibold ' + (on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:text-ink')}>{p.name}</button>
                        ) })}
                      </div>
                    </div>
                  )}
                  {/* THE PROPERTY IS OPTIONAL ON THIS ONE (2026-10-27). A prospect's unit is
                      usually not on our account yet, so the deck generates on a name alone; pick
                      a building we DO run and it fills with that building's own photographs. */}
                  <span className="pb-2"><Tag title="Pick a building to fill the deck with its photographs, or generate on the name alone">Property optional</Tag></span>
                </>
              ) : kind === 'onboarding' ? (
                <>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Owner name</span>
                    <input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Optional"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Target go-live</span>
                    <input value={goLive} onChange={e => setGoLive(e.target.value)} placeholder="e.g. Nov 1"
                      className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
                  </label>
                </>
              ) : (
                <span className="pb-2"><Tag title="The season comes straight from the projection model">Next high season · Nov–Apr</Tag></span>
              )}
              <button onClick={generate} disabled={generating || !canGenerate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-5 py-2 hover:bg-brand-700 disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {kind === 'projection' ? 'Generate projection report' : kind === 'onboarding' ? 'Generate onboarding' : kind === 'sales' ? 'Generate sales deck' : existing ? 'Generate a new one anyway' : 'Generate report'}
              </button>
            </div>
            {/* READY OR NOT — what this review will carry, before the wait rather than after it. */}
            {kind === 'review' && (
              <div className="rounded-xl border border-line bg-app/40 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wider text-muted font-semibold mr-1">This report</span>
                  {scopeReady
                    ? <Tag tone="emerald" title="Who the report is for"><span className="inline-block max-w-[11rem] truncate align-bottom">{targetLabel || 'Scope picked'}</span>{byIds ? ' · ' + scopeIds.length + ' unit' + (scopeIds.length === 1 ? '' : 's') : ''}</Tag>
                    : <Tag tone="amber" title="Pick who the report is for, above">{scopeMode === 'owner' ? 'Pick an owner' : scopeMode === 'unit' ? 'Pick units' : 'Pick a property'}</Tag>}
                  {!periodOk
                    ? <Tag tone="rose" title="The start date must be on or before the end date">Fix the dates</Tag>
                    : periodFuture
                      ? <Tag tone="amber" title="Nothing has been stayed yet — every number will be bookings on the books">{fmtRange(periodStart, periodEnd)} · not started</Tag>
                      : periodOpen
                        ? <Tag tone="amber" title="The period is still running. Revenue and occupancy are on-the-books as of today and will keep moving — the report says so on its face.">{fmtRange(periodStart, periodEnd)} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</Tag>
                        : <Tag tone="emerald" title="A closed period — the numbers are final">{fmtRange(periodStart, periodEnd)} · closed</Tag>}
                  {scopeReady && (stmtLoading
                    ? <Tag title="Checking the owner-statement mirror">Checking statements…</Tag>
                    : stmtPicked.length
                      ? <Tag tone="emerald" title="An Owner Statement section is built from the recognised Guesty ledger — pick which below">{stmtPicked.length} statement{stmtPicked.length === 1 ? '' : 's'} attached</Tag>
                      : unsyncedInWindow.length
                        ? <Tag tone="amber" title="A statement exists for this period but its ledger has not been synced, so it cannot be included yet. Run the owner-statement sync, then come back.">Statement not synced</Tag>
                        : syncedStmts.length
                          ? <Tag title="No statement is ticked — the report is built without an Owner Statement section">No statement section</Tag>
                          : <Tag title="Guesty has no owner statements for these units yet">No statements yet</Tag>)}
                  {pacing && <Tag tone="emerald" title="A Pacing vs Market section is read from the PriceLabs PDF">Pacing PDF</Tag>}
                </div>
                {existing && (
                  <div className="flex items-center gap-2 flex-wrap text-[12.5px] text-ink">
                    <span>
                      A review for <b>{existing.scope_label || targetLabel}</b> over this exact period already exists
                      {existing.views ? <> — the owner has opened it {existing.views} time{existing.views === 1 ? '' : 's'}</> : null}.
                    </span>
                    <a href={'/r/' + existing.code} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold hover:border-ink/30">
                      Open it <ExternalLink size={12} />
                    </a>
                    <span className="text-muted">Its numbers refresh inside the report, on the same link.</span>
                  </div>
                )}
              </div>
            )}
            {/* The picker follows the SCOPE, however it was chosen. It used to be gated on the
                building list alone, so in owner and unit mode — the default — statements were
                still auto-selected and sent to the generator with no picker on screen to see or
                change them (2026-11-09 audit). */}
            {kind === 'review' && scopeReady && (
              <div>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                    Owner statements {stmtLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
                  </p>
                  {stmtList.length > 0 && (
                    <div className="flex items-center gap-3 text-[11.5px]">
                      <span className="text-muted">{stmtPicked.length} of {stmtList.length} selected</span>
                      <button onClick={() => setStmtPicked([])} className="font-semibold text-muted hover:underline">Clear</button>
                    </div>
                  )}
                </div>
                {stmtList.length > 0 && (
                  <div className="mb-2">
                    <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
                      {STMT_MODES.map(m => (
                        <button key={m.id} onClick={() => pickMode(m.id)} title={m.hint}
                          className={'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ' + (stmtMode === m.id ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink')}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!stmtLoading && !stmtList.length ? (
                  <p className="text-[12px] text-muted italic">No Guesty owner statements found for these properties.</p>
                ) : (
                  <div className="rounded-xl border border-line divide-y divide-line max-h-64 overflow-y-auto">
                    {stmtList.map(s => {
                      const on = stmtPicked.indexOf(s.id) >= 0
                      const synced = s.net != null
                      return (
                        <button key={s.id} onClick={() => synced && toggleStatement(s.id)} disabled={!synced}
                          className={'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ' + (synced ? 'hover:bg-app/60 ' : 'opacity-55 cursor-not-allowed ') + (on ? 'bg-brand-50' : 'bg-white')}>
                          {stmtMode === 'one' ? (
                            <span className={'shrink-0 h-4 w-4 rounded-full border-2 flex items-center justify-center ' + (on ? 'border-brand-600' : 'border-line')}>
                              <span className={'h-2 w-2 rounded-full ' + (on ? 'bg-brand-600' : 'bg-transparent')} />
                            </span>
                          ) : (
                            <span className={'shrink-0 h-4 w-4 rounded border flex items-center justify-center text-[10px] font-bold ' + (on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-transparent')}>&#10003;</span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold text-ink truncate">{s.label}</span>
                            <span className="block text-[11px] text-muted">
                              {synced
                                ? <>Net {usd0(s.net as number)} &middot; Paid {usd0(s.paid || 0)} &middot; Due to owner {usd0(s.dueToOwner)}</>
                                : <>Not synced &mdash; run the owner-statement sync for {s.month}</>}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Tag tone={stmtPicked.length ? 'brand' : 'amber'}
                    title={'Figures come straight from the recognised Guesty owner ledger — net is what the owner earned, paid is what actually settled. '
                      + (stmtPicked.length === 1 ? 'One statement: the report gets a single-owner statement section for that month.'
                        : stmtPicked.length > 1 ? 'Several statements: the report rolls them up by month, with a per-owner breakdown.'
                          : 'Nothing selected: the report is generated without an Owner Statement section.')}>
                    {stmtPicked.length === 1 ? 'Single-statement section' : stmtPicked.length > 1 ? 'Rolled up by month' : 'No statement section'}
                  </Tag>
                </div>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2" title="Performance vs Plan appears automatically when the property has a stored budget. A PriceLabs pacing PDF adds Pacing vs Market; a hero photo becomes the cover.">Optional attachments</p>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
                <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
                {kind === 'review' && (
                  <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!uploading}
                    title="Adds a Pacing vs Market section" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50">
                    {uploading === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} PriceLabs pacing PDF
                  </button>
                )}
                <button onClick={() => heroRef.current && heroRef.current.click()} disabled={!!uploading}
                  title="Used on the cover" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50">
                  {uploading === 'hero' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} Hero photo
                </button>
              </div>
              {(pacing || heroImg) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pacing && kind === 'review' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-[11.5px] font-semibold">
                      Pacing: {pacing.name}
                      <Tip label="Remove the pacing PDF"><button onClick={() => setPacing(null)} aria-label="Remove the pacing PDF" className="hover:text-red-600"><X size={11} /></button></Tip>
                    </span>
                  )}
                  {heroImg && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-[11.5px] font-semibold">
                      Hero: {heroImg.name}
                      <Tip label="Remove the hero photo"><button onClick={() => setHeroImg(null)} aria-label="Remove the hero photo" className="hover:text-red-600"><X size={11} /></button></Tip>
                    </span>
                  )}
                </div>
              )}
            </div>
            {msg && <p role="status" className="text-[13px] text-amber-700">{generating && <Loader2 size={12} className="inline animate-spin mr-1.5" />}{msg}</p>}
          </div>
      </section>
      )}

      {/* List — one row per document, filtered by kind */}
      {salesOnly ? null : <LeanTabs
        tabs={[
          { key: 'all' as const, label: 'All', n: shownCount },
          { key: 'review' as const, label: 'Reviews', n: nKind('review') },
          { key: 'projection' as const, label: 'Projections', n: nKind('projection') },
          { key: 'onboarding' as const, label: 'Onboarding', n: nKind('onboarding') },
        ]}
        value={listKind} onChange={setListKind}
        right={reports.length > 6 ? (
          <label className="relative block">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input value={listQ} onChange={e => setListQ(e.target.value)} placeholder="Find an owner or property" aria-label="Find a report"
              className="w-56 max-w-full rounded-xl border border-line bg-white pl-8 pr-3 py-1.5 text-[12.5px] text-ink" />
          </label>
        ) : undefined} />}
      {cmaFor && <SalesCmaEditor report={cmaFor} onClose={() => setCmaFor(null)} />}
      {listErr && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <p className="text-[13px] text-rose-800 flex-1 min-w-[12rem]">{listErr}</p>
          <button onClick={() => { setLoading(true); loadReports() }} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-rose-800 hover:bg-rose-100">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      {loading ? (
        <LeanEmpty><Loader2 size={13} className="inline animate-spin mr-1.5" />Loading reports…</LeanEmpty>
      ) : !shownReports.length ? (
        listErr && !reports.length ? null
          : <LeanEmpty>{q ? 'Nothing matches “' + listQ.trim() + '”.' : reports.length ? 'None of this kind yet.' : 'No reports yet — press New report.'}</LeanEmpty>
      ) : (
        <LeanList>
          {shownReports.map(r => {
            const rk = kindOfRow(r)
            const k = KIND_TAG[rk]
            const sent = String(r.status) === 'sent'
            const asOf = String(r.as_of || '').slice(0, 10)
            const pEnd = String(r.period_end || '').slice(0, 10)
            // A review cut while its period was still running is a snapshot of a moving number.
            // A week on, the on-the-books figures an owner opens are a week stale.
            const age = isIso(asOf) ? dayDiff(asOf, today) : 0
            const stale = rk === 'review' && isIso(asOf) && isIso(pEnd) && pEnd >= asOf && age >= 7
            const copied = copiedId === r.id
            const busy = busyId === r.id
            return (
              <LeanRow key={r.id}
                name={<a href={'/r/' + r.code} title={r.title} className="hover:text-brand-700">{r.scope_label ? r.scope_label + (/\(copy\)\s*$/i.test(String(r.title || '')) ? ' (copy)' : '') : r.title}</a>}
                meta={rk === 'review' ? fmtRange(r.period_start, r.period_end) : 'made ' + fmtDay(asOf)}
                tags={<>
                  <Tag tone={k.t}>{k.l}</Tag>
                  {rk === 'review' && (
                    <Tag tone={stale ? 'amber' : 'slate'}
                      title={stale
                        ? 'The period was still running when this was built, ' + age + ' days ago. Open it and refresh the numbers before sending — the link stays the same.'
                        : 'Numbers are on-the-books as of ' + fmtDay(asOf)}>
                      as of {fmtDay(asOf, asOf.slice(0, 4) !== today.slice(0, 4))}
                    </Tag>
                  )}
                  <Tag tone={sent ? 'brand' : 'slate'} title={sent ? 'Marked as sent to the owner' : 'Not marked as sent yet'}>{sent ? 'Sent' : 'Draft'}</Tag>
                  {r.views
                    ? <Tag tone="emerald" title={'Opened from the share link ' + r.views + ' time' + (r.views === 1 ? '' : 's') + ' by someone not signed in to Lighthouse. Slide-by-slide detail is in the report’s Views panel.'}>Opened {r.views}×{r.last_viewed ? ' · ' + ago(r.last_viewed, today) : ''}</Tag>
                    : sent ? <Tag tone="amber" title="Sent, but nobody has opened the share link yet">Not opened</Tag> : null}
                </>}
                actions={<>
                  <IconBtn title={copied ? 'Owner link ready' : 'Share the owner link'} tone={copied ? 'ok' : 'brand'} onClick={() => share(r)}>
                    {copied ? <Check size={14} /> : <Share2 size={14} />}
                  </IconBtn>
                  <IconBtn title={sent ? 'Marked sent — tap to set back to draft' : 'Mark as sent to the owner'} tone={sent ? 'ok' : undefined} disabled={busy}
                    onClick={() => setStatus(r, sent ? 'draft' : 'sent')}>
                    <Send size={14} />
                  </IconBtn>
                  {rk === 'sales' && (
                    <>
                      <button type="button" onClick={() => setCmaFor(cmaFor && cmaFor.id === r.id ? null : r)} title="Floor plans, comps, partner program and second-option pages"
                        className={'shrink-0 inline-flex items-center gap-1 rounded-lg border px-2 h-8 text-[12px] font-semibold ' + (cmaFor && cmaFor.id === r.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-app')}>
                        <Building2 size={13} /> Floor plans &amp; comps
                      </button>
                      <Tip label="Magazine: letter pages to print, leave at a building or read on a phone">
                        <a href={'/r/' + r.code + '?view=magazine'} target="_blank" rel="noreferrer" aria-label="Open the magazine"
                          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 h-8 text-[12px] font-semibold text-ink hover:bg-app"><BookOpen size={13} /> Magazine</a>
                      </Tip>
                    </>
                  )}
                  <Tip label={rk === 'sales' ? 'Keynote: the slides, with Present mode, PDF and PowerPoint' : 'Open in a new tab'}>
                    <a href={'/r/' + r.code} target="_blank" rel="noreferrer" aria-label="Open in a new tab"
                      className="shrink-0 inline-flex items-center justify-center rounded-lg border border-line bg-white w-8 h-8 text-muted hover:text-ink hover:bg-app"><ExternalLink size={14} /></a>
                  </Tip>
                  <IconBtn title="Delete report (the link stops working)" tone="bad" disabled={busy} onClick={() => remove(r)}><Trash2 size={14} /></IconBtn>
                </>} />
            )
          })}
        </LeanList>
      )}
    </div>
  )
}
