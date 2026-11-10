'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Send, Sparkles, MessageSquare, ArrowDownWideNarrow, ArrowUpNarrowWide, Square, CheckSquare, XCircle, RefreshCw, Trash2, ChevronDown, Undo2, Play, Pencil, SkipForward, Check, Circle, Lock, ShieldAlert, ExternalLink } from 'lucide-react'
import { Tag, Clamp, IconBtn, LeanList, LeanEmpty, type Tone } from '@/components/lean'
import { rootCausesOf, removalGrounds, removalDraft, removalPath, recoverySteps, guestNoteDraft, lintReply, openerOf, type OpsState, type PlaybookReview } from '@/lib/review-playbook'

type Cat = { key: string; label: string; rating: number; comment?: string }
type Review = { id: string; rating: number | null; content: string; channel: string; listing_name?: string; listingId?: string; guest?: string; created_at?: string; hasReply: boolean; reply?: string; reason?: string; dismissed?: boolean; removed?: boolean; removedReason?: string | null; building?: string | null; market?: string | null; ownerId?: string; ownerName?: string; categories?: Cat[]; privateFeedback?: string | null }

// A LOW SCORE, on the review's own scale: 3 and under out of 5, 7 and under out of 10. Ratings are
// stored out of 5 for every channel, so a Booking.com 7/10 arrives as 3.5 and is read as low here
// exactly as lib/review-scale reads it everywhere else.
const lowScore = (n: number | null, ch?: string | null) => n != null && (/booking/i.test(String(ch || '')) && n <= 5 ? n <= 3.5 : (n <= 3 || (n > 5 && n <= 7)))

// DRAFTS SURVIVE A RELOAD (2026-11-09). A draft costs an AI call; losing ten of them to a refresh or
// a phone that slept the tab meant paying for them twice. Kept in this browser only, three weeks.
const DRAFT_KEY = 'lh.reviews.drafts.v1'
function loadDrafts(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || '{}')
    const out: Record<string, string> = {}
    const cut = Date.now() - 21 * 86400000
    for (const id of Object.keys(raw || {})) { const e = raw[id]; if (e && typeof e.t === 'string' && e.t.trim() && Number(e.at) > cut) out[id] = e.t }
    return out
  } catch { return {} }
}
/** Write or clear ONE draft. Only ever touches the entry it is given, so nothing is wiped by accident. */
function persistDraft(id: string, text: string) {
  try {
    const all = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || '{}') || {}
    if (text && text.trim()) all[id] = { t: text, at: Date.now() }
    else delete all[id]
    const ids = Object.keys(all)
    // Two hundred is far more than a queue ever holds; past that the oldest go.
    if (ids.length > 200) ids.sort((a, b) => Number(all[a].at) - Number(all[b].at)).slice(0, ids.length - 200).forEach(k => { delete all[k] })
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(all))
  } catch { /* private mode or full: drafts simply do not persist */ }
}

// THE FEED OBEYS THE BOARD ABOVE IT (Jon, 2026-09-09: "the main page should be KPI and where we can
// review or respond to reviews"). One filter bar on /reviews drives the numbers AND this list, so a
// page filtered to one owner's building shows that owner's reviews rather than the whole portfolio
// next to numbers for a slice of it. Both props are optional — a caller that renders this panel on
// its own gets the old unfiltered behaviour.
export type ReviewFeedFilter = { market: string; building: string; owner: string; channel: string; days: number }

function agoLabel(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago'
}

const ratingFrac = (n: number | null) => n == null ? -1 : (n <= 5 ? n / 5 : n / 10)
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const fmtDate = (s?: string) => { if (!s) return ""; const d = new Date(s); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) }

/** What the feed reports up to the page (tab counts, header pill, default tab). */
export type FeedCounts = { loading: boolean; needs: number; overdue: number; replied: number; unmapped: number; dismissed: number; total: number }

