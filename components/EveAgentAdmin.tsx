'use client'
// AGENT MODE — Settings → Eve → Agent mode (Jon, 2026-09-18: "Need a turn-on button for agent mode
// and an off button as well. Also need to set parameters for her.")
//
// The big switch first, with its state spelled out in words. Then the fence: one rung control per
// kind of action with what each rung means, the welded-shut ones shown with a lock; budgets; quiet
// hours; approvers; channels. A "today" strip from the counters and the AI ledger, the proposals
// waiting on a yes, and the last 100 lines of her log. Owner edits; admins see everything.
import { useCallback, useEffect, useState } from 'react'
import { Power, Lock, Loader2, Check, X, RefreshCw, ScrollText, Inbox, Save, Sparkles, AlertTriangle, Clock, Eye, Undo2, Play } from 'lucide-react'

type Rung = 0 | 1 | 2 | 3 | 4
type ActionDef = { key: string; label: string; what: string; def: Rung; cap: Rung; wiredAt: string[] }
type Settings = {
  enabled: boolean
  rungs: Record<string, Rung>
  budgets: { asksPerDay: number; actionsPerDay: number; aiUsdPerDay: number; moneyCeilingUsd: number }
  quietHours: { start: string; end: string; tz: string }
  approvers: string[]
  channels: { telegram: boolean; slack: boolean; email: boolean }
  updatedBy?: string | null; updatedAt?: string | null
}
type Today = { date: string; actions: number; asks: number; aiUsd: number; byAction: Record<string, number>; proposed?: number; gradedGood?: number; gradedBad?: number; gradedPending?: number }
type WatchRow = { key: string; title: string; what: string; action: string; enabled: boolean; cooldownHours: number; rungOverride: number | null; lastFiredAt: string | null; lastRunAt: string | null; firedCount: number; lastResult: any; migrated: boolean }
type Undoable = { id: number; at: string; action: string; summary: string | null; by: string; actor: string | null; ref: string | null; undone_at: string | null }
type LogRow = { id: number; at: string; action: string; rung: number; allowed: boolean; mode: string | null; reason: string | null; usd: number | null; summary: string | null; ref: string | null; by: string; actor: string | null; outcome?: string | null; outcome_note?: string | null }

// What became of an executed action (lib/eve/outcomes.ts), as a chip: green when it landed, amber
// while it is still someone's job, red when it slipped or was reversed, grey when we cannot know.
const OUTCOME_STYLE: Record<string, string> = {
  done: 'bg-[#E3F4EC] text-[#0F7B52] border-[#BFE5D2]', replied: 'bg-[#E3F4EC] text-[#0F7B52] border-[#BFE5D2]', gone: 'bg-[#E3F4EC] text-[#0F7B52] border-[#BFE5D2]',
  open: 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]', running: 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]', pending: 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]',
  overdue: 'bg-[#FBE7E4] text-[#A32D1C] border-[#F2C4BD]', silent: 'bg-[#FBE7E4] text-[#A32D1C] border-[#F2C4BD]', reopened: 'bg-[#FBE7E4] text-[#A32D1C] border-[#F2C4BD]',
  unverified: 'bg-app text-muted border-line',
}
type QueueStatus = { waiting: number; deferred: number; undeliverable: number; undeliverableWhy: string[] }
type QueueRow = { id: string; kind: string; payload: any; why: string | null; status: string; created_by: string | null; created_at: string; decided_by: string | null; result: any }

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const RUNG_SHORT = ['Observe', 'Draft', 'Propose', 'Act', 'Act + report']

