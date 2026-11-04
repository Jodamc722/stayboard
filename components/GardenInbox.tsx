'use client'
// THE GARDEN HOTEL'S UNIFIED INBOX (Jon, 2026-11-04: "Build a unified inbox, build it where we can
// sort by channel or source. Make this a robust app to manage cloudbeds").
//
// Two panes, like the Stay side's inbox (components/UnifiedInbox): LEFT the stream — every guest
// thread, call, voicemail, review and desk call — with chips for Source and Channel (counts on each),
// status, "needs reply", search and sort. RIGHT the open conversation and, beside it on a wide screen
// (under it otherwise), the Cloudbeds reservation it belongs to.
//
// Cloudbeds has no guest-messaging API, so nothing here is pulled from Cloudbeds' own inbox and
// nothing is sent to a guest from here: a reply is LOGGED, and the person sends it from their mail
// app / phone / the OTA extranet ("Open in email" hands them a ready mailto:). Data: /api/garden/inbox.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Inbox as InboxIcon, Mail, MessageSquare, Phone, Voicemail, Star, StickyNote, Globe, Search, Loader2, RefreshCw, ArrowLeft, ExternalLink,
  CalendarDays, Moon, BadgeDollarSign, Copy, Check, Send, PhoneCall, Sparkles, BedDouble, MessageCircle, Plug,
} from 'lucide-react'
import { LeanHead, Pill, Tag, LeanPick, type Tone } from '@/components/lean'

// ---- Types (mirror lib/garden/inbox) --------------------------------------------------------------
type Source = 'email' | 'sms' | 'whatsapp' | 'ota' | 'note' | 'phone' | 'voicemail' | 'review' | 'web'
type Status = 'open' | 'waiting' | 'closed'
type Res = { id: string; status: string | null; guest_name: string | null; guest_email: string | null; guest_phone: string | null; check_in: string | null; check_out: string | null; nights: number | null; room_names: string[]; source: string | null; channel: string; total: number | null; balance: number | null }
type Item = { id: string; kind: 'thread' | 'call' | 'review' | 'desk_call'; source: Source; channel: string; guest: string; reservation: Res | null; last_at: string | null; snippet: string; unread: number; status: Status; assigned_to: string | null; needs_reply: boolean; email: string | null; phone: string | null; meta: Record<string, any> }
type Msg = { id: string; direction: string; author: string | null; body: string; sent_at: string | null }
type Detail = { item: Item; messages: Msg[]; call?: any; review?: any; desk?: any; related: { id: string; kind: Item['kind']; label: string; at: string | null }[] }
type ListData = {
  ok: boolean; error?: string; items: Item[]; total: number; channels: string[]; staff: { name: string; role: string | null; email: string | null }[]
  ingest: { url: string; header: string; token: string } | null; missing: string[]; live: { threads: number; calls: number; reviews: number; desk: number }
  connected: boolean; me: string | null; canEdit: boolean; canReview: boolean
}

// ---- Helpers ----------------------------------------------------------------------------------------
const TZ = 'America/New_York'
const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); const b = await r.json().catch(() => ({})); return { ...b, ok: r.ok && b?.ok !== false } }
const post = (url: string, body: any) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const ago = (iso?: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'now'; if (m < 60) return m + 'm'
  const h = Math.round(m / 60); if (h < 24) return h + 'h'
  const d = Math.round(h / 24); if (d < 7) return d + 'd'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
}
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—'
const day = (d?: string | null) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const money = (n?: number | null) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const fmtPhone = (p?: string | null) => { const d = String(p || '').replace(/\D/g, ''); const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(p || '') }
const telOf = (p?: string | null) => { const d = String(p || '').replace(/\D/g, ''); return d ? '+' + (d.length === 10 ? '1' + d : d) : '' }

const SOURCE_CHIPS: { key: string; label: string; list: Source[] | null; icon: ReactNode }[] = [
  { key: 'all', label: 'All', list: null, icon: <InboxIcon size={12} /> },
  { key: 'email', label: 'Email', list: ['email'], icon: <Mail size={12} /> },
  { key: 'messaging', label: 'SMS/WhatsApp', list: ['sms', 'whatsapp'], icon: <MessageCircle size={12} /> },
  { key: 'phone', label: 'Phone & voicemail', list: ['phone', 'voicemail'], icon: <Phone size={12} /> },
  { key: 'review', label: 'Reviews', list: ['review'], icon: <Star size={12} /> },
  { key: 'note', label: 'Notes', list: ['note'], icon: <StickyNote size={12} /> },
  { key: 'ota', label: 'OTA', list: ['ota'], icon: <Globe size={12} /> },
  { key: 'web', label: 'Web', list: ['web'], icon: <Globe size={12} /> },
]
const SRC_ICON: Record<Source, ReactNode> = {
  email: <Mail size={14} />, sms: <MessageCircle size={14} />, whatsapp: <MessageCircle size={14} />, ota: <Globe size={14} />, note: <StickyNote size={14} />,
  phone: <Phone size={14} />, voicemail: <Voicemail size={14} />, review: <Star size={14} />, web: <Globe size={14} />,
}
const SRC_LABEL: Record<Source, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', ota: 'OTA', note: 'Cloudbeds note', phone: 'Phone', voicemail: 'Voicemail', review: 'Review', web: 'Web' }
const STATUS_TONE: Record<Status, Tone> = { open: 'amber', waiting: 'sky', closed: 'slate' }
type Sort = 'newest' | 'oldest_unanswered' | 'arrival'

