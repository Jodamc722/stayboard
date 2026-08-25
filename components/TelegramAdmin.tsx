'use client'
// EVE ON TELEGRAM — the panel where a stranger becomes a colleague.
//
// This screen is the entire access-control story for the Telegram bridge, so it is written to make
// the consequence of a click impossible to miss: approving somebody does not "let them chat", it
// hands them a Lighthouse identity, and everything Eve will tell them follows from that person's
// role and their dollar-amounts toggle. Hence the email is a required choice, not an afterthought,
// and the row says in words what the person will be able to see.
import { useState, useEffect, useCallback } from 'react'
import { Send, RefreshCw, Check, Ban, Users, MessageSquare, Link2, AlertTriangle, ShieldCheck, Clock } from 'lucide-react'

type Contact = {
  id: string; tg_user_id: string; username: string | null; first_name: string | null; last_name: string | null
  status: 'pending' | 'approved' | 'blocked'; email: string | null; first_message: string | null
  approved_by: string | null; approved_at: string | null; msg_count: number; last_seen_at: string | null; created_at: string
}
type Room = {
  id: string; chat_id: string; title: string | null; kind: string; status: 'pending' | 'approved' | 'blocked'
  added_by_name: string | null; approved_by: string | null; msg_count: number; last_seen_at: string | null
}
type AppUser = { email: string; name: string; role: string }
type State = {
  bot: { configured: boolean; hasSecret: boolean; username: string | null; name: string | null; error: string | null; canJoinGroups: boolean | null; readsAllGroupMessages: boolean | null }
  webhook: { url: string; wanted: string; connected: boolean; pendingUpdates: number | null; lastError: string | null; lastErrorAt: string | null }
  contacts: Contact[]; rooms: Room[]; users: AppUser[]
}

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = 'inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-3 py-1.5 transition-colors'

const nameOf = (c: Contact) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || (c.username ? '@' + c.username : c.tg_user_id)
const ago = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

