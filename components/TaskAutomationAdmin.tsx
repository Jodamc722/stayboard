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
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Zap, Loader2, Save, Eye, AlertTriangle, Check } from 'lucide-react'

type Cfg = {
  enabled: boolean
  bigArrivals: boolean; bigValue: number; bigNights: number
  vip: boolean; ownerStays: boolean; daysAhead: number
  lowReviews: boolean; lowReviewMax: number
  assignAlways: string
  supervisors: { Miami: string; Broward: string; North: string }
  noticeDrafts: { enabled: boolean; fromEmail: string; slackChannel: string }
  tripSweep: { enabled: boolean; lookBackDays: number; maxFutureDays: number; sameDeptOnly: boolean }
  staleCleans: { enabled: boolean; afterDays: number; skipOccupied: boolean; maxPerRun: number }
}

// A labelled knob: the words and the number read as one phrase ("Only look back [30]"),
// so a manager never has to map a bare input back to the sentence above it.
function Knob({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-line rounded-lg px-2.5 py-1 bg-app/40 text-[11.5px] text-muted">
      {label}
      {children}
      {unit ? <span>{unit}</span> : null}
    </span>
  )
}

// A small integer input. It refuses junk rather than writing NaN into the config — an empty or
// non-numeric box leaves the saved number exactly as it was.
function Num({ value, onChange, disabled, min = 1, max = 365 }: {
  value: number; onChange: (n: number) => void; disabled?: boolean; min?: number; max?: number
}) {
  return (
    <input
      type="number" min={min} max={max} value={value} disabled={disabled}
      onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) onChange(Math.round(n)) }}
      className="w-[58px] rounded-md border border-line bg-white px-1.5 py-0.5 text-[12px] font-semibold text-ink tabular-nums disabled:opacity-50"
    />
  )
}

