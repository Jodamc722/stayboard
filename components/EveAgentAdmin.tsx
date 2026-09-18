'use client'
// AGENT MODE — Settings → Eve → Agent mode (Jon, 2026-09-18: "Need a turn-on button for agent mode
// and an off button as well. Also need to set parameters for her.")
//
// The big switch first, with its state spelled out in words. Then the fence: one rung control per
// kind of action with what each rung means, the welded-shut ones shown with a lock; budgets; quiet
// hours; approvers; channels. A "today" strip from the counters and the AI ledger, the proposals
// waiting on a yes, and the last 100 lines of her log. Owner edits; admins see everything.
import { useCallback, useEffect, useState } from 'react'
import { Power, Lock, Loader2, Check, X, RefreshCw, ScrollText, Inbox, Save } from 'lucide-react'

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
type Today = { date: string; actions: number; asks: number; aiUsd: number; byAction: Record<string, number> }
type LogRow = { id: number; at: string; action: string; rung: number; allowed: boolean; mode: string | null; reason: string | null; usd: number | null; summary: string | null; ref: string | null; by: string; actor: string | null }
type QueueRow = { id: string; kind: string; payload: any; why: string | null; status: string; created_by: string | null; created_at: string; decided_by: string | null; result: any }

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const RUNG_SHORT = ['Observe', 'Draft', 'Propose', 'Act', 'Act + report']

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
  const [view, setView] = useState<'fence' | 'queue' | 'log'>('fence')
  const [log, setLog] = useState<LogRow[]>([])
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [approversText, setApproversText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/agent').then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load agent mode.'); return }
      setS(r.settings); setActions(r.actions || []); setMeanings(r.rungs || {}); setToday(r.today || null)
      setApproversText((r.settings?.approvers || []).join(', '))
      setDirty(false); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const loadLog = useCallback(async () => {
    try { const r = await fetch('/api/eve/agent?log=1').then(x => x.json()); setLog(r?.log || []) } catch { /* shown empty */ }
  }, [])
  const loadQueue = useCallback(async () => {
    try { const r = await fetch('/api/eve/agent?queue=1').then(x => x.json()); setQueue(r?.queue || []) } catch { /* shown empty */ }
  }, [])
  useEffect(() => { if (view === 'log') loadLog(); if (view === 'queue') loadQueue() }, [view, loadLog, loadQueue])

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
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Actions taken', `${today.actions} / ${s.budgets.actionsPerDay}`],
            ['Asks sent', `${today.asks} / ${s.budgets.asksPerDay}`],
            ['AI spend', `$${today.aiUsd.toFixed(2)} / $${s.budgets.aiUsdPerDay}`],
          ].map(([k, v]) => (
            <div key={k} className={`${card} px-3 py-2.5`}>
              <div className="text-[11px] text-muted">{k} · {today.date}</div>
              <div className="text-[15px] font-bold text-ink">{v}</div>
            </div>
          ))}
        </div>
      )}

      {err && <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{err}</div>}
      {note && <div className="text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{note}</div>}

      <div className="flex items-center gap-1 border-b border-line">
        {([['fence', 'Parameters', Lock], ['queue', 'Waiting on a yes', Inbox], ['log', 'Log', ScrollText]] as const).map(([k, label, Icon]) => (
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
            <div className="text-[13px] font-bold text-ink mb-1">What she may do, per kind of action</div>
            <div className="text-[12px] text-muted mb-3">
              {[0, 1, 2, 3, 4].map(r => <span key={r} className="mr-3"><b>{r}</b> {meanings[String(r)] || RUNG_SHORT[r]}</span>)}
            </div>
            <div className="divide-y divide-line">
              {actions.map(a => {
                const v = s.rungs[a.key] ?? a.def
                const locked = a.cap < 4
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
                <div className="text-[11px] text-muted mb-2">Acts wait until morning; asks and drafts still queue.</div>
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
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold text-ink">Proposals and drafts</div>
            <button onClick={loadQueue} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          </div>
          {!queue.length && <div className="text-[13px] text-muted">Nothing waiting.</div>}
          <div className="divide-y divide-line">
            {queue.map(q => {
              const open = q.status === 'proposed'
              return (
                <div key={q.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-ink">
                      <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 border mr-1.5 ${q.kind === 'draft' ? 'bg-app text-muted border-line' : 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]'}`}>{q.kind === 'draft' ? 'draft' : 'proposal'}</span>
                      <b>{q.payload?.action}</b> — {q.payload?.summary || q.why}
                    </div>
                    <div className="text-[11px] text-muted">{when(q.created_at)} · {q.created_by || 'eve'} · {q.status}{q.decided_by ? ` by ${q.decided_by}` : ''}{q.result?.done ? ` · ${q.result.done}` : ''}{q.result?.error ? ` · ${q.result.error}` : ''}</div>
                  </div>
                  {open && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => decide(q.id, 'approve')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-[#0F7B52] rounded-lg px-2.5 py-1.5"><Check size={12} /> Yes, do it</button>
                      <button onClick={() => decide(q.id, 'reject')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted bg-white border border-line rounded-lg px-2.5 py-1.5 hover:text-ink"><X size={12} /> No</button>
                    </div>
                  )}
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
                  <span className="text-muted">rung {r.rung} · {r.by}{r.actor ? ` · ${r.actor}` : ''}{r.usd ? ` · $${Number(r.usd).toFixed(2)}` : ''}</span>
                </div>
                <div className="text-ink">{r.summary}</div>
                {r.reason && <div className="text-muted">{r.reason}{r.ref ? ` · ref ${r.ref}` : ''}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
