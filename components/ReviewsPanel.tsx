'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Send, Sparkles, MessageSquare, ArrowDownWideNarrow, ArrowUpNarrowWide, Square, CheckSquare, XCircle, RefreshCw, Trash2, ChevronDown, Undo2 } from 'lucide-react'
import { Tag, Clamp, IconBtn, LeanList, LeanEmpty, type Tone } from '@/components/lean'

type Review = { id: string; rating: number | null; content: string; channel: string; listing_name?: string; listingId?: string; guest?: string; created_at?: string; hasReply: boolean; reply?: string; reason?: string; dismissed?: boolean; removed?: boolean; removedReason?: string | null; building?: string | null; market?: string | null; ownerId?: string; ownerName?: string }

// THE FEED OBEYS THE BOARD ABOVE IT (Jon, 2026-09-09: "the main page should be KPI and where we can
// review or respond to reviews"). One filter bar on /reviews drives the numbers AND this list, so a
// page filtered to one owner's building shows that owner's reviews rather than the whole portfolio
// next to numbers for a slice of it. Both props are optional — a caller that renders this panel on
// its own gets the old unfiltered behaviour.
export type ReviewFeedFilter = { market: string; building: string; owner: string; channel: string; days: number }

const SIGN = '— Stay Hospitality'

function agoLabel(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago'
}

