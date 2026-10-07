'use client'
// THE BULLETIN — one cycling slide strip at the top of Today (Jon, 2026-10-06). Replaced the week
// Scoreboard; then, after the first two looks: "nothing should be static … everything should be
// cycling … a quote of the day that takes up the page … Eve's recommendations, things to prioritize
// … still too big, too clunky, not cohesive with our name, should look professional and clean".
//
// So: ONE card, one slide at a time, in Lighthouse's own type and colours (the display serif for the
// one big thing on each slide, ink on white, the app's emerald / amber / rose for state). It
// advances every few seconds with a thin progress line; it pauses while you point at it, type in it
// or have the post form open; the dots and arrows jump. Every slide is something:
//   Ops health    the day's one number (computed in DayKpis, lib/ops-health; health-bus carries it)
//   Have to       the day's must-dos + leader reminders (tick done in place)
//   Eve recommends one plan per slide from her latest review — what to prioritise, and the first step
//   Stats         welcome calls (3 / 7 days), glitch close time, 5★ reviews, guest rating, billable
//                 this week and claims recovered (money switch only)
//   Posts         Employee of the month, Quote of the day (a full slide), shout-outs, five-star
//                 reviews, announcements — with reactions
// Rules: lib/bulletin.ts. Data: /api/command/bulletin (+ /stats), /api/command/scoreboard,
// /api/eve/review (plans), the day already loaded (d.tiles).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Plus, Trash2, X, Check, Loader2, ChevronLeft, ChevronRight, Pin, ImagePlus, Crop } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { SCOREBOARD_URL } from '@/components/command/Scoreboard'
import { useHealth } from '@/components/command/health-bus'
import type { OpsHealth } from '@/lib/ops-health'
import type { CommandDay } from '@/lib/command-day'
import { KINDS, REACTIONS, MAX_PHOTOS, DEFAULT_FRAME, dueState, type Frame, type Post, type PostKind, type ReviewRef } from '@/lib/bulletin'

export const BULLETIN_URL = '/api/command/bulletin'
const STATS_URL = '/api/command/bulletin/stats'
const PLANS_URL = '/api/eve/review?n=1'   // same key the Decide band reads — one fetch for both

type BoardRes = { ok: boolean; error?: string; today: string; me: string; canPost: boolean; posts: Post[]; haveTo: Post[]; reviews?: ReviewRef[]; people?: string[]; quote?: { q: string; a: string; src: string }; celebrations?: { name: string; md: string; inDays: number }[]; birthdays?: Record<string, string> }
type Fact = { key: string; label: string; value: string; sub: string; href?: string; tone?: 'emerald' | 'amber' | 'slate' | 'sky' }
type Plan = { id: string; title: string; detail: string | null; area: string | null }
type Slide = { key: string; label: string; secs: number; node: ReactNode }

const KIND_LABEL: Record<PostKind, string> = { eotm: 'Employee of the month', quote: 'Quote of the day', reminder: 'Reminder', announcement: 'Announcement', review: 'Five-star review', shoutout: 'Shout-out' }
const TONE_TEXT = { emerald: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700', slate: 'text-ink', sky: 'text-sky-700' } as const

async function send(body: any): Promise<BoardRes> {
  const r = await fetch(BULLETIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not save')
  return j
}
const shortDay = (ymd?: string | null) => { if (!ymd) return ''; try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }
/** Shrink a phone photo in the browser (longest side 1600px, JPEG) so big iPhone shots and HEICs
 *  upload under the request limit, then store it through the app's uploader. null = it failed. */
async function uploadPhoto(file: File): Promise<string | null> {
  let blob: Blob = file
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url })
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(url)
    const out = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/jpeg', 0.85))
    if (out) blob = out
  } catch { /* the browser couldn't read it — send the original and let the server decide */ }
  const fd = new FormData()
  fd.append('file', new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: blob.type || file.type }))
  try {
    const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    return j?.ok && j?.url ? String(j.url) : null
  } catch { return null }
}
/** Words that make a recommendation read as blame or bad news about people. */
const NEGATIVE = /accountab|blame|fault|dirty|redo|re-do|absorb|complain|late\b|missed|slow|sloppy|poor|bad review|failing|failed|negligen|warn|discipline|write[- ]?up|fire\b|lazy|careless|mistake|stop treating|not doing/i
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s

