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
import { Plus, Trash2, X, Check, Loader2, ChevronLeft, ChevronRight, Pin, ImagePlus } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { SCOREBOARD_URL } from '@/components/command/Scoreboard'
import { useHealth } from '@/components/command/health-bus'
import type { OpsHealth } from '@/lib/ops-health'
import type { CommandDay } from '@/lib/command-day'
import { KINDS, REACTIONS, MAX_PHOTOS, dueState, type Post, type PostKind, type ReviewRef } from '@/lib/bulletin'

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
    const recs = ((plans.data?.open?.plans || []) as Plan[]).slice(0, 4)
    const facts: Fact[] = [...(stats.data?.facts || [])]
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
    if (quote) out.push({ key: 'post:' + quote.id, label: KIND_LABEL.quote, secs: 10, node: <PostSlide p={quote} me={me} canPost={canPost} act={act} /> })
    else if (data?.quote?.q) out.push({ key: 'quote:auto', label: KIND_LABEL.quote, secs: 10, node: <AutoQuote q={data.quote} /> })
    const cel = data?.celebrations || []
    if (cel.length) out.push({ key: 'bday:' + cel.map(c => c.name).join('+'), label: cel.some(c => !c.inDays) ? 'Birthday' : 'Birthdays this week', secs: 9, node: <BirthdaySlide cel={cel} today={data?.today || ''} /> })
    const lanes: Slide[][] = [
      others.map(p => ({ key: 'post:' + p.id, label: KIND_LABEL[p.kind], secs: p.kind === 'review' ? 10 : 8, node: <PostSlide p={p} me={me} canPost={canPost} act={act} /> })),
      recs.map((r, i) => ({ key: 'rec:' + r.id, label: 'Eve recommends', secs: 9, node: <RecSlide r={r} n={i + 1} of={recs.length} /> })),
      statSlides,
    ]
    for (let i = 0; lanes.some(l => i < l.length); i++) for (const l of lanes) if (l[i]) out.push(l[i])
    return out
  }, [health, openTile, d, data, plans.data, stats.data, week.data, act])

  // ── cycling ───────────────────────────────────────────────────────────────────────────────────
  const [idx, setIdx] = useState(0)
  const [hold, setHold] = useState(false)
  const curKey = useRef<string>('')
  // Keep the slide you are on when the list changes underneath (a refresh, a new post).
  useEffect(() => {
    const at = slides.findIndex(s => s.key === curKey.current)
    setIdx(at >= 0 ? at : i => Math.min(i, Math.max(0, slides.length - 1)))
  }, [slides])
  const cur = slides[Math.min(idx, slides.length - 1)]
  useEffect(() => { if (cur) curKey.current = cur.key }, [cur])
  const paused = hold || !!composing || slides.length < 2
  useEffect(() => {
    if (paused || !cur) return
    const t = setTimeout(() => setIdx(i => (i + 1) % slides.length), cur.secs * 1000)
    return () => clearTimeout(t)
  }, [paused, cur, slides.length, idx])
  const go = (n: number) => setIdx((n + slides.length) % slides.length)

  if (!slides.length && !data?.canPost) return null
  return (
    <section aria-roledescription="carousel" aria-label="Bulletin"
      className="rounded-2xl border border-line bg-white overflow-hidden"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHold(false) }}>
      <div className="flex items-center gap-2 px-3.5 h-9 border-b border-line/70">
        <span className="lh-display text-[16px] leading-none text-ink">Bulletin</span>
        {cur && <span className="text-[12px] text-muted truncate">{cur.label}</span>}
        <span className="flex-1" />
        {slides.length > 1 && (
          <div className="hidden sm:flex items-center gap-1 mr-1" role="tablist" aria-label="Slides">
            {slides.map((s, i) => (
              <button key={s.key} role="tab" aria-selected={i === idx} aria-label={s.label} onClick={() => go(i)}
                className={'h-1.5 rounded-full transition-all ' + (i === idx ? 'w-4 bg-ink' : 'w-1.5 bg-ink/20 hover:bg-ink/40')} />
            ))}
          </div>
        )}
        {slides.length > 1 && <>
          <button onClick={() => go(idx - 1)} aria-label="Previous" className="w-6 h-6 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><ChevronLeft size={14} /></button>
          <button onClick={() => go(idx + 1)} aria-label="Next" className="w-6 h-6 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><ChevronRight size={14} /></button>
        </>}
        {data?.canPost && <button onClick={() => setComposing(c => c ? null : 'eotm')} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line px-2 h-7 text-[12px] font-semibold text-ink hover:border-ink/40"><Plus size={12} /> Post</button>}
      </div>
      {/* time to the next slide */}
      <div className="h-[2px] bg-transparent">
        {cur && !paused && <div key={cur.key + ':' + idx} className="lh-progress h-full bg-ink/25" style={{ animationDuration: cur.secs + 's' }} />}
      </div>
      {composing && data ? (
        <Composer data={data} initial={composing} onClose={() => setComposing(null)} onPost={async p => { await act({ action: 'create', post: p }); setComposing(null) }} onAct={act} />
      ) : (
        <div className="px-4 py-3 min-h-[112px] flex items-center" aria-live="polite">
          {cur ? <div key={cur.key} className="lh-fade w-full min-w-0">{cur.node}</div>
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
        <div>
          <div className="flex items-baseline gap-2"><span className={'lh-display text-[40px] leading-none tabular-nums ' + tone.text}>{h.score}</span><span className={'text-[14px] font-semibold ' + tone.text}>{h.label}</span></div>
          <p className="text-[12.5px] text-muted max-w-[30rem] line-clamp-2">{h.headline}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 flex-1 min-w-[200px]">
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
      {must.slice(0, 4).map(m => (
        <li key={m.key}>
          <Link href={m.href} className="flex items-baseline gap-2 rounded-md py-0.5 hover:underline">
            <span className={'lh-display text-[22px] leading-none tabular-nums w-8 text-right ' + (m.hot ? 'text-rose-700' : 'text-amber-700')}>{m.n}</span>
            <span className="text-[13px] text-ink">{m.text}</span>
          </Link>
        </li>
      ))}
      {rem.slice(0, 4).map(p => {
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
    <div className="min-w-0">
      <div className="text-[11.5px] text-muted">Priority {n} of {of}{r.area ? ' · ' + cap(r.area) : ''}</div>
      <div className="lh-display text-[22px] leading-[1.2] text-ink mt-0.5 line-clamp-2">{r.title}</div>
      {first && <div className="text-[12.5px] text-ink/75 mt-1 line-clamp-1"><span className="font-semibold text-ink">First step:</span> {first}</div>}
    </div>
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
function PostSlide(props: { p: Post; me: string; canPost: boolean; act: (b: any) => Promise<void> }) {
  const ph = props.p.photos || []
  if (!ph.length) return <PostBody {...props} />
  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
      <PhotoCycler photos={ph} />
      <div className="flex-1 min-w-0"><PostBody {...props} /></div>
    </div>
  )
}
function PhotoCycler({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (photos.length < 2) return
    const t = setInterval(() => setI(x => (x + 1) % photos.length), 3000)
    return () => clearInterval(t)
  }, [photos.length])
  return (
    <a href={photos[i]} target="_blank" rel="noreferrer" className="relative block shrink-0 w-full sm:w-[210px] h-[150px] sm:h-[132px] rounded-xl overflow-hidden bg-slate-100" aria-label="Open photo">
      {photos.map((u, k) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u} src={u} alt="" loading="lazy" className={'absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ' + (k === i ? 'opacity-100' : 'opacity-0')} />
      ))}
      {photos.length > 1 && (
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
          {photos.map((u, k) => <span key={u} className={'h-1 rounded-full ' + (k === i ? 'w-3 bg-white' : 'w-1 bg-white/60')} />)}
        </span>
      )}
    </a>
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
  const [up, setUp] = useState(false)
  const [upErr, setUpErr] = useState('')
  const addPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUp(true); setUpErr('')
    const got: string[] = []
    for (const f of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) { const u = await uploadPhoto(f); if (u) got.push(u) }
    setPhotos(x => x.concat(got).slice(0, MAX_PHOTOS))
    if (got.length < Math.min(files.length, MAX_PHOTOS - photos.length)) setUpErr('A photo did not upload. Try a JPG or PNG.')
    setUp(false)
  }
  const ok = kind === 'review' ? !!review : !!(title.trim() || body.trim() || photos.length)
  const submit = async () => { setBusy(true); try { await onPost({ kind, title, body, due: due || null, owner: owner || null, pinned, review, photos }) } finally { setBusy(false) } }
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setPhotos(x => x.filter((_, k) => k !== i))} aria-label="Remove photo" className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
            </span>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className={'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 h-8 text-[12px] font-medium text-ink cursor-pointer hover:border-ink/40 ' + (up ? 'opacity-60 pointer-events-none' : '')}>
              {up ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={13} />} {up ? 'Uploading…' : photos.length ? 'Add more' : 'Add photos'}
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
            </label>
          )}
          <span className="text-[11.5px] text-muted">Up to {MAX_PHOTOS}. They rotate on the slide.</span>
          {upErr && <span className="text-[11.5px] text-rose-700">{upErr}</span>}
        </div>
      )}
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
