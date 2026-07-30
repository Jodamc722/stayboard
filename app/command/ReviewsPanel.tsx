'use client'
import { useEffect, useState } from 'react'
import { Star, MessageSquareWarning, CheckCircle2, Send, Sparkles, MessageSquare, ArrowDownWideNarrow, ArrowUpNarrowWide, Square, CheckSquare, PlugZap, XCircle, Ban } from 'lucide-react'

type Review = { id: string; rating: number | null; content: string; channel: string; listing_name?: string; listingId?: string; guest?: string; created_at?: string; hasReply: boolean; reply?: string; reason?: string; dismissed?: boolean }

const SIGN = '— Stay Hospitality'

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

export function ReviewsPanel() {
  const [s, setS] = useState<{ loading: boolean; reviews?: Review[]; unmapped?: Review[]; error?: string }>({ loading: true })
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
  const [query, setQuery] = useState('')
  const [dismissedLocal, setDismissedLocal] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/reviews').then(r => r.json())
      .then(d => {
        const reviews: Review[] = d.reviews || []
        setS({ loading: false, reviews, unmapped: d.unmapped || [], error: d.error })
        // No template placeholders — drafts stay empty until the AI writes the real one.
      })
      .catch(e => setS({ loading: false, error: String(e) }))
  }, [])

  // Auto-drafting disabled: drafts are written on demand via the AI buttons below.

  const isLow = (n: number | null) => n != null && (n <= 3 || (n > 5 && n <= 7))
  const fmtRating = (n: number | null) => n == null ? '—' : (n <= 5 ? `${n}/5` : `${n}/10`)

  // Filter by building / unit / channel via the search box (matches the listing name + channel).
  const q = query.trim().toLowerCase()
  const matchQ = (r: Review) => !q || `${r.listing_name || ''} ${r.channel || ''}`.toLowerCase().includes(q)
  const isDismissed = (r: Review) => !!r.dismissed || !!dismissedLocal[r.id]
  const needs = (s.reviews || [])
    .filter(r => !r.hasReply && !posted[r.id] && !isDismissed(r) && matchQ(r))
    .sort((a, b) => sortDir === 'desc' ? ratingFrac(b.rating) - ratingFrac(a.rating) : ratingFrac(a.rating) - ratingFrac(b.rating))
  const replied = (s.reviews || [])
    .filter(r => (r.hasReply || posted[r.id]) && matchQ(r))
    .sort((a, b) => (postedAt[b.id] || 0) - (postedAt[a.id] || 0) || (b.created_at || '').localeCompare(a.created_at || ''))
  const unmapped = (s.unmapped || []).filter(matchQ)
  const dismissedList = (s.reviews || []).filter(r => isDismissed(r) && matchQ(r))
  const selectedIds = needs.filter(r => selected[r.id])

  function setDraft(id: string, v: string) { setDrafts(d => ({ ...d, [id]: v })) }

  async function rewriteAI(r: Review, instruction?: string) {
    setAiBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      // Retry on the org's 5-req/min rate limit with a backoff so drafts still land.
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch('/api/reviews/draft', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: r.content, rating: r.rating, listing_name: r.listing_name, guest: r.guest, channel: r.channel, instruction, currentDraft: drafts[r.id] || '' })
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
    const res = await fetch('/api/reviews/reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: r.id, reviewReply: text })
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
    // Optimistically reflect the posted reply so it shows immediately (text + replied state),
    // without waiting for the next Guesty sync.
    setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, hasReply: true, reply: text } : x) }))
    return true
  }

  async function post(r: Review) {
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try { await postOne(r); setPosted(p => ({ ...p, [r.id]: true })); setPostedAt(pa => ({ ...pa, [r.id]: Date.now() })) }
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

  async function dismiss(r: Review) {
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    setDismissedLocal(d => ({ ...d, [r.id]: true }))
    try {
      const res = await fetch('/api/reviews/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id }) })
      const d = await res.json().catch(() => ({})); if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
    } catch (e: any) { setErr(e?.message || String(e)); setDismissedLocal(d => ({ ...d, [r.id]: false })) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
  }
  async function undismiss(r: Review) {
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      const res = await fetch('/api/reviews/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id, undo: true }) })
      const d = await res.json().catch(() => ({})); if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setDismissedLocal(d => ({ ...d, [r.id]: false }))
      setS(prev => ({ ...prev, reviews: (prev.reviews || []).map(x => x.id === r.id ? { ...x, dismissed: false } : x) }))
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden lg:col-span-3">
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink text-sm flex items-center gap-1.5"><MessageSquareWarning size={14} className="text-brand-600" /> Reviews</h2>
          <span className="text-[11px] text-muted">Live from Guesty</span>
        </div>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <button onClick={() => setTab('needs')}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${tab === 'needs' ? 'bg-brand-600 text-white' : 'text-muted border border-line hover:bg-app'}`}>
            <MessageSquareWarning size={12} /> Needs a reply <span className={`ml-0.5 px-1 rounded ${tab === 'needs' ? 'bg-white/20' : 'bg-app'}`}>{s.loading ? '…' : needs.length}</span>
          </button>
          <button onClick={() => setTab('replied')}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${tab === 'replied' ? 'bg-brand-600 text-white' : 'text-muted border border-line hover:bg-app'}`}>
            <CheckCircle2 size={12} /> Replied <span className={`ml-0.5 px-1 rounded ${tab === 'replied' ? 'bg-white/20' : 'bg-app'}`}>{s.loading ? '…' : replied.length}</span>
          </button>
          <button onClick={() => setTab('unmapped')}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${tab === 'unmapped' ? 'bg-slate-600 text-white' : 'text-muted border border-line hover:bg-app'}`} title="Reviews on listings not synced to their channel — shown for visibility, can't be replied to, and never count toward scores">
            <PlugZap size={12} /> Not synced <span className={`ml-0.5 px-1 rounded ${tab === 'unmapped' ? 'bg-white/20' : 'bg-app'}`}>{s.loading ? '…' : unmapped.length}</span>
          </button>
          <button onClick={() => setTab('dismissed')}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${tab === 'dismissed' ? 'bg-slate-600 text-white' : 'text-muted border border-line hover:bg-app'}`} title="Reviews you cleared as no-reply-needed — off the list but still counted in scores">
            <XCircle size={12} /> Dismissed <span className={`ml-0.5 px-1 rounded ${tab === 'dismissed' ? 'bg-white/20' : 'bg-app'}`}>{s.loading ? '…' : dismissedList.length}</span>
          </button>
          {tab === 'needs' && !s.loading && needs.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-muted border border-line hover:bg-app">
                {sortDir === 'desc' ? <ArrowDownWideNarrow size={12} /> : <ArrowUpNarrowWide size={12} />} {sortDir === 'desc' ? 'High → Low' : 'Low → High'}
              </button>
              <button onClick={draftAllAI} disabled={allAi}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 disabled:opacity-50">
                <Sparkles size={12} /> {allAi ? 'Drafting…' : 'Draft all with AI'}
              </button>
              <button onClick={() => setSelected(needs.every(r => selected[r.id]) ? {} : Object.fromEntries(needs.map(r => [r.id, true])))}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-muted border border-line hover:bg-app">
                {needs.every(r => selected[r.id]) ? <CheckSquare size={12} /> : <Square size={12} />} {needs.every(r => selected[r.id]) ? 'Clear' : 'Select all'}
              </button>
            </div>
          )}
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by building, unit, or channel… (e.g. Capri, 214, airbnb)"
          className="mt-2 w-full text-xs text-ink bg-app border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        {err && <p className="text-[11px] text-red-600 mt-1.5">{err}</p>}
      </div>

      {tab === 'needs' && selectedIds.length > 0 && (
        <div className="px-4 py-2.5 bg-brand-600 flex items-center justify-between sticky top-0 z-10">
          <span className="text-xs font-semibold text-white inline-flex items-center gap-1.5"><CheckSquare size={14} /> {selectedIds.length} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected({})} className="text-xs font-medium text-white/80 hover:text-white">Clear</button>
            <button onClick={postSelected} disabled={bulkBusy}
              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white text-brand-700 hover:bg-brand-50 disabled:opacity-50">
              <Send size={12} /> {bulkBusy ? 'Posting…' : `Approve & post ${selectedIds.length}`}
            </button>
          </div>
        </div>
      )}

      {s.loading ? (
        <div className="px-4 py-8 text-center text-sm text-muted">Loading reviews from Guesty…</div>
      ) : s.error ? (
        <div className="px-4 py-6 text-center text-sm text-muted">Couldn’t load reviews ({String(s.error).slice(0, 80)}). Reload to retry.</div>
      ) : tab === 'replied' ? (
        replied.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No replied reviews yet.</div>
        ) : (
          <ul className="divide-y divide-line/70">
            {replied.map(r => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    <Star size={11} /> {fmtRating(r.rating)}
                  </span>
                  <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>{r.guest && <span className="text-[11px] text-muted whitespace-nowrap">· {r.guest}</span>}
                  {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                {r.created_at && <span className="text-[10px] text-muted whitespace-nowrap font-medium">{fmtDate(r.created_at)}</span>}
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1"><CheckCircle2 size={11} /> Replied</span>
                </div>
                {r.content && <p className="text-xs text-muted mt-1.5 whitespace-pre-wrap leading-relaxed">{r.content}</p>}
                {r.reply ? (
                  <div className="mt-2 flex gap-1.5 text-xs text-ink bg-app border border-line rounded-lg p-2">
                    <MessageSquare size={12} className="text-brand-600 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-wrap leading-relaxed">{r.reply}</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-muted mt-1.5 italic">Reply posted (text not returned by the channel).</p>
                )}
                {/* A reply does not fix a dirty unit. On a low review the follow-up matters MORE once
                    the public answer is out, so the actions live here too — but only where the score
                    warrants it, otherwise every five-star review grows buttons nobody needs. */}
                {isLow(r.rating) && <ReviewFollowUp r={r} />}
              </li>
            ))}
          </ul>
        )
      ) : tab === 'unmapped' ? (
        unmapped.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No unsynced listings. Everything is connected. <CheckCircle2 size={14} className="inline -mt-0.5 text-emerald-500" /></div>
        ) : (
          <>
            <div className="px-4 pt-3 pb-1 text-[11px] text-muted">These reviews are on listings no longer connected to their channel, so <b>they can't be replied to</b> — shown here for visibility only. Confirmed: they are <b>excluded from your health and OTA scores</b> (positive or negative), so they are not helping or hurting your numbers.</div>
            <ul className="divide-y divide-line/70">
              {unmapped.map(r => (
                <li key={r.id} className="px-4 py-3 border-l-[3px] border-slate-300 bg-slate-50/40">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      <Star size={11} /> {fmtRating(r.rating)}
                    </span>
                    <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>{r.guest && <span className="text-[11px] text-muted whitespace-nowrap">· {r.guest}</span>}
                    {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                {r.created_at && <span className="text-[10px] text-muted whitespace-nowrap font-medium">{fmtDate(r.created_at)}</span>}
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1"><Ban size={11} /> Can't reply</span>
                    <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1"><PlugZap size={11} /> {r.reason || 'Not synced'}</span>
                  </div>
                  {r.content && <p className="text-xs text-muted mt-1.5 whitespace-pre-wrap leading-relaxed">{r.content}</p>}
                </li>
             )) }
            </ul>
          </>
        )
      ) : tab === 'dismissed' ? (
        dismissedList.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No dismissed reviews.</div>
        ) : (
          <>
            <div className="px-4 pt-3 pb-1 text-[11px] text-muted">Reviews you cleared as &ldquo;no reply needed.&rdquo; They still count toward your scores — they&rsquo;re just off the reply list. Hit Undo to move one back.</div>
            <ul className="divide-y divide-line/70">
              {dismissedList.map(r => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      <Star size={11} /> {fmtRating(r.rating)}
                    </span>
                    <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>{r.guest && <span className="text-[11px] text-muted whitespace-nowrap">· {r.guest}</span>}
                    {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                {r.created_at && <span className="text-[10px] text-muted whitespace-nowrap font-medium">{fmtDate(r.created_at)}</span>}
                    <button onClick={() => undismiss(r)} disabled={rowBusy[r.id]} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 disabled:opacity-50">Undo</button>
                  </div>
                  {r.content && <p className="text-xs text-muted mt-1.5 whitespace-pre-wrap leading-relaxed">{r.content}</p>}
                </li>
              ))}
            </ul>
          </>
        )
      ) : needs.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted">All caught up on reviews. <CheckCircle2 size={14} className="inline -mt-0.5 text-emerald-500" /></div>
      ) : (
        <ul className="divide-y divide-line/70">
          {needs.map(r => (
            <li key={r.id} className={`px-4 py-3 border-l-[3px] transition-colors ${selected[r.id] ? 'bg-brand-50/70 border-brand-500' : 'border-transparent'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setSelected(sel => ({ ...sel, [r.id]: !sel[r.id] }))}
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${selected[r.id] ? 'bg-brand-600 text-white' : 'text-muted border border-line hover:bg-app'}`}>
                  {selected[r.id] ? <CheckSquare size={14} /> : <Square size={14} />} {selected[r.id] ? 'Selected' : 'Select'}
                </button>
                <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  <Star size={11} /> {fmtRating(r.rating)}
                </span>
                <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>{r.guest && <span className="text-[11px] text-muted whitespace-nowrap">· {r.guest}</span>}
                {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                {r.created_at && <span className="text-[10px] text-muted whitespace-nowrap font-medium">{fmtDate(r.created_at)}</span>}
              </div>
              {r.content && <p className="text-xs text-muted mt-1.5 whitespace-pre-wrap leading-relaxed">{r.content}</p>}

              <div className="mt-2">
                <textarea value={drafts[r.id] ?? ''} onChange={e => setDraft(r.id, e.target.value)} rows={4}
                  placeholder={aiBusy[r.id] ? 'Writing the AI reply…' : 'No AI draft yet — hit “Rewrite with AI”, or “Draft all with AI” up top.'}
                  className="w-full text-xs text-ink bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button onClick={() => post(r)} disabled={rowBusy[r.id] || bulkBusy || !(drafts[r.id] || '').trim()}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                    <Send size={12} /> {rowBusy[r.id] ? 'Posting…' : 'Approve & post'}
                  </button>
                  <button onClick={() => rewriteAI(r)} disabled={aiBusy[r.id] || rowBusy[r.id]}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 disabled:opacity-50">
                    <Sparkles size={12} /> {aiBusy[r.id] ? 'Writing…' : 'Rewrite with AI'}
                  </button>
                  <button onClick={() => { const i = window.prompt('How should the AI adjust this reply? (e.g. warmer, shorter, more professional, or: let them know we resolved the issue)'); if (i && i.trim()) rewriteAI(r, i.trim()) }}
                    disabled={aiBusy[r.id] || rowBusy[r.id]}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-muted border border-line hover:bg-app disabled:opacity-50">
                    Rephrase…
                  </button>
                  <button onClick={() => dismiss(r)} disabled={rowBusy[r.id]} title="No reply needed — clear this off the list (reversible, doesn't affect scores)"
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-muted border border-line hover:bg-app disabled:opacity-50">
                    <XCircle size={12} /> Dismiss
                  </button>
                  <span className="text-[10px] text-muted">Posts publicly to {r.channel || 'the channel'} via Guesty.</span>
                </div>
                <ReviewFollowUp r={r} />
              </div>
            </li>
          ))}
        </ul>
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
  const toSlack = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/reviews/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const j = await res.json()
      if (j.ok) flash('Sent to Slack')
      else setErr(j.error || 'Could not send')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const createTask = async () => {
    setBusy(true); setErr('')
    try {
      const match = people.find((p: any) => String(p.name).toLowerCase() === who.trim().toLowerCase())
      const description = 'Raised from a ' + (r.rating != null ? r.rating + '-star ' : '') + 'review'
        + (r.guest ? ' by ' + r.guest : '') + (r.channel ? ' on ' + r.channel : '')
        + (r.created_at ? ' (' + String(r.created_at).slice(0, 10) + ')' : '') + '.\n\nWhat the guest said:\n' + (r.content || '')
      const res = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: r.listingId, title: 'Guest-feedback inspection — ' + (r.listing_name || 'unit'),
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
    <div className="mt-2 pt-2 border-t border-line/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">Do something about it</span>
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
            <input list="rev-people" value={who} onChange={e => setWho(e.target.value)} placeholder="leave blank to assign later" className="text-xs border border-line rounded-md px-2 py-1 bg-white w-56" />
            <datalist id="rev-people">{people.map((p: any) => <option key={p.id} value={p.name} />)}</datalist>
          </div>
          <span className="text-[10px] text-muted pb-1">Guest-feedback inspection {'\u00b7'} inspection</span>
          <button onClick={createTask} disabled={busy} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Creating…' : 'Create in Breezeway'}</button>
        </div>
      )}

      {mode === 'share' && (
        <div className="mt-2 bg-app border border-line rounded-lg p-2">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted font-semibold mr-1">Written for</span>
            {tab('team', 'Our team')}{tab('vendor', 'Vendor partner')}{tab('cleaner', 'The cleaner')}
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
            className="w-full text-xs text-ink bg-white border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <button onClick={copy} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-ink text-white">Copy</button>
            <button onClick={toSlack} disabled={busy} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-ink border border-line hover:bg-white disabled:opacity-50">{busy ? 'Sending…' : 'Send to Slack'}</button>
            <a href={'sms:?&body=' + encodeURIComponent(text)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-ink border border-line hover:bg-white">Text it</a>
            <a href={'mailto:?subject=' + encodeURIComponent((r.listing_name || 'Unit') + ' — guest review') + '&body=' + encodeURIComponent(text)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-ink border border-line hover:bg-white">Email it</a>
            <span className="text-[10px] text-muted">Edit it first if you want — nothing sends until you press a button.</span>
          </div>
        </div>
      )}
    </div>
  )
}