function matches(it: Item, f: { source: string; channel: string; status: string; needs: boolean; q: string }, skip?: 'source' | 'channel' | 'status') {
  const chip = SOURCE_CHIPS.find(c => c.key === f.source)
  if (skip !== 'source' && chip?.list && !chip.list.includes(it.source)) return false
  if (skip !== 'channel' && f.channel !== 'all' && it.channel !== f.channel) return false
  if (skip !== 'status' && f.status !== 'all' && it.status !== f.status) return false
  if (f.needs && !it.needs_reply) return false
  const q = f.q.trim().toLowerCase()
  if (q && ![it.guest, it.snippet, it.channel, it.source, it.assigned_to, it.email, it.phone, it.reservation?.id, ...(it.reservation?.room_names || [])].some(v => String(v || '').toLowerCase().includes(q))) return false
  return true
}
function sortItems(items: Item[], sort: Sort): Item[] {
  const a = [...items], s = (v: any) => String(v || '')
  if (sort === 'oldest_unanswered') return a.sort((x, y) => (Number(y.needs_reply) - Number(x.needs_reply)) || s(x.last_at).localeCompare(s(y.last_at)))
  if (sort === 'arrival') {
    const today = new Date().toISOString().slice(0, 10)
    const k = (it: Item) => { const r = it.reservation; if (!r?.check_in) return '3'; return s(r.check_out) >= today ? '1' + r.check_in : '2' + String(99999999 - Number(r.check_in.replace(/-/g, ''))) }
    return a.sort((x, y) => k(x).localeCompare(k(y)) || s(y.last_at).localeCompare(s(x.last_at)))
  }
  return a.sort((x, y) => s(y.last_at).localeCompare(s(x.last_at)))
}

// Remember the filters per viewer (a convenience only — the page works without it).
const PREF_KEY = 'garden-inbox-filters'
const loadPrefs = (): any => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {} } catch { return {} } }
const savePrefs = (p: any) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)) } catch { /* private window */ } }

