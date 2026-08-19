'use client'
// SLACK ALERTS — the settings screen, in /users under App settings.
//
// Jon, 2026-08-19: "The whole slack alerts section in user setting need to be cleaned up, is a bit
// hard to understand. Basically what we want to be able to do is send alerts to specific channels.
// can we make it cleaner."
//
// So this screen is now built around ONE question — WHERE DOES EACH ALERT GO? — and everything
// else is secondary or hidden:
//
//   1. "Where each alert goes"  the main table. One row per alert: on/off, what it is in plain
//                               words, and the channel. Nothing else competes with it.
//   2. "Areas"                  only for the four alerts that route per building. Compact rows;
//                               the building list is a sentence you click to edit, not a
//                               permanently-open 23-row multi-select.
//   3. "People"                 who is tagged, who approves.
//   4. "Advanced"               COLLAPSED. Quiet hours, cooldowns, thresholds, tone.
//
// The previous version put a 92px multi-select for buildings AND one for supervisors inline on
// every area, six times over. That is what made it unreadable.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Save, RefreshCw, Slack as SlackIcon, AlertTriangle, Check,
  ChevronDown, ChevronRight, Settings2,
} from 'lucide-react'

type Level = { enabled: boolean; approval: boolean; quietStart: number; quietEnd: number; cooldownMin: number }
type Group = {
  id: string
  label: string
  buildings: string[]
  housekeeping: string | null
  maintenance: string | null
  supervisors: string[]
  vendor: boolean
}
type Rules = {
  firehose: string | null
  defaultChannel: string | null
  opsChannel: string | null
  leadershipChannel: string | null
  leadership: string[]
  bilingualFieldChannels: boolean
  groups: Group[]
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

/** Which knob on `rules` decides where an alert lands. `area` = per-building, set in the Areas table. */
type Dest =
  | { kind: 'area'; note: string }
  | { kind: 'channel'; field: 'opsChannel' | 'leadershipChannel' | 'defaultChannel' | 'firehose' }
  | { kind: 'dm'; note: string }

/**
 * Plain-English descriptions. Written for the person configuring this, not for a developer — every
 * one says what will actually appear in the channel.
 */
const ALERTS: { key: string; title: string; blurb: string; dest: Dest }[] = [
  { key: 'readiness_3pm', title: '3pm check — ready for 4pm?', dest: { kind: 'area', note: 'housekeeping channel' },
    blurb: 'At 3pm: how many of today\u2019s arrivals are cleaned and ready, and exactly which ones are not.' },
  { key: 'labor_report', title: 'Hours, no-shows, over hours', dest: { kind: 'channel', field: 'leadershipChannel' },
    blurb: 'Late afternoon: hours worked so far, anyone scheduled who never punched in, anyone running long.' },
  { key: 'notable_arrivals', title: 'Owner stays & big bookings', dest: { kind: 'channel', field: 'leadershipChannel' },
    blurb: 'Owner stays, high-value bookings and long stays arriving in the next week.' },
  { key: 'late_cleans', title: 'Cleans running behind', dest: { kind: 'area', note: 'housekeeping channel' },
    blurb: 'Departure cleans that have not started once the guest has gone, with the cleaner tagged.' },
  { key: 'glitches', title: 'Guest issues still open', dest: { kind: 'area', note: 'housekeeping or maintenance channel, by issue type' },
    blurb: 'Open issues that are overdue or more than two days old.' },
  { key: 'repeat_offenders', title: 'Same problem coming back', dest: { kind: 'area', note: 'maintenance channel' },
    blurb: 'A unit with the same fault reported twice in two weeks, after it was closed as fixed.' },
  { key: 'blocked_arrival', title: 'Guest booked into a blocked unit', dest: { kind: 'area', note: 'maintenance channel' },
    blurb: 'Someone arriving into a unit that is out of service.' },
  { key: 'door_codes', title: 'Door code problems', dest: { kind: 'channel', field: 'opsChannel' },
    blurb: 'Two arriving units sharing one code, or a unit with no code on file.' },
  { key: 'market_brief', title: 'Top priorities per market', dest: { kind: 'channel', field: 'opsChannel' },
    blurb: 'A short morning list — the two or three things worth pushing on, per market.' },
  { key: 'walk_in_risk', title: 'Could be a walk-in tonight', dest: { kind: 'area', note: 'housekeeping channel' },
    blurb: 'Any arrival today that is blocked or uncleaned. Mostly covered by the 3pm check \u2014 off by default.' },
  { key: 'handover', title: 'Nightly handover draft', dest: { kind: 'channel', field: 'leadershipChannel' },
    blurb: 'Tomorrow in numbers, per area, as a draft for leadership to edit before it goes out.' },
  { key: 'overtime', title: 'Someone running over hours', dest: { kind: 'channel', field: 'defaultChannel' },
    blurb: 'Anyone still clocked in past the hour limit set below.' },
  { key: 'sync', title: 'A data feed stopped', dest: { kind: 'channel', field: 'defaultChannel' },
    blurb: 'Bookings or tasks stopped syncing. Sends immediately — never waits for approval.' },
  { key: 'digest', title: 'Morning summary', dest: { kind: 'channel', field: 'defaultChannel' },
    blurb: 'One message with the shape of the day: turnovers, arrivals, open issues.' },
  { key: 'personal_brief', title: 'Personal brief (direct message)', dest: { kind: 'dm', note: 'sent to each person privately' },
    blurb: 'Each person gets their own day: their cleans, their arrivals, anything to know.' },
]

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

// Private channels the bot has not been invited to are invisible to conversations.list, so their
// ids would otherwise render as a raw "C04BE7CL90W". These names are read off the workspace.
const chanName: Record<string, string> = {
  C04BE7CL90W: 'vr-broward-housekeeping',
  C02S24UE1EZ: 'vr-broward-maintenance',
  C09PGAX5ARL: 'vr-miami-houskeeping-17west',
  C0AFLUUE8BH: 'vr-parktower',
  C08H24L05MY: 'vr-operations-mgt',
  C04JB4FG6JD: 'vr-gm',
  C083X66C17W: 'vr-ops-team-projects',
  C09LAGPR2RH: 'vr-jjleadership',
}

export function SlackRulesAdmin({ isOwner }: { isOwner: boolean }) {
  const [rules, setRules] = useState<Rules | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [connected, setConnected] = useState(false)
  const [bot, setBot] = useState<any>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'refresh' | null>('load')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [openArea, setOpenArea] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(refresh ? 'refresh' : 'load')
    try {
      const r = await fetch('/api/settings/slack-rules' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || !d.ok) { setMsg({ kind: 'err', text: d.error || 'Could not load the settings.' }); setBusy(null); return }
      setRules(d.rules); setUsers(d.users || []); setChannels(d.channels || [])
      setBuildings(d.buildings || []); setConnected(!!d.connected); setBot(d.bot || null)
    } catch { setMsg({ kind: 'err', text: 'Could not reach the server.' }) }
    setBusy(null)
  }, [])

  useEffect(() => { load() }, [load])

  const userName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of users) m[u.id] = u.name
    return m
  }, [users])

  const chanLabel = useCallback((id: string | null): string => {
    if (!id) return 'not set'
    const c = channels.find(x => x.id === id)
    if (c) return '#' + c.name
    return chanName[id] ? '#' + chanName[id] : id
  }, [channels])

  const unmapped = useMemo(() => {
    if (!rules) return []
    const claimed: Record<string, boolean> = {}
    for (const g of rules.groups) for (const b of g.buildings) claimed[b] = true
    return buildings.map(b => b.label).filter(l => !claimed[l])
  }, [rules, buildings])

  const needInvite = useMemo(() => {
    if (!rules) return []
    const want: string[] = []
    for (const g of rules.groups) { if (g.housekeeping) want.push(g.housekeeping); if (g.maintenance) want.push(g.maintenance) }
    for (const id of [rules.firehose, rules.defaultChannel, rules.opsChannel, rules.leadershipChannel]) if (id) want.push(id)
    const out: string[] = []
    for (const id of want) {
      if (channels.some(c => c.id === id)) continue
      const nm = chanName[id] || id
      if (out.indexOf(nm) < 0) out.push(nm)
    }
    return out
  }, [rules, channels])

  function patch(fn: (r: Rules) => Rules) { setRules(r => (r ? fn({ ...r }) : r)) }

  async function save() {
    if (!rules) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/slack-rules', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      })
      const d = await r.json().catch(() => ({} as any))
      if (r.ok && d.ok) { setRules(d.rules); setMsg({ kind: 'ok', text: 'Saved.' }) }
      else setMsg({ kind: 'err', text: d.error || 'Could not save.' })
    } catch { setMsg({ kind: 'err', text: 'Could not reach the server.' }) }
    setBusy(null)
  }

  if (busy === 'load' || !rules) {
    return <div className="flex items-center gap-2 text-[13px] text-muted py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
  }

  // Keeps a configured-but-uninvited private channel selectable. Without this, Save would wipe it.
  const ChannelSelect = ({ value, onChange, width }: { value: string | null; onChange: (v: string | null) => void; width?: string }) => {
    const known = value ? channels.some(c => c.id === value) : true
    return (
      <select className={INPUT + ' ' + (width || 'w-full')} value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">— pick a channel —</option>
        {!known && value ? <option value={value}>{chanLabel(value)} · invite the bot</option> : null}
        {channels.map(c => (
          <option key={c.id} value={c.id}>{'#' + c.name}{c.isPrivate ? ' 🔒' : ''}</option>
        ))}
      </select>
    )
  }

  const PeoplePicker = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <div>
      <select multiple className={INPUT + ' min-h-[84px] w-full'} value={value}
        onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}>
        {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.title ? ' — ' + u.title : ''}</option>)}
      </select>
      <div className="text-[11px] text-muted mt-1">{value.map(id => userName[id] || id).join(' · ') || 'nobody selected'}</div>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* ── status ─────────────────────────────────────────────────────────── */}
      <div className={`rounded-xl border px-3.5 py-2.5 text-[13px] flex items-start gap-2 ${connected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        {connected ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
        <div>
          {connected
            ? <>Connected as <b>@{bot && bot.user ? bot.user : 'lighthouse'}</b>{bot && bot.team ? <> in {bot.team}</> : null}.</>
            : <>Not connected yet. Connect Slack from the Command Center first.</>}
        </div>
      </div>

      {needInvite.length ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[12.5px] text-sky-900">
          <b>Invite the bot first</b> to {needInvite.map(c => '#' + c).join(', ')}. Post <code className="font-mono">/invite @lighthouse</code> in each — a private channel cannot be posted to otherwise.
        </div>
      ) : null}

      {/* ── 1. WHERE EACH ALERT GOES — the main event ───────────────────────── */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="px-3.5 py-2.5 bg-app/60 border-b border-line">
          <h4 className="text-[13px] font-bold text-ink">Where each alert goes</h4>
          <p className="text-[11.5px] text-muted mt-0.5">Turn an alert off and it stops entirely. &ldquo;Approve first&rdquo; means it waits in Command Center until someone says send.</p>
        </div>
        <div className="divide-y divide-line">
          {ALERTS.map(a => {
            const ev = rules.events[a.key]
            if (!ev) return null
            const setEv = (p: Partial<Level>) => patch(r => ({ ...r, events: { ...r.events, [a.key]: { ...r.events[a.key], ...p } } }))
            return (
              <div key={a.key} className={`px-3.5 py-3 ${ev.enabled ? '' : 'opacity-55'}`}>
                <div className="flex items-start gap-2.5">
                  <input type="checkbox" className="mt-1" checked={ev.enabled} onChange={e => setEv({ enabled: e.target.checked })} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{a.title}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">{a.blurb}</div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted">Goes to</span>
                        {a.dest.kind === 'channel' ? (
                          <ChannelSelect
                            width="w-[230px]"
                            value={rules[a.dest.field] as string | null}
                            onChange={v => patch(r => ({ ...r, [(a.dest as any).field]: v } as Rules))}
                          />
                        ) : (
                          <span className="text-[12px] font-medium text-ink bg-app rounded-lg px-2 py-1">
                            {a.dest.kind === 'area' ? 'the area’s ' + a.dest.note : a.dest.note}
                          </span>
                        )}
                      </div>
                      {a.key !== 'sync' ? (
                        <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                          <input type="checkbox" checked={ev.approval} onChange={e => setEv({ approval: e.target.checked })} />
                          approve first
                        </label>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-3.5 py-2 border-t border-line bg-app/40 text-[11.5px] text-muted">
          A copy of everything also goes to <b>{chanLabel(rules.firehose)}</b>.{' '}
          <span className="inline-flex items-center gap-1 align-middle">
            <ChannelSelect width="w-[210px]" value={rules.firehose} onChange={v => patch(r => ({ ...r, firehose: v }))} />
          </span>
        </div>
      </div>

      {/* ── 2. AREAS ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="px-3.5 py-2.5 bg-app/60 border-b border-line">
          <h4 className="text-[13px] font-bold text-ink">Areas</h4>
          <p className="text-[11.5px] text-muted mt-0.5">Only the four alerts marked &ldquo;the area&rsquo;s channel&rdquo; above use these.</p>
        </div>
        <div className="divide-y divide-line">
          {rules.groups.map((g, gi) => {
            const setG = (p: Partial<Group>) => patch(r => {
              const next = r.groups.slice(); next[gi] = { ...next[gi], ...p }
              return { ...r, groups: next }
            })
            const isOpen = openArea === g.id
            return (
              <div key={g.id} className="px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink min-w-[120px]">{g.label}</span>
                  {g.vendor ? <span className="text-[10px] font-semibold bg-violet-100 text-violet-800 rounded-full px-2 py-0.5">vendor · tags @here</span> : null}
                  <button onClick={() => setOpenArea(isOpen ? null : g.id)}
                    className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:underline">
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {g.buildings.length} buildings · {g.supervisors.length || 'no'} supervisor{g.supervisors.length === 1 ? '' : 's'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <label className="block">
                    <span className="text-[11px] text-muted block mb-1">Housekeeping</span>
                    <ChannelSelect value={g.housekeeping} onChange={v => setG({ housekeeping: v })} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted block mb-1">Maintenance</span>
                    <ChannelSelect value={g.maintenance} onChange={v => setG({ maintenance: v })} />
                  </label>
                </div>

                {!isOpen ? (
                  <p className="text-[11px] text-muted mt-1.5 truncate">{g.buildings.join(', ') || 'no buildings yet'}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5 pt-2.5 border-t border-line/70">
                    <label className="block">
                      <span className="text-[11px] text-muted block mb-1">Buildings in this area</span>
                      <select multiple className={INPUT + ' min-h-[110px] w-full'} value={g.buildings}
                        onChange={e => setG({ buildings: Array.from(e.target.selectedOptions).map(o => o.value) })}>
                        {buildings.map(b => <option key={b.label} value={b.label}>{b.label} — {b.market}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-muted block mb-1">Supervisors</span>
                      <PeoplePicker value={g.supervisors} onChange={v => setG({ supervisors: v })} />
                    </label>
                    <label className="flex items-center gap-1.5 text-[11.5px] text-muted sm:col-span-2">
                      <input type="checkbox" checked={g.vendor} onChange={e => setG({ vendor: e.target.checked })} />
                      Vendor-run — tag @here instead of naming people
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {unmapped.length ? (
          <div className="px-3.5 py-2 border-t border-line bg-amber-50 text-[11.5px] text-amber-800">
            <b>Not in any area:</b> {unmapped.join(', ')}.
          </div>
        ) : null}
      </div>

      {/* ── 3. PEOPLE ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="px-3.5 py-2.5 bg-app/60 border-b border-line">
          <h4 className="text-[13px] font-bold text-ink">People</h4>
        </div>
        <div className="p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-[11.5px] font-semibold text-ink mb-1">Tagged on everything</div>
            <PeoplePicker value={rules.core} onChange={v => patch(r => ({ ...r, core: v }))} />
          </div>
          <div>
            <div className="text-[11.5px] font-semibold text-ink mb-1">Gets the approval message</div>
            <PeoplePicker value={rules.approvers} onChange={v => patch(r => ({ ...r, approvers: v }))} />
          </div>
          <div>
            <div className="text-[11.5px] font-semibold text-ink mb-1">Leadership (handover)</div>
            <PeoplePicker value={rules.leadership} onChange={v => patch(r => ({ ...r, leadership: v }))} />
          </div>
        </div>
      </div>

      {/* ── 4. ADVANCED, collapsed ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <button onClick={() => setShowAdvanced(v => !v)}
          className="w-full px-3.5 py-2.5 bg-app/60 flex items-center gap-2 text-left">
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Settings2 size={14} className="text-muted" />
          <span className="text-[13px] font-bold text-ink">Advanced</span>
          <span className="text-[11.5px] text-muted">timing, limits, wording</span>
        </button>
        {showAdvanced ? (
          <div className="p-3.5 space-y-4">
            <div>
              <div className="text-[11.5px] font-semibold text-ink mb-1.5">When each alert may speak</div>
              <div className="space-y-1.5">
                {ALERTS.filter(a => rules.events[a.key]).map(a => {
                  const ev = rules.events[a.key]
                  const setEv = (p: Partial<Level>) => patch(r => ({ ...r, events: { ...r.events, [a.key]: { ...r.events[a.key], ...p } } }))
                  return (
                    <div key={a.key} className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                      <span className="min-w-[180px] text-ink">{a.title}</span>
                      <input type="time" className={INPUT} value={hhmm(ev.quietStart)} onChange={e => setEv({ quietStart: fromHhmm(e.target.value) })} />
                      <span>to</span>
                      <input type="time" className={INPUT} value={hhmm(ev.quietEnd)} onChange={e => setEv({ quietEnd: fromHhmm(e.target.value) })} />
                      <span>· then quiet for</span>
                      <input type="number" min={0} max={1440} className={INPUT + ' w-[74px]'} value={ev.cooldownMin} onChange={e => setEv({ cooldownMin: Number(e.target.value) })} />
                      <span>min</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                Flag someone after
                <input type="number" min={4} max={24} className={INPUT + ' w-[70px]'} value={rules.overtimeHours}
                  onChange={e => patch(r => ({ ...r, overtimeHours: Number(e.target.value) }))} />
                hours on the clock
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                Unapproved messages expire after
                <input type="number" min={15} max={1440} className={INPUT + ' w-[80px]'} value={rules.approvalExpiryMin}
                  onChange={e => patch(r => ({ ...r, approvalExpiryMin: Number(e.target.value) }))} />
                min
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-ink sm:col-span-2">
                <input type="checkbox" checked={rules.bilingualFieldChannels}
                  onChange={e => patch(r => ({ ...r, bilingualFieldChannels: e.target.checked }))} />
                Spanish then English in the field channels
              </label>
            </div>

            <div>
              <div className="text-[11.5px] font-semibold text-ink mb-1">How messages should read</div>
              <textarea className={INPUT + ' w-full h-[90px]'} value={rules.tone}
                onChange={e => patch(r => ({ ...r, tone: e.target.value }))} />
            </div>
          </div>
        ) : null}
      </div>

      {msg ? (
        <div className={`rounded-xl px-3.5 py-2.5 text-[13px] border ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy !== null || !isOwner}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40">
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
        <button onClick={() => load(true)} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40">
          {busy === 'refresh' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh channels
        </button>
        <span className="text-[11px] text-muted inline-flex items-center gap-1"><SlackIcon size={11} /> {users.length} people · {channels.length} channels</span>
      </div>
      {!isOwner ? <p className="text-[11px] text-muted">Only an admin can save changes here.</p> : null}
    </div>
  )
}
