'use client'
// HANDOFF ALERTS ON SCREEN (Jon, 2026-10-07: "I would prefer it to be a pop-up on their screen versus
// just in the bulletin on the Today page, where they can open and close it. It sits there and has a
// notification bell that shows everyone who saw it, read it, or acknowledged it based on the user …
// they can comment on it and ask questions about that notification in the pop-up").
//
//   POP-UP   mounted once in the Shell, on every page. When an alert for you fires it opens over
//            whatever you are doing. Close it and it waits in the bell; it comes back after an hour
//            if you still haven't tapped "Got it". Opening it counts as SEEN; reading it for a few
//            seconds (or touching it) as READ; "Got it" as ACKNOWLEDGED.
//   BELL     "Alerts" in the sidebar (a bell in the phone header). The badge is what you still have to
//            confirm. It lists the alerts — yours, and for an admin all of them — with how many have
//            confirmed; open one for the full picture: who saw it, read it, confirmed it, and the
//            comments. "New alert" is here too.
//   COMMENTS questions and answers inside the alert; each also goes to the alert's Slack thread.
// Rules: lib/handoff.ts · data: /api/handoff · firing + Slack + nags: lib/handoff-store (cron).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { BellRing, X, Check, Loader2, Send, Plus, Clock, Hash, Eye, BookOpen, CircleCheck, Circle } from 'lucide-react'
import { people as peopleOf, stageOf, type Alert, type Audience } from '@/lib/handoff'

const URL_ = '/api/handoff'
type Res = { ok: boolean; me: string; leader: boolean; mine: Alert[]; open: Alert[]; team?: { email: string; name: string; role: string | null }[]; roles?: { key: string; label: string }[]; channels?: { id: string; label: string }[] }

// ── one shared copy of the alerts for the bell and the pop-up ─────────────────────────────────────
let state: Res | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
let inflight: Promise<void> | null = null
async function load() {
  if (inflight) return inflight
  inflight = (async () => {
    try { const r = await fetch(URL_, { cache: 'no-store' }); if (r.ok) { state = await r.json(); emit() } } catch { /* offline: keep what we have */ }
  })().finally(() => { inflight = null })
  return inflight
}
async function post(body: any): Promise<Res> {
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not save')
  state = { ...(state || {} as any), ...j }; emit()
  return j
}
function useAlerts(): Res | null {
  const v = useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => state, () => null)
  useEffect(() => {
    if (!state) load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60_000)
    const vis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [])
  return v
}

