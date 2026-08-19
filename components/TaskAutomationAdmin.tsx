'use client'
// TASK AUTOMATION (Jon, 2026-08-18: "auto assign should be a customization in the user setting").
//
// The rules that let Lighthouse create work on its own. Today that is one automation —
// pre-arrival inspections for big / VIP / owner arrivals, created in Breezeway and assigned to
// the ops lead plus the market supervisor — with every knob a manager would want:
// which triggers, what "big" means, who gets assigned, and the master switch.
//
// PREVIEW BEFORE TRUST. The Preview button runs the real rule against the real calendar and
// shows exactly what WOULD fire, without creating anything — the same contract as the ops
// brief's preview. Nothing is created until Enabled is on.
import { useCallback, useEffect, useState } from 'react'
import { Zap, Loader2, Save, Eye, AlertTriangle, Check } from 'lucide-react'

type Cfg = {
  enabled: boolean
  bigArrivals: boolean; bigValue: number; bigNights: number
  vip: boolean; ownerStays: boolean; daysAhead: number
  assignAlways: string
  supervisors: { Miami: string; Broward: string; North: string }
  noticeDrafts: { enabled: boolean; fromEmail: string; slackChannel: string }
}

export function TaskAutomationAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [preview, setPreview] = useState<any[] | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/task-automation', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.config) { setCfg(j.config); setSaved(JSON.stringify(j.config)) }
    } catch { /* stays empty; save still works after a reload */ }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (patch: Partial<Cfg>) => setCfg(c => c ? { ...c, ...patch } : c)
  const setSup = (k: 'Miami' | 'Broward' | 'North', v: string) =>
    setCfg(c => c ? { ...c, supervisors: { ...c.supervisors, [k]: v } } : c)
  const dirty = cfg ? JSON.stringify(cfg) !== saved : false

  async function save() {
    if (!cfg) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/task-automation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      setCfg(j.config); setSaved(JSON.stringify(j.config))
      setMsg({ tone: 'ok', text: j.config.enabled ? 'Saved — the automation is ON and runs four times a day.' : 'Saved — the automation stays OFF until you enable it.' })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function runPreview() {
    setBusy('preview'); setMsg(null); setPreview(null)
    try {
      const r = await fetch('/api/cron/auto-inspections?preview=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Preview failed.')
      setPreview(j.candidates || [])
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  if (!cfg) return <p className="text-[12.5px] text-muted py-2"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Loading…</p>

  const box = 'rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] w-full'
  const check = (key: keyof Cfg, label: string, sub: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={!!cfg[key]} onChange={e => set({ [key]: e.target.checked } as any)} className="mt-0.5" disabled={!isOwner} />
      <span className="text-[12.5px]"><span className="font-semibold text-ink">{label}</span> <span className="text-muted">— {sub}</span></span>
    </label>
  )

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-2.5 flex-wrap">
        <Zap size={14} className={cfg.enabled ? 'text-amber-500' : 'text-muted'} />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} disabled={!isOwner} />
          <span className="text-[13px] font-bold text-ink">Auto-create pre-arrival inspections</span>
        </label>
        <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (cfg.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>
          {cfg.enabled ? 'On' : 'Off'}
        </span>
      </div>
      <p className="text-[12px] text-muted -mt-1">
        For qualifying arrivals in the next {cfg.daysAhead} day{cfg.daysAhead === 1 ? '' : 's'}, Lighthouse creates an inspection in
        Breezeway (scheduled the day before the guest lands), assigns it, and lists it in the morning brief's priorities.
        Each reservation fires exactly once, ever.
      </p>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        <div className="space-y-2">
          {check('bigArrivals', 'Big arrivals', 'high value or long stays')}
          <div className="flex items-center gap-2 pl-6">
            <span className="text-[11.5px] text-muted">$</span>
            <input type="number" value={cfg.bigValue} onChange={e => set({ bigValue: Number(e.target.value) })} className={box + ' max-w-[90px]'} disabled={!isOwner || !cfg.bigArrivals} />
            <span className="text-[11.5px] text-muted">or</span>
            <input type="number" value={cfg.bigNights} onChange={e => set({ bigNights: Number(e.target.value) })} className={box + ' max-w-[64px]'} disabled={!isOwner || !cfg.bigArrivals} />
            <span className="text-[11.5px] text-muted">nights+</span>
          </div>
          {check('vip', 'VIP guests', 'a Guesty VIP field or tag')}
          {check('ownerStays', 'Owner stays', 'owner bookings and owner-name matches')}
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">Look ahead</span>
            <input type="number" min={1} max={7} value={cfg.daysAhead} onChange={e => set({ daysAhead: Number(e.target.value) })} className={box + ' max-w-[64px]'} disabled={!isOwner} />
            <span className="text-[12.5px] text-muted">days</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider font-bold text-muted">Assigned to</p>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted w-24 shrink-0">Always</span>
            <input value={cfg.assignAlways} onChange={e => set({ assignAlways: e.target.value })} className={box} disabled={!isOwner} placeholder="e.g. Roberto" />
          </div>
          {(['Miami', 'Broward', 'North'] as const).map(m => (
            <div key={m} className="flex items-center gap-2">
              <span className="text-[12.5px] text-muted w-24 shrink-0">{m}</span>
              <input value={cfg.supervisors[m]} onChange={e => setSup(m, e.target.value)} className={box} disabled={!isOwner} placeholder="supervisor" />
            </div>
          ))}
          <p className="text-[11px] text-muted">Names are matched against Breezeway's people list when each task is created.</p>
        </div>
      </div>

      {/* ── AUTOMATION 2: arrival-day Gmail drafts for front-desk notices ─────────────────── */}
      <div className="border-t border-line pt-3 mt-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Zap size={14} className={cfg.noticeDrafts?.enabled ? 'text-amber-500' : 'text-muted'} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!cfg.noticeDrafts?.enabled}
              onChange={e => set({ noticeDrafts: { ...cfg.noticeDrafts, enabled: e.target.checked } })} disabled={!isOwner} />
            <span className="text-[13px] font-bold text-ink">Draft front-desk notices on arrival morning</span>
          </label>
          <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (cfg.noticeDrafts?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>
            {cfg.noticeDrafts?.enabled ? 'On' : 'Off'}
          </span>
        </div>
        <p className="text-[12px] text-muted mt-1">
          Every morning at 6:30, each of today&apos;s unsent building notices becomes a ready-to-send
          Gmail draft — addressed, subject and body filled — in the mailbox below. A human reviews and
          presses send; nothing goes out on its own.
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[12.5px] text-muted shrink-0">Drafts appear in</span>
          <input value={cfg.noticeDrafts?.fromEmail || ''}
            onChange={e => set({ noticeDrafts: { ...cfg.noticeDrafts, fromEmail: e.target.value } })}
            className={box + ' max-w-[280px]'} disabled={!isOwner} placeholder="mailbox with Google connected" />
          <span className="text-[12.5px] text-muted shrink-0">Notify Slack channel</span>
          <input value={cfg.noticeDrafts?.slackChannel || ''}
            onChange={e => set({ noticeDrafts: { ...cfg.noticeDrafts, slackChannel: e.target.value } })}
            className={box + ' max-w-[180px]'} disabled={!isOwner} placeholder="channel id" />
        </div>
        <p className="text-[11px] text-muted mt-1">
          Runs at 7am, then re-checks hourly until midnight — late bookings get drafted the same day. When the
          team SENDS a draft, the next check notices and marks the reservation sent in Guesty (flag + dated
          Reservation-Notes line), exactly like the desk&apos;s Mark-sent button. The channel only hears from it
          when a NEW draft lands. Default: drafts in support@, notify #vr-customercareteam.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {isOwner ? (
          <button onClick={save} disabled={!dirty || busy === 'save'}
            className="rounded-xl bg-ink text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
            {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
          </button>
        ) : <span className="text-[11.5px] text-muted inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Owner-only to change</span>}
        <button onClick={runPreview} disabled={busy === 'preview'}
          className="rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          {busy === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />} Preview — what would fire today
        </button>
        {msg ? <span className={'text-[12px] font-semibold ' + (msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700')}>{msg.text}</span> : null}
      </div>

      {preview !== null ? (
        <div className="rounded-xl border border-line bg-app/40 px-3 py-2.5">
          {preview.length === 0 ? (
            <p className="text-[12.5px] text-muted">Nothing qualifies in the window right now.</p>
          ) : (
            <div className="space-y-1">
              {preview.map((c: any) => (
                <p key={c.reservation_id} className="text-[12.5px] text-ink flex items-center gap-2 flex-wrap">
                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span className="font-bold">{c.unit_name || 'Unit'}</span>
                  <span className="text-muted">{c.guest_name}</span>
                  <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' +
                    (c.reason === 'owner stay' ? 'bg-indigo-100 text-indigo-700' : c.reason === 'VIP' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-800')}>{c.reason}</span>
                  <span className="text-muted">arrives {c.check_in} · {c.market}{c.hasBreezeway ? '' : ' · no Breezeway property — would be skipped'}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