// The plain-words column next to each action — the same rule as stanceOf in lib/eve/agent-mode.ts,
// computed here so it follows the rung buttons live, before Save.
type Stance = 'Observes' | 'Drafts only' | 'Needs your approval' | 'Acts on her own'
function stanceOf(a: ActionDef, rung: number, enabled: boolean): Stance {
  const r = Math.max(0, Math.min(a.cap, rung))
  const internal = a.cap <= 1
  if (!enabled && !internal) return r >= 1 ? 'Drafts only' : 'Observes'
  if (r >= 3) return 'Acts on her own'
  if (r === 2) return 'Needs your approval'
  if (r === 1) return 'Drafts only'
  return 'Observes'
}
const STANCE_STYLE: Record<Stance, string> = {
  'Acts on her own': 'bg-[#E3F4EC] text-[#0F7B52] border-[#BFE5D2]',
  'Needs your approval': 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]',
  'Drafts only': 'bg-app text-ink border-line',
  'Observes': 'bg-app text-muted border-line',
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : iso
}

export function EveAgentAdmin({ canEdit }: { canEdit: boolean }) {
  const [s, setS] = useState<Settings | null>(null)
  const [actions, setActions] = useState<ActionDef[]>([])
  const [meanings, setMeanings] = useState<Record<string, string>>({})
  const [today, setToday] = useState<Today | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<'fence' | 'queue' | 'watches' | 'log'>('fence')
  const [watches, setWatches] = useState<WatchRow[]>([])
  const [undoable, setUndoable] = useState<Undoable[]>([])
  const [running, setRunning] = useState('')
  const [log, setLog] = useState<LogRow[]>([])
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [approversText, setApproversText] = useState('')
  const [status, setStatus] = useState<QueueStatus | null>(null)
  const [recommended, setRecommended] = useState<Record<string, Rung>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/agent').then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load agent mode.'); return }
      setS(r.settings); setActions(r.actions || []); setMeanings(r.rungs || {}); setToday(r.today || null)
      setStatus(r.status || null); setRecommended(r.recommended || {})
      if (r.expiredDigests) setNote(`Cleared ${r.expiredDigests} stale digest proposal${r.expiredDigests === 1 ? '' : 's'} older than a day.`)
      setApproversText((r.settings?.approvers || []).join(', '))
      setDirty(false); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const loadLog = useCallback(async () => {
    try { const r = await fetch('/api/eve/agent?log=1').then(x => x.json()); setLog(r?.log || []) } catch { /* shown empty */ }
  }, [])
  const loadQueue = useCallback(async () => {
    try { const r = await fetch('/api/eve/agent?queue=1').then(x => x.json()); setQueue(r?.queue || []); if (r?.status) setStatus(r.status) } catch { /* shown empty */ }
  }, [])
  const loadWatches = useCallback(async () => {
    try { const r = await fetch('/api/eve/agent?watches=1').then(x => x.json()); setWatches(r?.watches || []) } catch { /* shown empty */ }
  }, [])
  const loadUndoable = useCallback(async () => {
    try { const r = await fetch('/api/eve/agent?undoable=1').then(x => x.json()); setUndoable(r?.undoable || []) } catch { /* shown empty */ }
  }, [])
  useEffect(() => { if (view === 'log') { loadLog(); loadUndoable() } if (view === 'queue') { loadQueue(); loadUndoable() } if (view === 'watches') loadWatches() }, [view, loadLog, loadQueue, loadWatches, loadUndoable])

  async function undo(logId: number | null) {
    if (!confirm(logId ? 'Undo this action?' : 'Undo the last thing she did?')) return
    try {
      const r = await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(logId ? { op: 'undo', logId } : { op: 'undo_last' }) }).then(x => x.json())
      setNote(r?.ok ? `Undone — ${r.summary}.` : (r?.error || r?.summary || 'Could not undo that.'))
    } catch (e: any) { setNote(e?.message || String(e)) }
    await loadUndoable(); await loadLog(); await load()
  }
  async function patchWatch(key: string, patch: any) {
    if (!canEdit) return
    try {
      const r = await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'watch', key, ...patch }) }).then(x => x.json())
      if (!r?.ok) setNote(r?.error || 'Could not save that watch.')
    } catch (e: any) { setNote(e?.message || String(e)) }
    await loadWatches()
  }
  async function runWatch(key?: string) {
    setRunning(key || 'all')
    try {
      const r = await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'run_watches', key, force: !!key }) }).then(x => x.json())
      if (!r?.ok) setNote(r?.skipped || r?.error || 'The run did not complete.')
      else {
        const ws = (r.watches || []) as any[]
        const fired = ws.reduce((n, w) => n + (w.fired || 0), 0), found = ws.reduce((n, w) => n + (w.found || 0), 0)
        setNote(`Ran ${ws.length} watch${ws.length === 1 ? '' : 'es'}: found ${found}, raised ${fired}${ws.some(w => w.error) ? ' — ' + ws.filter(w => w.error).map(w => `${w.key}: ${w.error}`).join('; ').slice(0, 300) : ''}.`)
      }
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setRunning('') }
    await loadWatches(); await load()
  }

  async function put(patch: any, msg: string) {
    if (!canEdit) return
    setSaving(true); setErr(''); setNote('')
    try {
      const r = await fetch('/api/eve/agent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not save.'); return }
      setS(r.settings); setToday(r.today || today); setApproversText((r.settings?.approvers || []).join(', ')); setDirty(false); setNote(msg)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setSaving(false) }
  }

  async function toggle() {
    if (!s) return
    const next = !s.enabled
    if (next && !confirm('Switch Agent mode ON? She will act on her own for anything set to Act below, and propose the rest.')) return
    await put({ enabled: next }, next ? 'Agent mode is ON.' : 'Agent mode is OFF — nothing leaves the app.')
  }

  function edit(fn: (d: Settings) => Settings) { if (!s || !canEdit) return; setS(fn(s)); setDirty(true) }

  function applyRecommended() {
    if (!s || !canEdit || !Object.keys(recommended).length) return
    edit(d => ({ ...d, rungs: { ...d.rungs, ...recommended } }))
    setNote('Recommended setup applied — Save parameters to keep it.')
  }

  async function saveParams() {
    if (!s) return
    const approvers = approversText.split(/[,\s]+/).map(e => e.trim().toLowerCase()).filter(e => /@/.test(e))
    await put({ rungs: s.rungs, budgets: s.budgets, quietHours: s.quietHours, approvers, channels: s.channels }, 'Parameters saved.')
  }

  async function decide(id: string, op: 'approve' | 'reject') {
    try {
      const r = await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id }) }).then(x => x.json())
      setNote(r?.ok ? (op === 'approve' ? `Done — ${r.done || 'carried out'}.` : 'Rejected.') : (r?.error || 'Could not do that.'))
    } catch (e: any) { setNote(e?.message || String(e)) }
    await loadQueue(); await load()
  }

  if (loading && !s) return <div className="flex items-center gap-2 text-sm text-muted p-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
  if (!s) return <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{err || 'Could not load.'}</div>

  const on = s.enabled
  return (
    <div className="space-y-4">
      {/* THE SWITCH */}
      <div className={`${card} p-4 sm:p-5 ${on ? 'border-[#BFE5D2]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button onClick={toggle} disabled={!canEdit || saving} role="switch" aria-checked={on}
            className={`inline-flex items-center gap-2 rounded-full px-1 py-1 transition-colors ${on ? 'bg-[#0F7B52]' : 'bg-line'} ${canEdit ? '' : 'opacity-60 cursor-not-allowed'}`}
            style={{ width: 92 }}>
            <span className={`flex items-center justify-center h-8 w-8 rounded-full bg-white text-ink shadow transition-transform ${on ? 'translate-x-[52px]' : 'translate-x-0'}`}>
              <Power size={14} className={on ? 'text-[#0F7B52]' : 'text-muted'} />
            </span>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-ink">
              {on ? 'Agent mode is ON — she acts inside the fence below' : 'Agent mode is OFF — she observes and drafts only'}
            </div>
            <div className="text-[12px] text-muted mt-0.5">
              {on ? 'Anything set to Act happens on its own and is logged. Anything set to Propose waits for a yes on Telegram or in the queue here. OFF stops everything within one request.'
                : 'Nothing leaves the app: no Slack posts, no Telegram asks, no door codes, no tasks. Drafts still pile up in the queue so nothing is lost.'}
              {s.updatedAt ? ` Last changed ${when(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy}` : ''}.` : ''}
            </div>
          </div>
          {!canEdit && <span className="text-[11px] text-muted">Owner edits · you can view</span>}
        </div>
      </div>

      {/* TODAY */}
      {today && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Acted', `${today.actions} / ${s.budgets.actionsPerDay}`],
            ['Proposed', `${today.proposed ?? 0} · asks ${today.asks} / ${s.budgets.asksPerDay}`],
            ['AI spend', `$${today.aiUsd.toFixed(2)} / $${s.budgets.aiUsdPerDay}`],
            ['Graded good · bad', `${today.gradedGood ?? 0} · ${today.gradedBad ?? 0}${today.gradedPending ? ` (${today.gradedPending} measuring)` : ''}`],
          ].map(([k, v]) => (
            <div key={k} className={`${card} px-3 py-2.5`}>
              <div className="text-[11px] text-muted">{k} · {today.date}</div>
              <div className="text-[15px] font-bold text-ink">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* THE QUEUE, AT THE TOP. Waiting on a yes, held for the morning, and — in red — proposals
          nobody was told about. Three days of silent digests is what this line is for. */}
      {status && (
        <div className={`${card} px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]`}>
          <button onClick={() => setView('queue')} className="inline-flex items-center gap-1.5 text-ink hover:underline"><Inbox size={13} /> <b>{status.waiting}</b> waiting on a yes</button>
          <span className="inline-flex items-center gap-1.5 text-muted"><Clock size={13} /> <b className="text-ink">{status.deferred}</b> held for the morning</span>
          {status.undeliverable > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[#B42318] font-semibold"><AlertTriangle size={13} /> {status.undeliverable} proposal{status.undeliverable === 1 ? '' : 's'} could not reach an approver{status.undeliverableWhy[0] ? ` — ${status.undeliverableWhy[0]}` : ''}</span>
          )}
        </div>
      )}

      {err && <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{err}</div>}
      {note && <div className="text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{note}</div>}

      <div className="flex items-center gap-1 border-b border-line">
        {([['fence', 'Parameters', Lock], ['queue', 'Waiting on a yes', Inbox], ['watches', 'Watches', Eye], ['log', 'Log', ScrollText]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setView(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px ${view === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === 'fence' && (
        <div className="space-y-4">
          {/* RUNGS */}
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[13px] font-bold text-ink">What she may do, per kind of action</div>
              {canEdit && (
                <button onClick={applyRecommended} disabled={saving || !Object.keys(recommended).length}
                  title="Slack posts on her own; Telegram asks, email drafts and task notes and tasks with your yes; recommendations and memory as drafts; everything welded stays at propose."
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 bg-white border border-line rounded-lg px-2.5 py-1.5 hover:bg-app disabled:opacity-50">
                  <Sparkles size={12} /> Recommended setup
                </button>
              )}
            </div>
            <div className="text-[12px] text-muted mb-3">
              {[0, 1, 2, 3, 4].map(r => <span key={r} className="mr-3"><b>{r}</b> {meanings[String(r)] || RUNG_SHORT[r]}</span>)}
            </div>
            <div className="divide-y divide-line">
              {actions.map(a => {
                const v = s.rungs[a.key] ?? a.def
                const locked = a.cap < 4
                const stance = stanceOf(a, v, s.enabled)
                return (
                  <div key={a.key} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
                        {a.label}
                        {a.cap <= 2 && <span title={`Welded at rung ${a.cap} — money and anything a guest can't un-experience stay at propose.`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted bg-app border border-line rounded-full px-1.5 py-0.5"><Lock size={9} /> max {a.cap}</span>}
                        {a.wiredAt.length === 0 && <span className="text-[10px] text-muted bg-app border border-line rounded-full px-1.5 py-0.5" title="No code path takes this action yet — the setting is ready for when one does.">not wired yet</span>}
                      </div>
                      <div className="text-[11px] text-muted">{a.what}</div>
                    </div>
                    <div className="sm:w-[150px] shrink-0">
                      <span className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 border ${STANCE_STYLE[stance]}`} title={!s.enabled && a.cap > 1 ? 'Agent mode is OFF, so nothing leaves the app whatever the rung says.' : `Rung ${v}`}>{stance}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {[0, 1, 2, 3, 4].map(r => {
                        const above = r > a.cap
                        const active = v === r
                        return (
                          <button key={r} disabled={!canEdit || above} title={above ? 'Locked' : (meanings[String(r)] || RUNG_SHORT[r])}
                            onClick={() => edit(d => ({ ...d, rungs: { ...d.rungs, [a.key]: r as Rung } }))}
                            className={`text-[11px] font-semibold rounded-lg px-2 py-1 border ${active ? 'bg-brand-600 text-white border-brand-600' : above ? 'bg-app text-line border-line cursor-not-allowed' : 'bg-white text-muted border-line hover:text-ink'} ${locked && above ? 'opacity-50' : ''}`}>
                            {above ? <Lock size={10} /> : RUNG_SHORT[r]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* BUDGETS · QUIET HOURS · APPROVERS · CHANNELS */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className={`${card} p-4`}>
              <div className="text-[13px] font-bold text-ink mb-2">Budgets (per day, ET)</div>
              {([['asksPerDay', 'Asks she may send'], ['actionsPerDay', 'Actions she may take'], ['aiUsdPerDay', 'AI spend, $'], ['moneyCeilingUsd', 'Money ceiling, $ — anything over this always needs a yes']] as const).map(([k, label]) => (
                <label key={k} className="block mb-2">
                  <span className="text-[11px] text-muted">{label}</span>
                  <input type="number" min={0} value={s.budgets[k]} disabled={!canEdit} className={input}
                    onChange={e => edit(d => ({ ...d, budgets: { ...d.budgets, [k]: Number(e.target.value) } }))} />
                </label>
              ))}
            </div>
            <div className="space-y-4">
              <div className={`${card} p-4`}>
                <div className="text-[13px] font-bold text-ink mb-2">Quiet hours</div>
                <div className="text-[11px] text-muted mb-2">Anything she would act on is held and goes out on its own when quiet hours end — no yes needed. A proposal made at night reaches you in the morning.</div>
                <div className="flex items-center gap-2">
                  <input type="time" value={s.quietHours.start} disabled={!canEdit} className={input} onChange={e => edit(d => ({ ...d, quietHours: { ...d.quietHours, start: e.target.value } }))} />
                  <span className="text-muted text-xs">to</span>
                  <input type="time" value={s.quietHours.end} disabled={!canEdit} className={input} onChange={e => edit(d => ({ ...d, quietHours: { ...d.quietHours, end: e.target.value } }))} />
                </div>
                <div className="text-[11px] text-muted mt-1">{s.quietHours.tz}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-[13px] font-bold text-ink mb-2">Approvers</div>
                <div className="text-[11px] text-muted mb-1">Emails, comma-separated. The first one bound to Telegram gets the asks.</div>
                <input value={approversText} disabled={!canEdit} className={input} onChange={e => { setApproversText(e.target.value); setDirty(true) }} />
              </div>
              <div className={`${card} p-4`}>
                <div className="text-[13px] font-bold text-ink mb-2">Where she asks</div>
                {([['telegram', 'Telegram'], ['slack', 'Slack (#vr-eve)'], ['email', 'Email (not built yet)']] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-[13px] text-ink mb-1">
                    <input type="checkbox" checked={!!s.channels[k]} disabled={!canEdit || k === 'email'} onChange={e => edit(d => ({ ...d, channels: { ...d.channels, [k]: e.target.checked } }))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <button onClick={saveParams} disabled={saving || !dirty}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save parameters
              </button>
              {dirty && <button onClick={load} className="text-xs text-muted hover:text-ink">Discard</button>}
            </div>
          )}
        </div>
      )}

      {view === 'queue' && (
        <div className={`${card} p-4`}>
          {undoable.length > 0 && (
            <div className="mb-3 rounded-xl border border-line bg-app/40 px-3 py-2 text-[12px] flex flex-wrap items-center gap-2">
              <Undo2 size={13} className="text-muted" />
              <span className="text-ink">{undoable.filter(u => !u.undone_at).length} thing{undoable.filter(u => !u.undone_at).length === 1 ? '' : 's'} she did in the last 24h can still be undone.</span>
              <button onClick={() => undo(null)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 hover:bg-app"><Undo2 size={11} /> Undo the last one</button>
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold text-ink">Proposals, drafts and work held for the morning</div>
            <button onClick={loadQueue} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          </div>
          {!queue.length && <div className="text-[13px] text-muted">Nothing waiting.</div>}
          <div className="divide-y divide-line">
            {queue.map(q => {
              const open = q.status === 'proposed'
              const deferred = q.payload?.type === 'deferred'
              const delivery = q.result?.delivery as string | undefined
              return (
                <div key={q.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-ink">
                      <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 border mr-1.5 ${q.kind === 'draft' ? 'bg-app text-muted border-line' : deferred ? 'bg-[#E8F0FE] text-[#1D4ED8] border-[#C7D7FB]' : 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]'}`}>{q.kind === 'draft' ? 'draft' : deferred ? 'held' : 'proposal'}</span>
                      <b>{q.payload?.action}</b> — {q.payload?.summary || q.why}
                    </div>
                    <div className="text-[11px] text-muted">{when(q.created_at)} · {q.created_by || 'eve'} · {q.status}{q.decided_by ? ` by ${q.decided_by}` : ''}{deferred && open && q.payload?.deferUntil ? ` · goes out ${when(q.payload.deferUntil)}` : ''}{q.result?.done ? ` · ${q.result.done}` : ''}{q.result?.error && delivery !== 'undeliverable' ? ` · ${q.result.error}` : ''}</div>
                    {open && !deferred && delivery === 'undeliverable' && <div className="text-[11px] text-[#B42318] font-semibold inline-flex items-center gap-1"><AlertTriangle size={11} /> Nobody was told about this one: {q.result?.error || 'no approver reachable'}</div>}
                    {open && !deferred && delivery === 'deferred' && <div className="text-[11px] text-muted">You will be told in the morning{q.result?.until ? ` (${when(q.result.until)})` : ''}.</div>}
                  </div>
                  {open && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => decide(q.id, 'approve')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-[#0F7B52] rounded-lg px-2.5 py-1.5"><Check size={12} /> {deferred ? 'Do it now' : 'Yes, do it'}</button>
                      <button onClick={() => decide(q.id, 'reject')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted bg-white border border-line rounded-lg px-2.5 py-1.5 hover:text-ink"><X size={12} /> {deferred ? 'Drop it' : 'No'}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'watches' && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-[13px] font-bold text-ink">What she watches on her own</div>
            <div className="flex items-center gap-2">
              <button onClick={loadWatches} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
              <button onClick={() => runWatch()} disabled={!!running} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-brand-600 rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50">{running === 'all' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run all now</button>
            </div>
          </div>
          <div className="text-[12px] text-muted mb-3">Each watch is a deterministic check over the same day picture the boards read. When one trips, she prepares the whole action and puts it through the fence above: at Act she does it (and it can be undone), at Propose she asks on Telegram, at Draft it waits here, and at Observe (or with agent mode OFF) the whole prepared action — draft, task, note — goes on the Thinking tab with the reason and the ask, and nothing leaves the app. A subject (a unit, a thread, a task) is never raised twice inside the cooldown. They run every 30 minutes with the sentiment scan and at the 09:00 ask.</div>
          {watches.length > 0 && !watches[0].migrated && <div className="mb-3 text-[12px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3 py-2 inline-flex items-center gap-1.5"><AlertTriangle size={12} /> Migration 102 has not run — the watches cannot store their state or fire yet.</div>}
          {!watches.length && <div className="text-[13px] text-muted">Loading…</div>}
          <div className="divide-y divide-line">
            {watches.map(w => {
              const res = w.lastResult || {}
              return (
                <div key={w.key} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
                  <button onClick={() => patchWatch(w.key, { enabled: !w.enabled })} disabled={!canEdit || !w.migrated} role="switch" aria-checked={w.enabled} title={w.enabled ? 'On — click to switch off' : 'Off — click to switch on'}
                    className={`shrink-0 mt-0.5 inline-flex items-center rounded-full px-0.5 py-0.5 transition-colors ${w.enabled ? 'bg-[#0F7B52]' : 'bg-line'} ${canEdit && w.migrated ? '' : 'opacity-60 cursor-not-allowed'}`} style={{ width: 40 }}>
                    <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${w.enabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink flex items-center gap-1.5 flex-wrap">
                      {w.title}
                      <span className="text-[10px] font-semibold text-muted bg-app border border-line rounded-full px-1.5 py-0.5">{w.action}</span>
                      {w.rungOverride != null && <span className="text-[10px] font-semibold text-[#9A6200] bg-[#FDF3E0] border border-[#F0DAA8] rounded-full px-1.5 py-0.5">capped at rung {w.rungOverride}</span>}
                    </div>
                    <div className="text-[11px] text-muted">{w.what}</div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {w.lastFiredAt ? `last raised ${when(w.lastFiredAt)} · ` : 'never raised · '}{w.firedCount} raised in total{w.lastRunAt ? ` · last ran ${when(w.lastRunAt)}` : ''}
                      {res && typeof res.found === 'number' ? ` · last run found ${res.found}, raised ${res.fired}${res.cooled ? `, ${res.cooled} in cooldown` : ''}` : ''}
                      {res?.error ? <span className="text-[#B42318]"> · {String(res.error).slice(0, 140)}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <label className="text-[11px] text-muted inline-flex items-center gap-1">cooldown
                      <input type="number" min={1} max={720} defaultValue={w.cooldownHours} disabled={!canEdit || !w.migrated} onBlur={e => { const n = Number(e.target.value); if (n && n !== w.cooldownHours) patchWatch(w.key, { cooldownHours: n }) }}
                        className="w-[64px] text-[12px] text-ink bg-app border border-line rounded-lg px-2 py-1" /> h
                    </label>
                    <button onClick={() => runWatch(w.key)} disabled={!!running || !w.migrated} title="Run this watch now (ignores the cooldown)" className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1.5 hover:bg-app disabled:opacity-50">{running === w.key ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run now</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'log' && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold text-ink">Last {log.length} decisions</div>
            <button onClick={loadLog} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          </div>
          {!log.length && <div className="text-[13px] text-muted">Nothing logged yet. Run migration 100 if this stays empty after she acts.</div>}
          <div className="divide-y divide-line">
            {log.map(r => (
              <div key={r.id} className="py-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted">{when(r.at)}</span>
                  <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 border ${r.allowed ? 'bg-[#E3F4EC] text-[#0F7B52] border-[#BFE5D2]' : 'bg-app text-muted border-line'}`}>{r.mode || (r.allowed ? 'act' : 'no')}</span>
                  <b className="text-ink">{r.action}</b>
                  {r.outcome && r.mode === 'act' && r.allowed && (
                    <span title={r.outcome_note || undefined} className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 border ${OUTCOME_STYLE[r.outcome] || OUTCOME_STYLE.unverified}`}>→ {r.outcome}</span>
                  )}
                  <span className="text-muted">rung {r.rung} · {r.by}{r.actor ? ` · ${r.actor}` : ''}{r.usd ? ` · $${Number(r.usd).toFixed(2)}` : ''}</span>
                </div>
                <div className="text-ink">{r.summary}</div>
                {r.reason && <div className="text-muted">{r.reason}{r.ref ? ` · ref ${r.ref}` : ''}</div>}
                {(() => { const u = undoable.find(x => Number(x.id) === Number(r.id)); if (!u) return null; return u.undone_at
                  ? <div className="text-[11px] text-muted inline-flex items-center gap-1"><Undo2 size={10} /> undone {when(u.undone_at)}</div>
                  : <button onClick={() => undo(Number(r.id))} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 hover:bg-app"><Undo2 size={11} /> Undo</button> })()}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