const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; const today = d.toDateString() === new Date().toDateString(); return d.toLocaleString('en-US', today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const SEV = {
  urgent: { bar: 'bg-rose-600', chip: 'bg-rose-50 text-rose-700', label: 'Urgent' },
  warn: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800', label: 'Heads-up' },
  info: { bar: 'bg-ink', chip: 'bg-slate-100 text-slate-700', label: 'Handoff' },
} as const

// ── one alert, in full ────────────────────────────────────────────────────────────────────────────
export function AlertView({ a, me, leader, onClose }: { a: Alert; me: string; leader: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const sev = SEV[a.severity || 'info']
  const mineToAck = !!a.firedAt && !a.closedAt && stageOf(a, me) !== 'ack' && (a.audience.kind === 'everyone' || (a.recipients || []).some(r => r.email === me))
  const canManage = leader || a.byEmail === me
  const ppl = peopleOf(a)
  const acked = Object.keys(a.acks || {}).length
  const total = (a.recipients || []).length
  const run = async (k: string, body: any) => { setBusy(k); setErr(''); try { await post(body) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') } }
  // READ: a few seconds with it open (or touching it) — "seen" is only that it came up.
  const readSent = useRef(false)
  const markRead = useCallback(() => { if (readSent.current || stageOf(a, me) === 'read' || stageOf(a, me) === 'ack') return; readSent.current = true; post({ action: 'read', id: a.id }).catch(() => {}) }, [a, me])
  useEffect(() => { const t = setTimeout(markRead, 3000); return () => clearTimeout(t) }, [markRead])
  const ch = a.channel ? (state?.channels?.find(c => c.id === a.channel)?.label || 'Slack') : null
  return (
    <div onMouseDown={markRead} onKeyDown={markRead}>
      <div className={'h-1.5 rounded-t-2xl ' + sev.bar} />
      <div className="px-5 pt-4 pb-3 border-b border-line">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + sev.chip}>{sev.label}</span>
              <span className="text-[12px] text-muted">from {a.by} · {a.firedAt ? when(a.firedAt) : 'goes out ' + when(a.fireAt)}</span>
              {a.closedAt && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">Closed</span>}
            </div>
            <h2 className="lh-display text-[24px] leading-[1.15] text-ink mt-1.5">{a.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100 shrink-0"><X size={16} /></button>
        </div>
        {a.body && <p className="text-[14px] text-ink/85 mt-2 whitespace-pre-line leading-relaxed">{a.body}</p>}
        {a.unit && <p className="text-[12.5px] text-muted mt-2">About: <span className="text-ink font-medium">{a.unit}</span></p>}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {mineToAck && <button disabled={!!busy} onClick={() => run('ack', { action: 'ack', id: a.id })} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-4 h-9 text-[13px] font-semibold disabled:opacity-50">{busy === 'ack' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Got it</button>}
          {!mineToAck && stageOf(a, me) === 'ack' && <span className="inline-flex items-center gap-1 text-[12.5px] text-emerald-700 font-semibold"><CircleCheck size={14} /> You confirmed {when(a.acks[me])}</span>}
          {canManage && !a.firedAt && <button disabled={!!busy} onClick={() => run('fire', { action: 'fire', id: a.id })} className="rounded-lg border border-line px-3 h-9 text-[12.5px] font-semibold text-ink hover:border-ink/40">Send now</button>}
          {canManage && !a.closedAt && <button disabled={!!busy} onClick={() => run('close', { action: 'close', id: a.id })} className="rounded-lg border border-line px-3 h-9 text-[12.5px] font-semibold text-muted hover:text-ink hover:border-ink/40">Close alert</button>}
          <span className="flex-1" />
          {ch && <span className={'text-[11.5px] inline-flex items-center gap-1 ' + (a.slackError ? 'text-rose-700' : 'text-muted')} title={a.slackError ? 'Slack said: ' + a.slackError + (a.slackError === 'not_in_channel' ? ' — invite the Lighthouse bot to that channel' : '') : ''}><Hash size={11} />{a.slackError ? 'Could not post to ' + ch : (a.slackTs ? 'Posted to ' : 'Will post to ') + ch}</span>}
        </div>
        {err && <p className="text-[12px] text-rose-700 mt-2">{err}</p>}
      </div>

      {/* WHO SAW IT */}
      <div className="px-5 py-3 border-b border-line">
        <div className="flex items-baseline gap-2 mb-1.5">
          <h3 className="text-[13px] font-semibold text-ink">Who&apos;s seen it</h3>
          <span className="text-[12px] text-muted">{total ? acked + ' of ' + total + ' confirmed' : acked + ' confirmed'}</span>
        </div>
        {!ppl.length && <p className="text-[12.5px] text-muted">{a.firedAt ? 'Nobody has opened it yet.' : 'It goes out ' + when(a.fireAt) + '.'}</p>}
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {ppl.map(p => (
            <li key={p.email} className="flex items-center gap-2 text-[12.5px]">
              {p.stage === 'ack' ? <CircleCheck size={14} className="text-emerald-600 shrink-0" /> : p.stage === 'read' ? <BookOpen size={14} className="text-sky-600 shrink-0" /> : p.stage === 'seen' ? <Eye size={14} className="text-amber-600 shrink-0" /> : <Circle size={14} className="text-slate-300 shrink-0" />}
              <span className="text-ink truncate">{p.name}</span>
              <span className="text-[11px] text-muted shrink-0">{p.stage === 'ack' ? 'confirmed' : p.stage === 'read' ? 'read' : p.stage === 'seen' ? 'saw it' : 'not yet'}{p.at ? ' ' + when(p.at) : ''}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* COMMENTS */}
      <div className="px-5 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-1.5">Questions &amp; comments</h3>
        <div className="space-y-2">
          {(a.comments || []).map(c => (
            <div key={c.id} className="text-[13px]"><span className="font-semibold text-ink">{c.by}</span> <span className="text-[11px] text-muted">{when(c.at)}</span><div className="text-ink/85 whitespace-pre-line">{c.text}</div></div>
          ))}
          {!(a.comments || []).length && <p className="text-[12.5px] text-muted">Ask a question or add an update — everyone on this alert sees it{a.slackTs ? ', and it goes to the Slack thread' : ''}.</p>}
        </div>
        <div className="flex gap-2 mt-2.5">
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { run('c', { action: 'comment', id: a.id, text }).then(() => setText('')) } }}
            placeholder="Write a comment or a question…" className="flex-1 min-w-0 text-[13px] rounded-lg border border-line px-3 py-2 focus:outline-none focus:border-ink/40" />
          <button disabled={!text.trim() || !!busy} onClick={() => run('c', { action: 'comment', id: a.id, text }).then(() => setText(''))} className="rounded-lg bg-ink text-white px-3 h-9 text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">{busy === 'c' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
        </div>
      </div>
    </div>
  )
}

// ── THE FLOATER, top right of every page (Jon, 2026-10-07: "want it to function in a way that follows
// you around like a floater, maybe small top right"). One small bell, pinned; under it, a compact card
// for each alert you still have to confirm — title, who, Got it, Open — that you can tuck away (it
// comes back in an hour if still unconfirmed). Open shows the whole alert in a panel hanging off the
// bell, not over the page; the bell itself opens the list and New alert.
const DISMISS_KEY = (id: string) => 'handoff:closed:' + id
const POP_AGAIN_MS = 60 * 60_000
const tucked = (id: string) => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY(id)) || 0) < POP_AGAIN_MS } catch { return false } }

function Panel({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element)?.closest?.('[data-handoff-bell]')) onClose() }
    window.addEventListener('keydown', k); document.addEventListener('mousedown', out)
    return () => { window.removeEventListener('keydown', k); document.removeEventListener('mousedown', out) }
  }, [onClose])
  return <div ref={ref} role="dialog" aria-label={label} className="mt-2 w-[min(440px,calc(100vw-24px))] max-h-[min(78vh,720px)] overflow-y-auto bg-white rounded-2xl border border-line shadow-2xl">{children}</div>
}