// LEAN PASS (2026-09-22): each review is one header line (score, unit, guest, channel, date, reply
// clock) with the text clamped to two lines and ONE primary action — "Approve & post" once a draft
// exists, else "Draft reply". Every other button lives behind the row's "More".
//
// `mode`: 'needs' shows only the reply queue (the page's "To reply" tab); 'all' shows the status
// sub-tabs. Left out, the panel behaves as it always did (sub-tabs shown).
export function ReviewsPanel({ filter, focusUnit, focusNonce, mode, onCounts, onOpenAll }: {
  filter?: ReviewFeedFilter; focusUnit?: string; focusNonce?: number
  mode?: 'needs' | 'all'
  onCounts?: (c: FeedCounts) => void
  /** Where "see the replied ones" goes when the panel is locked to the reply queue. */
  onOpenAll?: () => void
}) {
  const [s, setS] = useState<{ loading: boolean; reviews?: Review[]; unmapped?: Review[]; error?: string; segments?: boolean }>({ loading: true })
  const [tab, setTab] = useState<'needs' | 'replied' | 'unmapped' | 'dismissed'>('needs')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [posted, setPosted] = useState<Record<string, boolean>>({})
  const [postedAt, setPostedAt] = useState<Record<string, number>>({})
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({})
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const [allAi, setAllAi] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dismissedLocal, setDismissedLocal] = useState<Record<string, boolean>>({})
  // REMOVED BY THE CHANNEL (2026-09-22). Guesty does not tell us when a channel pulls a review --
  // the sync upserts by id and never deletes -- so a person says so here and every score, brief,
  // owner report and guidebook stops counting it. Local state mirrors the dismiss pattern so the
  // row responds before the round-trip.
  const [removedLocal, setRemovedLocal] = useState<Record<string, boolean>>({})
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  // Which rows have their "More" open.
  const [more, setMore] = useState<Record<string, boolean>>({})
  // ── THE REPLY RUN (2026-11-09) ─────────────────────────────────────────────────────────────────
  // "Start" puts the queue in a run: one review is in focus, its draft is written the moment it
  // takes focus (and the next one's behind it), and each review is one key or one tap — Approve,
  // Edit, Skip. Nothing is drafted until a person starts a run, so opening the page costs nothing,
  // and nothing posts without that person's key or tap on that review.
  const [flow, setFlow] = useState(false)
  const [cur, setCur] = useState<string | null>(null)
  const autoTried = useRef<Record<string, boolean>>({})
  const autoOff = useRef(false)
  const draftsRef = useRef<Record<string, string>>({})
  const act = useRef<(key: string, e: KeyboardEvent) => void>(() => {})
  // The panel stays mounted (hidden) while another tab of the page is open, so half-written drafts
  // survive. A key press must never post from a queue nobody is looking at — the keys check this.
  const rootRef = useRef<HTMLElement | null>(null)
  useEffect(() => { const saved = loadDrafts(); if (Object.keys(saved).length) setDrafts(d => ({ ...saved, ...d })) }, [])
  useEffect(() => { draftsRef.current = drafts }, [drafts])

  // "Answer N reviews" on a failing unit upstairs types that unit into this box, rather than
  // re-scoping the whole page behind the manager's back.
  useEffect(() => { if (focusUnit) { setQuery(focusUnit); setTab('needs') } }, [focusUnit, focusNonce])

  // LOADS EVERY TIME THE PAGE IS OPENED, and again whenever the tab comes back into view.
  // `cache: 'no-store'` matters: without it the browser can serve its own cached copy of
  // /api/reviews, so a review replied to on another screen keeps showing as unanswered.
  // A background reload that STARTED before the user's last dismiss/undo click carries stale
  // dismissed-flags; if it resolves after the click it silently re-hides (or re-shows) the row.
  // That is exactly the bug hit when clicking Undo at human speed: the visibility-change reload
  // races the undo, lands last, and the review never returns to the reply list.
  const mutatedAtRef = useRef(0)
  // First load only: if nothing is awaiting a reply, open on the populated 'Replied' list rather
  // than an empty 'Needs a reply' box. Jon, twice: "reviews don't seem to be populating" — they
  // are; the default work-queue tab was just empty because the team is caught up, which reads as a
  // broken page. Never overrides a tab the user picked themselves.
  const didInitialTab = useRef(false)
  // Only the WINDOW is a server round-trip; market/building/owner/channel are applied below to the
  // rows already in hand, so moving the filter bar re-renders instantly instead of re-fetching.
  const feedDays = filter?.days
  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts || !opts.quiet) setS(prev => ({ ...prev, loading: true }))
    setErr(null)
    const startedAt = Date.now()
    try {
      const d = await (await fetch('/api/reviews' + (feedDays ? '?days=' + feedDays : ''), { cache: 'no-store' })).json()
      if (startedAt < mutatedAtRef.current) return   // stale: a click happened mid-flight — drop it
      const reviews: Review[] = d.reviews || []
      setS({ loading: false, reviews, unmapped: d.unmapped || [], error: d.error, segments: d.segments !== false })
      setLoadedAt(Date.now())
      if (!didInitialTab.current) {
        didInitialTab.current = true
        const anyNeeds = reviews.some(r => !r.hasReply && !r.dismissed)
        if (!anyNeeds && reviews.length > 0) setTab('replied')
      }
      // No template placeholders — drafts stay empty until the AI writes the real one.
    } catch (e: any) {
      setS({ loading: false, error: String((e && e.message) || e) })
    }
  }, [feedDays])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load({ quiet: true }) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  // Auto-drafting disabled: drafts are written on demand via the AI buttons below.

  const isLow = (n: number | null, ch?: string | null) => lowScore(n, ch)
  // Booking.com shows the guest a 0-10 score, so its reviews read on that native scale here;
  // everything else (and every combined average) stays out of 5.
  const fmtRating = (n: number | null, ch?: string | null) => {
    if (n == null) return '—'
    if (/booking/i.test(String(ch || '')) && n <= 5) return `${Math.round(n * 2 * 10) / 10}/10`
    return n <= 5 ? `${n}/5` : `${n}/10`
  }

  // Reply SLA - bad reviews deserve an answer within a day, everything else within three.
  // The clock turns this queue from "a list" into "who has been waiting longest" (median first
  // reply was 367 hours when this shipped; the badge is the fix).
  const slaState = (r: Review): { overdueH: number; label: string; tone: Tone } | null => {
    if (!r.created_at) return null
    const ageH = (Date.now() - new Date(r.created_at).getTime()) / 3600000
    if (!Number.isFinite(ageH)) return null
    const dueH = isLow(r.rating, r.channel) ? 24 : 72
    const over = ageH - dueH
    if (over >= 0) return { overdueH: over, label: 'overdue ' + (over >= 48 ? Math.round(over / 24) + 'd' : Math.max(1, Math.round(over)) + 'h'), tone: 'rose' }
    return { overdueH: over, label: 'due in ' + (-over >= 48 ? Math.round(-over / 24) + 'd' : Math.max(1, Math.round(-over)) + 'h'), tone: -over <= 8 ? 'amber' : 'slate' }
  }

  // Filter by building / unit / channel via the search box (matches the listing name + channel),
  // then by whatever the board above the feed is set to. Both must pass.
  const q = query.trim().toLowerCase()
  const matchBar = (r: Review) => {
    if (!filter) return true
    // The live-Guesty fallback path carries no building/market/owner on its rows. Filtering on
    // fields that are not there would empty the list and blame the filter for a sync problem.
    if (s.segments === false) return true
    if (filter.market !== 'all' && (r.market || '') !== filter.market) return false
    if (filter.building !== 'all' && (r.building || '') !== filter.building) return false
    if (filter.owner !== 'all' && (r.ownerId || '') !== filter.owner) return false
    if (filter.channel !== 'all' && (r.channel || '') !== filter.channel) return false
    return true
  }
  const matchQ = (r: Review) =>
    matchBar(r) && (!q || `${r.listing_name || ''} ${r.building || ''} ${r.ownerName || ''} ${r.channel || ''}`.toLowerCase().includes(q))
  const barOn = !!filter && (filter.market !== 'all' || filter.building !== 'all' || filter.owner !== 'all' || filter.channel !== 'all')
  const isDismissed = (r: Review) => !!r.dismissed || !!dismissedLocal[r.id]
  const isRemoved = (r: Review) => (removedLocal[r.id] !== undefined ? removedLocal[r.id] : !!r.removed)
  const needs = (s.reviews || [])
    .filter(r => !r.hasReply && !posted[r.id] && !isDismissed(r) && matchQ(r))
    // Most-overdue first (the SLA is the queue order); the rating toggle breaks ties.
    .sort((a, b) => {
      const sa = slaState(a), sb = slaState(b)
      const d = (sb ? sb.overdueH : -9999) - (sa ? sa.overdueH : -9999)
      if (Math.abs(d) > 0.5) return d
      return sortDir === 'desc' ? ratingFrac(b.rating) - ratingFrac(a.rating) : ratingFrac(a.rating) - ratingFrac(b.rating)
    })
  const replied = (s.reviews || [])
    .filter(r => (r.hasReply || posted[r.id]) && matchQ(r))
    .sort((a, b) => (postedAt[b.id] || 0) - (postedAt[a.id] || 0) || (b.created_at || '').localeCompare(a.created_at || ''))
  const unmapped = (s.unmapped || []).filter(matchQ)
  const dismissedList = (s.reviews || []).filter(r => isDismissed(r) && matchQ(r))
  const selectedIds = needs.filter(r => selected[r.id])
  // How many unreplied reviews are past their SLA — the number that should make someone act.
  const overdueCount = needs.filter(r => { const st = slaState(r); return !!st && st.overdueH >= 0 }).length
  const totalCount = (s.reviews || []).filter(matchQ).length
  // The page shows these as tab counts and in the header; it also picks its default tab from them.
  useEffect(() => {
    if (onCounts) onCounts({ loading: s.loading, needs: needs.length, overdue: overdueCount, replied: replied.length, unmapped: unmapped.length, dismissed: dismissedList.length, total: totalCount })
  }, [onCounts, s.loading, needs.length, overdueCount, replied.length, unmapped.length, dismissedList.length, totalCount])
  // Locked to the reply queue on the page's "To reply" tab; otherwise the panel's own sub-tab.
  const view = mode === 'needs' ? 'needs' : tab

  function setDraft(id: string, v: string) { setDrafts(d => ({ ...d, [id]: v })); persistDraft(id, v) }

  // RESEARCH — the 360 look-before-you-claim step. Pulls the property's recently COMPLETED work
  // (Breezeway tasks, resolved guest issues, closed work orders) and shows it to the operator, so
  // "that's been addressed" is only ever written over evidence a human has seen. Quick drafts
  // ("Rewrite with AI") never do this — they stay fast and generic by design.
  const [research, setResearch] = useState<Record<string, { open: boolean; loading: boolean; evidence: string }>>({})
  async function doResearch(r: Review) {
    const cur = research[r.id]
    if (cur && cur.open) { setResearch(x => ({ ...x, [r.id]: { ...cur, open: false } })); return }
    if (cur && cur.evidence !== undefined && !cur.loading && cur.evidence !== '') { setResearch(x => ({ ...x, [r.id]: { ...cur, open: true } })); return }
    setResearch(x => ({ ...x, [r.id]: { open: true, loading: true, evidence: '' } }))
    try {
      const res = await fetch('/api/reviews/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ researchOnly: true, listingId: r.listingId })
      })
      const d = await res.json()
      setResearch(x => ({ ...x, [r.id]: { open: true, loading: false, evidence: d.evidence || '' } }))
    } catch {
      setResearch(x => ({ ...x, [r.id]: { open: true, loading: false, evidence: '' } }))
    }
  }

  async function rewriteAI(r: Review, instruction?: string, withEvidence?: boolean): Promise<boolean> {
    setAiBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      // Retry on the org's 5-req/min rate limit with a backoff so drafts still land.
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch('/api/reviews/draft', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // `avoid`: the drafts already sitting in this queue, so ten replies do not open the same way.
          body: JSON.stringify({ reviewId: r.id, content: r.content, rating: r.rating, listing_name: r.listing_name, guest: r.guest, channel: r.channel, instruction, currentDraft: draftsRef.current[r.id] || '', listingId: r.listingId, withEvidence: !!withEvidence,
            avoid: Object.keys(draftsRef.current).filter(id => id !== r.id).map(id => openerOf(draftsRef.current[id])).filter(Boolean).slice(-10) })
        })
        const d = await res.json()
        if (res.ok && d.draft) { setDraft(r.id, d.draft); draftsRef.current = { ...draftsRef.current, [r.id]: d.draft }; return true }
        const msg = d.error || `HTTP ${res.status}`
        // The AI budget stop is not a rate limit: waiting does nothing, so the run stops asking.
        if (d.budget) { autoOff.current = true; throw new Error(msg) }
        if (/429|rate limit/i.test(msg) && attempt < 3) { await sleep(15000); continue }
        throw new Error(msg)
      }
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setAiBusy(b => ({ ...b, [r.id]: false })) }
    return false
  }

  async function draftAllAI() {
    setAllAi(true); setErr(null)
    // Only the ones with no draft yet, and it stops at the first failure (a budget stop or an outage
    // would otherwise be retried once per review).
    const todo = needs.filter(r => !(draftsRef.current[r.id] || '').trim())
    for (let i = 0; i < todo.length; i++) { const ok = await rewriteAI(todo[i]); if (!ok) break; if (i < todo.length - 1) await sleep(4000) }
    setAllAi(false)
  }

  async function postOne(r: Review): Promise<boolean> {
    const text = (drafts[r.id] || '').trim()
    if (!text) return false
    // Never spin (Jon, 2026-09-22): the browser gives up at 30 seconds and says so.
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 30000)
    let res: Response
    try {
      res = await fetch('/api/reviews/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ reviewId: r.id, reviewReply: text })
      })
    } catch (e: any) {
      throw new Error(e?.name === 'AbortError' ? 'Posting took over 30 seconds, so it was stopped. Nothing was posted — try again.' : String(e?.message || e))
    } finally { clearTimeout(timer) }
    const d = await res.json().catch(() => ({}))
    // LISTING NO LONGER ACTIVE: the server closed the review instead of posting. Take it off the
    // list and say why, once.
    if (d.closed) {
      setDismissedLocal(x => ({ ...x, [r.id]: true }))
      setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, dismissed: true } : x) }))
      setNote((r.listing_name ? r.listing_name + ': ' : '') + (d.message || 'Listing is no longer active — review closed.'))
      return false
    }
    if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
    // Optimistically reflect the posted reply so it shows immediately (text + replied state),
    // without waiting for the next Guesty sync.
    setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, hasReply: true, reply: text } : x) }))
    return true
  }

  /** True when the review left the queue (posted, or closed because its listing is gone). */
  async function post(r: Review): Promise<boolean> {
    if (!(drafts[r.id] || '').trim()) return false
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    let gone = false
    try {
      if (await postOne(r)) { setPosted(p => ({ ...p, [r.id]: true })); setPostedAt(pa => ({ ...pa, [r.id]: Date.now() })) }
      setDrafts(d => { const n = { ...d }; delete n[r.id]; return n })
      persistDraft(r.id, '')
      gone = true
    }
    catch (e: any) { setErr(e?.message || String(e)) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
    return gone
  }

  // ── THE RUN: which review is next, and what each key does ─────────────────────────────────────
  const neighbour = (id: string, dir: 1 | -1, leaving: boolean): string | null => {
    const i = needs.findIndex(x => x.id === id)
    if (i < 0) return needs.length ? needs[0].id : null
    const j = i + dir
    if (j >= 0 && j < needs.length) return needs[j].id
    // Off the end: a review that is leaving the queue hands focus back; a skipped one wraps round.
    if (leaving) return needs.length > 1 ? needs[dir === 1 ? i - 1 : i + 1].id : null
    return needs.length > 1 ? needs[dir === 1 ? 0 : needs.length - 1].id : id
  }
  const startFlow = () => { autoOff.current = false; setFlow(true); setCur(c => (c && needs.some(x => x.id === c) ? c : (needs[0] ? needs[0].id : null))) }
  const focusBox = (id: string) => { const el = document.getElementById('rv-ta-' + id) as HTMLTextAreaElement | null; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }
  async function approveCur(r: Review, viaKey: boolean) {
    const txt = (draftsRef.current[r.id] || '').trim()
    if (!txt || rowBusy[r.id] || aiBusy[r.id]) return
    // A key press never posts over a blocking flag — the person reads it and uses the button.
    const blocks = lintReply(txt, r).filter(f => f.block)
    if (viaKey && blocks.length) { setErr('Not posted — this draft ' + blocks.map(b => b.label).join(' and ') + '. Edit it, or press the Approve button if that is intended.'); return }
    const next = neighbour(r.id, 1, true)
    if (await post(r)) setCur(next)
  }
  act.current = (key, e) => {
    if (!flow || view !== 'needs' || !needs.length) return
    if (!rootRef.current || rootRef.current.offsetParent === null) return
    const r = needs.find(x => x.id === cur) || needs[0]
    if (!r) return
    const k = key.toLowerCase()
    if (k === 'escape') { setFlow(false); return }
    if (k === 'a') { e.preventDefault(); approveCur(r, true) }
    else if (k === 'e') { e.preventDefault(); focusBox(r.id) }
    else if (k === 's' || k === 'j' || k === 'arrowdown') { e.preventDefault(); setCur(neighbour(r.id, 1, false)) }
    else if (k === 'k' || k === 'arrowup') { e.preventDefault(); setCur(neighbour(r.id, -1, false)) }
    else if (k === 'r') { e.preventDefault(); if (!aiBusy[r.id]) rewriteAI(r) }
    else if (k === 'd') { e.preventDefault(); const next = neighbour(r.id, 1, true); dismiss(r); setCur(next) }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t && t.tagName ? t.tagName.toLowerCase() : ''
      // Typing is typing. Escape leaves the box and gives the keys back to the run.
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) { if (e.key === 'Escape' && t) t.blur(); return }
      act.current(e.key, e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The review in focus gets its draft written, and the one behind it — so the next is ready when
  // this one is approved. Once per review; a failure never loops.
  const curIdx = flow && cur ? needs.findIndex(x => x.id === cur) : -1
  const curId = curIdx >= 0 ? needs[curIdx].id : null
  const nextId = curIdx >= 0 && curIdx + 1 < needs.length ? needs[curIdx + 1].id : null
  useEffect(() => {
    if (!flow || view !== 'needs' || autoOff.current) return
    for (const id of [curId, nextId]) {
      if (!id || autoTried.current[id]) continue
      const r = needs.find(x => x.id === id)
      if (!r || (draftsRef.current[id] || '').trim()) continue
      autoTried.current[id] = true
      rewriteAI(r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, view, curId, nextId])
  useEffect(() => {
    if (!flow || !curId) return
    const el = document.getElementById('rv-' + curId)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [flow, curId])
  // A run with nothing left, or one whose focus left the list, settles itself.
  useEffect(() => {
    if (!flow) return
    if (!needs.length) { setFlow(false); return }
    if (!cur || !needs.some(x => x.id === cur)) setCur(needs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, cur, needs.length])

  async function postSelected() {
    if (!selectedIds.length) return
    setBulkBusy(true); setErr(null)
    const done: Record<string, boolean> = {}
    try {
      for (const r of selectedIds) { try { if (await postOne(r)) done[r.id] = true } catch (e: any) { setErr(e?.message || String(e)) } }
    } finally {
      setPosted(p => ({ ...p, ...done })); setPostedAt(pa => ({ ...pa, ...Object.fromEntries(Object.keys(done).map(id => [id, Date.now()])) })); setSelected({}); setBulkBusy(false)
      Object.keys(done).forEach(id => persistDraft(id, ''))
    }
  }

  async function setRemoved(r: Review, undo: boolean) {
    if (!undo) {
      const why = window.prompt('Mark this review as removed by ' + (r.channel || 'the channel') + '?\n\nOptional: why was it removed? (e.g. Airbnb policy violation, retracted by guest)')
      if (why === null) return
      setRemovedLocal(d => ({ ...d, [r.id]: true }))
      try {
        const res = await fetch('/api/reviews/removed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id, reason: why }) })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not mark it removed')
        setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, removed: true, removedReason: why || null } : x) }))
      } catch (e: any) { setErr(e?.message || String(e)); setRemovedLocal(d => ({ ...d, [r.id]: false })) }
      return
    }
    setRemovedLocal(d => ({ ...d, [r.id]: false }))
    try {
      const res = await fetch('/api/reviews/removed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id, undo: true }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not restore it')
      setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, removed: false, removedReason: null } : x) }))
    } catch (e: any) { setErr(e?.message || String(e)); setRemovedLocal(d => ({ ...d, [r.id]: true })) }
  }

  async function dismiss(r: Review) {
    mutatedAtRef.current = Date.now()
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    setDismissedLocal(d => ({ ...d, [r.id]: true }))
    try {
      const res = await fetch('/api/reviews/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id }) })
      const d = await res.json().catch(() => ({})); if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
    } catch (e: any) { setErr(e?.message || String(e)); setDismissedLocal(d => ({ ...d, [r.id]: false })) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
  }
  async function undismiss(r: Review) {
    mutatedAtRef.current = Date.now()
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      const res = await fetch('/api/reviews/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id, undo: true }) })
      const d = await res.json().catch(() => ({})); if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setDismissedLocal(d => ({ ...d, [r.id]: false }))
      setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, dismissed: false } : x) }))
      // Belt and braces: pull server truth AFTER the undo landed, so the row reappears in the
      // reply queue even if any local state was stale. Clearing the stamp lets this reload win.
      mutatedAtRef.current = 0
      load({ quiet: true })
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
  }

  // ── ROW PARTS (plain functions, not components, so a re-render never remounts a row) ─────────
  // Sub-scores worth a chip on the line are the ones the guest marked down; six fives are noise.
  const catChips = (r: Review) => {
    const low = (r.categories || []).filter(c => c.rating <= 3).slice(0, 3)
    if (!low.length) return null
    return <>{low.map(c => <Tag key={c.key} tone="rose" title={c.label + ' scored ' + c.rating + ' out of 5' + (c.comment ? ' — “' + c.comment + '”' : '')}>{c.label} {c.rating}</Tag>)}</>
  }
  // Airbnb takes a public response for about 30 days after a review; after that the box is gone.
  const windowTag = (r: Review) => {
    if (!/airbnb/i.test(r.channel || '') || !r.created_at) return null
    const age = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
    if (!Number.isFinite(age) || age < 21) return null
    return age >= 30
      ? <Tag title="Airbnb accepts a public response for about 30 days after the review. This one is older, so the post may be refused — mark it no-reply-needed if it is.">window likely closed</Tag>
      : <Tag tone="amber" title="Airbnb accepts a public response for about 30 days after the review">closes in {30 - age}d</Tag>
  }
  const head = (r: Review, extra?: ReactNode) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Tag tone={isLow(r.rating, r.channel) ? 'rose' : 'emerald'} title="Guest score">{'★ '}{fmtRating(r.rating, r.channel)}</Tag>
      <span className="text-[13.5px] font-semibold text-ink truncate max-w-[11rem] sm:max-w-[14rem]">{r.listing_name}</span>
      {r.guest && <span className="text-[12px] text-muted truncate max-w-[8rem] sm:max-w-[10rem]">{r.guest}</span>}
      {r.channel && <Tag>{r.channel}</Tag>}
      {r.created_at && <span className="text-[11.5px] text-muted whitespace-nowrap">{fmtDate(r.created_at)}</span>}
      {extra}
      {catChips(r)}
      {r.privateFeedback ? <Tag tone="violet" title="The guest also left private feedback. Open the row to read it — it informs the draft and is never part of the public reply."><Lock size={9} className="inline -mt-px mr-0.5" />private note</Tag> : null}
      {isRemoved(r) && <Tag title={'The channel took this review down — not counted in scores' + (r.removedReason ? ' · ' + r.removedReason : '')}>Removed</Tag>}
    </div>
  )
  const text = (r: Review) => !r.content ? null
    : isRemoved(r) ? <p className="text-[12.5px] text-muted/60 line-through line-clamp-2">{r.content}</p>
      : <Clamp text={r.content} />
  const moreBtn = (r: Review, label = 'More') => (
    <button onClick={() => setMore(m => ({ ...m, [r.id]: !m[r.id] }))} title={more[r.id] ? 'Hide the other actions' : 'Rewrite, research, dismiss, follow up…'}
      className="inline-flex items-center gap-0.5 text-[12px] font-semibold px-2 py-1 rounded-lg border border-line text-muted hover:text-ink hover:bg-app">
      {label} <ChevronDown size={13} className={more[r.id] ? 'rotate-180 transition' : 'transition'} />
    </button>
  )
  const btn2 = 'inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg border disabled:opacity-50'
  const removedBtn = (r: Review, disabled?: boolean) => (
    // REMOVED IS NOT DISMISSED. Dismiss means "no reply needed" and leaves the review in every
    // score. Removed means the channel took it down, so it comes out of the average, the briefs,
    // the owner reports and the guidebook.
    <button onClick={() => setRemoved(r, isRemoved(r))} disabled={disabled}
      title={isRemoved(r) ? 'Put this review back — it counts in scores again' : 'The channel took this review down — stop counting it in every score, brief and owner report'}
      className={`${btn2} ${isRemoved(r) ? 'text-slate-700 border-slate-300 bg-slate-100 hover:bg-slate-200' : 'text-muted border-line hover:bg-app'}`}>
      <Trash2 size={12} /> {isRemoved(r) ? 'Restore' : 'Removed by channel'}
    </button>
  )

  const subTab = (k: 'needs' | 'replied' | 'unmapped' | 'dismissed', label: string, n: number, title?: string, extra?: ReactNode) => (
    <button key={k} onClick={() => setTab(k)} title={title}
      className={'inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 border-l border-line first:border-l-0 whitespace-nowrap ' + (tab === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>
      {label} <span className="opacity-70 tabular-nums">{s.loading ? '…' : n}</span>{extra}
    </button>
  )
  const draftedCount = needs.filter(r => (drafts[r.id] || '').trim()).length

  return (
    <section ref={rootRef}>
      {/* ── TOOLBAR: status sub-tabs (All reviews), search, queue tools, refresh — one line ─────── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {mode !== 'needs' && (
          <div className="inline-flex rounded-lg border border-line overflow-hidden max-w-full overflow-x-auto">
            {subTab('needs', 'Needs a reply', needs.length, 'Unreplied, most overdue first',
              !s.loading && overdueCount > 0 ? <span className="ml-0.5 px-1 rounded bg-rose-100 text-rose-700 font-bold" title="Unreplied past SLA (24h for low scores, 72h otherwise)">{overdueCount}</span> : null)}
            {subTab('replied', 'Replied', replied.length)}
            {subTab('unmapped', 'Not counted', unmapped.length, 'Reviews that cannot be replied to and never count toward scores: the listing is not connected to its channel, is no longer active, or the review was left on a channel listing that has since been replaced')}
            {subTab('dismissed', 'Dismissed', dismissedList.length, 'Cleared as no-reply-needed — off the list but still counted in scores. Undo moves one back.')}
          </div>
        )}
        {/* THE RUN. One review in focus, its draft already written, one key or tap each. */}
        {view === 'needs' && !s.loading && needs.length > 0 && (
          <button onClick={() => (flow ? setFlow(false) : startFlow())}
            title={flow ? 'Stop the run (Esc)' : 'Work the queue one review at a time: the draft is written for you, then Approve, Edit or Skip'}
            className={'inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg ' + (flow ? 'border border-line bg-white text-ink hover:bg-app' : 'bg-brand-600 text-white hover:bg-brand-700')}>
            {flow ? <><XCircle size={12} /> Stop</> : <><Play size={12} /> Start replying</>}
          </button>
        )}
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search unit, building, owner, channel"
          title="e.g. Capri, 214, airbnb"
          className="flex-1 min-w-[9rem] text-[12px] text-ink bg-white border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        {/* Say so when the filter bar is narrowing this list, or an empty tab reads as a broken feed. */}
        {barOn && (
          <Tag title={'Narrowed by the filters at the top of the page'
            + (filter && filter.building !== 'all' ? ' · ' + filter.building : '')
            + (filter && filter.market !== 'all' ? ' · ' + filter.market : '')
            + (filter && filter.channel !== 'all' ? ' · ' + filter.channel : '')
            + (filter && filter.owner !== 'all' ? ' · one owner' : '')}>filtered</Tag>
        )}
        {barOn && s.segments === false && (
          <Tag tone="amber" title="Reading live from Guesty right now, which does not carry building or owner on a review — so the filters are not being applied to this list">filters off</Tag>
        )}
        {view === 'needs' && !s.loading && needs.length > 0 && (<>
          <IconBtn title={sortDir === 'desc' ? 'Ties: high to low rating — click for low to high' : 'Ties: low to high rating — click for high to low'} onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}>
            {sortDir === 'desc' ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
          </IconBtn>
          <button onClick={draftAllAI} disabled={allAi || draftedCount === needs.length} title="Write an AI draft for every review in the queue that does not have one yet"
            className={`${btn2} text-brand-700 border-brand-200 bg-brand-50 hover:bg-brand-100`}>
            <Sparkles size={12} /> {allAi ? 'Drafting…' : 'Draft all'}
          </button>
          <IconBtn title={needs.every(r => selected[r.id]) ? 'Clear the selection' : 'Select all for bulk posting'}
            onClick={() => setSelected(needs.every(r => selected[r.id]) ? {} : Object.fromEntries(needs.map(r => [r.id, true])))}>
            {needs.every(r => selected[r.id]) ? <CheckSquare size={14} /> : <Square size={14} />}
          </IconBtn>
        </>)}
        <span className="text-[11px] text-muted whitespace-nowrap">{s.loading ? 'Loading…' : loadedAt ? agoLabel(loadedAt) : 'Live'}</span>
        <IconBtn title="Pull the review list again" onClick={() => load()} disabled={s.loading}>
          <RefreshCw size={13} className={s.loading ? 'animate-spin' : ''} />
        </IconBtn>
      </div>
      {flow && view === 'needs' && needs.length > 0 && (
        <p className="text-[11.5px] text-muted mb-2 px-1">
          <span className="font-semibold text-ink tabular-nums">{curIdx >= 0 ? curIdx + 1 : 1} of {needs.length}</span>
          <span className="hidden sm:inline"> · <kbd className="font-semibold text-ink">A</kbd> approve &amp; post · <kbd className="font-semibold text-ink">E</kbd> edit · <kbd className="font-semibold text-ink">S</kbd> skip · <kbd className="font-semibold text-ink">R</kbd> rewrite · <kbd className="font-semibold text-ink">D</kbd> no reply needed · <kbd className="font-semibold text-ink">Esc</kbd> stop</span>
          <span className="sm:hidden"> · the draft is written for you — approve, edit or skip</span>
        </p>
      )}
      {err && <p className="text-[12px] text-rose-700 mb-2">{err}</p>}
      {note && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 flex items-center gap-2"><span className="flex-1">{note}</span><button onClick={() => setNote(null)} className="text-amber-700 hover:text-amber-900 font-semibold">OK</button></p>}

      {view === 'needs' && selectedIds.length > 0 && (
        <div className="rounded-xl px-3 py-2 mb-2 bg-brand-600 flex items-center justify-between sticky top-0 z-10">
          <span className="text-[12px] font-semibold text-white inline-flex items-center gap-1.5"><CheckSquare size={14} /> {selectedIds.length} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected({})} className="text-[12px] font-medium text-white/80 hover:text-white">Clear</button>
            <button onClick={postSelected} disabled={bulkBusy}
              className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-white text-brand-700 hover:bg-brand-50 disabled:opacity-50">
              <Send size={12} /> {bulkBusy ? 'Posting…' : `Approve & post ${selectedIds.length}`}
            </button>
          </div>
        </div>
      )}

      {s.loading ? (
        <LeanEmpty>Loading reviews from Guesty…</LeanEmpty>
      ) : s.error ? (
        <LeanEmpty>
          Couldn&rsquo;t load reviews ({String(s.error).slice(0, 80)}).
          <button onClick={() => load()} className="ml-1.5 font-semibold text-brand-700 underline">Try again</button>
        </LeanEmpty>
      ) : view === 'replied' ? (
        replied.length === 0 ? <LeanEmpty>No replied reviews yet.</LeanEmpty> : (
          <LeanList>
            {replied.map(r => (
              <li key={r.id}>
                <div className="flex items-start gap-2.5 px-3 sm:px-4 py-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    {head(r, <Tag tone="emerald">Replied</Tag>)}
                    {text(r)}
                  </div>
                  {moreBtn(r, 'Reply')}
                </div>
                {more[r.id] && (
                  <div className="px-3 sm:px-4 pb-3 space-y-2">
                    {r.reply ? (
                      <div className="flex gap-1.5 text-[12px] text-ink bg-app border border-line rounded-lg p-2">
                        <MessageSquare size={12} className="text-brand-600 shrink-0 mt-0.5" />
                        <span className="whitespace-pre-wrap leading-relaxed">{r.reply}</span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted italic">Reply posted (text not returned by the channel).</p>
                    )}
                    {/* A reply does not fix a dirty unit. On a low review the follow-up matters MORE
                        once the public answer is out — but only where the score warrants it. */}
                    {isLow(r.rating, r.channel) && <LowPlaybook r={r} replied />}
                    {isLow(r.rating, r.channel) && <ReviewFollowUp r={r} />}
                  </div>
                )}
              </li>
            ))}
          </LeanList>
        )
      ) : view === 'unmapped' ? (
        unmapped.length === 0 ? <LeanEmpty>Nothing here — every review is on a live, connected listing.</LeanEmpty> : (
          <LeanList>
            {unmapped.map(r => (
              <li key={r.id} className="bg-slate-50/40">
                <div className="px-3 sm:px-4 py-2 space-y-1">
                  {head(r, <>
                    <Tag tone="rose" title="There is no live public page for this review to be answered on">Can&rsquo;t reply</Tag>
                    <Tag title="Shown for the record; excluded from health and OTA scores, positive or negative">{r.reason || 'Not synced'}</Tag>
                  </>)}
                  {text(r)}
                </div>
              </li>
            ))}
          </LeanList>
        )
      ) : view === 'dismissed' ? (
        dismissedList.length === 0 ? <LeanEmpty>No dismissed reviews.</LeanEmpty> : (
          <LeanList>
            {dismissedList.map(r => (
              <li key={r.id}>
                <div className="flex items-start gap-2.5 px-3 sm:px-4 py-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    {head(r)}
                    {text(r)}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => undismiss(r)} disabled={rowBusy[r.id]} title="Put it back on the reply list"
                      className={`${btn2} text-brand-700 border-brand-200 bg-brand-50 hover:bg-brand-100`}><Undo2 size={12} /> Undo</button>
                    <IconBtn title={isRemoved(r) ? 'Restore — the review counts in scores again' : 'Removed by the channel — stop counting it in every score'}
                      onClick={() => setRemoved(r, isRemoved(r))}><Trash2 size={13} /></IconBtn>
                  </div>
                </div>
              </li>
            ))}
          </LeanList>
        )
      ) : needs.length === 0 ? (
        <LeanEmpty>
          All caught up — nothing waiting on a reply. <CheckCircle2 size={14} className="inline -mt-0.5 text-emerald-500" />
          <button onClick={() => { setTab('replied'); if (mode === 'needs' && onOpenAll) onOpenAll() }} className="ml-2 font-semibold text-brand-700 hover:underline">See the {replied.length} replied</button>
        </LeanEmpty>
      ) : (
        <LeanList>
          {needs.map(r => {
            const draftText = drafts[r.id] ?? ''
            const hasDraft = !!draftText.trim()
            const sla = slaState(r)
            const busy = !!aiBusy[r.id] || !!rowBusy[r.id]
            const focused = flow && curId === r.id
            const low = isLow(r.rating, r.channel)
            const flags = hasDraft ? lintReply(draftText, r) : []
            const showBox = hasDraft || !!aiBusy[r.id] || !!more[r.id] || focused
            return (
              <li key={r.id} id={'rv-' + r.id}
                className={focused ? 'bg-brand-50/40 ring-2 ring-inset ring-brand-300' : selected[r.id] ? 'bg-brand-50/60' : ''}>
                {/* On a phone the actions sit on their own line under the review, not beside it. */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-2.5 px-3 sm:px-4 py-2">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    {!flow && (
                      <IconBtn title={selected[r.id] ? 'Unselect' : 'Select for bulk posting'} tone={selected[r.id] ? 'brand' : undefined}
                        onClick={() => setSelected(sel => ({ ...sel, [r.id]: !sel[r.id] }))}>
                        {selected[r.id] ? <CheckSquare size={14} /> : <Square size={14} />}
                      </IconBtn>
                    )}
                    <div className="flex-1 min-w-0 space-y-1" onClick={() => { if (flow && !focused) setCur(r.id) }}>
                      {/* Reply-due clock — the queue is ordered by it, so it belongs on the row. */}
                      {head(r, <>
                        {sla ? <Tag tone={sla.tone} title="Reply due within 24h for a low score, 72h otherwise">{sla.label}</Tag> : null}
                        {windowTag(r)}
                      </>)}
                      {text(r)}
                    </div>
                  </div>
                  {!focused && (
                    <div className="flex items-center gap-1 shrink-0 justify-end">
                      {hasDraft ? (
                        <button onClick={() => post(r)} disabled={rowBusy[r.id] || bulkBusy} title={'Posts publicly to ' + (r.channel || 'the channel') + ' via Guesty'}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 sm:py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                          <Send size={12} /> {rowBusy[r.id] ? 'Posting…' : 'Approve & post'}
                        </button>
                      ) : (
                        <button onClick={() => rewriteAI(r)} disabled={busy} title="Write a reply with AI — you review it before anything posts"
                          className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 sm:py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                          <Sparkles size={12} /> {aiBusy[r.id] ? 'Writing…' : 'Draft reply'}
                        </button>
                      )}
                      {moreBtn(r)}
                    </div>
                  )}
                </div>

                {showBox && (
                  <div className="px-3 sm:px-4 pb-2 space-y-1.5">
                    <textarea id={'rv-ta-' + r.id} value={draftText} onChange={e => setDraft(r.id, e.target.value)} rows={focused ? 4 : 3}
                      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); approveCur(r, false) } }}
                      placeholder={aiBusy[r.id] ? 'Writing the reply…' : 'Type a reply, or hit Draft reply.'}
                      className="w-full text-[13px] sm:text-[12.5px] leading-relaxed text-ink bg-white border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    {flags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <ShieldAlert size={12} className="text-amber-600 shrink-0" />
                        {flags.map(f => <Tag key={f.key} tone={f.block ? 'rose' : 'amber'} title={f.block ? 'Read this before it goes public — the A key will not post it' : 'Worth a second look before it goes public'}>{f.label}</Tag>)}
                      </div>
                    )}
                    {focused && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button onClick={() => approveCur(r, false)} disabled={!hasDraft || busy || bulkBusy} title={'Posts publicly to ' + (r.channel || 'the channel') + ' via Guesty, then moves to the next review (A)'}
                          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-4 py-2.5 sm:py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                          <Send size={13} /> {rowBusy[r.id] ? 'Posting…' : aiBusy[r.id] ? 'Writing…' : 'Approve & post'}
                        </button>
                        <button onClick={() => focusBox(r.id)} title="Change the wording (E)"
                          className="inline-flex items-center justify-center gap-1 text-[13px] font-semibold px-3 py-2.5 sm:py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app">
                          <Pencil size={13} /> Edit
                        </button>
                        <button onClick={() => setCur(neighbour(r.id, 1, false))} title="Leave it in the queue and move on (S)"
                          className="inline-flex items-center justify-center gap-1 text-[13px] font-semibold px-3 py-2.5 sm:py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app">
                          <SkipForward size={13} /> Skip
                        </button>
                        {moreBtn(r)}
                      </div>
                    )}
                  </div>
                )}

                {(more[r.id] || (focused && low)) && (
                  <div className="px-3 sm:px-4 pb-3 space-y-2">
                    {more[r.id] && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {hasDraft && (
                          <button onClick={() => rewriteAI(r)} disabled={busy} className={`${btn2} text-brand-700 border-brand-200 bg-brand-50 hover:bg-brand-100`}>
                            <Sparkles size={12} /> {aiBusy[r.id] ? 'Writing…' : 'Rewrite with AI'}
                          </button>
                        )}
                        <button onClick={() => { const i = window.prompt('How should the AI adjust this reply? (e.g. warmer, shorter, more professional, or: let them know we resolved the issue)'); if (i && i.trim()) rewriteAI(r, i.trim()) }}
                          disabled={busy} className={`${btn2} text-muted border-line hover:bg-app`}>
                          Rephrase…
                        </button>
                        <button onClick={() => doResearch(r)} disabled={busy}
                          title="Check what our ops systems show was actually completed at this property, then draft a reply that can say so with confidence"
                          className={`${btn2} text-muted border-line hover:bg-app`}>
                          {research[r.id]?.loading ? 'Checking…' : research[r.id]?.open ? 'Hide research' : 'Research'}
                        </button>
                        <button onClick={() => dismiss(r)} disabled={rowBusy[r.id]} title="No reply needed — clear this off the list (reversible, doesn't affect scores)"
                          className={`${btn2} text-muted border-line hover:bg-app`}>
                          <XCircle size={12} /> Dismiss
                        </button>
                        {removedBtn(r, rowBusy[r.id])}
                      </div>
                    )}
                    {more[r.id] && research[r.id]?.open && !research[r.id]?.loading && (
                      <div className="rounded-lg border border-line bg-app/60 p-2.5">
                        {research[r.id]?.evidence ? (
                          <>
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1">Verified work at this property (internal — never posted)</div>
                            <pre className="text-[11px] text-ink whitespace-pre-wrap font-sans leading-relaxed">{research[r.id].evidence.replace(/^Verified internal record[^\n]*\n/, '')}</pre>
                            <button onClick={() => rewriteAI(r, undefined, true)} disabled={busy}
                              className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                              <Sparkles size={12} /> {aiBusy[r.id] ? 'Writing…' : 'Draft detailed reply from this'}
                            </button>
                          </>
                        ) : (
                          <p className="text-[11px] text-muted">No completed work on record here in the last 45 days — the reply should not claim anything was fixed.</p>
                        )}
                      </div>
                    )}
                    {low && <LowPlaybook r={r} />}
                    {!low && r.privateFeedback ? <PrivateNote text={r.privateFeedback} /> : null}
                    <ReviewFollowUp r={r} />
                  </div>
                )}
              </li>
            )
          })}
        </LeanList>
      )}
    </section>
  )
}