// ---- The page ---------------------------------------------------------------------------------------
export function GardenInbox({ canEdit: canEditProp }: { canEdit: boolean }) {
  const router = useRouter()
  const sp = useSearchParams()
  const open = sp.get('open') || ''
  const [d, setD] = useState<ListData | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [source, setSource] = useState('all')
  const [channel, setChannel] = useState('all')
  const [status, setStatus] = useState<'open' | 'waiting' | 'closed' | 'all'>('open')
  const [needs, setNeeds] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [showSetup, setShowSetup] = useState(false)
  const prefsLoaded = useRef(false)

  useEffect(() => {
    const p = loadPrefs()
    if (p.source) setSource(p.source); if (p.channel) setChannel(p.channel); if (p.status) setStatus(p.status); if (p.sort) setSort(p.sort); if (p.needs) setNeeds(!!p.needs)
    prefsLoaded.current = true
  }, [])
  useEffect(() => { if (prefsLoaded.current) savePrefs({ source, channel, status, sort, needs }) }, [source, channel, status, sort, needs])

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    setBusy(true)
    const r = await j('/api/garden/inbox').catch(e => ({ ok: false, error: String(e?.message || e) }))
    if (r.ok) { setD(r as ListData); setErr('') } else { setErr(r.message || r.error || 'Could not load the inbox.'); setD(prev => prev || ({ ...(r as any), ok: false })) }
    setBusy(false)
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const select = useCallback((id: string) => {
    const u = new URLSearchParams(Array.from(sp.entries()))
    if (id) u.set('open', id); else u.delete('open')
    router.replace('/garden/messages' + (u.toString() ? '?' + u.toString() : ''), { scroll: false })
  }, [router, sp])

  const items = useMemo(() => d?.items || [], [d])
  const f = { source, channel, status, needs, q }
  const shown = useMemo(() => sortItems(items.filter(it => matches(it, f)), sort), [items, source, channel, status, needs, q, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  // Faceted counts: each chip row counts what the OTHER filters leave.
  const srcCounts = useMemo(() => { const base = items.filter(it => matches(it, f, 'source')); return Object.fromEntries(SOURCE_CHIPS.map(c => [c.key, c.list ? base.filter(it => c.list!.includes(it.source)).length : base.length])) }, [items, channel, status, needs, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const chanCounts = useMemo(() => { const base = items.filter(it => matches(it, f, 'channel')); const o: Record<string, number> = { all: base.length }; for (const it of base) o[it.channel] = (o[it.channel] || 0) + 1; return o }, [items, source, status, needs, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const stCounts = useMemo(() => { const base = items.filter(it => matches(it, f, 'status')); return { all: base.length, open: base.filter(i => i.status === 'open').length, waiting: base.filter(i => i.status === 'waiting').length, closed: base.filter(i => i.status === 'closed').length } }, [items, source, channel, needs, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = !!(d?.canEdit ?? canEditProp)
  const needCount = items.filter(i => i.needs_reply).length
  const unreadCount = items.filter(i => i.unread > 0).length
  const openCount = items.filter(i => i.status === 'open').length
  const patchItem = useCallback((it: Item | null | undefined) => { if (it) setD(prev => prev ? { ...prev, items: prev.items.map(x => x.id === it.id ? { ...x, ...it, email: x.email || it.email, phone: x.phone || it.phone } : x) } : prev) }, [])

  const head = (
    <LeanHead title="Inbox" icon={<InboxIcon size={20} className="text-emerald-700" />}>
      {d?.ok ? <>
        <Pill tone={needCount ? 'rose' : 'emerald'} title="Guest messages, missed calls, voicemails and reviews still owed an answer" onClick={() => { setNeeds(true); setStatus('all') }}>{needCount} need a reply</Pill>
        <Pill tone={unreadCount ? 'amber' : 'slate'} title="Not opened yet">{unreadCount} unread</Pill>
        <Pill title="Open conversations">{openCount} open</Pill>
      </> : null}
      {canEdit && d?.ok ? <button onClick={() => setShowSetup(v => !v)} className="rounded-lg border border-line bg-white px-2.5 h-7 text-[12px] font-semibold inline-flex items-center gap-1" title="How guest conversations get into this inbox"><Plug size={12} /> Connect sources</button> : null}
      <button onClick={load} disabled={busy} title={err ? err : 'Refreshes every 30 seconds while this tab is open — click to refresh now'}
        className={'rounded-lg border px-2.5 h-7 text-[12px] font-semibold inline-flex items-center gap-1 ' + (err ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-line bg-white')}>
        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> {err ? 'Retry' : 'Refresh'}
      </button>
    </LeanHead>
  )

  if (!d) return <>{head}<p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading the inbox…</p></>
  if (!d.ok) return <>{head}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err || d.error}</div></>

  const empty = d.total === 0
  return (
    <>
      {head}
      {d.missing?.length ? <p className="mb-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Not in the database yet: {d.missing.join(', ')} — run the Garden migrations (115, 117, 118, 170) to bring those sources in.</p> : null}
      {(empty || showSetup) ? <ConnectPanel d={d} canEdit={canEdit} empty={empty} onRotate={async () => { if (!confirm('Make a new token? Anything forwarding with the old one stops working until it is updated.')) return; const r = await post('/api/garden/inbox', { op: 'rotate_token' }); if (r.ok) load(); else alert(r.error || 'Could not rotate.') }} /> : null}
      {empty ? null : (
        <div className="grid gap-3 lg:grid-cols-[minmax(330px,400px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)_minmax(280px,330px)] items-start">
          {/* LEFT — filters and the stream. On a phone it hides while a conversation is open. */}
          <aside className={'min-w-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1 ' + (open ? 'hidden lg:block' : '')}>
            <div className="rounded-2xl border border-line bg-white p-3 space-y-2.5 mb-2">
              <label className="flex items-center gap-2 rounded-lg border border-line px-2.5 h-8 bg-app/40">
                <Search size={13} className="text-muted" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search guest, room, reservation, text…" className="flex-1 bg-transparent text-[12.5px] outline-none min-w-0" />
              </label>
              <ChipRow label="Source">
                {SOURCE_CHIPS.filter(c => c.key === 'all' || srcCounts[c.key] || source === c.key || ['email', 'messaging', 'phone', 'review'].includes(c.key)).map(c => (
                  <Chip key={c.key} on={source === c.key} n={srcCounts[c.key]} onClick={() => setSource(c.key)}>{c.icon}{c.label}</Chip>
                ))}
              </ChipRow>
              <ChipRow label="Channel">
                <Chip on={channel === 'all'} n={chanCounts.all} onClick={() => setChannel('all')}>All</Chip>
                {d.channels.map(c => <Chip key={c} on={channel === c} n={chanCounts[c] || 0} onClick={() => setChannel(c)}>{c === 'Direct' ? 'Direct/Website' : c}</Chip>)}
              </ChipRow>
              <ChipRow label="Status">
                {(['open', 'waiting', 'closed', 'all'] as const).map(st => <Chip key={st} on={status === st} n={stCounts[st]} onClick={() => setStatus(st)}>{st[0].toUpperCase() + st.slice(1)}</Chip>)}
                <Chip on={needs} onClick={() => setNeeds(v => !v)} tone="rose">Needs reply</Chip>
              </ChipRow>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted w-14 shrink-0">Sort</span>
                <LeanPick size="sm" value={sort} onPick={setSort} options={[{ v: 'newest', label: 'Newest' }, { v: 'oldest_unanswered', label: 'Oldest unanswered' }, { v: 'arrival', label: 'Arrival date' }]} />
              </div>
            </div>
            {shown.length ? (
              <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 overflow-hidden">
                {shown.map(it => <Row key={it.id} it={it} on={open === it.id} onClick={() => select(it.id)} />)}
              </ul>
            ) : (
              <div className="rounded-2xl border border-line bg-white px-4 py-6 text-center text-[12.5px] text-muted">
                Nothing matches these filters.{' '}
                <button className="text-brand-700 font-semibold hover:underline" onClick={() => { setSource('all'); setChannel('all'); setStatus('all'); setNeeds(false); setQ('') }}>Show everything</button>
              </div>
            )}
            <p className="mt-2 px-1 text-[11px] text-muted">{shown.length} of {d.total} · {d.live.threads} threads · {d.live.calls} calls · {d.live.reviews} reviews · {d.live.desk} desk calls</p>
          </aside>

          {open ? <Conversation key={open} id={open} canEdit={canEdit} canReview={d.canReview} staff={d.staff} me={d.me} onBack={() => select('')} onOpen={select} onChanged={patchItem} />
            : (
              <section className="hidden lg:block min-w-0">
                <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-16 text-center">
                  <InboxIcon size={28} className="mx-auto text-muted/60" />
                  <p className="mt-2 text-[13.5px] font-semibold text-ink">Pick a conversation</p>
                  <p className="text-[12.5px] text-muted">The thread, call or review opens here; the Cloudbeds reservation opens beside it.</p>
                </div>
              </section>
            )}
        </div>
      )}
    </>
  )
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted w-14 shrink-0 pt-1">{label}</span>
      <div className="flex flex-wrap gap-1 min-w-0">{children}</div>
    </div>
  )
}
function Chip({ on, n, onClick, tone, children }: { on: boolean; n?: number; onClick: () => void; tone?: 'rose'; children: ReactNode }) {
  const onCls = tone === 'rose' ? 'bg-rose-600 text-white border-rose-600' : 'bg-ink text-white border-ink'
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${on ? onCls : 'bg-white border-line text-muted hover:text-ink hover:border-ink/40'}`}>
      {children}{n != null ? <span className={`tabular-nums ${on ? 'opacity-80' : 'opacity-60'}`}>{n}</span> : null}
    </button>
  )
}

function Row({ it, on, onClick }: { it: Item; on: boolean; onClick: () => void }) {
  const r = it.reservation
  return (
    <li>
      <button onClick={onClick} className={`relative w-full text-left px-3 py-2.5 flex gap-2.5 ${on ? 'bg-emerald-50/70' : 'hover:bg-app/60'}`}>
        {it.needs_reply ? <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-500" title="Needs a reply" /> : null}
        <span className={`mt-0.5 shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center ${it.source === 'review' ? 'bg-amber-50 text-amber-700' : it.source === 'phone' || it.source === 'voicemail' ? 'bg-sky-50 text-sky-700' : it.source === 'note' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`} title={SRC_LABEL[it.source]}>{SRC_ICON[it.source]}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[13px] ${it.unread ? 'font-bold text-ink' : 'font-semibold text-ink/90'}`}>{it.guest}</span>
            {it.unread ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" title="Unread" /> : null}
            <span className="ml-auto text-[11px] text-muted shrink-0 tabular-nums">{ago(it.last_at)}</span>
          </span>
          <span className={`block truncate text-[12px] ${it.unread ? 'text-ink/85' : 'text-muted'}`}>{it.snippet || '—'}</span>
          <span className="mt-1 flex items-center gap-1 flex-wrap">
            <Tag tone={it.channel === 'Unmatched' ? 'slate' : 'brand'}>{it.channel}</Tag>
            {it.status !== 'open' ? <Tag tone={STATUS_TONE[it.status]}>{it.status}</Tag> : null}
            {it.kind === 'review' && it.meta.rating != null ? <Tag tone={it.meta.sentiment === 'negative' ? 'rose' : it.meta.sentiment === 'mixed' ? 'amber' : 'emerald'}>{it.meta.rating}/{it.meta.max_rating}</Tag> : null}
            {r?.check_in ? <Tag title={`${day(r.check_in)} → ${day(r.check_out)}`}>{day(r.check_in).replace(/^\w+, /, '')}{r.room_names[0] ? ' · ' + r.room_names[0] : ''}</Tag> : null}
            {it.assigned_to ? <Tag tone="violet">{it.assigned_to.split('@')[0]}</Tag> : null}
          </span>
        </span>
      </button>
    </li>
  )
}

// ---- The open conversation ---------------------------------------------------------------------------
function Conversation({ id, canEdit, canReview, staff, me, onBack, onOpen, onChanged }: {
  id: string; canEdit: boolean; canReview: boolean; staff: ListData['staff']; me: string | null
  onBack: () => void; onOpen: (id: string) => void; onChanged: (it: Item | null | undefined) => void
}) {
  const [det, setDet] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    const r = await j('/api/garden/inbox?item=' + encodeURIComponent(id))
    if (r.ok) { setDet(r.detail); setErr('') } else setErr(r.error || r.message || 'Could not open that conversation.')
    return r.ok ? (r.detail as Detail) : null
  }, [id])
  useEffect(() => {
    let alive = true
    load().then(x => {
      // Opening it is reading it.
      if (alive && x && canEdit && x.item.unread > 0) post('/api/garden/inbox', { op: 'read', item: id }).then(r => { if (r.ok && alive) { onChanged(r.item); setDet(dd => dd && r.item ? { ...dd, item: { ...dd.item, ...r.item, email: dd.item.email, phone: dd.item.phone } } : dd) } })
    })
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const op = async (body: any) => {
    setSaving(true)
    const r = await post('/api/garden/inbox', { ...body, item: id })
    setSaving(false)
    if (!r.ok) { alert(r.error || r.message || 'That did not save.'); return false }
    onChanged(r.item); await load()
    return true
  }

  if (err) return <section className="min-w-0 space-y-3"><BackBtn onBack={onBack} /><div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div></section>
  if (!det) return <section className="min-w-0"><BackBtn onBack={onBack} /><div className="rounded-2xl border border-line bg-white px-5 py-10 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Opening…</div></section>
  const it = det.item
  const resCard = <ReservationCard it={it} related={det.related} onOpen={onOpen} />
  return (
    <>
      <section className="min-w-0 space-y-3">
        <BackBtn onBack={onBack} />
        <div className="rounded-2xl border border-line bg-white">
          {/* Header: who, where from, and the controls that move it along. */}
          <div className="px-4 pt-3 pb-2.5 border-b border-line/70">
            <div className="flex items-start gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-bold text-ink leading-tight truncate">{it.guest}</h2>
                <div className="mt-1 flex items-center gap-1 flex-wrap">
                  <Tag tone="emerald">{SRC_LABEL[it.source]}</Tag>
                  <Tag tone={it.channel === 'Unmatched' ? 'slate' : 'brand'}>{it.channel}</Tag>
                  {it.needs_reply ? <Tag tone="rose">needs reply</Tag> : null}
                  {it.unread ? <Tag tone="amber">unread</Tag> : null}
                  <span className="text-[11.5px] text-muted">{when(it.last_at)}</span>
                </div>
              </div>
              {canEdit ? (
                <button disabled={saving} onClick={() => op({ op: 'read', unread: !it.unread })} className="h-7 px-2 rounded-lg border border-line bg-white text-[11.5px] font-semibold text-muted hover:text-ink">{it.unread ? 'Mark read' : 'Mark unread'}</button>
              ) : null}
            </div>
            {canEdit ? (
              <div className="mt-2.5 flex items-center gap-x-4 gap-y-2 flex-wrap">
                <LeanPick size="sm" disabled={saving} value={it.status} onPick={v => op({ op: 'status', status: v })} options={[
                  { v: 'open', label: 'Open', on: 'bg-amber-500 text-white border-amber-500' },
                  { v: 'waiting', label: 'Waiting on guest', on: 'bg-sky-600 text-white border-sky-600' },
                  { v: 'closed', label: 'Closed', on: 'bg-slate-600 text-white border-slate-600' },
                ]} />
                <Assign value={it.assigned_to} staff={staff} me={me} disabled={saving} onSave={v => op({ op: 'assign', assigned_to: v })} />
              </div>
            ) : <div className="mt-2 flex gap-1"><Tag tone={STATUS_TONE[it.status]}>{it.status}</Tag>{it.assigned_to ? <Tag tone="violet">{it.assigned_to}</Tag> : null}</div>}
          </div>

          <div className="p-4 space-y-3">
            {it.kind === 'thread' ? <ThreadView det={det} canEdit={canEdit} saving={saving} op={op} /> : null}
            {it.kind === 'call' ? <CallView det={det} canEdit={canEdit} saving={saving} op={op} /> : null}
            {it.kind === 'review' ? <ReviewView det={det} canEdit={canEdit} canReview={canReview} reload={async () => { const x = await load(); onChanged(x?.item) }} op={op} saving={saving} /> : null}
            {it.kind === 'desk_call' ? <DeskView det={det} canEdit={canEdit} saving={saving} op={op} /> : null}
          </div>
        </div>
        <div className="2xl:hidden">{resCard}</div>
      </section>
      <aside className="hidden 2xl:block min-w-0 sticky top-3 max-h-[calc(100vh-6rem)] overflow-y-auto">{resCard}</aside>
    </>
  )
}
const BackBtn = ({ onBack }: { onBack: () => void }) => <button onClick={onBack} className="lg:hidden inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-1"><ArrowLeft size={15} /> All conversations</button>

function Assign({ value, staff, me, disabled, onSave }: { value: string | null; staff: ListData['staff']; me: string | null; disabled?: boolean; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(value || '')
  useEffect(() => setV(value || ''), [value])
  const commit = () => { const x = v.trim(); if (x !== (value || '')) onSave(x || null) }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Assigned</span>
      <input list="garden-inbox-staff" value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder="Nobody" className="h-7 w-40 rounded-lg border border-line px-2 text-[12px] bg-white" />
      <datalist id="garden-inbox-staff">{staff.map(s => <option key={s.name} value={s.name}>{s.role || ''}</option>)}</datalist>
      {me && !value ? <button disabled={disabled} onClick={() => onSave(me)} className="h-7 px-2 rounded-lg border border-line bg-white text-[11.5px] font-semibold text-muted hover:text-ink">Me</button> : null}
      {value ? <button disabled={disabled} onClick={() => onSave(null)} className="h-7 px-2 rounded-lg text-[11.5px] font-semibold text-muted hover:text-ink">Clear</button> : null}
    </div>
  )
}

type OpFn = (body: any) => Promise<boolean>

function Timeline({ messages }: { messages: Msg[] }) {
  const end = useRef<HTMLDivElement | null>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length])
  if (!messages.length) return null
  return (
    <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
      {messages.map(m => m.direction === 'note' ? (
        <div key={m.id} className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12.5px]">
          <div className="text-[10.5px] font-semibold text-amber-800 mb-0.5 inline-flex items-center gap-1"><StickyNote size={11} /> Internal note · {m.author || 'Team'} · {when(m.sent_at)}</div>
          <div className="whitespace-pre-wrap text-ink/90">{m.body}</div>
        </div>
      ) : (
        <div key={m.id} className={`rounded-xl px-3 py-2 text-[13px] max-w-[85%] ${m.direction === 'in' ? 'bg-app' : 'bg-emerald-50 ml-auto'}`}>
          <div className="text-[10.5px] text-muted mb-0.5">{m.author || (m.direction === 'in' ? 'Guest' : 'Hotel')} · {when(m.sent_at)}{m.direction === 'out' ? ' · logged' : ''}</div>
          <div className="whitespace-pre-wrap break-words">{m.body}</div>
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

function NoteBox({ saving, op, placeholder = 'Internal note — only the team sees this', extra }: { saving: boolean; op: OpFn; placeholder?: string; extra?: (body: string) => ReactNode }) {
  const [t, setT] = useState('')
  return (
    <div className="rounded-xl border border-line p-2 space-y-2">
      <textarea value={t} onChange={e => setT(e.target.value)} rows={2} placeholder={placeholder} className="w-full resize-y text-[12.5px] outline-none bg-transparent" />
      <div className="flex items-center gap-1.5 flex-wrap">
        <button disabled={saving || !t.trim()} onClick={async () => { if (await op({ op: 'note', body: t })) setT('') }} className="h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1"><StickyNote size={12} /> Log note</button>
        {extra ? extra(t) : null}
      </div>
    </div>
  )
}

function ThreadView({ det, canEdit, saving, op }: { det: Detail; canEdit: boolean; saving: boolean; op: OpFn }) {
  const it = det.item
  const [mode, setMode] = useState<'reply' | 'note'>(it.source === 'note' ? 'note' : 'reply')
  const [t, setT] = useState('')
  const subject = (() => { const r = it.reservation; return 'Re: Your stay at The Garden Hotel' + (r?.check_in ? ` (${day(r.check_in)})` : '') })()
  const mailto = it.email ? `mailto:${encodeURIComponent(it.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(t)}` : ''
  const tel = telOf(it.phone)
  const smsHref = tel ? `sms:${tel}${t ? '?&body=' + encodeURIComponent(t) : ''}` : ''
  const waHref = tel ? `https://wa.me/${tel.replace('+', '')}${t ? '?text=' + encodeURIComponent(t) : ''}` : ''
  const send = async (after?: () => void) => { if (await op({ op: mode, body: t })) { after?.(); setT('') } }
  return (
    <>
      {det.messages.length ? <Timeline messages={det.messages} /> : <p className="text-[12.5px] text-muted">{it.snippet || 'No messages in this thread yet.'}</p>}
      {canEdit ? (
        <div className="rounded-xl border border-line p-2 space-y-2">
          {it.source !== 'note' ? (
            <LeanPick size="sm" value={mode} onPick={setMode} options={[{ v: 'reply', label: 'Reply to guest' }, { v: 'note', label: 'Internal note', on: 'bg-amber-500 text-white border-amber-500' }]} />
          ) : <p className="text-[11.5px] text-muted">Cloudbeds front-desk notes are not a guest conversation — add a team note here; edit the note itself in Cloudbeds.</p>}
          <textarea value={t} onChange={e => setT(e.target.value)} rows={3} placeholder={mode === 'reply' ? 'Write the reply…' : 'Internal note — only the team sees this'} className={`w-full resize-y text-[13px] outline-none rounded-lg px-2 py-1.5 ${mode === 'note' ? 'bg-amber-50/60' : 'bg-app/40'}`} />
          <div className="flex items-center gap-1.5 flex-wrap">
            {mode === 'reply' ? <>
              {it.source === 'email' && mailto ? (
                <a href={mailto} onClick={() => { if (t.trim()) send() }} className={`h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1 ${!t.trim() ? 'opacity-40 pointer-events-none' : ''}`} title="Logs the reply here and opens it in your email app to send"><Mail size={12} /> Log &amp; open in email</a>
              ) : null}
              {(it.source === 'sms') && smsHref ? <a href={smsHref} onClick={() => { if (t.trim()) send() }} className={`h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1 ${!t.trim() ? 'opacity-40 pointer-events-none' : ''}`}><MessageCircle size={12} /> Log &amp; open in Messages</a> : null}
              {(it.source === 'whatsapp') && waHref ? <a href={waHref} target="_blank" rel="noreferrer" onClick={() => { if (t.trim()) send() }} className={`h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1 ${!t.trim() ? 'opacity-40 pointer-events-none' : ''}`}><MessageCircle size={12} /> Log &amp; open WhatsApp</a> : null}
              <button disabled={saving || !t.trim()} onClick={() => send()} className="h-8 px-3 rounded-lg border border-line bg-white text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1" title="Records the reply on this thread (sets it to Waiting). Nothing is sent to the guest from Lighthouse."><Send size={12} /> Log as sent</button>
              {it.source === 'email' && !it.email ? <span className="text-[11px] text-muted">No guest email known — reply from the original email.</span> : null}
              {it.source === 'ota' ? <span className="text-[11px] text-muted">Send it in the {it.channel !== 'Unmatched' ? it.channel : 'OTA'} extranet, then log it here.</span> : null}
            </> : (
              <button disabled={saving || !t.trim()} onClick={() => send()} className="h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1"><StickyNote size={12} /> Log note</button>
            )}
          </div>
          <p className="text-[10.5px] text-muted">Lighthouse never sends to the guest — Cloudbeds has no messaging API. The reply is logged here and sent from your email, phone or the OTA.</p>
        </div>
      ) : null}
    </>
  )
}

function CallView({ det, canEdit, saving, op }: { det: Detail; canEdit: boolean; saving: boolean; op: OpFn }) {
  const c = det.call || {}
  const it = det.item
  const inbound = c.direction === 'inbound'
  const guestNum = inbound ? c.from_number : c.to_number
  const tel = telOf(guestNum || it.phone)
  return (
    <>
      <div className="rounded-xl bg-app/50 px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-bold text-ink">{inbound ? (c.result === 'missed' ? 'Missed call' : c.result === 'voicemail' ? 'Voicemail' : 'Inbound call') : 'Outbound call'}</span>
          {c.result ? <Tag tone={c.result === 'answered' ? 'emerald' : c.result === 'voicemail' ? 'violet' : 'rose'}>{c.result}</Tag> : null}
          {it.meta.called_back ? <Tag tone="emerald">called back</Tag> : null}
        </div>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[12.5px]">
          <Fact label="From" value={fmtPhone(c.from_number) || '—'} />
          <Fact label="To" value={fmtPhone(c.to_number) || '—'} />
          <Fact label="When" value={when(c.started_at)} />
          <Fact label="Duration" value={c.duration_sec ? `${Math.floor(c.duration_sec / 60)}m ${c.duration_sec % 60}s` : '—'} sub={c.provider} />
        </dl>
        {c.recording_url ? (
          <div className="mt-2 space-y-1">
            <audio controls preload="none" src={c.recording_url} className="w-full h-8" />
            <a href={c.recording_url} target="_blank" rel="noreferrer" className="text-[12px] text-brand-700 font-semibold hover:underline inline-flex items-center gap-1">Open recording <ExternalLink size={11} /></a>
          </div>
        ) : null}
        {c.transcript ? <div className="mt-2"><p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Transcript</p><p className="whitespace-pre-wrap text-[12.5px] text-ink/90">{c.transcript}</p></div> : null}
      </div>
      {tel ? <a href={'tel:' + tel} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1.5"><PhoneCall size={13} /> Call back {fmtPhone(guestNum || it.phone)}</a> : null}
      <Timeline messages={det.messages} />
      {canEdit ? <NoteBox saving={saving} op={op} placeholder="What happened — e.g. called back, left a voicemail, guest wants early check-in"
        extra={body => <button disabled={saving || !body.trim()} onClick={async () => { if (await op({ op: 'note', body })) await op({ op: 'status', status: 'closed' }) }} className="h-8 px-3 rounded-lg border border-line bg-white text-[12px] font-semibold disabled:opacity-40">Log &amp; close</button>} /> : null}
    </>
  )
}

function ReviewView({ det, canEdit, canReview, reload, op, saving }: { det: Detail; canEdit: boolean; canReview: boolean; reload: () => Promise<void>; op: OpFn; saving: boolean }) {
  const r = det.review || {}
  const [draft, setDraft] = useState<string>(r.reply_draft || r.reply || '')
  const [busy, setBusy] = useState('')
  useEffect(() => setDraft(r.reply_draft || r.reply || ''), [r.reply_draft, r.reply])
  const max = Number(r.max_rating) || 5
  const stars = Math.round((Number(r.rating) / max) * 5)
  const rv = async (body: any, label: string) => {
    setBusy(label)
    const x = await post('/api/garden/reviews', { ...body, id: r.id })
    setBusy('')
    if (!x.ok) { alert(x.message || x.error || 'That did not save.'); return }
    if (body.op === 'draft' && x.draft) setDraft(x.draft)
    await reload()
  }
  const copy = async () => { try { await navigator.clipboard.writeText(draft); setBusy('copied'); setTimeout(() => setBusy(''), 1200) } catch { /* no clipboard */ } }
  return (
    <>
      <div className="rounded-xl bg-app/50 px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex text-amber-500">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} fill={i < stars ? 'currentColor' : 'none'} />)}</span>
          <span className="text-[13px] font-bold text-ink tabular-nums">{r.rating}/{max}</span>
          <Tag tone="brand">{det.item.channel}</Tag>
          {r.sentiment ? <Tag tone={r.sentiment === 'negative' ? 'rose' : r.sentiment === 'mixed' ? 'amber' : 'emerald'}>{r.sentiment}</Tag> : null}
          <Tag tone={r.reply_status === 'sent' ? 'emerald' : r.reply_status === 'approved' ? 'sky' : r.reply_status === 'skipped' ? 'slate' : 'amber'}>reply {r.reply_status || 'none'}</Tag>
          <span className="text-[11.5px] text-muted">{when(r.received_at)}</span>
        </div>
        {r.title ? <p className="mt-1.5 text-[13.5px] font-semibold text-ink">{r.title}</p> : null}
        <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink/90">{r.body || '(no text)'}</p>
        {Array.isArray(r.themes) && r.themes.length ? <div className="mt-2 flex gap-1 flex-wrap">{r.themes.map((t: string) => <Tag key={t}>{t}</Tag>)}</div> : null}
      </div>
      <div className="rounded-xl border border-line p-2 space-y-2">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{r.reply_status === 'sent' ? 'Posted reply' : 'Reply'}</p>
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={5} readOnly={!canReview || r.reply_status === 'sent'} placeholder={canReview ? 'Draft with Adam, or write the reply…' : 'No reply drafted yet.'} className="w-full resize-y text-[13px] outline-none rounded-lg px-2 py-1.5 bg-app/40" />
        {canReview ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {r.reply_status !== 'sent' ? <>
              <button disabled={!!busy} onClick={() => rv({ op: 'draft' }, 'draft')} className="h-8 px-3 rounded-lg border border-line bg-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-40">{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {draft ? 'Redraft with Adam' : 'Draft with Adam'}</button>
              <button disabled={!!busy || !draft.trim()} onClick={() => rv({ op: 'reply', reply: draft, sent: false }, 'approve')} className="h-8 px-3 rounded-lg border border-line bg-white text-[12px] font-semibold disabled:opacity-40">Approve</button>
              <button disabled={!!busy || !draft.trim()} onClick={() => rv({ op: 'reply', reply: draft, sent: true }, 'sent')} className="h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold disabled:opacity-40" title="Mark it posted once you have pasted it on the review site">Mark posted</button>
              <button disabled={!!busy} onClick={() => rv({ op: 'skip' }, 'skip')} className="h-8 px-2.5 rounded-lg text-[12px] font-semibold text-muted hover:text-ink">Skip</button>
            </> : null}
            {draft ? <button onClick={copy} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold inline-flex items-center gap-1">{busy === 'copied' ? <Check size={12} /> : <Copy size={12} />} Copy</button> : null}
            <Link href="/garden/reviews" className="h-8 px-2.5 rounded-lg text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">Reviews page <ExternalLink size={11} /></Link>
          </div>
        ) : <p className="text-[11.5px] text-muted">Drafting and approving replies needs edit access on Reviews.</p>}
      </div>
      <Timeline messages={det.messages} />
      {canEdit ? <NoteBox saving={saving} op={op} /> : null}
    </>
  )
}

function DeskView({ det, canEdit, saving, op }: { det: Detail; canEdit: boolean; saving: boolean; op: OpFn }) {
  const c = det.desk || {}
  const tel = telOf(det.item.phone)
  return (
    <>
      <div className="rounded-xl bg-app/50 px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-bold text-ink">Desk call · {String(c.kind || 'call').replace(/_/g, ' ')}</span>
          {c.outcome ? <Tag tone={c.outcome === 'reached' ? 'emerald' : c.outcome === 'voicemail' ? 'violet' : 'amber'}>{String(c.outcome).replace(/_/g, ' ')}</Tag> : null}
        </div>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 text-[12.5px]">
          <Fact label="When" value={when(c.called_at)} />
          <Fact label="By" value={c.called_by || '—'} />
          <Fact label="Duration" value={c.duration_min ? c.duration_min + ' min' : '—'} />
        </dl>
        {c.note ? <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-ink/90">{c.note}</p> : null}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {tel ? <a href={'tel:' + tel} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1.5"><PhoneCall size={13} /> Call {fmtPhone(det.item.phone)}</a> : null}
        <Link href="/garden/calls" className="h-8 px-3 rounded-lg border border-line bg-white text-[12px] font-semibold inline-flex items-center gap-1">Calls &amp; verifications</Link>
      </div>
      <Timeline messages={det.messages} />
      {canEdit ? <NoteBox saving={saving} op={op} /> : null}
    </>
  )
}

function ReservationCard({ it, related, onOpen }: { it: Item; related: Detail['related']; onOpen: (id: string) => void }) {
  const r = it.reservation
  const st = String(r?.status || '').toLowerCase()
  const stTone: Tone = /cancel|no_show/.test(st) ? 'rose' : /checked_in/.test(st) ? 'emerald' : /checked_out/.test(st) ? 'slate' : /confirm/.test(st) ? 'sky' : 'amber'
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-line bg-white p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Cloudbeds reservation</p>
        {r ? <>
          <h3 className="mt-1 text-[16px] font-bold text-ink leading-tight">{r.guest_name || it.guest}</h3>
          <p className="text-[12.5px] text-muted">{r.room_names.length ? 'Room ' + r.room_names.join(', ') : 'No room assigned yet'} · #{r.id}</p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <Tag tone="brand">{r.channel}</Tag>
            {r.source && r.source !== r.channel ? <Tag>{r.source}</Tag> : null}
            {r.status ? <Tag tone={stTone}>{r.status.replace(/_/g, ' ')}</Tag> : null}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
            <Fact icon={<CalendarDays size={12} />} label="Check-in" value={day(r.check_in)} />
            <Fact icon={<CalendarDays size={12} />} label="Check-out" value={day(r.check_out)} />
            <Fact icon={<Moon size={12} />} label="Nights" value={r.nights != null ? String(r.nights) : '—'} />
            <Fact icon={<BedDouble size={12} />} label="Rooms" value={r.room_names.join(', ') || '—'} />
            <Fact icon={<BadgeDollarSign size={12} />} label="Total" value={money(r.total)} />
            <Fact icon={<BadgeDollarSign size={12} />} label="Balance" value={r.balance ? money(r.balance) : r.total != null ? 'Paid' : '—'} />
          </dl>
        </> : <p className="mt-2 text-[12.5px] text-muted">No Cloudbeds reservation matched. Matching tries the reservation id, then the guest&apos;s email, then the last ten digits of their phone, then their name against an upcoming stay.</p>}
        <div className="mt-3 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px]">
          {(it.phone || r?.guest_phone) ? <a href={'tel:' + telOf(it.phone || r?.guest_phone)} className="text-brand-700 font-semibold hover:underline inline-flex items-center gap-1"><Phone size={12} /> {fmtPhone(it.phone || r?.guest_phone)}</a> : null}
          {(it.email || r?.guest_email) ? <a href={'mailto:' + (it.email || r?.guest_email)} className="text-brand-700 font-semibold hover:underline truncate inline-flex items-center gap-1"><Mail size={12} /> {it.email || r?.guest_email}</a> : null}
        </div>
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <Link href="/garden" className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><CalendarDays size={11} /> Arrivals today</Link>
          <Link href="/garden/calls" className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><Phone size={11} /> Calls &amp; verifications</Link>
        </div>
      </section>
      {related.length ? (
        <section className="rounded-2xl border border-line bg-white p-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted px-1 mb-1">Also on this reservation</p>
          <ul className="space-y-0.5">{related.map(x => (
            <li key={x.id}><button onClick={() => onOpen(x.id)} className="w-full text-left rounded-lg px-1.5 py-1 hover:bg-app/70 flex items-center gap-2 text-[12px]">
              <span className="text-muted shrink-0">{x.kind === 'review' ? <Star size={12} /> : x.kind === 'thread' ? <MessageSquare size={12} /> : <Phone size={12} />}</span>
              <span className="truncate flex-1 text-ink/90">{x.label}</span>
              <span className="text-muted shrink-0 tabular-nums">{ago(x.at)}</span>
            </button></li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  )
}

function Fact({ icon, label, value, sub }: { icon?: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted inline-flex items-center gap-1">{icon} {label}</dt>
      <dd className="text-[13px] font-semibold text-ink leading-snug truncate" title={value}>{value}{sub ? <span className="block text-[11px] font-normal text-muted">{sub}</span> : null}</dd>
    </div>
  )
}

// ---- How conversations get in (the honest empty state; also behind "Connect sources") -----------------
function ConnectPanel({ d, canEdit, empty, onRotate }: { d: ListData; canEdit: boolean; empty: boolean; onRotate: () => void }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState('')
  const copy = async (k: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 1200) } catch { /* no clipboard */ } }
  const ing = d.ingest
  const sample = ing ? `curl -X POST ${ing.url} \\\n  -H "Content-Type: application/json" \\\n  -H "${ing.header}: ${shown ? ing.token : '<token>'}" \\\n  -d '{"id":"msg-123","from":"Jane Doe <jane@example.com>","source":"email","subject":"Late arrival","body":"We land at 11pm — is the desk open?","sentAt":"${new Date().toISOString().slice(0, 16)}:00Z"}'` : ''
  return (
    <div className="mb-4 rounded-2xl border border-line bg-white p-4 space-y-3">
      {empty ? <>
        <p className="text-[14px] font-bold text-ink">No guest conversations here yet</p>
        <p className="text-[12.5px] text-muted max-w-3xl">Cloudbeds has <b>no guest-messaging API</b> — no endpoint and no webhook event — so its own inbox cannot be mirrored. This inbox gathers everything Lighthouse <i>can</i> reach, links each conversation to its Cloudbeds reservation, and lets the team sort it by source and booking channel. Three ways in:</p>
      </> : <p className="text-[13px] font-bold text-ink">Getting conversations in</p>}
      <ol className="space-y-3 text-[12.5px]">
        <li>
          <p className="font-semibold text-ink inline-flex items-center gap-1.5"><Mail size={13} /> 1. Forward guest email, SMS, WhatsApp and OTA messages here</p>
          <p className="text-muted">Point an email-forwarding service, Zapier/Make, or your SMS provider&apos;s webhook at this address. Each message is matched to a reservation by id, email, phone or name.</p>
          {canEdit && ing ? (
            <div className="mt-1.5 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <code className="rounded-md bg-app px-2 py-1 text-[11.5px] break-all">POST {ing.url}</code>
                <button onClick={() => copy('url', ing.url)} className="h-7 px-2 rounded-lg border border-line bg-white text-[11.5px] font-semibold inline-flex items-center gap-1">{copied === 'url' ? <Check size={11} /> : <Copy size={11} />} URL</button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <code className="rounded-md bg-app px-2 py-1 text-[11.5px] break-all">{ing.header}: {shown ? ing.token : '•'.repeat(18)}</code>
                <button onClick={() => setShown(v => !v)} className="h-7 px-2 rounded-lg border border-line bg-white text-[11.5px] font-semibold">{shown ? 'Hide' : 'Show'}</button>
                <button onClick={() => copy('tok', ing.token)} className="h-7 px-2 rounded-lg border border-line bg-white text-[11.5px] font-semibold inline-flex items-center gap-1">{copied === 'tok' ? <Check size={11} /> : <Copy size={11} />} Token</button>
                <button onClick={onRotate} className="h-7 px-2 rounded-lg text-[11.5px] font-semibold text-muted hover:text-rose-700">New token</button>
              </div>
              <details className="text-[11.5px]">
                <summary className="cursor-pointer text-muted hover:text-ink">Payload format and an example</summary>
                <p className="mt-1 text-muted">JSON: one message, an array, or <code>{'{ messages: [...] }'}</code>. Each: <code>{'{ id, threadId?, from, to?, guest?, email?, phone?, channel?, source, subject?, body, sentAt, direction?, reservationId? }'}</code>. <code>source</code> is email | sms | whatsapp | ota | web | phone | voicemail; <code>direction</code> is in (default) or out; <code>channel</code> is the booking channel (Airbnb, Booking.com…). The same <code>id</code> twice is stored once. Forwarders that cannot set headers may add <code>?token=</code> to the URL.</p>
                <pre className="mt-1.5 rounded-lg bg-ink text-white/90 p-2.5 overflow-x-auto text-[11px] leading-relaxed">{sample}</pre>
              </details>
            </div>
          ) : <p className="mt-1 text-[11.5px] text-muted">An editor on Messages can see the forwarding address and token here.</p>}
        </li>
        <li>
          <p className="font-semibold text-ink inline-flex items-center gap-1.5"><Phone size={13} /> 2. Connect the phone system</p>
          <p className="text-muted">Calls and voicemails arrive from Talkroute, Twilio, RingCentral or any system that can post a webhook — set the provider in <Link href="/garden/settings" className="text-brand-700 font-semibold hover:underline">Hotel settings → Phone</Link>. Missed calls and voicemails show here as needing a reply until someone calls back.</p>
        </li>
        <li>
          <p className="font-semibold text-ink inline-flex items-center gap-1.5"><Star size={13} /> 3. Import reviews</p>
          <p className="text-muted">Paste or upload the CSV export from Google, Booking.com, Expedia or Tripadvisor on <Link href="/garden/reviews" className="text-brand-700 font-semibold hover:underline">Reviews</Link>; Adam drafts each reply and it is answered from here.</p>
        </li>
      </ol>
      <p className="text-[11.5px] text-muted">Cloudbeds front-desk notes on reservations arriving this week come in by themselves with every Cloudbeds sync{d.connected ? '' : ' once Cloudbeds is connected'} (source “Notes”).</p>
    </div>
  )
}
