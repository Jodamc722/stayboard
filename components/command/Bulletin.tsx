'use client'
// THE BULLETIN BOARD on Today — replaces the week Scoreboard strip (Jon, 2026-10-06: "the score
// board is weird … have more of a notification board, like have to … a bulletin board where we
// leaders can add something, quote of the day, pending project reminder … make it interactive, we
// can add employee of the month, highlight good reviews … highlight billable amount, cool stats,
// eve thoughts, avg glitch closing time, welcome call completion last 3 days or 7 days, it can be
// random" … then "make it more fun and beautiful").
//
// THE LOOK — a Miami-deco lobby noticeboard, because that is where this team works: a thin
// flamingo / lagoon / sun stripe across the top, the stats as tinted postcards with a stamp, and the
// posts as pinned paper notes, each a little tilted, on a dotted board. The display serif carries the
// names, the quotes and the numbers. Motion only answers a person: a reaction pops, ticking a
// reminder done throws a small burst of confetti; the postcards cross-fade when they rotate.
// Everything respects prefers-reduced-motion (globals.css, .bb-*).
//
//   POSTCARDS  a shuffled set of facts: billable this week (money switch only — the scoreboard
//              route redacts it), glitch close time, welcome-call completion (3 and 7 days), 5★
//              reviews, guest rating, one of Eve's open thoughts. Rotates; ↻ for a new set.
//   HAVE TO    the day's own must-dos + leader reminders with due dates. Tick done.
//   THE BOARD  Employee of the month, Quote of the day, Shout-outs, Good reviews, Announcements.
//              Everyone reacts and replies; leaders post, pin and take down.
// Rules: lib/bulletin.ts. Data: /api/command/bulletin (+ /stats), /api/command/scoreboard, Eve.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Plus, Pin, Trash2, X, Check, Loader2, MessageCircle, RefreshCw } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { SCOREBOARD_URL } from '@/components/command/Scoreboard'
import { useThoughts } from '@/components/EveThoughts'
import { useHealth } from '@/components/command/health-bus'
import type { OpsHealth } from '@/lib/ops-health'
import type { CommandDay } from '@/lib/command-day'
import { KINDS, REACTIONS, dueState, type Post, type PostKind, type ReviewRef } from '@/lib/bulletin'

export const BULLETIN_URL = '/api/command/bulletin'
const STATS_URL = '/api/command/bulletin/stats'

type BoardRes = { ok: boolean; error?: string; today: string; me: string; canPost: boolean; posts: Post[]; haveTo: Post[]; reviews?: ReviewRef[]; people?: string[] }
type Fact = { key: string; label: string; value: string; sub: string; href?: string; tone?: 'emerald' | 'amber' | 'slate' | 'sky' }

// ── THE PALETTE (Miami deco, pastel paper + one deep ink) ──────────────────────────────────────
const C = {
  ink: '#1E2B4A',
  flamingo: '#E8698A', flamingoPaper: '#FDE8EE',
  lagoon: '#1F9E98', lagoonPaper: '#DEF4F1',
  sun: '#E9A92C', sunPaper: '#FFF2D3',
  sky: '#5B7FD6', skyPaper: '#E7EDFB',
  paper: '#FFFDF7',
}
type Paper = { bg: string; pin: string; ink: string; tilt: string }
const PAPER: Record<PostKind, Paper> = {
  eotm: { bg: C.sunPaper, pin: C.sun, ink: '#8A5A00', tilt: '-1deg' },
  quote: { bg: C.skyPaper, pin: C.sky, ink: '#2F4A93', tilt: '0.8deg' },
  review: { bg: C.lagoonPaper, pin: C.lagoon, ink: '#13706B', tilt: '-0.6deg' },
  shoutout: { bg: C.flamingoPaper, pin: C.flamingo, ink: '#A63558', tilt: '1.1deg' },
  announcement: { bg: C.paper, pin: C.ink, ink: C.ink, tilt: '-0.4deg' },
  reminder: { bg: C.paper, pin: C.ink, ink: C.ink, tilt: '0deg' },
}
const KIND_EMOJI: Record<PostKind, string> = { eotm: '🏆', quote: '💬', reminder: '📌', announcement: '📣', review: '⭐', shoutout: '🎉' }
const KIND_LABEL: Record<PostKind, string> = { eotm: 'Employee of the month', quote: 'Quote of the day', reminder: 'Reminder', announcement: 'Announcement', review: 'Five-star review', shoutout: 'Shout-out' }

