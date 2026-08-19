'use client'
// SLACK ALERT RULES — the editable rulebook, in /users under App settings.
//
// Jon, 2026-08-19: "This should be editable in user settings, ect where we can set rules."
//
// Everything the alert engine consults is on this screen: which channel each building posts to,
// who supervises it, who is tagged on everything, when each alert is allowed to speak, whether it
// waits for approval, and how long an unapproved message lives. Nothing is hardcoded in the
// engine that cannot be changed here.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Save, RefreshCw, Slack as SlackIcon, AlertTriangle, Check } from 'lucide-react'

type Level = { enabled: boolean; approval: boolean; quietStart: number; quietEnd: number; cooldownMin: number }
type Rules = {
  firehose: string | null
  defaultChannel: string | null
  buildings: Record<string, string>
  supervisors: Record<string, string[]>
  core: string[]
  people: Record<string, string>
  events: Record<string, Level>
  approvers: string[]
  approvalExpiryMin: number
  overtimeHours: number
  tone: string
}
type User = { id: string; name: string; email: string | null; title: string | null }
type Channel = { id: string; name: string; isPrivate: boolean; isMember: boolean }
type Building = { label: string; market: string; vendor?: boolean }

const hhmm = (min: number): string => {
  const h = Math.floor(min / 60), m = min % 60
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}
const fromHhmm = (s: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''))
  if (!m) return 0
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]))
}

const INPUT = 'rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] bg-white focus:outline-none focus:ring-2 focus:ring-brand-200'