export function BulletinBoard({ d }: { d: CommandDay }) {
  const q = useCachedFetch<BoardRes>(BULLETIN_URL, { ttl: 60_000 })
  const stats = useCachedFetch<{ facts?: Fact[] }>(STATS_URL, { ttl: 10 * 60_000 })
  const week = useCachedFetch<{ tiles?: { key: string; value: string; sub: string }[] }>(SCOREBOARD_URL, { ttl: 5 * 60_000 })
  const plans = useCachedFetch<{ open?: { plans?: Plan[] } }>(PLANS_URL, { ttl: 300_000 })
  const { health, open: openTile } = useHealth()
  const [local, setLocal] = useState<BoardRes | null>(null)
  const data = local || q.data
  const [composing, setComposing] = useState<PostKind | null>(null)
  const [framing, setFraming] = useState<Post | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const act = useCallback(async (body: any) => {
    setErr('')
    try { const j = await send(body); setLocal(prev => ({ ...(prev || q.data || {} as any), ...j })); invalidateCache(BULLETIN_URL) }
    catch (e: any) { setErr(e?.message || String(e)) }
  }, [q.data])

  // ── the slides ────────────────────────────────────────────────────────────────────────────────
  const slides = useMemo<Slide[]>(() => {
    const me = data?.me || ''
    const canPost = !!data?.canPost
    const out: Slide[] = []
    if (health) out.push({ key: 'health', label: 'Ops health', secs: 8, node: <HealthSlide h={health} open={openTile} /> })
    const must = haveToRows(d)
    const rem = data?.haveTo || []
    if (must.length || rem.length) out.push({ key: 'haveto', label: 'Have to', secs: 9, node: <HaveToSlide must={must} rem={rem} today={data?.today || ''} canPost={canPost} act={act} /> })

    const posts = data?.posts || []
    const quote = posts.find(p => p.kind === 'quote')
    const others = posts.filter(p => p.kind !== 'quote')
    // NOTHING NEGATIVE ABOUT THE TEAM (Jon, 2026-10-06). The board is the team's page: a recommendation
    // worded as blame stays in Decide where a leader acts on it, and a stat only shows when it is good
    // news — an amber number (a low call rate, a slow close time) belongs in the tiles, not up here.
    const recs = ((plans.data?.open?.plans || []) as Plan[]).filter(r => !NEGATIVE.test(r.title + ' ' + String(r.detail || '').slice(0, 300))).slice(0, 4)
    const facts: Fact[] = (stats.data?.facts || []).filter(f => f.tone !== 'amber')
    for (const t of week.data?.tiles || []) {
      if (t.key === 'billable' && /\$/.test(t.value)) facts.push({ key: 'billable', label: 'Billable this week', value: t.value, sub: t.sub, href: '/billing', tone: 'emerald' })
      if (t.key === 'claims' && /\$[\d,]+ back/.test(t.sub)) facts.push({ key: 'claimsBack', label: 'Claims recovered this month', value: (t.sub.match(/\$[\d,]+/) || [''])[0], sub: t.value + ' still open', href: '/claims', tone: 'emerald' })
    }
    // Pair the stats two to a slide so the strip stays short.
    const statSlides: Slide[] = []
    for (let i = 0; i < facts.length; i += 2) {
      const pair = facts.slice(i, i + 2)
      statSlides.push({ key: 'stats:' + pair.map(f => f.key).join('+'), label: 'By the numbers', secs: 7, node: <StatsSlide facts={pair} /> })
    }
    // Interleave so no two of a kind run back to back: quote, then post / rec / stats round-robin.
    // A quote every day: a leader's wins; otherwise the day's quote from the internet (or our list).
    if (quote) out.push({ key: 'post:' + quote.id, label: KIND_LABEL.quote, secs: 10, node: <PostSlide p={quote} me={me} canPost={canPost} act={act} onFrame={setFraming} onOpen={x => setViewing(x.id)} /> })
    else if (data?.quote?.q) out.push({ key: 'quote:auto', label: KIND_LABEL.quote, secs: 10, node: <AutoQuote q={data.quote} /> })
    const cel = data?.celebrations || []
    if (cel.length) out.push({ key: 'bday:' + cel.map(c => c.name).join('+'), label: cel.some(c => !c.inDays) ? 'Birthday' : 'Birthdays this week', secs: 9, node: <BirthdaySlide cel={cel} today={data?.today || ''} /> })
    const lanes: Slide[][] = [
      others.map(p => ({ key: 'post:' + p.id, label: KIND_LABEL[p.kind], secs: p.kind === 'review' ? 10 : 8, node: <PostSlide p={p} me={me} canPost={canPost} act={act} onFrame={setFraming} onOpen={x => setViewing(x.id)} /> })),
      recs.map((r, i) => ({ key: 'rec:' + r.id, label: 'Eve recommends', secs: 9, node: <RecSlide r={r} n={i + 1} of={recs.length} /> })),
    ]
    for (let i = 0; lanes.some(l => i < l.length); i++) for (const l of lanes) if (l[i]) out.push(l[i])
    // The stats are spread evenly between everything else, so two never run back to back while there
    // is something else to show (they used to bunch up at the end of the loop).
    if (!statSlides.length) return out
    const mixed: Slide[] = []
    const gap = out.length / statSlides.length
    let next = gap > 1 ? gap : 1, si = 0
    out.forEach((sl, i) => {
      mixed.push(sl)
      while (si < statSlides.length && i + 1 >= next) { mixed.push(statSlides[si++]); next += gap }
    })
    while (si < statSlides.length) mixed.push(statSlides[si++])
    return mixed
  }, [health, openTile, d, data, plans.data, stats.data, week.data, act])

  // ── ONE CLOCK FOR EVERYONE (Jon, 2026-10-07: "it flows weird when you land … keep it where everyone
  // is seeing the same thing at the same time unless they move it forward — set on a timer vs on
  // load"). The slide on screen is a function of the wall clock, not of when you opened the page:
  // every SLOT seconds the board moves one slide, and slot n shows slide n mod N — so everyone looking
  // at Today sees the same slide and they turn together. People with different access (dollar
  // amounts, Eve) can have a slide or two more or fewer, so they can drift by a slide; the rest line up.
  //   · arrows / dots move YOUR view only; 30 seconds after your last tap you rejoin everyone
  //   · pointing at it or typing in it holds your view; letting go rejoins everyone
  //   · nothing shows until the sources are in (or 4s pass), so the list doesn't grow under you on landing
  const SLOT_MS = 9000
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => { const n = Date.now(); setNow(n); t = setTimeout(tick, SLOT_MS - (n % SLOT_MS) + 30) }
    tick()
    const vis = () => { if (document.visibilityState === 'visible') { clearTimeout(t); tick() } }
    document.addEventListener('visibilitychange', vis)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const [waited, setWaited] = useState(false)
  useEffect(() => { const t = setTimeout(() => setWaited(true), 4000); return () => clearTimeout(t) }, [])
  const ready = !!data && ((!stats.loading && !plans.loading && !!health) || waited)
  const [manual, setManual] = useState<{ key: string; until: number } | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const N = slides.length
  const live = N ? Math.floor(now / SLOT_MS) % N : 0
  const pick = (key?: string | null) => { if (!key) return -1; return slides.findIndex(s => s.key === key) }
  const manualIdx = manual && manual.until > now ? pick(manual.key) : -1
  const heldIdx = pick(held)
  const overlay = !!composing || !!framing || !!viewing
  const idx = manualIdx >= 0 ? manualIdx : heldIdx >= 0 ? heldIdx : live
  const cur = ready ? slides[idx] : undefined
  const onLive = manualIdx < 0 && heldIdx < 0 && !overlay
  const go = (n: number) => { if (!N) return; const k = slides[(n + N) % N].key; setManual({ key: k, until: Date.now() + 30_000 }); setHeld(null) }
  const hold = (on: boolean) => setHeld(on && cur ? cur.key : null)
  // the manual window ends between clock ticks too
  useEffect(() => {
    if (!manual) return
    const t = setTimeout(() => { setManual(null); setNow(Date.now()) }, Math.max(0, manual.until - Date.now()))
    return () => clearTimeout(t)
  }, [manual])
  const slotLeft = SLOT_MS - (Date.now() % SLOT_MS)

  if (ready && !slides.length && !data?.canPost) return null
  return (
    <section aria-roledescription="carousel" aria-label="Bulletin"
      className="rounded-2xl border border-line bg-white overflow-hidden"
      onMouseEnter={() => hold(true)} onMouseLeave={() => hold(false)}
      onFocusCapture={() => { if (!held) hold(true) }} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) hold(false) }}>
      <div className="flex items-center gap-2 px-3.5 h-9 border-b border-line/70">
        <span className="lh-display text-[16px] leading-none text-ink">Bulletin</span>
        {cur && <span className="text-[12px] text-muted truncate">{cur.label}</span>}
        {ready && manualIdx >= 0 && <button onClick={() => { setManual(null); setNow(Date.now()) }} className="text-[11.5px] text-muted hover:text-ink underline shrink-0">Back to live</button>}
        <span className="flex-1" />
        {ready && slides.length > 1 && (
          <div className="hidden sm:flex items-center gap-1 mr-1" role="tablist" aria-label="Slides">
            {slides.map((s, i) => (
              <button key={s.key} role="tab" aria-selected={i === idx} aria-label={s.label} onClick={() => go(i)}
                className={'h-1.5 rounded-full transition-all ' + (i === idx ? 'w-4 bg-ink' : 'w-1.5 bg-ink/20 hover:bg-ink/40')} />
            ))}
          </div>
        )}
        {ready && slides.length > 1 && <>
          <button onClick={() => go(idx - 1)} aria-label="Previous" className="w-6 h-6 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><ChevronLeft size={14} /></button>
          <button onClick={() => go(idx + 1)} aria-label="Next" className="w-6 h-6 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><ChevronRight size={14} /></button>
        </>}
        {data?.canPost && <button onClick={() => setComposing(c => c ? null : 'eotm')} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line px-2 h-7 text-[12px] font-semibold text-ink hover:border-ink/40"><Plus size={12} /> Post</button>}
      </div>
      {/* time to the next slide */}
      <div className="h-[2px] bg-transparent">
        {cur && onLive && N > 1 && <div key={'slot:' + Math.floor(now / SLOT_MS)} className="lh-progress h-full bg-ink/25" style={{ animationDuration: SLOT_MS + 'ms', animationDelay: -(SLOT_MS - slotLeft) + 'ms' }} />}
      </div>
      {viewing && data?.posts.find(x => x.id === viewing) ? (
        <PostView p={data!.posts.find(x => x.id === viewing)!} me={data?.me || ''} canPost={!!data?.canPost} act={act} onClose={() => setViewing(null)} />
      ) : framing ? (
        <FrameDialog p={framing} onClose={() => setFraming(null)} onSave={async frames => { await act({ action: 'edit', id: framing.id, post: { frames } }); setFraming(null) }} />
      ) : composing && data ? (
        <Composer data={data} initial={composing} onClose={() => setComposing(null)} onPost={async p => { await act({ action: 'create', post: p }); setComposing(null) }} onAct={act} />
      ) : (
        // ONE HEIGHT for every slide, so the page under it never jumps as the board turns.
        <div className="px-4 py-3 h-[150px] flex items-center overflow-hidden" aria-live="polite">
          {!ready ? (
            <div className="w-full space-y-2.5 animate-pulse" aria-label="Loading the board">
              <div className="h-3 w-24 rounded bg-slate-100" /><div className="h-6 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/3 rounded bg-slate-100" />
            </div>
          ) : cur ? <div key={cur.key} className="lh-fade w-full min-w-0">{cur.node}</div>
            : <div className="text-[13px] text-muted">Post an employee of the month, a quote, a reminder or a five-star review.</div>}
        </div>
      )}
      {err && <div className="px-4 pb-2 text-[12px] text-rose-700">{err}</div>}
    </section>
  )
}