async function send(body: any): Promise<BoardRes> {
  const r = await fetch(BULLETIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not save')
  return j
}
const shortDay = (ymd?: string | null) => { if (!ymd) return ''; try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? Math.max(1, m) + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }
function shuffle<T>(xs: T[]): T[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
const firstName = (email: string) => { const n = String(email || '').split('@')[0].split(/[._-]/)[0]; return n ? n[0].toUpperCase() + n.slice(1) : '' }
function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/New_York' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** A small burst of confetti from an element — answers "done". Skipped under reduced motion. */
function burst(el: HTMLElement | null) {
  if (!el || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const colors = [C.flamingo, C.lagoon, C.sun, C.sky]
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span')
    s.className = 'bb-confetti'
    const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4
    const r = 26 + Math.random() * 22
    s.style.setProperty('--dx', Math.cos(a) * r + 'px')
    s.style.setProperty('--dy', Math.sin(a) * r - 10 + 'px')
    s.style.background = colors[i % colors.length]
    el.appendChild(s)
    setTimeout(() => s.remove(), 750)
  }
}

export function BulletinBoard({ d }: { d: CommandDay }) {
  const q = useCachedFetch<BoardRes>(BULLETIN_URL, { ttl: 60_000 })
  const [local, setLocal] = useState<BoardRes | null>(null)
  const data = local || q.data
  const [composing, setComposing] = useState<PostKind | null>(null)
  const [err, setErr] = useState('')
  const act = async (body: any) => {
    setErr('')
    try { const j = await send(body); setLocal(prev => ({ ...(prev || q.data || {} as any), ...j })); invalidateCache(BULLETIN_URL) }
    catch (e: any) { setErr(e?.message || String(e)) }
  }
  const name = firstName(data?.me || '')

  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden" aria-label="Bulletin board">
      {/* The deco stripe — the one ornament. */}
      <div className="flex h-[5px]" aria-hidden>
        <span className="flex-[3]" style={{ background: C.flamingo }} /><span className="flex-[2]" style={{ background: C.sun }} /><span className="flex-[3]" style={{ background: C.lagoon }} /><span className="flex-[1]" style={{ background: C.sky }} />
      </div>
      <header className="flex items-center gap-3 px-3.5 pt-2.5 pb-2">
        <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
          <h2 className="font-serif text-[22px] leading-none" style={{ color: C.ink }}>Bulletin board</h2>
          <p className="text-[12px] text-muted">{greeting()}{name ? ', ' + name : ''}.</p>
        </div>
        {data?.canPost && !composing && (
          <button onClick={() => setComposing('eotm')} className="shrink-0 inline-flex items-center gap-1 rounded-full px-3 h-8 text-[12.5px] font-semibold text-white transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: C.ink }}><Plus size={13} /> Post</button>
        )}
      </header>
      <Postcards />
      {composing && data && <Composer data={data} initial={composing} onClose={() => setComposing(null)} onPost={async p => { await act({ action: 'create', post: p }); setComposing(null) }} />}
      {err && <div className="mx-4 mb-2 text-[12px] text-rose-700">{err}</div>}
      <div className="grid md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-4 px-3.5 pb-3.5 pt-2">
        <HaveTo d={d} data={data} act={act} />
        <Board data={data} loading={q.loading && !data} act={act} onStart={k => setComposing(k)} />
      </div>
    </section>
  )
}

// ── POSTCARDS (the stats) ───────────────────────────────────────────────────────────────────────
const STAMP: Record<string, string> = { welcome3: '📞', welcome7: '📞', glitchClose: '🛠️', glitchWeek: '✅', fiveStar: '⭐', avgStars: '🌴', billable: '💵', claimsBack: '💰', eve: '✨' }
function Postcards() {
  const stats = useCachedFetch<{ facts?: Fact[] }>(STATS_URL, { ttl: 10 * 60_000 })
  const week = useCachedFetch<{ tiles?: { key: string; label: string; value: string; sub: string }[] }>(SCOREBOARD_URL, { ttl: 5 * 60_000 })
  const eve = useThoughts({ status: 'open', limit: 25 })
  const all = useMemo(() => {
    const out: Fact[] = [...(stats.data?.facts || [])]
    for (const t of week.data?.tiles || []) {
      // Money only when the viewer may see it (the route blanks it to "—" otherwise).
      if (t.key === 'billable' && /\$/.test(t.value)) out.push({ key: 'billable', label: 'Billable this week', value: t.value, sub: t.sub, href: '/billing', tone: 'emerald' })
      if (t.key === 'claims' && /\$[\d,]+ back/.test(t.sub)) out.push({ key: 'claimsBack', label: 'Claims recovered this month', value: (t.sub.match(/\$[\d,]+/) || [''])[0], sub: t.value + ' still open', href: '/claims', tone: 'emerald' })
    }
    const th = eve.rows.filter(r => r.headline)
    if (th.length) {
      const pick = th[Math.floor(Math.random() * th.length)]
      out.push({ key: 'eve', label: 'Eve is thinking', value: '', sub: pick.headline, href: '/users?tab=settings&panel=eve', tone: 'sky' })
    }
    return out
  }, [stats.data, week.data, eve.rows])
  const [order, setOrder] = useState<Fact[]>([])
  const [turn, setTurn] = useState(0)
  useEffect(() => { setOrder(shuffle(all)) }, [all])
  useEffect(() => {
    if (all.length <= 3) return
    const id = setInterval(() => { setOrder(o => o.length > 3 ? [...o.slice(3), ...o.slice(0, 3)] : o); setTurn(t => t + 1) }, 12_000)
    return () => clearInterval(id)
  }, [all.length])
  const { health, open } = useHealth()
  if (!order.length && !health) return null
  const show = order.slice(0, 3)
  const tint = (t?: Fact['tone']) => t === 'emerald' ? { bg: C.lagoonPaper, ink: '#13706B' } : t === 'amber' ? { bg: C.sunPaper, ink: '#8A5A00' } : t === 'sky' ? { bg: C.skyPaper, ink: '#2F4A93' } : { bg: '#F3F4F7', ink: C.ink }
  return (
    <div className="px-3.5 pb-0.5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {health && <HealthPostcard h={health} open={open} />}
        {show.map((f, i) => {
          const t = tint(f.tone)
          const inner = (
            <div key={f.key + ':' + turn} className="bb-card-in relative h-full rounded-xl px-3 pt-2 pb-2.5 overflow-hidden" style={{ background: t.bg, animationDelay: i * 70 + 'ms' }}>
              {/* the stamp, top right, dashed like a postage stamp */}
              <span className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-white/80 flex items-center justify-center text-[14px]" style={{ outline: '1.5px dashed ' + t.ink + '55', outlineOffset: '-3px' }} aria-hidden>{STAMP[f.key] || '✦'}</span>
              <div className="text-[11.5px] font-medium pr-8 truncate" style={{ color: t.ink }}>{f.label}</div>
              {f.value && <div className="font-serif text-[28px] leading-[1.05] tabular-nums" style={{ color: t.ink }}>{f.value}</div>}
              <div className={'text-[12px] pr-1 ' + (f.key === 'eve' ? 'text-[12.5px] mt-0.5 line-clamp-3' : 'truncate')} style={{ color: f.key === 'eve' ? C.ink : t.ink + 'cc' }}>{f.sub}</div>
            </div>
          )
          return f.href
            ? <Link key={f.key} href={f.href} className="block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: C.ink }}>{inner}</Link>
            : <div key={f.key}>{inner}</div>
        })}
      </div>
      {all.length > 3 && (
        <div className="flex justify-end mt-0.5">
          <button onClick={() => { setOrder(shuffle(all)); setTurn(t => t + 1) }} className="text-[11.5px] text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={11} /> Other stats</button>
        </div>
      )}
    </div>
  )
}

// ── OPS HEALTH, as the first postcard (Jon, 2026-10-06: "part of the slide") ─────────────────────
// The ring, the word, the worst thing in a line, and the three weakest dimensions as chips that open
// the tile behind them (DayKpis registers the opener). Always first — it is the day's one number.
function HealthPostcard({ h, open }: { h: OpsHealth; open: ((tile: string) => void) | null }) {
  const t = h.band === 'smooth' ? { bg: C.lagoonPaper, ink: '#13706B', ring: C.lagoon } : h.band === 'watch' ? { bg: C.sunPaper, ink: '#8A5A00', ring: C.sun } : { bg: C.flamingoPaper, ink: '#A63558', ring: C.flamingo }
  const r = 17, c = 2 * Math.PI * r
  const weak = h.dims.slice().sort((a, b) => a.score - b.score).filter(d => d.score < 85).slice(0, 3)
  return (
    <div className="relative h-full rounded-xl px-3 pt-2 pb-2.5" style={{ background: t.bg }} title="Ops health: one number from today’s board. Glitches and rooms ready by 4pm weigh half, then maintenance, guest touch, inspections and the office.">
      <div className="flex items-center gap-2.5">
        <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0" aria-hidden>
          <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(30,43,74,.10)" strokeWidth="5" />
          <circle cx="22" cy="22" r={r} fill="none" stroke={t.ring} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - h.score / 100)} transform="rotate(-90 22 22)" />
        </svg>
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium" style={{ color: t.ink }}>Ops health</div>
          <div className="flex items-baseline gap-1.5"><span className="font-serif text-[28px] leading-none tabular-nums" style={{ color: t.ink }}>{h.score}</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{h.label}</span></div>
        </div>
      </div>
      <div className="text-[11.5px] mt-1 line-clamp-2" style={{ color: t.ink + 'cc' }}>{h.headline}</div>
      {weak.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {weak.map(d => (
            <button key={d.key} onClick={() => open?.(d.tile)} title={d.label + (d.why ? ' — ' + d.why : '')} className="text-[11px] font-semibold rounded-full px-2 py-[2px] bg-white/75 hover:bg-white" style={{ color: t.ink }}>
              {d.label} {d.score}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── HAVE TO ─────────────────────────────────────────────────────────────────────────────────────
function HaveTo({ d, data, act }: { d: CommandDay; data?: BoardRes; act: (b: any) => Promise<void> }) {
  const t = d.tiles
  const auto: { key: string; n: number; text: string; href: string; hot: boolean }[] = []
  if (t.claims.dueSoon) auto.push({ key: 'claims', n: t.claims.dueSoon, text: t.claims.dueSoon === 1 ? 'claim to file before its deadline' : 'claims to file before their deadline', href: '/claims', hot: true })
  if (t.glitches.overdue) auto.push({ key: 'glitches', n: t.glitches.overdue, text: t.glitches.overdue === 1 ? 'guest issue past due' : 'guest issues past due', href: '/glitches', hot: true })
  if (t.guestDesk.messages) auto.push({ key: 'msgs', n: t.guestDesk.messages, text: t.guestDesk.messages === 1 ? 'guest waiting on a reply' : 'guests waiting on a reply', href: '/messages', hot: false })
  if (t.guestDesk.welcome) auto.push({ key: 'welcome', n: t.guestDesk.welcome, text: t.guestDesk.welcome === 1 ? 'welcome call to make' : 'welcome calls to make', href: '/welcome-calls', hot: false })
  if (t.tasks.unassigned) auto.push({ key: 'unowned', n: t.tasks.unassigned, text: t.tasks.unassigned === 1 ? 'task with nobody on it' : 'tasks with nobody on it', href: '/maintenance', hot: false })
  const rem = data?.haveTo || []
  const today = data?.today || ''
  return (
    <div>
      <h3 className="font-serif text-[17px] leading-none mb-1.5" style={{ color: C.ink }}>Have to</h3>
      {!auto.length && !rem.length && <div className="rounded-xl px-3 py-3 text-center text-[13px]" style={{ background: C.lagoonPaper, color: '#13706B' }}>All clear. Nothing has to happen right now. 🌴</div>}
      <ul className="space-y-0.5">
        {auto.map(a => (
          <li key={a.key}>
            <Link href={a.href} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2" style={{ outlineColor: C.ink }}>
              <span className="min-w-[30px] h-[26px] px-1.5 rounded-lg flex items-center justify-center font-serif text-[18px] leading-none tabular-nums" style={{ background: a.hot ? C.flamingoPaper : C.sunPaper, color: a.hot ? '#A63558' : '#8A5A00' }}>{a.n}</span>
              <span className="flex-1 min-w-0 text-[13px] text-ink">{a.text}</span>
            </Link>
          </li>
        ))}
        {rem.map(p => <Reminder key={p.id} p={p} today={today} canPost={!!data?.canPost} act={act} />)}
      </ul>
    </div>
  )
}

function Reminder({ p, today, canPost, act }: { p: Post; today: string; canPost: boolean; act: (b: any) => Promise<void> }) {
  const st = dueState(p, today)
  const done = st === 'done'
  const when = st === 'overdue' ? { t: 'overdue since ' + shortDay(p.due), c: '#A63558', bg: C.flamingoPaper }
    : st === 'today' ? { t: 'due today', c: '#8A5A00', bg: C.sunPaper }
      : st === 'soon' || st === 'later' ? { t: 'by ' + shortDay(p.due), c: C.ink, bg: '#F1F2F6' } : null
  return (
    <li className="group relative flex items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-50">
      <button onClick={e => { if (!done) burst(e.currentTarget); act({ action: done ? 'undone' : 'done', id: p.id }) }}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        className="relative mt-[1px] w-[22px] h-[22px] shrink-0 rounded-full border-2 flex items-center justify-center transition-colors"
        style={{ borderColor: done ? C.lagoon : '#C9CEDA', background: done ? C.lagoon : 'white' }}>
        {done && <Check size={13} className="text-white" strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={'text-[13px] ' + (done ? 'line-through text-muted' : 'text-ink font-medium')}>{p.title || p.body}</div>
        {p.title && p.body && !done && <div className="text-[12px] text-muted">{p.body}</div>}
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {when && !done && <span className="text-[11px] font-semibold rounded-full px-2 py-[2px]" style={{ background: when.bg, color: when.c }}>{when.t}</span>}
          {p.owner && <span className="text-[11px] text-muted">{p.owner}</span>}
          {done && p.doneBy && <span className="text-[11px] text-muted">done by {p.doneBy}</span>}
        </div>
      </div>
      {canPost && <button onClick={() => act({ action: 'delete', id: p.id })} aria-label="Remove reminder" className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-rose-600 shrink-0"><Trash2 size={13} /></button>}
    </li>
  )
}

// ── THE BOARD ───────────────────────────────────────────────────────────────────────────────────
function Board({ data, loading, act, onStart }: { data?: BoardRes; loading: boolean; act: (b: any) => Promise<void>; onStart: (k: PostKind) => void }) {
  const posts = data?.posts || []
  return (
    <div>
      <h3 className="font-serif text-[17px] leading-none mb-1.5" style={{ color: C.ink }}>On the board</h3>
      <div className="bb-cork rounded-2xl p-2.5">
        {loading && <div className="text-[12.5px] text-muted py-6 flex items-center justify-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading the board…</div>}
        {!loading && !posts.length && (data?.canPost ? (
          // Empty board for a leader: three blank notes that each start a post.
          <div className="grid sm:grid-cols-3 gap-2.5">
            {([['eotm', 'Name this month’s employee of the month'], ['quote', 'Post a quote for today'], ['review', 'Pin a five-star review']] as [PostKind, string][]).map(([k, t]) => (
              <button key={k} onClick={() => onStart(k)} className="bb-note text-left rounded-lg px-3 pt-3 pb-3 border-2 border-dashed transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2"
                style={{ background: PAPER[k].bg + 'aa', borderColor: PAPER[k].pin + '66', ['--tilt' as any]: PAPER[k].tilt, outlineColor: C.ink }}>
                <div className="text-[17px]" aria-hidden>{KIND_EMOJI[k]}</div>
                <div className="font-serif text-[16px] leading-tight mt-0.5" style={{ color: PAPER[k].ink }}>{t}</div>
              </button>
            ))}
          </div>
        ) : <div className="text-[13px] text-muted py-5 text-center">Nothing pinned yet. Check back soon.</div>)}
        <div className="columns-1 sm:columns-2 gap-3 [column-fill:_balance]">
          {posts.map(p => <div key={p.id} className="break-inside-avoid mb-3"><Note p={p} me={data?.me || ''} canPost={!!data?.canPost} act={act} /></div>)}
        </div>
      </div>
    </div>
  )
}

function Note({ p, me, canPost, act }: { p: Post; me: string; canPost: boolean; act: (b: any) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [popped, setPopped] = useState<string | null>(null)
  const paper = PAPER[p.kind]
  const replies = p.replies || []
  const doReply = async () => { if (!reply.trim()) return; setBusy(true); await act({ action: 'reply', id: p.id, text: reply }); setReply(''); setBusy(false) }
  const react = (e: string, el: HTMLElement, mine: boolean) => { setPopped(e); setTimeout(() => setPopped(null), 400); if (!mine && p.kind === 'eotm') burst(el); act({ action: 'react', id: p.id, emoji: e }) }
  return (
    <article className="bb-note relative rounded-lg px-3 pt-3.5 pb-2 shadow-[0_1px_0_rgba(30,43,74,0.06),0_6px_14px_-8px_rgba(30,43,74,0.35)]"
      style={{ background: paper.bg, ['--tilt' as any]: p.pinned ? '0deg' : paper.tilt }}>
      {/* the pushpin */}
      <span className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full shadow-[0_2px_3px_rgba(0,0,0,0.25)]" style={{ background: `radial-gradient(circle at 35% 35%, #fff8 0 18%, ${paper.pin} 22%)` }} aria-hidden />
      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] font-semibold" style={{ color: paper.ink }}>{KIND_EMOJI[p.kind]} {KIND_LABEL[p.kind]}</span>
        {p.pinned && <span className="text-[10.5px] font-semibold rounded-full px-1.5 py-[1px] bg-white/70" style={{ color: paper.ink }}>Pinned</span>}
        <span className="flex-1" />
        {canPost && <button onClick={() => act({ action: 'edit', id: p.id, post: { pinned: !p.pinned } })} aria-label={p.pinned ? 'Unpin' : 'Pin to the top'} className="text-ink/40 hover:text-ink"><Pin size={12} /></button>}
        {canPost && <button onClick={() => act({ action: 'delete', id: p.id })} aria-label="Take down" className="text-ink/40 hover:text-rose-600"><Trash2 size={12} /></button>}
      </div>

      {p.kind === 'eotm' && (
        <div className="flex items-center gap-3 mt-2">
          <div className="relative w-14 h-14 rounded-full flex items-center justify-center font-serif text-[22px] text-white shrink-0" style={{ background: `conic-gradient(from 200deg, ${C.sun}, ${C.flamingo}, ${C.sun})` }}>
            {(p.title || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            <span className="absolute -bottom-1 -right-1 text-[18px]" aria-hidden>🏆</span>
          </div>
          <div className="min-w-0">
            <div className="font-serif text-[23px] leading-[1.05]" style={{ color: C.ink }}>{p.title}</div>
            {p.body && <div className="text-[13px] mt-1" style={{ color: C.ink + 'cc' }}>{p.body}</div>}
          </div>
        </div>
      )}
      {p.kind === 'quote' && (
        <figure className="mt-1">
          <span className="font-serif text-[54px] leading-[0.6] block h-6" style={{ color: C.sky + '88' }} aria-hidden>“</span>
          <blockquote className="font-serif text-[19px] leading-[1.25]" style={{ color: C.ink }}>{p.body || p.title}</blockquote>
          {p.body && p.title && <figcaption className="text-[12.5px] mt-1.5" style={{ color: paper.ink }}>— {p.title}</figcaption>}
        </figure>
      )}
      {p.kind === 'review' && p.review && (
        <figure className="mt-1.5">
          <div className="text-[15px] tracking-[2px] leading-none" style={{ color: C.sun }} aria-label={p.review.stars + ' stars'}>{'★'.repeat(Math.round(p.review.stars))}</div>
          <blockquote className="font-serif text-[17px] leading-[1.3] mt-1.5 line-clamp-6" style={{ color: C.ink }}>“{p.review.text}”</blockquote>
          <figcaption className="text-[12px] mt-1.5" style={{ color: paper.ink }}>{p.review.guest}, at {p.review.unit}{p.review.channel ? ' on ' + p.review.channel[0].toUpperCase() + p.review.channel.slice(1) : ''}, {shortDay(p.review.date)}</figcaption>
          {p.body && <div className="text-[12.5px] mt-1.5 pt-1.5 border-t border-black/5" style={{ color: C.ink + 'cc' }}>{p.body}</div>}
        </figure>
      )}
      {(p.kind === 'announcement' || p.kind === 'shoutout' || (p.kind === 'review' && !p.review)) && (
        <div className="mt-1.5">
          {p.title && <div className="font-serif text-[21px] leading-[1.15]" style={{ color: C.ink }}>{p.title}</div>}
          {p.body && <div className="text-[13px] whitespace-pre-line mt-0.5" style={{ color: C.ink + 'cc' }}>{p.body}</div>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mt-2.5">
        {REACTIONS.map(e => {
          const who = p.reactions?.[e] || []
          const mine = who.includes(me)
          return (
            <button key={e} onClick={ev => react(e, ev.currentTarget, mine)} aria-pressed={mine} aria-label={'React ' + e}
              className={'relative text-[13px] rounded-full px-1.5 h-[26px] inline-flex items-center gap-1 transition-all ' + (mine ? 'bg-white shadow-sm' : who.length ? 'bg-white/60' : 'opacity-45 hover:opacity-100 hover:bg-white/60') + (popped === e ? ' bb-pop' : '')}
              style={mine ? { boxShadow: '0 0 0 1.5px ' + paper.pin } : undefined}>
              {e}{who.length ? <span className="text-[11px] font-semibold tabular-nums" style={{ color: C.ink }}>{who.length}</span> : null}
            </button>
          )
        })}
        <button onClick={() => setOpen(o => !o)} className="text-[12px] hover:underline inline-flex items-center gap-1 ml-1" style={{ color: paper.ink }}><MessageCircle size={12} />{replies.length ? replies.length + (replies.length === 1 ? ' reply' : ' replies') : 'Reply'}</button>
        <span className="flex-1" />
        <span className="text-[11px]" style={{ color: C.ink + '88' }}>{p.by}, {ago(p.at)}</span>
      </div>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-black/5 pt-2">
          {replies.map(r => (
            <div key={r.id} className="text-[12.5px] flex gap-1.5 group"><span className="font-semibold shrink-0" style={{ color: C.ink }}>{r.by}</span><span className="flex-1" style={{ color: C.ink + 'cc' }}>{r.text}</span>
              {canPost && <button onClick={() => act({ action: 'unreply', id: p.id, replyId: r.id })} aria-label="Remove reply" className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-rose-600"><X size={11} /></button>}
            </div>
          ))}
          <div className="flex gap-1.5">
            <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doReply() }} placeholder={p.kind === 'eotm' || p.kind === 'shoutout' ? 'Say congrats…' : 'Write a reply…'} className="flex-1 min-w-0 text-[12.5px] rounded-full border border-black/10 px-3 py-1.5 bg-white/90" />
            <button onClick={doReply} disabled={busy || !reply.trim()} className="rounded-full px-3 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: C.ink }}>{busy ? <Loader2 size={12} className="animate-spin" /> : 'Send'}</button>
          </div>
        </div>
      )}
    </article>
  )
}

// ── COMPOSER (leaders) ──────────────────────────────────────────────────────────────────────────
function Composer({ data, initial, onClose, onPost }: { data: BoardRes; initial: PostKind; onClose: () => void; onPost: (p: any) => Promise<void> }) {
  const [kind, setKind] = useState<PostKind>(initial)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState('')
  const [pinned, setPinned] = useState(false)
  const [review, setReview] = useState<ReviewRef | null>(null)
  const [busy, setBusy] = useState(false)
  const person = kind === 'eotm' || kind === 'shoutout'
  const paper = PAPER[kind]
  const field = 'w-full text-[13px] rounded-lg border border-black/10 px-2.5 py-2 bg-white focus:outline-none focus:ring-2'
  const ok = kind === 'review' ? !!review : !!(title.trim() || body.trim())
  const submit = async () => { setBusy(true); try { await onPost({ kind, title, body, due: due || null, owner: owner || null, pinned, review }) } finally { setBusy(false) } }
  const titleLabel = person ? 'Who' : kind === 'quote' ? 'Who said it (optional)' : kind === 'reminder' ? 'What has to get done' : kind === 'review' ? 'Headline (optional)' : 'Headline'
  const bodyLabel = kind === 'eotm' ? 'Why they earned it' : kind === 'shoutout' ? 'What they did' : kind === 'quote' ? 'The quote' : kind === 'reminder' ? 'Details (optional)' : kind === 'review' ? 'Your note (optional)' : 'Details'
  const life = kind === 'quote' ? 'Stays up today only.' : kind === 'eotm' ? 'Stays up until the end of the month.' : kind === 'reminder' ? 'Stays in Have to until someone ticks it done.' : kind === 'review' ? 'Stays up for two weeks.' : 'Stays up for a week.'
  return (
    <div className="mx-4 mb-3 rounded-2xl p-3.5 space-y-3 transition-colors" style={{ background: paper.bg }}>
      <div className="flex items-center gap-2">
        <div className="font-serif text-[20px] leading-none flex-1" style={{ color: C.ink }}>Post to the board</div>
        <button onClick={onClose} aria-label="Close" className="text-ink/50 hover:text-ink"><X size={16} /></button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What are you posting">
        {KINDS.map(k => (
          <button key={k.key} role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}
            className="text-[12.5px] font-medium rounded-full px-3 h-8 inline-flex items-center gap-1.5 transition-colors"
            style={kind === k.key ? { background: C.ink, color: 'white' } : { background: 'rgba(255,255,255,0.75)', color: C.ink }}>
            <span aria-hidden>{KIND_EMOJI[k.key]}</span> {k.label}
          </button>
        ))}
      </div>
      {kind === 'review' && (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
          {!(data.reviews || []).length && <div className="text-[12.5px] text-muted">No new five-star reviews with a written comment in the last three weeks.</div>}
          {(data.reviews || []).map(r => (
            <button key={r.id} onClick={() => setReview(r)} className="block w-full text-left rounded-xl px-3 py-2 bg-white transition-shadow"
              style={review?.id === r.id ? { boxShadow: '0 0 0 2px ' + C.lagoon } : undefined}>
              <div className="text-[11.5px] text-muted"><span style={{ color: C.sun }}>★★★★★</span> {r.guest}, at {r.unit}, {shortDay(r.date)}</div>
              <div className="text-[13px] text-ink line-clamp-2">{r.text}</div>
            </button>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2.5">
        <label className="block"><span className="text-[12px] font-medium" style={{ color: paper.ink }}>{titleLabel}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} list={person ? 'bulletin-people' : undefined} className={field} placeholder={person ? 'Start typing a name' : ''} />
          {person && <datalist id="bulletin-people">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist>}
        </label>
        {kind === 'reminder' && (
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block"><span className="text-[12px] font-medium" style={{ color: paper.ink }}>Due</span><input type="date" value={due} onChange={e => setDue(e.target.value)} className={field} /></label>
            <label className="block"><span className="text-[12px] font-medium" style={{ color: paper.ink }}>Whose</span><input value={owner} onChange={e => setOwner(e.target.value)} list="bulletin-people2" className={field} /><datalist id="bulletin-people2">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist></label>
          </div>
        )}
      </div>
      <label className="block"><span className="text-[12px] font-medium" style={{ color: paper.ink }}>{bodyLabel}</span>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={kind === 'quote' ? 2 : 3} className={field + (kind === 'quote' ? ' font-serif text-[17px]' : '')} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[12.5px] text-ink inline-flex items-center gap-1.5"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to the top</label>
        <span className="text-[12px] flex-1" style={{ color: paper.ink }}>{life}</span>
        <button onClick={submit} disabled={!ok || busy} className="rounded-full px-4 h-9 text-[13px] font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40 active:scale-95 transition-transform" style={{ background: C.ink }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Post it
        </button>
      </div>
    </div>
  )
}