export function SlackRulesAdmin({ isOwner }: { isOwner: boolean }) {
  const [rules, setRules] = useState<Rules | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [connected, setConnected] = useState(false)
  const [bot, setBot] = useState<any>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'refresh' | null>('load')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(refresh ? 'refresh' : 'load')
    try {
      const r = await fetch('/api/settings/slack-rules' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || !d.ok) { setMsg({ kind: 'err', text: d.error || 'Could not load the rules.' }); setBusy(null); return }
      setRules(d.rules); setUsers(d.users || []); setChannels(d.channels || [])
      setBuildings(d.buildings || []); setLabels(d.eventLabels || {})
      setConnected(!!d.connected); setBot(d.bot || null)
    } catch { setMsg({ kind: 'err', text: 'Could not reach the server.' }) }
    setBusy(null)
  }, [])

  useEffect(() => { load() }, [load])

  const userName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of users) m[u.id] = u.name
    return m
  }, [users])

  function patch(fn: (r: Rules) => Rules) {
    setRules(r => (r ? fn({ ...r }) : r))
  }

  async function save() {
    if (!rules) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/slack-rules', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      })
      const d = await r.json().catch(() => ({} as any))
      if (r.ok && d.ok) { setRules(d.rules); setMsg({ kind: 'ok', text: 'Saved. New alerts follow these rules from now on.' }) }
      else setMsg({ kind: 'err', text: d.error || 'Could not save.' })
    } catch { setMsg({ kind: 'err', text: 'Could not reach the server.' }) }
    setBusy(null)
  }

  if (busy === 'load' || !rules) {
    return <div className="flex items-center gap-2 text-[13px] text-muted py-4"><Loader2 size={14} className="animate-spin" /> Loading the rules…</div>
  }

  const ChannelSelect = ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <select className={INPUT} value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">— none —</option>
      {channels.map(c => (
        <option key={c.id} value={c.id}>
          {'#' + c.name}{c.isPrivate ? (c.isMember ? ' 🔒' : ' 🔒 (bot not in it)') : ''}
        </option>
      ))}
    </select>
  )

  const PeopleSelect = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <select
      multiple
      className={INPUT + ' min-h-[76px] w-full'}
      value={value}
      onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}
    >
      {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.title ? ' — ' + u.title : ''}</option>)}
    </select>
  )

  return (
    <div className="space-y-4">
      {/* connection state */}
      <div className={`rounded-xl border px-3.5 py-2.5 text-[13px] flex items-start gap-2 ${connected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        {connected ? <Check size={15} className="mt-0.5" /> : <AlertTriangle size={15} className="mt-0.5" />}
        <div>
          {connected
            ? <>Connected as <b>{bot && bot.user ? bot.user : 'Lighthouse'}</b>{bot && bot.team ? <> in {bot.team}</> : null}. Private channels still need the bot invited with <code className="font-mono">/invite @{bot && bot.user ? bot.user : 'Lighthouse'}</code>.</>
            : <>No Slack bot connected yet. Connect it from the Command Center, then come back here to set the rules.</>}
        </div>
      </div>

      {/* where things go */}
      <div className="rounded-xl border border-line bg-app/40 p-3 space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Where messages go</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] text-muted block mb-1">Firehose — gets a copy of everything</span>
            <ChannelSelect value={rules.firehose} onChange={v => patch(r => ({ ...r, firehose: v }))} />
          </label>
          <label className="block">
            <span className="text-[12px] text-muted block mb-1">Fallback — buildings with no channel of their own</span>
            <ChannelSelect value={rules.defaultChannel} onChange={v => patch(r => ({ ...r, defaultChannel: v }))} />
          </label>
        </div>
      </div>

      {/* always tagged */}
      <div className="rounded-xl border border-line bg-app/40 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Tagged on everything</div>
        <p className="text-[12px] text-muted mb-2">
          These people are added to every alert, whatever the building — on top of whoever the message is about and that building&rsquo;s supervisor.
        </p>
        <PeopleSelect value={rules.core} onChange={v => patch(r => ({ ...r, core: v }))} />
        <div className="text-[11px] text-muted mt-1.5">{rules.core.map(id => userName[id] || id).join(' · ') || 'nobody selected'}</div>
      </div>

      {/* per building */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="px-3 py-2 bg-app/60 border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
          Per building — channel &amp; supervisor
        </div>
        <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
          {buildings.map(b => (
            <div key={b.label} className="px-3 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
              <div className="text-[12.5px] font-semibold text-ink">
                {b.label}
                <span className="block text-[11px] font-normal text-muted">{b.market}{b.vendor ? ' · vendor' : ''}</span>
              </div>
              <ChannelSelect
                value={rules.buildings[b.label] || null}
                onChange={v => patch(r => {
                  const next = { ...r.buildings }
                  if (v) next[b.label] = v; else delete next[b.label]
                  return { ...r, buildings: next }
                })}
              />
              <PeopleSelect
                value={rules.supervisors[b.label] || []}
                onChange={v => patch(r => {
                  const next = { ...r.supervisors }
                  if (v.length) next[b.label] = v; else delete next[b.label]
                  return { ...r, supervisors: next }
                })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* per event */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="px-3 py-2 bg-app/60 border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
          What can speak, and when
        </div>
        <div className="divide-y divide-line">
          {Object.keys(rules.events).map(key => {
            const ev = rules.events[key]
            const set = (patchEv: Partial<Level>) => patch(r => ({ ...r, events: { ...r.events, [key]: { ...r.events[key], ...patchEv } } }))
            return (
              <div key={key} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink min-w-[190px]">
                    <input type="checkbox" checked={ev.enabled} onChange={e => set({ enabled: e.target.checked })} />
                    {labels[key] || key}
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    <input type="checkbox" checked={ev.approval} onChange={e => set({ approval: e.target.checked })} />
                    needs approval
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    between
                    <input type="time" className={INPUT} value={hhmm(ev.quietStart)} onChange={e => set({ quietStart: fromHhmm(e.target.value) })} />
                    and
                    <input type="time" className={INPUT} value={hhmm(ev.quietEnd)} onChange={e => set({ quietEnd: fromHhmm(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    quiet for
                    <input type="number" min={0} max={1440} className={INPUT + ' w-20'} value={ev.cooldownMin} onChange={e => set({ cooldownMin: Number(e.target.value) })} />
                    min after sending
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* thresholds + tone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-app/40 p-3 space-y-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Thresholds</div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            Flag someone after
            <input type="number" min={4} max={24} className={INPUT + ' w-20'} value={rules.overtimeHours}
              onChange={e => patch(r => ({ ...r, overtimeHours: Number(e.target.value) }))} />
            hours on the clock
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            Unapproved messages expire after
            <input type="number" min={15} max={1440} className={INPUT + ' w-20'} value={rules.approvalExpiryMin}
              onChange={e => patch(r => ({ ...r, approvalExpiryMin: Number(e.target.value) }))} />
            min
          </label>
          <div>
            <span className="text-[12px] text-muted block mb-1">Who gets the approval DM</span>
            <PeopleSelect value={rules.approvers} onChange={v => patch(r => ({ ...r, approvers: v }))} />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-app/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Tone</div>
          <p className="text-[12px] text-muted mb-2">How every message should read. Keep it encouraging — people see these in front of their whole team.</p>
          <textarea
            className={INPUT + ' w-full h-[132px]'}
            value={rules.tone}
            onChange={e => patch(r => ({ ...r, tone: e.target.value }))}
          />
        </div>
      </div>

      {msg ? (
        <div className={`rounded-xl px-3.5 py-2.5 text-[13px] flex items-center gap-2 border ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy !== null || !isOwner}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40">
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save rules
        </button>
        <button onClick={() => load(true)} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40">
          {busy === 'refresh' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh people &amp; channels
        </button>
        <span className="text-[11px] text-muted inline-flex items-center gap-1"><SlackIcon size={11} /> {users.length} people · {channels.length} channels</span>
      </div>
      {!isOwner ? <p className="text-[11px] text-muted">Only an admin can save changes here.</p> : null}
    </div>
  )
}
