'use client'
// THE BULLETIN BOARD on Today — replaces the week Scoreboard strip (Jon, 2026-10-06: "the score
// board is weird … have more of a notification board, like have to … a bulletin board where we
// leaders can add something, quote of the day, pending project reminder … make it interactive, we
// can add employee of the month, highlight good reviews … highlight billable amount, cool stats,
// eve thoughts, avg glitch closing time, welcome call completion last 3 days or 7 days, it can be
// random").
//
//   DID YOU KNOW  a shuffled strip of facts: billable this week (money switch only — the scoreboard
//                 route redacts it), glitch close time, welcome-call completion (3 and 7 days), 5★
//                 reviews, one of Eve's open thoughts. Rotates; tap ↻ for a new set.
//   HAVE TO       what has to happen: the day's own must-dos (claims to file, guests waiting,
//                 overdue glitches, unowned tasks) + leader reminders with due dates. Tick done.
//   THE BOARD     Employee of the month, Quote of the day, Shout-outs, Good reviews, Announcements.
//                 Everyone reacts and replies; leaders post, pin and take down.
// Rules: lib/bulletin.ts. Data: /api/command/bulletin (+ /stats), /api/command/scoreboard, Eve.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Plus, Pin, Trash2, X, Check, Loader2, MessageCircle, RefreshCw, Trophy, Quote, Star, Megaphone, Bell, PartyPopper, Sparkles, Circle, CheckCircle2 } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { Tag } from '@/components/lean'
import { CARD, BTN } from '@/components/CommandCockpit'
import { SCOREBOARD_URL } from '@/components/command/Scoreboard'
import { useThoughts } from '@/components/EveThoughts'
import type { CommandDay } from '@/lib/command-day'
import { KINDS, REACTIONS, dueState, type Post, type PostKind, type ReviewRef } from '@/lib/bulletin'

export const BULLETIN_URL = '/api/command/bulletin'
const STATS_URL = '/api/command/bulletin/stats'

type BoardRes = { ok: boolean; error?: string; today: string; me: string; canPost: boolean; posts: Post[]; haveTo: Post[]; reviews?: ReviewRef[]; people?: string[] }
type Fact = { key: string; label: string; value: string; sub: string; href?: string; tone?: 'emerald' | 'amber' | 'slate' | 'sky' }