// ── SLIDES ──────────────────────────────────────────────────────────────────────────────────────
function HealthSlide({ h, open }: { h: OpsHealth; open: ((tile: string) => void) | null }) {
  const tone = h.band === 'smooth' ? { ring: '#059669', text: 'text-emerald-700' } : h.band === 'watch' ? { ring: '#d97706', text: 'text-amber-700' } : { ring: '#e11d48', text: 'text-rose-700' }
  const r = 24, c = 2 * Math.PI * r
  const weak = h.dims.slice().sort((a, b) => a.score - b.score).slice(0, 4)
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-3 shrink-0">
        <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden>
          <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(15,23,42,.08)" strokeWidth="5" />
          <circle cx="30" cy="30" r={r} fill="none" stroke={tone.ring} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - h.score / 100)} transform="rotate(-90 30 30)" />
        </svg>
        <button onClick={() => document.getElementById('day-kpis')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="text-left rounded-lg hover:bg-slate-50 -mx-1.5 px-1.5" title="See the tiles behind this score">
          <div className="flex items-baseline gap-2"><span className={'lh-display text-[40px] leading-none tabular-nums ' + tone.text}>{h.score}</span><span className={'text-[14px] font-semibold ' + tone.text}>{h.label}</span></div>
          <p className="text-[12.5px] text-muted max-w-[30rem] line-clamp-2">{h.headline}</p>
        </button>
      </div>
      <div className="hidden sm:flex flex-wrap gap-1.5 flex-1 min-w-[200px]">
        {weak.map(dm => (
          <button key={dm.key} onClick={() => open?.(dm.tile)} title={dm.why || dm.label}
            className={'rounded-lg border px-2 py-1 text-left hover:border-ink/40 ' + (dm.score >= 85 ? 'border-emerald-200' : dm.score >= 65 ? 'border-amber-200' : 'border-rose-200')}>
            <span className="block text-[11px] text-muted leading-tight">{dm.label}</span>
            <span className={'block text-[15px] font-semibold tabular-nums leading-tight ' + (dm.score >= 85 ? 'text-emerald-700' : dm.score >= 65 ? 'text-amber-700' : 'text-rose-700')}>{dm.score}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

type Must = { key: string; n: number; text: string; href: string; hot: boolean }
function haveToRows(d: CommandDay): Must[] {
  const t = d.tiles, out: Must[] = []
  const add = (key: string, n: number, one: string, many: string, href: string, hot: boolean) => { if (n) out.push({ key, n, text: n === 1 ? one : many, href, hot }) }
  add('claims', t.claims.dueSoon, 'claim to file before its deadline', 'claims to file before their deadline', '/claims', true)
  add('glitches', t.glitches.overdue, 'guest issue past due', 'guest issues past due', '/glitches', true)
  add('msgs', t.guestDesk.messages, 'guest waiting on a reply', 'guests waiting on a reply', '/messages', false)
  add('welcome', t.guestDesk.welcome, 'welcome call to make', 'welcome calls to make', '/welcome-calls', false)
  add('unowned', t.tasks.unassigned, 'task with nobody on it', 'tasks with nobody on it', '/maintenance', false)
  return out
}
function HaveToSlide({ must, rem, today, canPost, act }: { must: Must[]; rem: Post[]; today: string; canPost: boolean; act: (b: any) => Promise<void> }) {
  return (
    <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
      {must.slice(0, rem.length ? 2 : 4).map(m => (
        <li key={m.key}>
          <Link href={m.href} className="flex items-baseline gap-2 rounded-md py-0.5 hover:underline">
            <span className={'lh-display text-[22px] leading-none tabular-nums w-8 text-right ' + (m.hot ? 'text-rose-700' : 'text-amber-700')}>{m.n}</span>
            <span className="text-[13px] text-ink">{m.text}</span>
          </Link>
        </li>
      ))}
      {rem.slice(0, 4 - Math.min(must.length, rem.length ? 2 : 4)).map(p => {
        const st = dueState(p, today), done = st === 'done'
        return (
          <li key={p.id} className="flex items-center gap-2 py-0.5 group">
            <button onClick={() => act({ action: done ? 'undone' : 'done', id: p.id })} aria-label={done ? 'Mark not done' : 'Mark done'}
              className={'w-[18px] h-[18px] ml-[14px] shrink-0 rounded-full border-2 flex items-center justify-center ' + (done ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 hover:border-ink')}>
              {done && <Check size={11} className="text-white" strokeWidth={3} />}
            </button>
            <span className={'text-[13px] truncate ' + (done ? 'line-through text-muted' : 'text-ink')}>{p.title || p.body}</span>
            {!done && st === 'overdue' && <span className="text-[11px] font-semibold text-rose-700 shrink-0">overdue</span>}
            {!done && st === 'today' && <span className="text-[11px] font-semibold text-amber-700 shrink-0">today</span>}
            {!done && (st === 'soon' || st === 'later') && <span className="text-[11px] text-muted shrink-0">by {shortDay(p.due)}</span>}
            {p.owner && <span className="text-[11px] text-muted shrink-0">{p.owner}</span>}
            {canPost && <button onClick={() => act({ action: 'delete', id: p.id })} aria-label="Remove" className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-rose-600"><Trash2 size={12} /></button>}
          </li>
        )
      })}
    </ul>
  )
}

function RecSlide({ r, n, of }: { r: Plan; n: number; of: number }) {
  const first = (String(r.detail || '').match(/FIRST STEP:\s*([^\n]+)/) || [])[1] || ''
  return (
    <button onClick={() => { const el = document.getElementById('decide'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className="block w-full text-left min-w-0 rounded-lg hover:bg-slate-50 -mx-1.5 px-1.5" title="Open it in Decide to accept or pass">
      <div className="text-[11.5px] text-muted">Priority {n} of {of}{r.area ? ' · ' + cap(r.area) : ''}</div>
      <div className="lh-display text-[22px] leading-[1.2] text-ink mt-0.5 line-clamp-2">{r.title}</div>
      {first && <div className="text-[12.5px] text-ink/75 mt-1 line-clamp-1"><span className="font-semibold text-ink">First step:</span> {first}</div>}
    </button>
  )
}

function StatsSlide({ facts }: { facts: Fact[] }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {facts.map(f => {
        const inner = (
          <div className="min-w-0">
            <div className="text-[12px] text-muted truncate">{f.label}</div>
            <div className={'lh-display text-[34px] leading-[1.05] tabular-nums ' + TONE_TEXT[f.tone || 'slate']}>{f.value}</div>
            <div className="text-[12px] text-muted truncate">{f.sub}</div>
          </div>
        )
        return f.href ? <Link key={f.key} href={f.href} className="block rounded-lg hover:bg-slate-50 -mx-1.5 px-1.5">{inner}</Link> : <div key={f.key}>{inner}</div>
      })}
    </div>
  )
}

// A post with photos: the photos on the left (they cross-fade every few seconds when there are
// several — nothing on the board sits still), the words on the right. Tap a photo to open it full size.
function PostSlide(props: { p: Post; me: string; canPost: boolean; act: (b: any) => Promise<void>; onFrame?: (p: Post) => void; onOpen?: (p: Post) => void }) {
  const ph = props.p.photos || []
  // Tap anywhere on a post that isn't a control → open it full size (photos, the whole text, replies).
  const open = (e: React.MouseEvent) => { if (!(e.target as Element).closest('button,a,input,label')) props.onOpen?.(props.p) }
  if (!ph.length) return <div onClick={open} className="cursor-pointer"><PostBody {...props} /></div>
  return (
    <div onClick={open} className="flex flex-row gap-3 sm:gap-4 items-center cursor-pointer">
      <div className="relative shrink-0 group">
        <PhotoCycler photos={ph} frames={props.p.frames} />
        {props.canPost && props.onFrame && (
          <button onClick={() => props.onFrame!(props.p)} className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/55 text-white text-[11px] font-semibold px-1.5 h-6 opacity-0 group-hover:opacity-100 focus:opacity-100">
            <Crop size={11} /> Adjust
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0"><PostBody {...props} /></div>
    </div>
  )
}

// THE SLIDE'S PHOTO BOX — 210×132 on a desktop, full width on a phone. Every photo sits in it the
// way its frame says: FILL crops to the box at the chosen spot and zoom; FIT shows the whole photo
// over a soft blurred copy of itself, so a tall phone shot never gets its head cut off.
const BOX = 'w-[118px] h-[104px] sm:w-[210px] sm:h-[124px]'
function FramedImg({ src, frame, className = '' }: { src: string; frame?: Frame; className?: string }) {
  const f = frame || DEFAULT_FRAME
  /* eslint-disable @next/next/no-img-element */
  if (f.fit === 'fit') return (
    <span className={'absolute inset-0 overflow-hidden ' + className}>
      <img src={src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-md opacity-60" />
      <img src={src} alt="" className="absolute inset-0 w-full h-full object-contain" draggable={false} />
    </span>
  )
  return (
    <span className={'absolute inset-0 overflow-hidden ' + className}>
      <img src={src} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: f.x + '% ' + f.y + '%', transform: 'scale(' + f.z + ')', transformOrigin: f.x + '% ' + f.y + '%' }} />
    </span>
  )
  /* eslint-enable @next/next/no-img-element */
}
function PhotoCycler({ photos, frames }: { photos: string[]; frames?: Frame[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (photos.length < 2) return
    const t = setInterval(() => setI(x => (x + 1) % photos.length), 3000)
    return () => clearInterval(t)
  }, [photos.length])
  return (
    <span className={'relative block rounded-xl overflow-hidden bg-slate-100 ' + BOX}>
      {photos.map((u, k) => <FramedImg key={u} src={u} frame={frames?.[k]} className={'transition-opacity duration-700 ' + (k === i ? 'opacity-100' : 'opacity-0')} />)}
      {photos.length > 1 && (
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
          {photos.map((u, k) => <span key={u} className={'h-1 rounded-full ' + (k === i ? 'w-3 bg-white' : 'w-1 bg-white/60')} />)}
        </span>
      )}
    </span>
  )
}

// THE FRAMING EDITOR — one photo at a time in a box the shape of the slide's. Fill: drag the photo
// to choose what shows, the slider zooms in. Fit: the whole photo. What you see is what the slide shows.
function FrameEditor({ photos, frames, onChange }: { photos: string[]; frames: Frame[]; onChange: (f: Frame[]) => void }) {
  const [at, setAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null)
  const f = frames[at] || DEFAULT_FRAME
  const set = (patch: Partial<Frame>) => onChange(frames.map((x, k) => k === at ? { ...(x || DEFAULT_FRAME), ...patch } : (x || DEFAULT_FRAME)))
  const down = (e: React.PointerEvent) => { if (f.fit !== 'fill') return; (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, fx: f.x, fy: f.y } }
  const move = (e: React.PointerEvent) => {
    const d = drag.current, el = box.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    // Dragging right shows more of the left of the photo, so the focus point moves the other way.
    const k = 100 / f.z
    set({ x: Math.max(0, Math.min(100, d.fx - ((e.clientX - d.x) / r.width) * k)), y: Math.max(0, Math.min(100, d.fy - ((e.clientY - d.y) / r.height) * k)) })
  }
  const up = () => { drag.current = null }
  if (!photos.length) return null
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className={'relative rounded-xl overflow-hidden bg-slate-100 shrink-0 w-full sm:w-[315px] h-[198px] touch-none select-none ' + (f.fit === 'fill' ? 'cursor-grab active:cursor-grabbing' : '')}>
        <FramedImg src={photos[at]} frame={f} />
      </div>
      <div className="flex-1 min-w-0 space-y-2.5">
        {photos.length > 1 && (
          <div className="flex gap-1.5">
            {photos.map((u, k) => (
              <button key={u} onClick={() => setAt(k)} aria-label={'Photo ' + (k + 1)} className={'relative w-12 h-9 rounded-md overflow-hidden ' + (k === at ? 'ring-2 ring-ink' : 'opacity-70 hover:opacity-100')}>
                <FramedImg src={u} frame={frames[k]} />
              </button>
            ))}
          </div>
        )}
        <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="How the photo fits">
          {([['fill', 'Fill the box'], ['fit', 'Show whole photo']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={f.fit === k} onClick={() => set({ fit: k })}
              className={'text-[12px] font-medium rounded-md px-2.5 h-7 ' + (f.fit === k ? 'bg-ink text-white' : 'text-ink hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
        {f.fit === 'fill' ? (
          <>
            <label className="flex items-center gap-2 text-[12px] text-muted">Zoom
              <input type="range" min={1} max={3} step={0.05} value={f.z} onChange={e => set({ z: Number(e.target.value) })} className="flex-1 accent-[#0f172a]" />
              <span className="tabular-nums w-9 text-right">{f.z.toFixed(1)}×</span>
            </label>
            <p className="text-[11.5px] text-muted">Drag the photo to choose what shows.</p>
          </>
        ) : <p className="text-[11.5px] text-muted">The whole photo shows, with a soft blur filling the sides.</p>}
        <button onClick={() => set({ ...DEFAULT_FRAME })} className="text-[12px] text-muted hover:text-ink underline">Reset</button>
      </div>
    </div>
  )
}

/** A post opened full size: every photo whole, the full text, reactions and replies. The strip pauses. */
function PostView({ p, me, canPost, act, onClose }: { p: Post; me: string; canPost: boolean; act: (b: any) => Promise<void>; onClose: () => void }) {
  const ph = p.photos || []
  const [at, setAt] = useState(0)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const doReply = async () => { if (!reply.trim()) return; setBusy(true); try { await act({ action: 'reply', id: p.id, text: reply }); setReply('') } finally { setBusy(false) } }
  const text = p.kind === 'review' && p.review ? p.review.text : p.body
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2"><span className="text-[12px] text-muted flex-1">{KIND_LABEL[p.kind]} · {p.by}</span><button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={15} /></button></div>
      <div className="flex flex-col md:flex-row gap-4">
        {ph.length > 0 && (
          <div className="md:w-[420px] shrink-0">
            <div className="relative rounded-xl overflow-hidden bg-slate-100 h-[260px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ph[at]} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-md opacity-50" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ph[at]} alt="" className="absolute inset-0 w-full h-full object-contain" />
              {ph.length > 1 && <>
                <button onClick={() => setAt((at - 1 + ph.length) % ph.length)} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 text-white flex items-center justify-center"><ChevronLeft size={15} /></button>
                <button onClick={() => setAt((at + 1) % ph.length)} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 text-white flex items-center justify-center"><ChevronRight size={15} /></button>
              </>}
              <a href={ph[at]} target="_blank" rel="noreferrer" className="absolute bottom-2 right-2 text-[11px] font-semibold rounded-md bg-black/50 text-white px-1.5 h-6 inline-flex items-center">Open original</a>
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {p.kind === 'review' && p.review && <div className="text-amber-500 text-[13px] tracking-[1px]">{'★'.repeat(Math.round(p.review.stars))}</div>}
          {p.title && <div className="lh-display text-[26px] leading-[1.15] text-ink">{p.kind === 'quote' && !p.body ? '“' + p.title + '”' : p.title}</div>}
          {text && <div className={(p.kind === 'quote' || p.kind === 'review' ? 'lh-display text-[19px] leading-[1.35] text-ink' : 'text-[13.5px] text-ink/80') + ' mt-1 whitespace-pre-line'}>{p.kind === 'quote' || p.kind === 'review' ? '“' + text + '”' : text}</div>}
          {p.kind === 'review' && p.review && <div className="text-[12px] text-muted mt-1">{p.review.guest}, {p.review.unit}, {shortDay(p.review.date)}</div>}
          <div className="flex items-center gap-1 mt-3">
            {REACTIONS.map(e => {
              const who = p.reactions?.[e] || [], mine = who.includes(me)
              return <button key={e} onClick={() => act({ action: 'react', id: p.id, emoji: e })} aria-pressed={mine} className={'text-[13px] rounded-full px-2 h-7 inline-flex items-center gap-1 border ' + (mine ? 'border-ink/30 bg-slate-50' : 'border-line')}>{e}{who.length ? <span className="text-[11px] font-semibold tabular-nums">{who.length}</span> : null}</button>
            })}
          </div>
          <div className="mt-3 space-y-1">
            {(p.replies || []).map(r => (
              <div key={r.id} className="text-[12.5px] flex gap-1.5 group"><span className="font-semibold text-ink shrink-0">{r.by}</span><span className="text-ink/80 flex-1">{r.text}</span>
                {canPost && <button onClick={() => act({ action: 'unreply', id: p.id, replyId: r.id })} aria-label="Remove reply" className="opacity-0 group-hover:opacity-100 text-muted hover:text-rose-600"><X size={11} /></button>}</div>
            ))}
            <div className="flex gap-1.5 pt-1">
              <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doReply() }} placeholder={p.kind === 'eotm' || p.kind === 'shoutout' ? 'Say congrats…' : 'Write a reply…'} className="flex-1 min-w-0 text-[12.5px] rounded-lg border border-line px-2.5 py-1.5" />
              <button onClick={doReply} disabled={busy || !reply.trim()} className="rounded-lg px-3 text-[12px] font-semibold bg-ink text-white disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : 'Send'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Adjusting the photos of a post already on the board (leaders): the strip pauses on this. */
function FrameDialog({ p, onSave, onClose }: { p: Post; onSave: (frames: Frame[]) => Promise<void>; onClose: () => void }) {
  const [frames, setFrames] = useState<Frame[]>(() => (p.photos || []).map((_, k) => p.frames?.[k] || DEFAULT_FRAME))
  const [busy, setBusy] = useState(false)
  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-ink flex-1">Adjust photos{p.title ? ' · ' + p.title : ''}</span><button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={15} /></button></div>
      <FrameEditor photos={p.photos || []} frames={frames} onChange={setFrames} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 h-8 text-[12.5px] font-semibold border border-line text-ink">Cancel</button>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await onSave(frames) } finally { setBusy(false) } }} className="rounded-lg px-3 h-8 text-[12.5px] font-semibold bg-ink text-white inline-flex items-center gap-1.5 disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
      </div>
    </div>
  )
}

function PostBody({ p, me, canPost, act }: { p: Post; me: string; canPost: boolean; act: (b: any) => Promise<void> }) {
  const reactions = (
    <div className="flex items-center gap-1 mt-2">
      {REACTIONS.map(e => {
        const who = p.reactions?.[e] || [], mine = who.includes(me)
        return (
          <button key={e} onClick={() => act({ action: 'react', id: p.id, emoji: e })} aria-pressed={mine} aria-label={'React ' + e}
            className={'text-[12px] rounded-full px-1.5 h-6 inline-flex items-center gap-1 border ' + (mine ? 'border-ink/30 bg-slate-50' : who.length ? 'border-line' : 'border-transparent opacity-50 hover:opacity-100')}>
            {e}{who.length ? <span className="text-[11px] font-semibold tabular-nums text-ink">{who.length}</span> : null}
          </button>
        )
      })}
      <span className="flex-1" />
      <span className="text-[11px] text-muted">{p.by}</span>
      {canPost && <button onClick={() => act({ action: 'edit', id: p.id, post: { pinned: !p.pinned } })} aria-label={p.pinned ? 'Unpin' : 'Pin first'} className={'ml-1 ' + (p.pinned ? 'text-ink' : 'text-muted hover:text-ink')}><Pin size={12} /></button>}
      {canPost && <button onClick={() => act({ action: 'delete', id: p.id })} aria-label="Take down" className="text-muted hover:text-rose-600"><Trash2 size={12} /></button>}
    </div>
  )
  if (p.kind === 'quote') return (
    <figure>
      <blockquote className="lh-display text-[26px] sm:text-[30px] leading-[1.2] text-ink">“{p.body || p.title}”</blockquote>
      {p.body && p.title && <figcaption className="text-[13px] text-muted mt-1">— {p.title}</figcaption>}
      {reactions}
    </figure>
  )
  if (p.kind === 'eotm') return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-ink text-white flex items-center justify-center lh-display text-[19px] shrink-0">{(p.title || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
        <div className="min-w-0">
          <div className="lh-display text-[28px] leading-none text-ink">{p.title}</div>
          {p.body && <div className="text-[13px] text-ink/75 mt-1 line-clamp-2">{p.body}</div>}
        </div>
      </div>
      {reactions}
    </div>
  )
  if (p.kind === 'review' && p.review) return (
    <figure>
      <div className="text-amber-500 text-[13px] tracking-[1px] leading-none" aria-label={p.review.stars + ' stars'}>{'★'.repeat(Math.round(p.review.stars))}</div>
      <blockquote className="lh-display text-[19px] leading-[1.3] text-ink mt-1 line-clamp-2">“{p.review.text}”</blockquote>
      <figcaption className="text-[12px] text-muted mt-0.5">{p.review.guest}, {p.review.unit}{p.review.channel ? ', ' + cap(p.review.channel) : ''}, {shortDay(p.review.date)}</figcaption>
      {reactions}
    </figure>
  )
  return (
    <div>
      {p.title && <div className="lh-display text-[24px] leading-[1.15] text-ink">{p.title}</div>}
      {p.body && <div className="text-[13px] text-ink/75 mt-0.5 line-clamp-2 whitespace-pre-line">{p.body}</div>}
      {reactions}
    </div>
  )
}

function AutoQuote({ q }: { q: { q: string; a: string; src: string } }) {
  return (
    <figure>
      <blockquote className="lh-display text-[26px] sm:text-[30px] leading-[1.2] text-ink">“{q.q}”</blockquote>
      <figcaption className="text-[13px] text-muted mt-1">— {q.a}{q.src === 'zenquotes' && <span className="text-[11px] text-muted/70"> · via <a href="https://zenquotes.io/" target="_blank" rel="noreferrer" className="underline">ZenQuotes</a></span>}</figcaption>
    </figure>
  )
}

function BirthdaySlide({ cel, today }: { cel: { name: string; md: string; inDays: number }[]; today: string }) {
  const now = cel.filter(c => !c.inDays), soon = cel.filter(c => c.inDays)
  const dayName = (k: number) => { try { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return k === 1 ? 'tomorrow' : new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d) } catch { return '' } }
  const names = (xs: { name: string }[]) => xs.map(x => x.name.split(/\s+/)[0]).join(', ').replace(/, ([^,]*)$/, ' and $1')
  return (
    <div>
      {now.length > 0 && <div className="lh-display text-[30px] leading-[1.1] text-ink">Happy birthday, {names(now)} 🎂</div>}
      {soon.length > 0 && (
        <div className={now.length ? 'text-[13px] text-muted mt-1.5' : ''}>
          {!now.length && <div className="lh-display text-[24px] leading-[1.15] text-ink">Birthdays coming up</div>}
          <div className={now.length ? '' : 'text-[13px] text-muted mt-1'}>{(now.length ? 'Coming up: ' : '') + soon.map(c => c.name.split(/\s+/)[0] + ' ' + dayName(c.inDays)).join(' · ')}</div>
        </div>
      )}
    </div>
  )
}

// ── COMPOSER (leaders) ──────────────────────────────────────────────────────────────────────────
function Composer({ data, initial, onClose, onPost, onAct }: { data: BoardRes; initial: PostKind; onClose: () => void; onPost: (p: any) => Promise<void>; onAct: (b: any) => Promise<void> }) {
  const [kind, setKind] = useState<PostKind>(initial)
  const [bday, setBday] = useState(false)
  const [bName, setBName] = useState(''); const [bDate, setBDate] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState('')
  const [pinned, setPinned] = useState(false)
  const [review, setReview] = useState<ReviewRef | null>(null)
  const [busy, setBusy] = useState(false)
  const person = kind === 'eotm' || kind === 'shoutout'
  const field = 'w-full text-[13px] rounded-lg border border-line px-2.5 py-1.5 bg-white focus:outline-none focus:border-ink/40'
  const [photos, setPhotos] = useState<string[]>([])
  const [frames, setFrames] = useState<Frame[]>([])
  const [framingOpen, setFramingOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [upErr, setUpErr] = useState('')
  const addPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUp(true); setUpErr('')
    const got: string[] = []
    for (const f of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) { const u = await uploadPhoto(f); if (u) got.push(u) }
    setPhotos(x => x.concat(got).slice(0, MAX_PHOTOS))
    setFrames(x => x.concat(got.map(() => DEFAULT_FRAME)).slice(0, MAX_PHOTOS))
    if (got.length < Math.min(files.length, MAX_PHOTOS - photos.length)) setUpErr('A photo did not upload. Try a JPG or PNG.')
    setUp(false)
  }
  const ok = kind === 'review' ? !!review : !!(title.trim() || body.trim() || photos.length)
  const submit = async () => { setBusy(true); try { await onPost({ kind, title, body, due: due || null, owner: owner || null, pinned, review, photos, frames }) } finally { setBusy(false) } }
  const titleLabel = person ? 'Who' : kind === 'quote' ? 'Who said it (optional)' : kind === 'reminder' ? 'What has to get done' : kind === 'review' ? 'Headline (optional)' : 'Headline'
  const bodyLabel = kind === 'eotm' ? 'Why they earned it' : kind === 'shoutout' ? 'What they did' : kind === 'quote' ? 'The quote' : kind === 'reminder' ? 'Details (optional)' : kind === 'review' ? 'Your note (optional)' : 'Details'
  const life = kind === 'quote' ? 'Up today only.' : kind === 'eotm' ? 'Up until the end of the month.' : kind === 'reminder' ? 'Shows under Have to until ticked done.' : kind === 'review' ? 'Up for two weeks.' : 'Up for a week.'
  return (
    <div className="px-4 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map(k => (
          <button key={k.key} onClick={() => { setKind(k.key); setBday(false) }} aria-pressed={!bday && kind === k.key}
            className={'text-[12px] font-medium rounded-lg px-2.5 h-7 border ' + (!bday && kind === k.key ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:border-ink/40')}>{k.label}</button>
        ))}
        <button onClick={() => setBday(true)} aria-pressed={bday}
          className={'text-[12px] font-medium rounded-lg px-2.5 h-7 border ' + (bday ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:border-ink/40')}>Birthday</button>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={15} /></button>
      </div>
      {bday && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <label className="block"><span className="text-[11.5px] text-muted">Who</span><input value={bName} onChange={e => setBName(e.target.value)} list="bulletin-people" className={field} placeholder="Start typing a name" /><datalist id="bulletin-people">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist></label>
            <label className="block"><span className="text-[11.5px] text-muted">Birthday</span><input type="date" value={bDate} onChange={e => setBDate(e.target.value)} className={field} /></label>
            <button disabled={!bName.trim() || !bDate || busy} onClick={async () => { setBusy(true); try { await onAct({ action: 'birthday', name: bName, date: bDate }); setBName(''); setBDate('') } finally { setBusy(false) } }}
              className="rounded-lg px-3 h-8 text-[12.5px] font-semibold bg-ink text-white disabled:opacity-40">Save</button>
          </div>
          <div className="text-[11.5px] text-muted">Only the month and day are kept. It shows on the board on the day, and in the week before.</div>
          {Object.keys(data.birthdays || {}).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.birthdays || {}).sort((a, b) => a[1].localeCompare(b[1])).map(([n, md]) => (
                <span key={n} className="inline-flex items-center gap-1 text-[12px] rounded-lg border border-line px-2 h-7">{n} <span className="text-muted">{shortDay('2000-' + md)}</span>
                  <button onClick={() => onAct({ action: 'unbirthday', name: n })} aria-label={'Remove ' + n} className="text-muted hover:text-rose-600"><X size={11} /></button></span>
              ))}
            </div>
          )}
        </div>
      )}
      {!bday && kind === 'review' && (
        <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1">
          {!(data.reviews || []).length && <div className="text-[12.5px] text-muted">No new five-star reviews with a written comment in the last three weeks.</div>}
          {(data.reviews || []).map(r => (
            <button key={r.id} onClick={() => setReview(r)} className={'block w-full text-left rounded-lg border px-2.5 py-1.5 ' + (review?.id === r.id ? 'border-ink' : 'border-line hover:border-ink/30')}>
              <div className="text-[11.5px] text-muted"><span className="text-amber-500">★★★★★</span> {r.guest}, {r.unit}, {shortDay(r.date)}</div>
              <div className="text-[12.5px] text-ink line-clamp-1">{r.text}</div>
            </button>
          ))}
        </div>
      )}
      {!bday && <>
      <div className="grid sm:grid-cols-[1fr_1fr] gap-2">
        <label className="block"><span className="text-[11.5px] text-muted">{titleLabel}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} list={person ? 'bulletin-people' : undefined} className={field} placeholder={person ? 'Start typing a name' : ''} />
          {person && <datalist id="bulletin-people">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist>}
        </label>
        {kind === 'reminder' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[11.5px] text-muted">Due</span><input type="date" value={due} onChange={e => setDue(e.target.value)} className={field} /></label>
            <label className="block"><span className="text-[11.5px] text-muted">Whose</span><input value={owner} onChange={e => setOwner(e.target.value)} list="bulletin-people2" className={field} /><datalist id="bulletin-people2">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist></label>
          </div>
        ) : (
          <label className="block"><span className="text-[11.5px] text-muted">{bodyLabel}</span><input value={body} onChange={e => setBody(e.target.value)} className={field} /></label>
        )}
      </div>
      {kind === 'reminder' && <label className="block"><span className="text-[11.5px] text-muted">{bodyLabel}</span><input value={body} onChange={e => setBody(e.target.value)} className={field} /></label>}
      {kind !== 'reminder' && (
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((u, i) => (
            <span key={u} className="relative w-16 h-12 rounded-lg overflow-hidden bg-slate-100">
              <FramedImg src={u} frame={frames[i]} />
              <button onClick={() => { setPhotos(x => x.filter((_, k) => k !== i)); setFrames(x => x.filter((_, k) => k !== i)) }} aria-label="Remove photo" className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
            </span>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className={'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 h-8 text-[12px] font-medium text-ink cursor-pointer hover:border-ink/40 ' + (up ? 'opacity-60 pointer-events-none' : '')}>
              {up ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={13} />} {up ? 'Uploading…' : photos.length ? 'Add more' : 'Add photos'}
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
            </label>
          )}
          {photos.length > 0 && <button onClick={() => setFramingOpen(o => !o)} className={'inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-[12px] font-medium ' + (framingOpen ? 'border-ink text-ink' : 'border-line text-ink hover:border-ink/40')}><Crop size={12} /> Crop & fit</button>}
          <span className="text-[11.5px] text-muted">Up to {MAX_PHOTOS}. They rotate on the slide.</span>
          {upErr && <span className="text-[11.5px] text-rose-700">{upErr}</span>}
        </div>
      )}
      {kind !== 'reminder' && framingOpen && photos.length > 0 && <FrameEditor photos={photos} frames={frames} onChange={setFrames} />}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[12px] text-ink inline-flex items-center gap-1.5"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Show first</label>
        <span className="text-[12px] text-muted flex-1">{life}</span>
        <button onClick={submit} disabled={!ok || busy} className="rounded-lg px-3 h-8 text-[12.5px] font-semibold bg-ink text-white inline-flex items-center gap-1.5 disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Post
        </button>
      </div>
      </>}
    </div>
  )
}