export function TelegramAdmin({ canEdit }: { canEdit: boolean }) {
  const [s, setS] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [pick, setPick] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/telegram/admin').then(x => x.json())
      if (r?.error) setErr(r.message || r.error); else { setS(r); setErr('') }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function act(action: string, extra: Record<string, any>, key: string) {
    setBusy(key); setNote(''); setErr('')
    try {
      const r = await fetch('/api/telegram/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      }).then(x => x.json())
      if (r?.ok) { setNote(action === 'connect' ? 'Connected. Message the bot on Telegram and it will land here.' : 'Done.'); await load() }
      else setErr(r?.error || r?.message || 'That did not work.')
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }

  if (loading && !s) return <p className="text-sm text-muted">Loading…</p>

  const pending = (s?.contacts || []).filter(c => c.status === 'pending')
  const approved = (s?.contacts || []).filter(c => c.status === 'approved')
  const blocked = (s?.contacts || []).filter(c => c.status === 'blocked')
  const rooms = s?.rooms || []

  return (
    <div className="space-y-4">
      {err && <p className="text-[13px] text-[#A32020]">{err}</p>}
      {note && <p className="text-[13px] text-[#1F7A4D]">{note}</p>}

      {/* ---- Connection ---- */}
      <div className={`${card} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><Send size={14} /> The bot</p>
            <p className="text-[13px] text-muted mt-1 max-w-2xl">
              Eve answers in Telegram exactly as she does here — same tools, same memory, same permissions.
              Who she answers is decided below, and only below: nothing sent from inside Telegram or Slack can
              approve anybody.
            </p>
          </div>
          <button onClick={load} className="text-muted hover:text-ink shrink-0" title="Refresh"><RefreshCw size={14} /></button>
        </div>

        <div className="mt-3 grid gap-2 text-[13px]">
          <Row ok={!!s?.bot.configured} label="TELEGRAM_BOT_TOKEN"
            good={s?.bot.username ? `@${s.bot.username}` : 'set'}
            bad="Not set in Vercel. Create the bot with @BotFather, then add the token." />
          <Row ok={!!s?.bot.hasSecret} label="TELEGRAM_WEBHOOK_SECRET"
            good="set" bad="Not set in Vercel. 32+ random characters — it is what proves a call really came from Telegram." />
          <Row ok={!!s?.webhook.connected} label="Webhook"
            good={s?.webhook.url || ''} bad={s?.webhook.url ? `Pointing somewhere else: ${s.webhook.url}` : 'Not connected yet.'} />
          {s?.bot.error && <p className="text-[13px] text-[#A32020]">Telegram says: {s.bot.error}</p>}
          {s?.webhook.lastError && (
            <p className="text-[13px] text-[#A32020]">Last delivery error {ago(s.webhook.lastErrorAt)}: {s.webhook.lastError}</p>
          )}
          {s?.bot.readsAllGroupMessages === true && (
            <p className="text-[13px] text-[#8A5A00] inline-flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Group privacy is OFF in BotFather, so Telegram sends her every message in every group she is in.
              She still only answers when @mentioned, but turn privacy back ON (/setprivacy → Enable) so she
              never receives the rest.
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button disabled={!canEdit || !s?.bot.configured || !s?.bot.hasSecret || busy === 'connect'}
            onClick={() => act('connect', {}, 'connect')}
            className={`${btn} bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40`}>
            <Link2 size={13} /> {s?.webhook.connected ? 'Re-point webhook here' : 'Connect'}
          </button>
          {s?.webhook.url && (
            <button disabled={!canEdit || busy === 'disconnect'} onClick={() => act('disconnect', {}, 'disconnect')}
              className={`${btn} bg-app border border-line text-ink hover:bg-white disabled:opacity-40`}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* ---- Pending people ---- */}
      <div className={`${card} p-4`}>
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
          <Clock size={14} /> Waiting to be approved {pending.length > 0 && <span className="text-[11px] font-bold text-white bg-[#A32020] rounded-full px-1.5">{pending.length}</span>}
        </p>
        <p className="text-[13px] text-muted mt-1 max-w-2xl">
          Anyone who messages the bot lands here and gets no answer until you approve them. Approving means
          choosing <b>which Lighthouse user they speak as</b> — Eve then shows them exactly what that person can
          see in the app, dollar amounts included or hidden by their own toggle.
        </p>
        {!pending.length && <p className="text-[13px] text-muted mt-3">Nobody waiting.</p>}
        <div className="mt-3 space-y-2">
          {pending.map(c => (
            <div key={c.id} className="border border-line rounded-xl p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{nameOf(c)}</p>
                  <p className="text-[12px] text-muted">
                    {c.username ? `@${c.username} · ` : ''}id {c.tg_user_id} · {c.msg_count} message{c.msg_count === 1 ? '' : 's'} · first seen {ago(c.created_at)}
                  </p>
                  {c.first_message && <p className="text-[13px] text-ink mt-1.5 italic">“{c.first_message}”</p>}
                </div>
                <div className="flex items-center gap-2">
                  <select className={input + ' max-w-[15rem]'} disabled={!canEdit}
                    value={pick[c.tg_user_id] || ''} onChange={e => setPick(p => ({ ...p, [c.tg_user_id]: e.target.value }))}>
                    <option value="">Speaks as…</option>
                    {(s?.users || []).map(u => <option key={u.email} value={u.email}>{u.name} — {u.email}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
                  </select>
                  <button disabled={!canEdit || !pick[c.tg_user_id] || busy === c.id}
                    onClick={() => act('approve', { tgUserId: c.tg_user_id, email: pick[c.tg_user_id] }, c.id)}
                    className={`${btn} bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40`}><Check size={13} /> Approve</button>
                  <button disabled={!canEdit || busy === c.id} onClick={() => act('block', { tgUserId: c.tg_user_id }, c.id)}
                    className={`${btn} bg-app border border-line text-ink hover:bg-white disabled:opacity-40`}><Ban size={13} /> Block</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Groups ---- */}
      <div className={`${card} p-4`}>
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><MessageSquare size={14} /> Groups</p>
        <p className="text-[13px] text-muted mt-1 max-w-2xl">
          A room is approved separately from the people in it, and both have to pass — so the bot cannot be
          dragged into a chat nobody vetted, and inside an approved room each person still only gets what their
          own role allows. She only speaks when @mentioned or replied to.
        </p>
        <p className="text-[12px] text-muted mt-2 max-w-2xl">
          Note for the rev-bot room: Telegram never delivers one bot&apos;s messages to another bot. Several bots
          can sit in one group and answer the people in it — Eve reacting to what another bot posts would have to
          go through an API, not through Telegram.
        </p>
        {!rooms.length && <p className="text-[13px] text-muted mt-3">She is not in any groups yet. Add her to one and it will appear here.</p>}
        <div className="mt-3 space-y-2">
          {rooms.map(r => (
            <div key={r.id} className="border border-line rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{r.title || r.chat_id}</p>
                <p className="text-[12px] text-muted">
                  {r.kind} · {r.status}{r.added_by_name ? ` · added by ${r.added_by_name}` : ''}{r.last_seen_at ? ` · active ${ago(r.last_seen_at)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.status !== 'approved' && (
                  <button disabled={!canEdit || busy === r.id} onClick={() => act('room', { chatId: r.chat_id, status: 'approved' }, r.id)}
                    className={`${btn} bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40`}><Check size={13} /> Approve room</button>
                )}
                {r.status !== 'blocked' && (
                  <button disabled={!canEdit || busy === r.id} onClick={() => act('room', { chatId: r.chat_id, status: 'blocked' }, r.id)}
                    className={`${btn} bg-app border border-line text-ink hover:bg-white disabled:opacity-40`}><Ban size={13} /> Block</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Approved people ---- */}
      <div className={`${card} p-4`}>
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><Users size={14} /> Approved</p>
        {!approved.length && <p className="text-[13px] text-muted mt-2">Nobody yet.</p>}
        <div className="mt-3 space-y-2">
          {approved.map(c => (
            <div key={c.id} className="border border-line rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><ShieldCheck size={13} className="text-[#1F7A4D]" /> {nameOf(c)}</p>
                <p className="text-[12px] text-muted">
                  speaks as {c.email} · approved by {c.approved_by || '—'} · {c.msg_count} message{c.msg_count === 1 ? '' : 's'}{c.last_seen_at ? ` · last ${ago(c.last_seen_at)}` : ''}
                </p>
              </div>
              <button disabled={!canEdit || busy === c.id} onClick={() => act('block', { tgUserId: c.tg_user_id }, c.id)}
                className={`${btn} bg-app border border-line text-ink hover:bg-white disabled:opacity-40`}><Ban size={13} /> Revoke</button>
            </div>
          ))}
        </div>
        {blocked.length > 0 && (
          <p className="text-[12px] text-muted mt-3">
            Blocked: {blocked.map(nameOf).join(', ')}. They get no reply at all. Approve them again from a fresh message if that was a mistake.
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ ok, label, good, bad }: { ok: boolean; label: string; good: string; bad: string }) {
  return (
    <p className={`inline-flex items-start gap-1.5 ${ok ? 'text-ink' : 'text-[#A32020]'}`}>
      {ok ? <Check size={13} className="mt-0.5 shrink-0 text-[#1F7A4D]" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
      <span><b>{label}:</b> {ok ? good : bad}</span>
    </p>
  )
}