export function HandoffFloater() {
  const s = useAlerts()
  const [view, setView] = useState<null | 'list' | 'new' | string>(null)   // string = an alert id
  const [, force] = useState(0)
  const seenSent = useRef(new Set<string>())
  const mine = s?.mine || []
  const cards = mine.filter(a => !tucked(a.id))
  const n = mine.length
  // SEEN: a card came up on your screen.
  useEffect(() => {
    for (const a of cards) {
      if (seenSent.current.has(a.id) || stageOf(a, s?.me || '') !== 'none') continue
      seenSent.current.add(a.id)
      post({ action: 'seen', id: a.id }).catch(() => {})
    }
  }, [cards, s?.me])
  // a tucked card comes back on its own after an hour
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 5 * 60_000); return () => clearInterval(t) }, [])
  if (!s) return null
  const tuck = (id: string) => { try { localStorage.setItem(DISMISS_KEY(id), String(Date.now())) } catch { /* fine */ } force(x => x + 1) }
  const open = typeof view === 'string' && view !== 'list' && view !== 'new' ? (s.open.find(x => x.id === view) || mine.find(x => x.id === view)) : null
  const sevBar = (a: Alert) => a.severity === 'urgent' ? 'bg-rose-600' : a.severity === 'warn' ? 'bg-amber-500' : 'bg-ink'
  return (
    <div className="fixed z-[65] right-3 top-[64px] lg:right-5 lg:top-4 flex flex-col items-end pointer-events-none print:hidden">
      <button data-handoff-bell onClick={() => { setView(v => v ? null : 'list'); load() }}
        aria-label={'Alerts' + (n ? ', ' + n + ' to confirm' : '')}
        className={'pointer-events-auto relative h-9 min-w-9 rounded-full border bg-white shadow-md inline-flex items-center justify-center gap-1.5 ' + (n ? 'px-3' : 'px-0 w-9') + ' text-[12.5px] font-semibold transition-colors ' + (n ? 'border-rose-200 text-rose-700' : 'border-line text-muted hover:text-ink')}>
        <BellRing size={15} className={n ? 'motion-safe:animate-[wiggle_1.2s_ease-in-out_2]' : ''} />
        {n ? <span>{n}</span> : null}
      </button>

      {view === null && cards.length > 0 && (
        <div className="pointer-events-auto mt-2 flex flex-col gap-2 w-[min(340px,calc(100vw-24px))]">
          {cards.slice(0, 2).map(a => (
            <div key={a.id} className="lh-fade relative bg-white rounded-xl border border-line shadow-xl overflow-hidden" role="alert">
              <span className={'absolute left-0 top-0 bottom-0 w-1 ' + sevBar(a)} />
              <div className="pl-3.5 pr-2 py-2.5">
                <div className="flex items-start gap-2">
                  <button onClick={() => setView(a.id)} className="flex-1 min-w-0 text-left">
                    <div className="text-[11px] text-muted">{a.source === 'eve' ? 'Eve' : a.by} · {when(a.firedAt)}{a.unit ? ' · ' + a.unit : ''}</div>
                    <div className="text-[13.5px] font-semibold text-ink leading-snug line-clamp-2">{a.title}</div>
                  </button>
                  <button onClick={() => tuck(a.id)} aria-label="Tuck away for an hour" title="Tuck away — it stays in the bell" className="w-6 h-6 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100 shrink-0"><X size={13} /></button>
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <button onClick={() => post({ action: 'ack', id: a.id }).catch(() => {})} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 h-7 text-[12px] font-semibold"><Check size={12} /> Got it</button>
                  <button onClick={() => setView(a.id)} className="rounded-lg border border-line px-2.5 h-7 text-[12px] font-semibold text-ink hover:border-ink/40">Open{(a.comments || []).length ? ' · ' + a.comments!.length + ' comment' + (a.comments!.length === 1 ? '' : 's') : ''}</button>
                </div>
              </div>
            </div>
          ))}
          {cards.length > 2 && <button onClick={() => setView('list')} className="self-end text-[12px] font-semibold text-ink bg-white border border-line rounded-full px-3 h-7 shadow">+{cards.length - 2} more</button>}
        </div>
      )}

      {view !== null && (
        <div className="pointer-events-auto">
          <Panel onClose={() => setView(null)} label={view === 'new' ? 'New alert' : open ? 'Alert' : 'Alerts'}>
            {view === 'new' ? <NewAlert onDone={id => setView(id || 'list')} />
              : open ? <AlertView a={open} me={s.me} leader={s.leader} onClose={() => setView('list')} />
                : <AlertList s={s} onOpen={id => setView(id)} onNew={() => setView('new')} onClose={() => setView(null)} />}
          </Panel>
        </div>
      )}
    </div>
  )
}