export function TaskAutomationAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [saved, setSaved] = useState('')
  // LONG-STAY THRESHOLD (Jon, 2026-08-22: "big arrivals should be long stays… create the user
  // setting where we can customize these triggers"). One number, one source of truth
  // (slack_rules.longStayNights): it drives the briefs' Long-stays card, the VIP/LONG-STAY
  // arrival flags, the GM Decide-today entries and Slack's "Worth knowing" list.
  const [rulesObj, setRulesObj] = useState<any | null>(null)
  const [longStay, setLongStay] = useState<number>(14)
  const [longStaySaved, setLongStaySaved] = useState<number>(14)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [preview, setPreview] = useState<any[] | null>(null)
  const [stalePrev, setStalePrev] = useState<any | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/task-automation', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.config) { setCfg(j.config); setSaved(JSON.stringify(j.config)) }
    } catch { /* stays empty; save still works after a reload */ }
    try {
      const r2 = await fetch('/api/settings/slack-rules', { cache: 'no-store' })
      const j2 = await r2.json()
      if (r2.ok && j2.rules) {
        setRulesObj(j2.rules)
        const n = Number(j2.rules.longStayNights)
        if (Number.isFinite(n) && n > 0) { setLongStay(n); setLongStaySaved(n) }
      }
    } catch { /* the long-stay input simply stays at its default */ }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (patch: Partial<Cfg>) => setCfg(c => c ? { ...c, ...patch } : c)
  const setSup = (k: 'Miami' | 'Broward' | 'North', v: string) =>
    setCfg(c => c ? { ...c, supervisors: { ...c.supervisors, [k]: v } } : c)
  const dirty = (cfg ? JSON.stringify(cfg) !== saved : false) || longStay !== longStaySaved

  async function save() {
    if (!cfg) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/task-automation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      setCfg(j.config); setSaved(JSON.stringify(j.config))
      // The long-stay threshold lives on the Slack rules key — send the FULL rules object back
      // with just this number changed, so a partial write can never clear the rest of the rules.
      if (rulesObj && longStay !== longStaySaved) {
        const r3 = await fetch('/api/settings/slack-rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { ...rulesObj, longStayNights: longStay } }) })
        const j3 = await r3.json(); if (!r3.ok) throw new Error(j3?.error || 'Could not save the long-stay threshold.')
        setRulesObj(j3.rules || { ...rulesObj, longStayNights: longStay })
        setLongStaySaved(Number(j3.rules?.longStayNights) || longStay)
      }
      setMsg({ tone: 'ok', text: j.config.enabled ? 'Saved — the automation is ON and runs four times a day.' : 'Saved — the automation stays OFF until you enable it.' })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function previewStale() {
    setBusy('stale'); setMsg(null); setStalePrev(null)
    try {
      const r = await fetch('/api/settings/stale-cleans', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Preview failed.')
      setStalePrev(j)
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
          {check('bigArrivals', 'Big reservations', 'value only — nights alone never qualify (Jon, 2026-08-22)')}
          <div className="flex items-center gap-2 pl-6">
            <span className="text-[11.5px] text-muted">$</span>
            <input type="number" value={cfg.bigValue} onChange={e => set({ bigValue: Number(e.target.value) })} className={box + ' max-w-[90px]'} disabled={!isOwner || !cfg.bigArrivals} />
            <span className="text-[11.5px] text-muted">+ reservation value</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">Long stay =</span>
            <input type="number" min={2} max={365} value={longStay} onChange={e => setLongStay(Number(e.target.value) || longStay)} className={box + ' max-w-[64px]'} disabled={!isOwner} />
            <span className="text-[12.5px] text-muted">nights+</span>
          </div>
          <p className="text-[11px] text-muted pl-0.5 -mt-1">
            Long stays drive the briefs&apos; Long-stays card, the LONG STAY / VIP arrival flags and Slack&apos;s
            &ldquo;Worth knowing&rdquo; — they do not create inspections; only the $ value above does.
          </p>
          {check('vip', 'VIP guests', 'a Guesty VIP field or tag')}
          {check('ownerStays', 'Owner stays', 'owner bookings and owner-name matches')}
          {check('lowReviews', 'Bad reviews', 'a NEW low review fires a quality inspection on the unit&rsquo;s next checkout')}
          <div className="flex items-center gap-2 pl-6">
            <span className="text-[11.5px] text-muted">rating</span>
            <input type="number" min={1} max={4} step={0.5} value={cfg.lowReviewMax} onChange={e => set({ lowReviewMax: Number(e.target.value) })} className={box + ' max-w-[64px]'} disabled={!isOwner || !cfg.lowReviews} />
            <span className="text-[11.5px] text-muted">&#9733; and below (10-scale channels are halved) &middot; not completed by that checkout &rarr; it moves to the next one automatically</span>
          </div>
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

      {/* ── AUTOMATION: TRIP CONSOLIDATION ────────────────────────────────────────────────── */}
      <div className="border-t border-line pt-3 mt-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Zap size={14} className={cfg.tripSweep?.enabled ? 'text-amber-500' : 'text-muted'} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.tripSweep?.enabled !== false}
              onChange={e => set({ tripSweep: { ...cfg.tripSweep, enabled: e.target.checked } })} disabled={!isOwner} />
            <span className="text-[13px] font-bold text-ink">Bring pending work along when somebody visits a unit</span>
          </label>
          <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (cfg.tripSweep?.enabled !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>
            {cfg.tripSweep?.enabled !== false ? 'On' : 'Off'}
          </span>
        </div>
        <p className="text-[12px] text-muted mt-1 max-w-[74ch]">
          The expensive part of a maintenance job is getting somebody through the door. When a visit is
          scheduled &mdash; from a suggestion, or by anybody, picked up each morning &mdash; every other pending job of the
          same trade in that unit moves onto the same day and the same person, and each one is retitled
          <b className="text-ink"> [Moved to &hellip;]</b> with a dated Lighthouse line saying why.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Knob label="Only look back" unit="days">
            <Num value={cfg.tripSweep?.lookBackDays ?? 30} disabled={!isOwner}
              onChange={n => set({ tripSweep: { ...cfg.tripSweep, lookBackDays: n } })} />
          </Knob>
          <Knob label="Pull forward from up to" unit="days">
            <Num value={cfg.tripSweep?.maxFutureDays ?? 21} disabled={!isOwner}
              onChange={n => set({ tripSweep: { ...cfg.tripSweep, maxFutureDays: n } })} />
          </Knob>
          <label className="text-[11.5px] text-muted border border-line rounded-lg px-2.5 py-1 bg-app/40 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={cfg.tripSweep?.sameDeptOnly !== false} disabled={!isOwner}
              onChange={e => set({ tripSweep: { ...cfg.tripSweep, sameDeptOnly: e.target.checked } })} />
            Same trade only
          </label>
        </div>
        <p className="text-[11px] text-muted mt-1.5">
          Older than the look-back is not pending, it is abandoned &mdash; dragging it onto today&rsquo;s visit tells a
          tech something was forgotten rather than that something needs doing. Beyond the pull-forward window, work was
          scheduled deliberately and is left alone.
        </p>
      </div>

      {/* ── AUTOMATION: STALE DEPARTURE CLEANS ────────────────────────────────────────────── */}
      <div className="border-t border-line pt-3 mt-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Zap size={14} className={cfg.staleCleans?.enabled ? 'text-amber-500' : 'text-muted'} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!cfg.staleCleans?.enabled}
              onChange={e => set({ staleCleans: { ...cfg.staleCleans, enabled: e.target.checked } })} disabled={!isOwner} />
            <span className="text-[13px] font-bold text-ink">Close departure cleans nobody closed</span>
          </label>
          <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (cfg.staleCleans?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>
            {cfg.staleCleans?.enabled ? 'On' : 'Off'}
          </span>
        </div>
        <p className="text-[12px] text-muted mt-1 max-w-[74ch]">
          Crews finish turns and forget to close the task. A week later the unit has been cleaned, re-let and cleaned
          again &mdash; so an open clean from that long ago is a stale record, not outstanding work, and every one of them
          inflates the late count until the 4pm numbers stop meaning anything.
          {' '}<b className="text-ink">It never touches a unit that is occupied right now, and never touches a vendor-cleaned
          building</b> &mdash; vendors never close tasks at all, so every one of theirs would look stale forever.
        </p>
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          <Knob label="Close after" unit="days">
            <Num value={cfg.staleCleans?.afterDays ?? 7} disabled={!isOwner}
              onChange={n => set({ staleCleans: { ...cfg.staleCleans, afterDays: n } })} />
          </Knob>
          <Knob label="Never more than" unit="a run">
            <Num value={cfg.staleCleans?.maxPerRun ?? 40} disabled={!isOwner}
              onChange={n => set({ staleCleans: { ...cfg.staleCleans, maxPerRun: n } })} />
          </Knob>
          <label className="text-[11.5px] text-muted border border-line rounded-lg px-2.5 py-1 bg-app/40 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={cfg.staleCleans?.skipOccupied !== false} disabled={!isOwner}
              onChange={e => set({ staleCleans: { ...cfg.staleCleans, skipOccupied: e.target.checked } })} />
            Skip occupied units
          </label>
          <button onClick={previewStale} disabled={busy === 'stale'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
            {busy === 'stale' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Show me what it would close
          </button>
        </div>
        <p className="text-[11px] text-muted mt-1.5">Counted from the scheduled date. The per-run ceiling is a hard stop, so a bad sync can never mass-close the portfolio.</p>

        {stalePrev && (
          <div className="mt-2 rounded-xl border border-line bg-white overflow-hidden">
            <div className="px-3 py-2 bg-app border-b border-line">
              <p className="text-[12.5px] font-semibold text-ink">
                {stalePrev.closed?.length || 0} would be closed &middot; open since before {stalePrev.cutoff}
              </p>
              <p className="text-[11.5px] text-muted mt-0.5">
                {stalePrev.found} stale cleans found
                {stalePrev.skipped?.occupied ? ` · ${stalePrev.skipped.occupied} skipped, unit occupied today` : ''}
                {stalePrev.skipped?.vendor ? ` · ${stalePrev.skipped.vendor} skipped, vendor-cleaned` : ''}
                {stalePrev.skipped?.overCap ? ` · ${stalePrev.skipped.overCap} over the per-run cap` : ''}
              </p>
            </div>
            <div className="divide-y divide-line max-h-[220px] overflow-y-auto">
              {(stalePrev.closed || []).slice(0, 60).map((c: any) => (
                <div key={c.id} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[12px] text-ink flex-1 truncate">{c.unit}</span>
                  <span className="text-[11px] text-muted tabular-nums shrink-0">{c.date}</span>
                </div>
              ))}
              {(stalePrev.closed || []).length === 0 && (
                <p className="px-3 py-2 text-[12px] text-muted">Nothing is stale right now.</p>
              )}
            </div>
          </div>
        )}
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