// What the guest told only us. Read it, act on it, never answer it in public.
function PrivateNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-violet-700 inline-flex items-center gap-1"><Lock size={10} /> Private feedback — told only to us, never quote it publicly</div>
      <p className="text-[12px] text-ink whitespace-pre-wrap leading-relaxed mt-0.5">{text}</p>
    </div>
  )
}

// ── THE LOW-STAR PLAYBOOK, ON THE ROW ─────────────────────────────────────────────────────────────
// A 1–3 star review is four questions, and they used to live on four pages: what went wrong, is
// anyone already on it, what do we do next, and can the review be challenged. The first and last are
// read off the review itself (lib/review-playbook, instantly); the middle two are one read of our own
// systems (/api/reviews/playbook). Every draft here — the removal request, the private note — is text
// for a person to copy and send themselves. Nothing leaves Lighthouse from this panel.
type PlaybookData = { signOff: string; stay: { checkIn: string; checkOut: string } | null; ops: OpsState; score: { channel: string; n: number; onOldListing: number; display: number; scale: number; holds: string | null; next: string | null; fivesToNext: number | null; lowsToDrop: number | null; risk: string | null } | null }

function LowPlaybook({ r, replied }: { r: Review; replied?: boolean }) {
  const [d, setD] = useState<PlaybookData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  const [pane, setPane] = useState<'' | 'removal' | 'note'>('')
  const [removalText, setRemovalText] = useState('')
  const [noteText, setNoteText] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let live = true
    setState('loading')
    fetch('/api/reviews/playbook?reviewId=' + encodeURIComponent(r.id), { cache: 'no-store' })
      .then(x => x.json())
      .then(j => { if (!live) return; if (j && j.ok) { setD(j as PlaybookData); setState('ok') } else setState('err') })
      .catch(() => { if (live) setState('err') })
    return () => { live = false }
  }, [r.id])

  const pr: PlaybookReview = {
    rating: r.rating, content: r.content, channel: r.channel, guest: r.guest, listing_name: r.listing_name, created_at: r.created_at,
    privateFeedback: r.privateFeedback || null,
    categories: (r.categories || []).map(c => ({ key: c.key, label: c.label, rating: c.rating, comment: c.comment })),
  }
  const causes = rootCausesOf(pr)
  const grounds = removalGrounds(pr)
  const ops: OpsState = { ...(d ? d.ops : {}), replied: !!replied || r.hasReply }
  const steps = recoverySteps(pr, causes, ops, grounds)
  const path = removalPath(r.channel)
  const cats = r.categories || []

  const openPane = (p: 'removal' | 'note') => {
    if (pane === p) { setPane(''); return }
    if (p === 'removal' && !removalText) setRemovalText(removalDraft(pr, grounds))
    if (p === 'note' && !noteText) setNoteText(guestNoteDraft(pr, causes, d ? d.signOff : 'Stay Hospitality'))
    setPane(p)
  }
  const copy = async (what: string, textToCopy: string) => {
    try { await navigator.clipboard.writeText(textToCopy); setCopied(what); setTimeout(() => setCopied(''), 2200) } catch { setCopied('') }
  }
  const lbl = 'text-[10px] uppercase tracking-wider font-semibold text-muted'
  const btn = 'inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line bg-white text-ink hover:bg-app'

  return (
    <div className="rounded-xl border border-rose-200/70 bg-rose-50/30 p-2.5 space-y-2">
      {/* WHAT WENT WRONG */}
      <div>
        <div className={lbl}>What went wrong</div>
        {causes.length === 0 && cats.length === 0 ? (
          <p className="text-[12px] text-muted">The guest named nothing specific — the walk is how we find what earned the score.</p>
        ) : (
          <ul className="mt-0.5 space-y-1">
            {causes.map(c => (
              <li key={c.key} className="text-[12px] text-ink">
                <span className="font-semibold capitalize">{c.label}</span>{' '}
                <Tag tone={c.owner === 'maintenance' ? 'amber' : c.owner === 'clean' ? 'sky' : c.owner === 'inspection' ? 'violet' : 'slate'} title="Who owns fixing it">{c.owner}</Tag>
                {c.source === 'private' ? <> <Tag tone="violet" title="From the private feedback — do not repeat it publicly">private</Tag></> : null}
                {c.quote ? <span className="text-muted"> — “{c.quote}”</span> : null}
                <div className="text-[11.5px] text-muted">{c.action}</div>
              </li>
            ))}
          </ul>
        )}
        {cats.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1">
            {cats.map(c => <Tag key={c.key} tone={c.rating <= 3 ? 'rose' : c.rating < 5 ? 'amber' : 'slate'} title={c.comment ? '“' + c.comment + '”' : c.label + ' — the guest’s own category score'}>{c.label} {c.rating}</Tag>)}
          </div>
        )}
      </div>

      {r.privateFeedback ? <PrivateNote text={r.privateFeedback} /> : null}

      {/* WHAT TO DO — each line true of this review */}
      <div>
        <div className={lbl}>Recovery {state === 'loading' ? '· checking tasks and inspections…' : state === 'err' ? '· could not read tasks — the steps below assume nothing is open' : ''}</div>
        <ul className="mt-0.5 space-y-0.5">
          {steps.map(st => (
            <li key={st.key} className="flex items-start gap-1.5 text-[12px] text-ink">
              {st.done ? <Check size={12} className="text-emerald-600 shrink-0 mt-0.5" /> : <Circle size={11} className="text-muted shrink-0 mt-0.5" />}
              <span className={st.done ? 'text-muted' : ''}>{st.text}</span>
            </li>
          ))}
        </ul>
        {d && (d.ops.openTasks || []).length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1">
            {(d.ops.openTasks || []).slice(0, 4).map(t => (
              <a key={t.id} href={'https://app.breezeway.io/task/' + t.id} target="_blank" rel="noreferrer" title={(t.dept ? t.dept + ' · ' : '') + 'opens in Breezeway'}
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border border-line bg-white text-ink hover:bg-app max-w-full">
                <span className="truncate max-w-[14rem]">{t.name}</span>{t.date ? <span className="text-muted">{t.date.slice(5)}</span> : null}<ExternalLink size={10} className="text-muted shrink-0" />
              </a>
            ))}
          </div>
        )}
        {d && d.score && (
          <p className="text-[11.5px] text-muted mt-1">
            <span className="font-semibold text-ink">{d.score.channel} {d.score.display}{d.score.scale === 10 ? '/10' : ''}</span> on {d.score.n} review{d.score.n === 1 ? '' : 's'}
            {d.score.onOldListing ? ' (' + d.score.onOldListing + ' more on a replaced listing, not counted)' : ''}
            {d.score.risk ? ' — ' + d.score.risk + '.' : d.score.holds ? ' — holding ' + d.score.holds + '.' : '.'}
          </p>
        )}
      </div>

      {/* CAN IT BE CHALLENGED? */}
      <div>
        <div className={lbl}>Removal request</div>
        {grounds.length ? (
          <ul className="mt-0.5 space-y-1">
            {grounds.map(g => (
              <li key={g.key} className="text-[12px] text-ink">
                <span className="font-semibold">{g.label}</span>{' '}
                <Tag tone={g.strength === 'worth filing' ? 'emerald' : 'amber'} title={g.strength === 'worth filing' ? 'The review itself is the evidence' : 'Holds only with the evidence named here'}>{g.strength}</Tag>
                <div className="text-[11.5px] text-muted">Needs: {g.evidence}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted">Nothing in the wording points at a policy breach. A low score on a fair complaint is not removable — the reply and the fix are the answer.</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <button onClick={() => openPane('removal')} className={btn}>{grounds.length ? 'Draft the removal request' : 'Draft one anyway'}</button>
          <button onClick={() => openPane('note')} className={btn}>Private note to the guest</button>
          {copied && <span className="text-[11px] font-semibold text-emerald-700">Copied — {copied}</span>}
        </div>
        {pane === 'removal' && (
          <div className="mt-1.5">
            <textarea value={removalText} onChange={e => setRemovalText(e.target.value)} rows={10}
              className="w-full text-[12px] text-ink bg-white border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <button onClick={() => copy('paste it into the channel’s form', removalText)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white">Copy</button>
              <span className="text-[11px] text-muted flex-1 min-w-[12rem]">A draft for a person to complete and submit — Lighthouse sends nothing. File it at: {path.where}{d && d.stay && d.stay.checkIn ? ' Stay: ' + d.stay.checkIn + ' to ' + d.stay.checkOut + '.' : ''}</span>
            </div>
          </div>
        )}
        {pane === 'note' && (
          <div className="mt-1.5">
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={7}
              className="w-full text-[12px] text-ink bg-white border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <button onClick={() => copy('send it from the inbox', noteText)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white">Copy</button>
              <span className="text-[11px] text-muted flex-1 min-w-[12rem]">Not sent from here — paste it into the guest’s thread if you want it to go. Never ask for the review to be changed and never offer anything for it.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// A reply is only half the answer. A bad review usually needs two more things: somebody to go and
// look at the unit, and somebody TOLD — the field team, or the owner. Both are written here, because
// composing them by hand is exactly the friction that stops it happening.
// OWNERS ARE NOT AN AUDIENCE FOR A SINGLE REVIEW. Jon 2026-07-30: an owner should never be sent a
// one-off guest complaint — it reads as blame and it is not decision-grade. What an owner needs is
// the PATTERN across their own property, in a report, which is where the case for spending money
// belongs. So the drafts here are internal only.
type Audience = 'team' | 'vendor' | 'cleaner'

function draftFor(a: Audience, r: Review): string {
  const unit = r.listing_name || 'the unit'
  const stars = r.rating != null ? r.rating + '-star' : 'low'
  const when = r.created_at ? ' on ' + new Date(String(r.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const via = r.channel ? ' (' + r.channel + ')' : ''
  const quote = r.content ? '\n\n"' + String(r.content).trim().replace(/\s+/g, ' ').slice(0, 500) + '"' : ''

  // Vendor partners manage and clean some of these buildings (Botanica, Park Towers, Capri,
  // Lucerne, Amrit). They are a partner company, not staff — so this reads as a professional
  // hand-off with a specific ask and a deadline, not an instruction.
  if (a === 'vendor') return [
    'Hi — flagging a guest review on ' + unit + when + via + ' so your team can take a look.',
    quote,
    '\n\nCould someone check the unit before the next arrival and confirm back what was found and',
    ' what was done? Happy to jump on a call if it is easier.',
  ].join('')

  if (a === 'cleaner') return [
    'Hi — a guest left a ' + stars + ' review on ' + unit + when + ' and mentioned the following:',
    quote,
    '\n\nNothing to worry about, but can we go over this together so we know what to look for on the',
    ' next turn there? I will walk it with you if that is easier.',
  ].join('')

  return [
    '*' + unit + '* — ' + stars + ' review' + (r.guest ? ' from ' + r.guest : '') + when + via + '.',
    quote,
    '\n\nCan someone walk the unit before the next guest and confirm this is sorted? Reply here with what you find.',
  ].join('')
}

function ReviewFollowUp({ r }: { r: Review }) {
  const [mode, setMode] = useState<'' | 'task' | 'share'>('')
  const [audience, setAudience] = useState<Audience>('team')
  const [text, setText] = useState('')
  const [date, setDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()))
  const [who, setWho] = useState('')
  const [people, setPeople] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { setText(draftFor(audience, r)) }, [audience, r])
  useEffect(() => {
    if (mode !== 'task' || people.length) return
    fetch('/api/breezeway/people', { cache: 'no-store' }).then(x => x.json())
      .then(j => setPeople(((j?.people || j || []) as any[]).filter((p: any) => p && p.name))).catch(() => {})
  }, [mode, people.length])

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(''), 2200) }

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); flash('Copied — paste it wherever you need it') }
    catch { setErr('Could not copy — select the text and copy it manually') }
  }
  const createTask = async () => {
    setBusy(true); setErr('')
    try {
      const match = people.find((p: any) => String(p.name).toLowerCase() === who.trim().toLowerCase())
      const description = 'Raised in Lighthouse from a ' + (r.rating != null ? r.rating + '-star ' : '') + 'review'
        + (r.guest ? ' by ' + r.guest : '') + (r.channel ? ' on ' + r.channel : '')
        + (r.created_at ? ' (' + String(r.created_at).slice(0, 10) + ')' : '') + '.\n\nWhat the guest said:\n' + (r.content || '')
      // "Quality inspection — " is the naming convention lib/task-audit's REVIEW_RULE matches on.
      // Titled anything else, a review inspection is classified STRAY and the stray sweep cancels
      // it in Breezeway about a week later — which is what happened to every inspection this button
      // has ever created (fixed 2026-09-09).
      const res = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: r.listingId,
          title: 'Quality inspection — ' + (r.listing_name || 'unit') + (r.rating != null ? ' (' + r.rating + '★ review)' : ''),
          department: 'inspection', priority: 'normal', description, date, assigneeIds: match ? [match.id] : [],
        }),
      })
      const j = await res.json()
      if (!j.ok && !j.task && !j.taskId) throw new Error(j.error || 'Could not create the task')
      setDone(String(j.taskId || j.task?.id || '') || 'created'); setMode('')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  if (!r.listingId && !done) return null
  const tab = (k: Audience, label: string) => (
    <button key={k} onClick={() => setAudience(k)}
      className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${audience === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:bg-app'}`}>{label}</button>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {done ? (
          done !== 'created'
            ? <a href={'https://app.breezeway.io/task/' + done} target="_blank" rel="noreferrer" className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300">Task created {'\u2197'}</a>
            : <span className="text-[11px] font-semibold text-emerald-700">Task created</span>
        ) : (
          <button onClick={() => setMode(mode === 'task' ? '' : 'task')} className="text-[11px] font-semibold px-2 py-1 rounded-lg text-ink border border-line hover:bg-app">Push to Breezeway</button>
        )}
        <button onClick={() => setMode(mode === 'share' ? '' : 'share')} className="text-[11px] font-semibold px-2 py-1 rounded-lg text-ink border border-line hover:bg-app">Draft a message</button>
        {note && <span className="text-[11px] font-semibold text-emerald-700">{note}</span>}
        {err && <span className="text-[11px] text-red-700">{err}</span>}
      </div>

      {mode === 'task' && (
        <div className="mt-2 flex flex-wrap items-end gap-2 bg-app border border-line rounded-lg p-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted font-semibold">When</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-xs border border-line rounded-md px-2 py-1 bg-white" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted font-semibold">Who</label>
            <input list="rev-people" value={who} onChange={e => setWho(e.target.value)} placeholder="leave blank to assign later" className="text-xs border border-line rounded-md px-2 py-1 bg-white w-48 max-w-full" />
            <datalist id="rev-people">{people.map((p: any) => <option key={p.id} value={p.name} />)}</datalist>
          </div>
          <span className="text-[10px] text-muted pb-1">Quality inspection {'\u00b7'} inspection</span>
          <button onClick={createTask} disabled={busy} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Creating…' : 'Create in Breezeway'}</button>
        </div>
      )}

      {mode === 'share' && (
        <div className="mt-2 bg-app border border-line rounded-lg p-2">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted font-semibold mr-1">Written for</span>
            {tab('team', 'Our team')}{tab('vendor', 'Vendor partner')}{tab('cleaner', 'The cleaner')}
            <button onClick={() => setMode('')} title="Close the draft" className="ml-auto text-[11px] font-semibold text-muted hover:text-ink px-1.5">Close {'\u00d7'}</button>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
            className="w-full text-xs text-ink bg-white border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <button onClick={copy} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-ink text-white">Copy</button>
            <button onClick={() => setMode('')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-muted border border-line hover:bg-white">Close</button>
            <span className="text-[10px] text-muted">Edit it first if you want — copy, then paste it wherever it needs to go.</span>
          </div>
        </div>
      )}
    </div>
  )
}