function AlertList({ s, onOpen, onNew, onClose }: { s: Res; onOpen: (id: string) => void; onNew: () => void; onClose: () => void }) {
  return (
    <>
      <div className="px-4 pt-3.5 pb-3 border-b border-line flex items-center gap-2">
        <h2 className="lh-display text-[20px] leading-none text-ink flex-1">Alerts</h2>
        <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-2.5 h-8 text-[12.5px] font-semibold"><Plus size={13} /> New alert</button>
        <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><X size={15} /></button>
      </div>
      {!s.open.length && <p className="px-4 py-8 text-center text-[13px] text-muted">No alerts. Use New alert to leave the incoming team a note they have to confirm.</p>}
      <ul className="divide-y divide-line">
        {s.open.map(x => {
          const st = stageOf(x, s.me)
          const forMe = s.mine.some(m => m.id === x.id)
          const acked = Object.keys(x.acks || {}).length, total = (x.recipients || []).length
          return (
            <li key={x.id}>
              <button onClick={() => onOpen(x.id)} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2.5">
                <span className={'mt-1.5 w-2 h-2 rounded-full shrink-0 ' + (x.closedAt ? 'bg-slate-300' : x.severity === 'urgent' ? 'bg-rose-600' : x.severity === 'warn' ? 'bg-amber-500' : 'bg-ink')} />
                <span className="min-w-0 flex-1">
                  <span className={'block text-[13px] leading-snug ' + (forMe ? 'font-semibold text-ink' : 'text-ink')}>{x.title}</span>
                  <span className="block text-[11.5px] text-muted mt-0.5">
                    {x.source === 'eve' ? 'Eve' : x.by} · {x.firedAt ? when(x.firedAt) : <span className="inline-flex items-center gap-0.5"><Clock size={10} /> goes out {when(x.fireAt)}</span>}
                    {' · '}{total ? acked + '/' + total + ' confirmed' : acked + ' confirmed'}{(x.comments || []).length ? ' · ' + x.comments!.length + ' comment' + (x.comments!.length === 1 ? '' : 's') : ''}{x.closedAt ? ' · closed' : ''}
                  </span>
                </span>
                {forMe ? <span className="text-[11px] font-semibold text-rose-700 shrink-0">confirm</span> : st === 'ack' ? <CircleCheck size={15} className="text-emerald-600 shrink-0" /> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** Old mount names, kept so nothing else breaks: the floater is the whole thing now. */
export const HandoffPopup = HandoffFloater
export function HandoffBell(_: { variant: 'sidebar' | 'icon' }) { return null }

// ── a new alert ───────────────────────────────────────────────────────────────────────────────────
export function NewAlert({ onDone }: { onDone: (id: string | null) => void }) {
  const [form, setForm] = useState<Res | null>(null)
  useEffect(() => { fetch(URL_ + '?form=1', { cache: 'no-store' }).then(r => r.json()).then(j => { setForm(j); if (j?.channels) state = { ...(state || j), channels: j.channels } }).catch(() => {}) }, [])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [unit, setUnit] = useState('')
  const [aud, setAud] = useState<'everyone' | 'roles' | 'people'>('everyone')
  const [roles, setRoles] = useState<string[]>([])
  const [ppl, setPpl] = useState<string[]>([])
  const [whenMode, setWhenMode] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState('')
  const [channel, setChannel] = useState<string>('')   // '' = default (first channel); 'none' = Lighthouse only
  const [sev, setSev] = useState<'info' | 'warn' | 'urgent'>('info')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const field = 'w-full text-[13px] rounded-lg border border-line px-2.5 py-2 bg-white focus:outline-none focus:border-ink/40'
  const chip = (on: boolean) => 'text-[12px] font-medium rounded-lg px-2.5 h-8 border ' + (on ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:border-ink/40')
  const audience: Audience = aud === 'roles' ? { kind: 'roles', roles } : aud === 'people' ? { kind: 'people', emails: ppl } : { kind: 'everyone' }
  const ok = !!title.trim() && (aud !== 'roles' || roles.length > 0) && (aud !== 'people' || ppl.length > 0) && (whenMode === 'now' || !!at)
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const ch = channel === 'none' ? null : (channel || form?.channels?.[0]?.id || null)
      const j = await post({ action: 'create', alert: { title, body, unit, audience, fireAt: whenMode === 'later' && at ? new Date(at).toISOString() : null, channel: ch, severity: sev, nag: true } })
      const made = j.open?.find(x => x.title === title.trim() && x.byEmail === j.me)
      onDone(made ? made.id : null)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-center gap-2"><h2 className="lh-display text-[22px] leading-none text-ink flex-1">New alert</h2><button onClick={() => onDone(null)} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><X size={16} /></button></div>
      <p className="text-[12.5px] text-muted -mt-1">It pops up on their screen until they tap Got it, posts to Slack, and reminds anyone who hasn&apos;t confirmed every hour.</p>
      <label className="block"><span className="text-[12px] text-muted">What they need to know</span><input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Guest in Arya 1404 moved to 1406 — arriving 4pm" className={field} /></label>
      <label className="block"><span className="text-[12px] text-muted">Details (optional)</span><textarea value={body} onChange={e => setBody(e.target.value)} rows={3} className={field} /></label>
      <label className="block"><span className="text-[12px] text-muted">Unit or reservation (optional)</span><input value={unit} onChange={e => setUnit(e.target.value)} className={field} /></label>
      <div>
        <div className="text-[12px] text-muted mb-1">For</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setAud('everyone')} className={chip(aud === 'everyone')}>Everyone on shift</button>
          <button onClick={() => setAud('roles')} className={chip(aud === 'roles')}>A team</button>
          <button onClick={() => setAud('people')} className={chip(aud === 'people')}>Specific people</button>
        </div>
        {aud === 'roles' && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(form?.roles || []).map(r => <button key={r.key} onClick={() => setRoles(x => x.includes(r.key) ? x.filter(k => k !== r.key) : x.concat(r.key))} className={chip(roles.includes(r.key))}>{r.label}</button>)}
            {!form && <Loader2 size={14} className="animate-spin text-muted" />}
          </div>
        )}
        {aud === 'people' && (
          <div className="flex flex-wrap gap-1.5 mt-2 max-h-[150px] overflow-y-auto">
            {(form?.team || []).map(p => <button key={p.email} onClick={() => setPpl(x => x.includes(p.email) ? x.filter(e => e !== p.email) : x.concat(p.email))} className={chip(ppl.includes(p.email))}>{p.name}</button>)}
            {!form && <Loader2 size={14} className="animate-spin text-muted" />}
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[12px] text-muted mb-1">When</div>
          <div className="flex gap-1.5">
            <button onClick={() => setWhenMode('now')} className={chip(whenMode === 'now')}>Now</button>
            <button onClick={() => setWhenMode('later')} className={chip(whenMode === 'later')}>At a time</button>
          </div>
          {whenMode === 'later' && <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className={field + ' mt-2'} />}
        </div>
        <div>
          <div className="text-[12px] text-muted mb-1">Slack</div>
          <select value={channel} onChange={e => setChannel(e.target.value)} className={field}>
            {(form?.channels || []).map((c, i) => <option key={c.id} value={i === 0 ? '' : c.id}>{c.label}</option>)}
            <option value="none">Don&apos;t post to Slack</option>
          </select>
        </div>
      </div>
      <div>
        <div className="text-[12px] text-muted mb-1">How important</div>
        <div className="flex gap-1.5">
          <button onClick={() => setSev('info')} className={chip(sev === 'info')}>Handoff</button>
          <button onClick={() => setSev('warn')} className={chip(sev === 'warn')}>Heads-up</button>
          <button onClick={() => setSev('urgent')} className={chip(sev === 'urgent')}>Urgent</button>
        </div>
      </div>
      {err && <p className="text-[12px] text-rose-700">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => onDone(null)} className="rounded-lg border border-line px-3 h-9 text-[13px] font-semibold text-ink">Cancel</button>
        <button disabled={!ok || busy} onClick={submit} className="rounded-lg bg-ink text-white px-4 h-9 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} {whenMode === 'now' ? 'Send alert' : 'Schedule alert'}</button>
      </div>
    </div>
  )
}