// Build a reply tailored to what the guest actually mentioned (no fault admission, warm, specific).
function draftReply(r: Review): string {
  const t = (r.content || '').toLowerCase()
  const low = r.rating != null && (r.rating <= 3 || (r.rating > 5 && r.rating <= 7))
  const first = (r.guest || '').trim().split(/\s+/)[0]
  const hi = first ? `Hi ${first}, ` : ''

  // Sensitive allegations (bed bugs / pests / intrusion / someone walking in): NEVER affirm or name them.
  if (/bed.?bug|bedbug|\bbugs?\b|roach|cockroach|\binsect|\bpest|rodent|\bmice\b|\brat\b|intrud|broke in|broke into|let themselves in|someone (came|walked|enter)|unauthorized|barged|walked in on/.test(t)) {
    return `${hi}thank you for sharing your feedback. We take concerns like this seriously and have taken corrective action to ensure we keep delivering the experience our guests deserve. We'd welcome the opportunity to host you again. ${SIGN}`
  }

  if (!low) {
    const pos: string[] = []
    if (/clean|spotless|tidy|immaculate/.test(t)) pos.push('the spotless space')
    if (/location|located|walk|beach|close|near|convenient/.test(t)) pos.push('the location')
    if (/host|communicat|responsive|helpful|check.?in/.test(t)) pos.push('a smooth, responsive experience')
    if (/comfort|cozy|spacious|view|pool/.test(t)) pos.push('the comfort of the space')
    const ref = pos.length ? ` We're so glad ${pos.slice(0, 2).join(' and ')} stood out.` : ''
    return `${hi}thank you so much for the wonderful review!${ref} It was a pleasure hosting you, and we'd love to welcome you back anytime. ${SIGN}`
  }

  const issues: string[] = []
  if (/clean|dirty|stain|hair|dust|filth|sheet|towel/.test(t)) issues.push('the cleanliness not meeting our usual standard')
  if (/smell|odor|odour|sewer|musty|sewage/.test(t)) issues.push('the odor you noticed')
  if (/\bac\b|a\/c|air.?condition|\bhot\b|\bcold\b|temperature|stuffy/.test(t)) issues.push('the comfort and temperature')
  if (/check.?in|door.?code|\bcode\b|lock|lockout|access|\bkey\b|entry/.test(t)) issues.push('the trouble getting in')
  if (/noise|loud|noisy|thin wall|hear/.test(t)) issues.push('the noise')
  if (/wifi|wi-fi|internet|\btv\b|connection/.test(t)) issues.push('the connectivity issues')
  if (/parking|\bpark\b|garage|valet/.test(t)) issues.push('the parking confusion')
  if (/bed|mattress|pillow|sofa|couch|furniture|broke|broken|damag/.test(t)) issues.push('the issue with the furnishings')
  if (/photo|picture|looked|different|advertise|not as|misleading|motel/.test(t)) issues.push('the gap between what was shown and your experience')
  if (/pool|hot tub|amenit/.test(t)) issues.push('the amenities falling short')
  if (/staff|reception|front.?desk|rude|service/.test(t)) issues.push('the service experience')

  const list = issues.length === 0 ? 'parts of your stay falling short'
    : issues.length === 1 ? issues[0]
    : issues.slice(0, 3).slice(0, -1).join(', ') + ' and ' + issues.slice(0, 3).slice(-1)

  return `${hi}thank you for taking the time to share this, and we're sorry to hear about ${list}. That's genuinely not the experience we aim to provide, and we've shared your feedback directly with our team so we can make it right. We'd welcome the chance to host you again and show you the stay you should have had. ${SIGN}`
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

  const isLow = (n: number | null) => n != null && (n <= 3 || (n > 5 && n <= 7))
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
    const dueH = isLow(r.rating) ? 24 : 72
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

  function setDraft(id: string, v: string) { setDrafts(d => ({ ...d, [id]: v })) }

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

  async function rewriteAI(r: Review, instruction?: string, withEvidence?: boolean) {
    setAiBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      // Retry on the org's 5-req/min rate limit with a backoff so drafts still land.
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch('/api/reviews/draft', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: r.content, rating: r.rating, listing_name: r.listing_name, guest: r.guest, channel: r.channel, instruction, currentDraft: drafts[r.id] || '', listingId: r.listingId, withEvidence: !!withEvidence })
        })
        const d = await res.json()
        if (res.ok && d.draft) { setDraft(r.id, d.draft); return }
        const msg = d.error || `HTTP ${res.status}`
        if (/429|rate limit/i.test(msg) && attempt < 3) { await sleep(15000); continue }
        throw new Error(msg)
      }
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setAiBusy(b => ({ ...b, [r.id]: false })) }
  }

  async function draftAllAI() {
    setAllAi(true); setErr(null)
    for (let i = 0; i < needs.length; i++) { await rewriteAI(needs[i]); if (i < needs.length - 1) await sleep(13000) }   // ~5/min org limit
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

  async function post(r: Review) {
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try { if (await postOne(r)) { setPosted(p => ({ ...p, [r.id]: true })); setPostedAt(pa => ({ ...pa, [r.id]: Date.now() })) } }
    catch (e: any) { setErr(e?.message || String(e)) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
  }

  async function postSelected() {
    if (!selectedIds.length) return
    setBulkBusy(true); setErr(null)
    const done: Record<string, boolean> = {}
    try {
      for (const r of selectedIds) { try { if (await postOne(r)) done[r.id] = true } catch (e: any) { setErr(e?.message || String(e)) } }
    } finally {
      setPosted(p => ({ ...p, ...done })); setPostedAt(pa => ({ ...pa, ...Object.fromEntries(Object.keys(done).map(id => [id, Date.now()])) })); setSelected({}); setBulkBusy(false)
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
  const head = (r: Review, extra?: ReactNode) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Tag tone={isLow(r.rating) ? 'rose' : 'emerald'} title="Guest score">{'★ '}{fmtRating(r.rating, r.channel)}</Tag>
      <span className="text-[13.5px] font-semibold text-ink truncate max-w-[14rem]">{r.listing_name}</span>
      {r.guest && <span className="text-[12px] text-muted truncate max-w-[10rem]">{r.guest}</span>}
      {r.channel && <Tag>{r.channel}</Tag>}
      {r.created_at && <span className="text-[11.5px] text-muted whitespace-nowrap">{fmtDate(r.created_at)}</span>}
      {extra}
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

  return (
    <section>
      {/* ── TOOLBAR: status sub-tabs (All reviews), search, queue tools, refresh — one line ─────── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {mode !== 'needs' && (
          <div className="inline-flex rounded-lg border border-line overflow-hidden max-w-full overflow-x-auto">
            {subTab('needs', 'Needs a reply', needs.length, 'Unreplied, most overdue first',
              !s.loading && overdueCount > 0 ? <span className="ml-0.5 px-1 rounded bg-rose-100 text-rose-700 font-bold" title="Unreplied past SLA (24h for low scores, 72h otherwise)">{overdueCount}</span> : null)}
            {subTab('replied', 'Replied', replied.length)}
            {subTab('unmapped', 'Not synced', unmapped.length, 'Reviews on listings not connected to their channel — can’t be replied to, and never count toward scores')}
            {subTab('dismissed', 'Dismissed', dismissedList.length, 'Cleared as no-reply-needed — off the list but still counted in scores. Undo moves one back.')}
          </div>
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
          <button onClick={draftAllAI} disabled={allAi} title="Write an AI draft for every review in the queue (about 5 a minute)"
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
                    {isLow(r.rating) && <ReviewFollowUp r={r} />}
                  </div>
                )}
              </li>
            ))}
          </LeanList>
        )
      ) : view === 'unmapped' ? (
        unmapped.length === 0 ? <LeanEmpty>No unsynced listings — everything is connected.</LeanEmpty> : (
          <LeanList>
            {unmapped.map(r => (
              <li key={r.id} className="bg-slate-50/40">
                <div className="px-3 sm:px-4 py-2 space-y-1">
                  {head(r, <>
                    <Tag tone="rose" title="The listing is not connected to its channel, so there is nothing to reply through">Can&rsquo;t reply</Tag>
                    <Tag title="Excluded from health and OTA scores, positive or negative">{r.reason || 'Not synced'}</Tag>
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
            const hasDraft = !!(drafts[r.id] || '').trim()
            const sla = slaState(r)
            const busy = !!aiBusy[r.id] || !!rowBusy[r.id]
            return (
              <li key={r.id} className={selected[r.id] ? 'bg-brand-50/60' : ''}>
                <div className="flex items-start gap-2.5 px-3 sm:px-4 py-2">
                  <IconBtn title={selected[r.id] ? 'Unselect' : 'Select for bulk posting'} tone={selected[r.id] ? 'brand' : undefined}
                    onClick={() => setSelected(sel => ({ ...sel, [r.id]: !sel[r.id] }))}>
                    {selected[r.id] ? <CheckSquare size={14} /> : <Square size={14} />}
                  </IconBtn>
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* Reply-due clock — the queue is ordered by it, so it belongs on the row. */}
                    {head(r, sla ? <Tag tone={sla.tone} title="Reply due within 24h for a low score, 72h otherwise">{sla.label}</Tag> : null)}
                    {text(r)}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {hasDraft ? (
                      <button onClick={() => post(r)} disabled={rowBusy[r.id] || bulkBusy} title={'Posts publicly to ' + (r.channel || 'the channel') + ' via Guesty'}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                        <Send size={12} /> {rowBusy[r.id] ? 'Posting…' : 'Approve & post'}
                      </button>
                    ) : (
                      <button onClick={() => rewriteAI(r)} disabled={busy} title="Write a reply with AI — you review it before anything posts"
                        className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                        <Sparkles size={12} /> {aiBusy[r.id] ? 'Writing…' : 'Draft reply'}
                      </button>
                    )}
                    {moreBtn(r)}
                  </div>
                </div>

                {(hasDraft || aiBusy[r.id] || more[r.id]) && (
                  <div className="px-3 sm:px-4 pb-2">
                    <textarea value={drafts[r.id] ?? ''} onChange={e => setDraft(r.id, e.target.value)} rows={3}
                      placeholder={aiBusy[r.id] ? 'Writing the AI reply…' : 'Type a reply, or hit Draft reply.'}
                      className="w-full text-[12px] text-ink bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  </div>
                )}

                {more[r.id] && (
                  <div className="px-3 sm:px-4 pb-3 space-y-2">
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
                    {research[r.id]?.open && !research[r.id]?.loading && (
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