async function send(body: any): Promise<BoardRes> {
  const r = await fetch(BULLETIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not save')
  return j
}
const shortDay = (ymd?: string | null) => { if (!ymd) return ''; try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? Math.max(1, m) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd' }
function shuffle<T>(xs: T[]): T[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

const KIND_ICON: Record<PostKind, ReactNode> = {
  eotm: <Trophy size={13} />, quote: <Quote size={13} />, reminder: <Bell size={13} />,
  announcement: <Megaphone size={13} />, review: <Star size={13} />, shoutout: <PartyPopper size={13} />,
}
const KIND_LABEL: Record<PostKind, string> = { eotm: 'Employee of the month', quote: 'Quote of the day', reminder: 'Reminder', announcement: 'Announcement', review: 'Good review', shoutout: 'Shout-out' }

export function BulletinBoard({ d }: { d: CommandDay }) {
  const q = useCachedFetch<BoardRes>(BULLETIN_URL, { ttl: 60_000 })
  const [local, setLocal] = useState<BoardRes | null>(null)
  const data = local || q.data
  const [composing, setComposing] = useState(false)
  const [err, setErr] = useState('')
  const act = async (body: any) => {
    setErr('')
    try { const j = await send(body); setLocal(prev => ({ ...(prev || q.data || {} as any), ...j })); invalidateCache(BULLETIN_URL) }
    catch (e: any) { setErr(e?.message || String(e)) }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="text-[14px] font-bold text-ink flex-1">Bulletin board</div>
        {data?.canPost && !composing && <button onClick={() => setComposing(true)} className={BTN + ' bg-ink text-white'}><Plus size={13} /> Post</button>}
      </div>
      <Facts />
      {composing && data && <Composer data={data} onClose={() => setComposing(false)} onPost={async p => { await act({ action: 'create', post: p }); setComposing(false) }} />}
      {err && <div className="mx-4 mb-2 text-[12px] text-rose-700">{err}</div>}
      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 px-4 pb-4 pt-1">
        <HaveTo d={d} data={data} act={act} />
        <Board data={data} loading={q.loading && !data} act={act} />
      </div>
    </section>
  )
}

// ── DID YOU KNOW ────────────────────────────────────────────────────────────────────────────────
function Facts() {
  const stats = useCachedFetch<{ facts?: Fact[] }>(STATS_URL, { ttl: 10 * 60_000 })
  const week = useCachedFetch<{ tiles?: { key: string; label: string; value: string; sub: string }[] }>(SCOREBOARD_URL, { ttl: 5 * 60_000 })
  const eve = useThoughts({ status: 'open', limit: 25 })
  const all = useMemo(() => {
    const out: Fact[] = [...(stats.data?.facts || [])]
    for (const t of week.data?.tiles || []) {
      // Money only when the viewer may see it (the route blanks it to "—" otherwise).
      if (t.key === 'billable' && /\$/.test(t.value)) out.push({ key: 'billable', label: 'Billable this week', value: t.value, sub: t.sub, href: '/billing', tone: 'emerald' })
      if (t.key === 'claims' && /\$[\d,]+ back/.test(t.sub)) out.push({ key: 'claimsBack', label: 'Claims recovered · this month', value: (t.sub.match(/\$[\d,]+/) || [''])[0], sub: t.value + ' still open', href: '/claims', tone: 'emerald' })
    }
    const th = eve.rows.filter(r => r.headline)
    if (th.length) {
      const pick = th[Math.floor(Math.random() * th.length)]
      out.push({ key: 'eve', label: 'Eve is thinking', value: '', sub: pick.headline, href: '/users?tab=settings&panel=eve', tone: 'sky' })
    }
    return out
  }, [stats.data, week.data, eve.rows])
  const [order, setOrder] = useState<Fact[]>([])
  useEffect(() => { setOrder(shuffle(all)) }, [all])
  useEffect(() => {
    if (all.length <= 3) return
    const id = setInterval(() => setOrder(o => o.length > 3 ? [...o.slice(3), ...o.slice(0, 3)] : o), 12_000)
    return () => clearInterval(id)
  }, [all.length])
  if (!order.length) return null
  const show = order.slice(0, 3)
  const tone = (t?: Fact['tone']) => t === 'emerald' ? 'text-emerald-700' : t === 'amber' ? 'text-amber-700' : t === 'sky' ? 'text-sky-700' : 'text-ink'
  return (
    <div className="px-4 pb-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles size={12} className="text-brand-600" />
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted flex-1">Did you know</span>
        {all.length > 3 && <button onClick={() => setOrder(shuffle(all))} title="Show other stats" className="text-muted hover:text-ink"><RefreshCw size={12} /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {show.map(f => {
          const inner = (
            <div className={'h-full rounded-xl border border-line px-3 py-2 transition-colors ' + (f.key === 'eve' ? 'bg-sky-50/60' : 'bg-slate-50/60') + (f.href ? ' hover:border-ink/30' : '')}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted truncate">{f.label}</div>
              {f.value && <div className={'text-[20px] font-bold tabular-nums leading-tight ' + tone(f.tone)}>{f.value}</div>}
              <div className={'text-[11.5px] text-muted ' + (f.key === 'eve' ? 'text-ink line-clamp-3 mt-0.5' : 'truncate')}>{f.sub}</div>
            </div>
          )
          return f.href ? <Link key={f.key} href={f.href} className="block">{inner}</Link> : <div key={f.key}>{inner}</div>
        })}
      </div>
    </div>
  )
}

// ── HAVE TO ─────────────────────────────────────────────────────────────────────────────────────
function HaveTo({ d, data, act }: { d: CommandDay; data?: BoardRes; act: (b: any) => Promise<void> }) {
  const t = d.tiles
  const auto: { key: string; text: string; href: string; tone: 'rose' | 'amber' }[] = []
  if (t.claims.dueSoon) auto.push({ key: 'claims', text: t.claims.dueSoon + ' claim' + (t.claims.dueSoon === 1 ? '' : 's') + ' to file before the deadline', href: '/claims', tone: 'rose' })
  if (t.glitches.overdue) auto.push({ key: 'glitches', text: t.glitches.overdue + ' guest issue' + (t.glitches.overdue === 1 ? '' : 's') + ' past due', href: '/glitches', tone: 'rose' })
  if (t.guestDesk.messages) auto.push({ key: 'msgs', text: t.guestDesk.messages + ' guest' + (t.guestDesk.messages === 1 ? '' : 's') + ' waiting on a reply', href: '/messages', tone: 'amber' })
  if (t.guestDesk.welcome) auto.push({ key: 'welcome', text: t.guestDesk.welcome + ' welcome call' + (t.guestDesk.welcome === 1 ? '' : 's') + ' to make', href: '/welcome-calls', tone: 'amber' })
  if (t.tasks.unassigned) auto.push({ key: 'unowned', text: t.tasks.unassigned + ' task' + (t.tasks.unassigned === 1 ? '' : 's') + ' with nobody on it', href: '/maintenance', tone: 'amber' })
  const rem = data?.haveTo || []
  const today = data?.today || ''
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1.5">Have to</div>
      {!auto.length && !rem.length && <div className="text-[12.5px] text-muted py-2">Nothing pressing. Leaders can add a reminder with + Post.</div>}
      <ul className="space-y-1">
        {auto.map(a => (
          <li key={a.key}>
            <Link href={a.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-[12.5px] text-ink">
              <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (a.tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500')} />
              <span className="flex-1 min-w-0">{a.text}</span>
            </Link>
          </li>
        ))}
        {rem.map(p => {
          const st = dueState(p, today)
          const done = st === 'done'
          return (
            <li key={p.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 group">
              <button onClick={() => act({ action: done ? 'undone' : 'done', id: p.id })} title={done ? 'Mark not done' : 'Mark done'} className={'mt-[1px] shrink-0 ' + (done ? 'text-emerald-600' : 'text-muted hover:text-ink')}>
                {done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className={'text-[12.5px] ' + (done ? 'line-through text-muted' : 'text-ink font-medium')}>{p.title || p.body}</div>
                {p.title && p.body && !done && <div className="text-[11.5px] text-muted">{p.body}</div>}
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  {st === 'overdue' && <Tag tone="rose">overdue · {shortDay(p.due)}</Tag>}
                  {st === 'today' && <Tag tone="amber">due today</Tag>}
                  {(st === 'soon' || st === 'later') && <Tag tone="slate">by {shortDay(p.due)}</Tag>}
                  {p.owner && <Tag tone="sky">{p.owner}</Tag>}
                  {done && p.doneBy && <span className="text-[10.5px] text-muted">done by {p.doneBy}</span>}
                </div>
              </div>
              {data?.canPost && <button onClick={() => act({ action: 'delete', id: p.id })} title="Remove" className="opacity-0 group-hover:opacity-100 text-muted hover:text-rose-600 shrink-0"><Trash2 size={13} /></button>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── THE BOARD ───────────────────────────────────────────────────────────────────────────────────
function Board({ data, loading, act }: { data?: BoardRes; loading: boolean; act: (b: any) => Promise<void> }) {
  const posts = data?.posts || []
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1.5">The board</div>
      {loading && <div className="text-[12.5px] text-muted py-2 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading…</div>}
      {!loading && !posts.length && <div className="text-[12.5px] text-muted py-2">{data?.canPost ? 'Nothing up yet. Post an Employee of the month, a quote, or pin a 5★ review.' : 'Nothing up yet.'}</div>}
      <div className="space-y-2">{posts.map(p => <PostCard key={p.id} p={p} me={data?.me || ''} canPost={!!data?.canPost} act={act} />)}</div>
    </div>
  )
}

function PostCard({ p, me, canPost, act }: { p: Post; me: string; canPost: boolean; act: (b: any) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const frame = p.kind === 'eotm' ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'
    : p.kind === 'quote' ? 'border-violet-200 bg-violet-50/50'
      : p.kind === 'review' ? 'border-emerald-200 bg-emerald-50/40'
        : p.kind === 'shoutout' ? 'border-pink-200 bg-pink-50/40' : 'border-line bg-white'
  const accent = p.kind === 'eotm' ? 'text-amber-700' : p.kind === 'quote' ? 'text-violet-700' : p.kind === 'review' ? 'text-emerald-700' : p.kind === 'shoutout' ? 'text-pink-700' : 'text-slate-600'
  const replies = p.replies || []
  const doReply = async () => { if (!reply.trim()) return; setBusy(true); await act({ action: 'reply', id: p.id, text: reply }); setReply(''); setBusy(false) }
  return (
    <article className={'rounded-xl border px-3 py-2.5 ' + frame}>
      <div className="flex items-center gap-1.5">
        <span className={'inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide ' + accent}>{KIND_ICON[p.kind]} {KIND_LABEL[p.kind]}</span>
        {p.pinned && <Pin size={11} className="text-muted" />}
        <span className="flex-1" />
        {canPost && <button onClick={() => act({ action: 'edit', id: p.id, post: { pinned: !p.pinned } })} title={p.pinned ? 'Unpin' : 'Pin to the top'} className="text-muted hover:text-ink"><Pin size={12} /></button>}
        {canPost && <button onClick={() => act({ action: 'delete', id: p.id })} title="Take down" className="text-muted hover:text-rose-600"><Trash2 size={12} /></button>}
      </div>

      {p.kind === 'eotm' && (
        <div className="flex items-center gap-3 mt-1.5">
          <div className="w-11 h-11 rounded-full bg-amber-400 text-white flex items-center justify-center text-[16px] font-bold shrink-0">{(p.title || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
          <div className="min-w-0"><div className="text-[17px] font-bold text-ink leading-tight">{p.title}</div>{p.body && <div className="text-[12.5px] text-ink/80 mt-0.5">{p.body}</div>}</div>
        </div>
      )}
      {p.kind === 'quote' && (
        <div className="mt-1.5"><div className="text-[15px] italic text-ink leading-snug">“{p.body || p.title}”</div>{p.body && p.title && <div className="text-[12px] text-muted mt-0.5">— {p.title}</div>}</div>
      )}
      {p.kind === 'review' && p.review && (
        <div className="mt-1.5">
          <div className="text-amber-500 text-[13px] leading-none">{'★'.repeat(Math.round(p.review.stars))}</div>
          <div className="text-[13px] text-ink mt-1 leading-snug line-clamp-5">“{p.review.text}”</div>
          <div className="text-[11.5px] text-muted mt-1">{p.review.guest} · {p.review.unit}{p.review.channel ? ' · ' + p.review.channel : ''} · {shortDay(p.review.date)}</div>
          {p.body && <div className="text-[12.5px] text-ink/80 mt-1">{p.body}</div>}
        </div>
      )}
      {(p.kind === 'announcement' || p.kind === 'shoutout' || (p.kind === 'review' && !p.review)) && (
        <div className="mt-1">{p.title && <div className="text-[14px] font-bold text-ink">{p.kind === 'shoutout' ? '🎉 ' : ''}{p.title}</div>}{p.body && <div className="text-[12.5px] text-ink/80 whitespace-pre-line">{p.body}</div>}</div>
      )}

      <div className="flex flex-wrap items-center gap-1 mt-2">
        {REACTIONS.map(e => {
          const who = p.reactions?.[e] || []
          const mine = who.includes(me)
          return (
            <button key={e} onClick={() => act({ action: 'react', id: p.id, emoji: e })}
              className={'text-[12px] rounded-full px-1.5 h-6 inline-flex items-center gap-1 border ' + (mine ? 'border-brand-300 bg-brand-50' : who.length ? 'border-line bg-white' : 'border-transparent opacity-50 hover:opacity-100')}>
              {e}{who.length ? <span className="text-[11px] font-semibold tabular-nums text-ink/80">{who.length}</span> : null}
            </button>
          )
        })}
        <button onClick={() => setOpen(o => !o)} className="text-[11.5px] text-muted hover:text-ink inline-flex items-center gap-1 ml-1"><MessageCircle size={12} />{replies.length ? replies.length : 'Reply'}</button>
        <span className="flex-1" />
        <span className="text-[10.5px] text-muted">{p.by} · {ago(p.at)}</span>
      </div>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-line/70 pt-2">
          {replies.map(r => (
            <div key={r.id} className="text-[12px] flex gap-1.5 group"><span className="font-semibold text-ink shrink-0">{r.by}</span><span className="text-ink/80 flex-1">{r.text}</span>
              {canPost && <button onClick={() => act({ action: 'unreply', id: p.id, replyId: r.id })} className="opacity-0 group-hover:opacity-100 text-muted hover:text-rose-600"><X size={11} /></button>}
            </div>
          ))}
          <div className="flex gap-1.5">
            <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doReply() }} placeholder="Say something…" className="flex-1 min-w-0 text-[12.5px] border border-line rounded-lg px-2 py-1.5 bg-white" />
            <button onClick={doReply} disabled={busy || !reply.trim()} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={12} className="animate-spin" /> : 'Send'}</button>
          </div>
        </div>
      )}
    </article>
  )
}

// ── COMPOSER (leaders) ──────────────────────────────────────────────────────────────────────────
function Composer({ data, onClose, onPost }: { data: BoardRes; onClose: () => void; onPost: (p: any) => Promise<void> }) {
  const [kind, setKind] = useState<PostKind>('eotm')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState('')
  const [pinned, setPinned] = useState(false)
  const [review, setReview] = useState<ReviewRef | null>(null)
  const [busy, setBusy] = useState(false)
  const person = kind === 'eotm' || kind === 'shoutout'
  const field = 'w-full text-[13px] border border-line rounded-lg px-2.5 py-1.5 bg-white'
  const ok = kind === 'review' ? !!review : !!(title.trim() || body.trim())
  const submit = async () => {
    setBusy(true)
    try { await onPost({ kind, title, body, due: due || null, owner: owner || null, pinned, review }) } finally { setBusy(false) }
  }
  const titleLabel = kind === 'eotm' || kind === 'shoutout' ? 'Who' : kind === 'quote' ? 'Who said it (optional)' : kind === 'reminder' ? 'What has to get done' : kind === 'review' ? 'Headline (optional)' : 'Headline'
  const bodyLabel = kind === 'eotm' ? 'Why (a line or two)' : kind === 'shoutout' ? 'What they did' : kind === 'quote' ? 'The quote' : kind === 'reminder' ? 'Details (optional)' : kind === 'review' ? 'Your note (optional)' : 'Details'
  return (
    <div className="mx-4 mb-3 rounded-xl border border-line bg-slate-50/70 p-3 space-y-2.5">
      <div className="flex items-center gap-2"><div className="text-[13px] font-bold text-ink flex-1">New post</div><button onClick={onClose} className="text-muted hover:text-ink"><X size={15} /></button></div>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(k => (
          <button key={k.key} onClick={() => setKind(k.key)} className={'text-[12px] font-semibold rounded-full px-2.5 py-1 border inline-flex items-center gap-1 ' + (kind === k.key ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-ink/40')}>
            {KIND_ICON[k.key]} {k.label}
          </button>
        ))}
      </div>
      {kind === 'review' ? (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {!(data.reviews || []).length && <div className="text-[12.5px] text-muted">No new 5★ reviews with text in the last 3 weeks.</div>}
          {(data.reviews || []).map(r => (
            <button key={r.id} onClick={() => setReview(r)} className={'block w-full text-left rounded-lg border px-2.5 py-2 ' + (review?.id === r.id ? 'border-emerald-400 bg-emerald-50' : 'border-line bg-white hover:border-ink/30')}>
              <div className="text-[11px] text-muted"><span className="text-amber-500">★★★★★</span> {r.guest} · {r.unit} · {r.channel} · {shortDay(r.date)}</div>
              <div className="text-[12.5px] text-ink line-clamp-2">{r.text}</div>
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="block"><span className="text-[11px] font-semibold text-muted">{titleLabel}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} list={person ? 'bulletin-people' : undefined} className={field} placeholder={person ? 'Start typing a name' : ''} />
          {person && <datalist id="bulletin-people">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist>}
        </label>
        {kind === 'reminder' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[11px] font-semibold text-muted">Due</span><input type="date" value={due} onChange={e => setDue(e.target.value)} className={field} /></label>
            <label className="block"><span className="text-[11px] font-semibold text-muted">Whose</span><input value={owner} onChange={e => setOwner(e.target.value)} list="bulletin-people2" className={field} /><datalist id="bulletin-people2">{(data.people || []).map(n => <option key={n} value={n} />)}</datalist></label>
          </div>
        )}
      </div>
      <label className="block"><span className="text-[11px] font-semibold text-muted">{bodyLabel}</span>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={kind === 'quote' ? 2 : 3} className={field} />
      </label>
      <div className="flex items-center gap-3">
        <label className="text-[12px] text-ink inline-flex items-center gap-1.5"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to the top</label>
        <span className="text-[11px] text-muted flex-1">{kind === 'quote' ? 'Up today only.' : kind === 'eotm' ? 'Up until the end of the month.' : kind === 'reminder' ? 'Stays in Have to until ticked done.' : kind === 'review' ? 'Up for two weeks.' : 'Up for a week.'}</span>
        <button onClick={submit} disabled={!ok || busy} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Post</button>
      </div>
    </div>
  )
}
