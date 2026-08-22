'use client'
// Admin console — MORNING OPS BRIEF. Who gets which variant, which mailbox sends it, and the
// on/off switch. Also the two buttons that make it trustworthy: Preview (see today's brief in a
// tab) and Send test (all three variants to YOUR inbox only). Nothing goes to the team until
// Enabled is on AND a list has addresses — safe by default.
import { useCallback, useEffect, useState } from 'react'
import { Sunrise, Loader2, Check, AlertTriangle, Save, Eye, Send, Mail } from 'lucide-react'

type Digest = { enabled?: boolean; to?: string[]; fromEmail?: string }
type Cfg = { enabled?: boolean; fromEmail?: string; miami?: string[]; broward?: string[]; full?: string[]; gm?: string[]; vendors?: { botanica?: string[]; pt?: string[]; north?: string[] }; trueup?: Digest; salato?: Digest; laborPlan?: { targetMarginPct?: number | null }; maint?: { enabled?: boolean; miamiTo?: string[]; browardTo?: string[] } }

// The two other daily emails, editable on the same card (Jon, 2026-08-17). Each has its own
// on/off, its own recipient list, and sends from the ops-brief mailbox unless overridden.
const DIGESTS: { key: 'trueup' | 'salato'; label: string; blurb: string }[] = [
  { key: 'trueup', label: 'Daily Labor · 7:58am ET', blurb: "One simple email: today's shifts & tasks (8h standard), then cleaning revenue, maintenance revenue, payroll and profit for yesterday / 7 days / 30 days. Goes to the owner until a list is saved. Skips the day rather than send on partial payroll." },
  { key: 'salato', label: 'Salato front desk · 7:16am ET', blurb: 'Reservations only: arriving, departing, in-house, upcoming — hotel-related flags highlighted.' },
]

// Four audiences, deliberately different documents (2026-08-07). The blurb is the promise each
// one makes — if a brief stops matching its blurb, one of the two is wrong.
const LISTS: { key: 'miami' | 'broward' | 'full' | 'gm'; label: string; blurb: string }[] = [
  { key: 'miami', label: 'Miami · supervisors', blurb: "Today on the ground in Miami: cleans, same-day turns, arrivals" },
  { key: 'broward', label: 'Broward · supervisors', blurb: 'Same, for the Broward market' },
  { key: 'full', label: 'Ops manager · all markets', blurb: 'Every market, full operational detail' },
  { key: 'gm', label: 'GM Brief · leadership', blurb: 'High level: money, occupancy, reputation, claims' },
]

export function OpsBriefAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<Cfg>({})
  // The boxes hold RAW TEXT while you type. The old version re-parsed and filtered on every
  // keystroke, so "jon" (no @ yet) was wiped mid-word and nothing could ever be entered.
  // Parsing to clean address lists happens once, at Save.
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState('')
  // Which sender mailboxes hold a Google connection — and a Connect button for the ones that
  // don't. This is how support@ gets connected for the front-desk drafts (Jon, 2026-08-17).
  const [mailboxes, setMailboxes] = useState<{ email: string; usedFor: string; connected: boolean }[]>([])
  const loadMailboxes = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/mailboxes', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && Array.isArray(j.mailboxes)) setMailboxes(j.mailboxes)
    } catch { /* section simply stays empty */ }
  }, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const rawFromCfg = (c: Cfg): Record<string, string> => ({
    miami: (c.miami || []).join(', '), broward: (c.broward || []).join(', '), full: (c.full || []).join(', '), gm: (c.gm || []).join(', '),
    v_botanica: (c.vendors?.botanica || []).join(', '), v_pt: (c.vendors?.pt || []).join(', '), v_north: (c.vendors?.north || []).join(', '),
    d_trueup: (c.trueup?.to || []).join(', '), d_salato: (c.salato?.to || []).join(', '),
    lp_target: c.laborPlan?.targetMarginPct != null ? String(c.laborPlan.targetMarginPct) : '',
    m_miami: (c.maint?.miamiTo || []).join(', '), m_broward: (c.maint?.browardTo || []).join(', '),
  })
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/ops-brief', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) {
        const c = j.config || {}
        setCfg(c); const rw = rawFromCfg(c); setRaw(rw); setSaved(JSON.stringify({ rw, enabled: c.enabled === true, dt: c.trueup?.enabled === true, ds: c.salato?.enabled === true, dm: c.maint?.enabled !== false }))
      }
    } catch { /* card stays editable with defaults */ }
  }, [])
  useEffect(() => { load(); loadMailboxes() }, [load, loadMailboxes])

  const dirty = JSON.stringify({ rw: raw, enabled: cfg.enabled === true, dt: cfg.trueup?.enabled === true, ds: cfg.salato?.enabled === true, dm: cfg.maint?.enabled !== false }) !== saved
  const parse = (v: string) => v.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))

  async function save() {
    setBusy('save'); setMsg(null)
    try {
      const config: Cfg = {
        ...cfg,
        miami: parse(raw.miami || ''), broward: parse(raw.broward || ''), full: parse(raw.full || ''), gm: parse(raw.gm || ''),
        vendors: { botanica: parse(raw.v_botanica || ''), pt: parse(raw.v_pt || ''), north: parse(raw.v_north || '') },
        trueup: { ...(cfg.trueup || {}), to: parse(raw.d_trueup || '') },
        salato: { ...(cfg.salato || {}), to: parse(raw.d_salato || '') },
        laborPlan: (() => {
          const t = (raw.lp_target || '').trim()
          const n = Number(t)
          return { targetMarginPct: t && Number.isFinite(n) ? n : null }
        })(),
        maint: { enabled: cfg.maint?.enabled !== false, miamiTo: parse(raw.m_miami || ''), browardTo: parse(raw.m_broward || '') },
      }
      const r = await fetch('/api/settings/ops-brief', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      const c = j.config || config
      setCfg(c); const rw = rawFromCfg(c); setRaw(rw); setSaved(JSON.stringify({ rw, enabled: c.enabled === true, dt: c.trueup?.enabled === true, ds: c.salato?.enabled === true, dm: c.maint?.enabled !== false }))
      const total = (c.miami || []).length + (c.broward || []).length + (c.full || []).length + (c.gm || []).length
        + (c.vendors?.botanica || []).length + (c.vendors?.pt || []).length + (c.vendors?.north || []).length
      setMsg({ tone: 'ok', text: `Saved — ${total} recipient${total === 1 ? '' : 's'} across all lists. Anything that didn't look like an email was dropped.` })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function sendTest() {
    setBusy('test'); setMsg(null)
    try {
      const r = await fetch('/api/cron/ops-brief?test=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error((j.results || []).map((x: any) => x.error).filter(Boolean)[0] || j.error || 'Test failed.')
      setMsg({ tone: 'ok', text: `Test sent — all three variants are in ${j.to}'s inbox.` })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function sendMaintTest() {
    setBusy('mtest'); setMsg(null)
    try {
      const r = await fetch('/api/cron/maint-brief?test=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Test failed.')
      setMsg({ tone: 'ok', text: `Test sent — both maintenance briefs are in ${j.to}'s inbox.` })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Sunrise size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Morning Ops Brief</span>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${cfg.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-app text-muted'}`}>
          {cfg.enabled ? 'Sending daily at 7am ET' : 'Off'}
        </span>
        <button onClick={save} disabled={!isOwner || busy !== null || !dirty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
      </div>

      <div className="p-4 space-y-3">
        {msg && (
          <div className={`rounded-lg border px-3 py-2 text-[12px] flex items-center gap-1.5 ${msg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {msg.tone === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}
          </div>
        )}

        <p className="text-[12px] text-muted">
          One email per market every morning: today&apos;s departure cleans and who&apos;s on them, priorities,
          units to inspect, tonight&apos;s occupancy and the 30-day review pulse. Sends from <b>{cfg.fromEmail || 'jon@stay-hospitality.com'}</b> via
          its Google connection — if the test says the Gmail permission is missing, reconnect Google from Owner Reports and approve the send-email permission.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {LISTS.map(l => (
            <div key={l.key} className={'rounded-xl border p-3 ' + (l.key === 'gm' ? 'border-brand-200 bg-brand-50/40' : 'border-line')}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-ink">{l.label}</span>
                <a href={`/api/cron/ops-brief?preview=${l.key === 'gm' ? 'GM' : l.key}`} target="_blank" rel="noreferrer"
                  className="ml-auto text-[10px] font-semibold text-brand-700 hover:underline">preview</a>
              </div>
              <div className="text-[11px] text-muted mb-1.5">{l.blurb}</div>
              <textarea rows={2} disabled={!isOwner} value={raw[l.key] ?? ''} onChange={e => setRaw(x => ({ ...x, [l.key]: e.target.value }))}
                placeholder="emails, comma separated"
                className="w-full text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {DIGESTS.map(dg => (
            <div key={dg.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-ink">{dg.label}</span>
                <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted cursor-pointer">
                  <input type="checkbox" disabled={!isOwner} checked={(cfg as any)[dg.key]?.enabled === true}
                    onChange={e => setCfg(x => ({ ...x, [dg.key]: { ...((x as any)[dg.key] || {}), enabled: e.target.checked } }))} />
                  sending
                </label>
              </div>
              <div className="text-[11px] text-muted mb-1.5">{dg.blurb}</div>
              <textarea rows={2} disabled={!isOwner} value={raw['d_' + dg.key] ?? ''} onChange={e => setRaw(x => ({ ...x, ['d_' + dg.key]: e.target.value }))}
                placeholder="emails, comma separated"
                className="w-full text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
            </div>
          ))}
        </div>

        {/* MAINTENANCE BRIEFS (Jon, 2026-08-20): one per market — task completion, carryover,
            glitches, vacant units, recurring issues, billable labor. 17 WEST excluded from both
            (its own brief comes later). */}
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-bold text-ink">Maintenance briefs · 7:46am ET</span>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted cursor-pointer">
              <input type="checkbox" disabled={!isOwner} checked={cfg.maint?.enabled !== false}
                onChange={e => setCfg(x => ({ ...x, maint: { ...(x.maint || {}), enabled: e.target.checked } }))} />
              sending
            </label>
            <button onClick={sendMaintTest} disabled={busy !== null}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-40">
              {busy === 'mtest' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send both to me
            </button>
          </div>
          <div className="text-[11px] text-muted mt-0.5 mb-1.5">
            One per market: yesterday&apos;s task completion, carryover not finished, open glitches, vacant units worth
            preventive work, recurring-issue units, and billable labor (yesterday / 7d / 30d) priced exactly like the invoices.
            17 WEST is excluded from both — it gets its own brief. Until a list is saved here, each goes to the owner alone.
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {([['m_miami', 'Miami', 'miami'], ['m_broward', 'Broward', 'broward']] as [string, string, string][]).map(([rk, label, pk]) => (
              <div key={rk}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-ink">{label}</span>
                  <a href={`/api/cron/maint-brief?preview=${pk}`} target="_blank" rel="noreferrer"
                    className="ml-auto text-[10px] font-semibold text-brand-700 hover:underline">preview</a>
                </div>
                <textarea rows={2} disabled={!isOwner} value={raw[rk] ?? ''} onChange={e => setRaw(x => ({ ...x, [rk]: e.target.value }))}
                  placeholder="emails, comma separated"
                  className="w-full text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
              </div>
            ))}
          </div>
        </div>

        {/* STAFFING PLANNER TARGET (Jon, 2026-08-18): the margin the Weekly planner's hours
            budget protects. Blank = automatic — the settled 30-day HK margin plus 3 points. */}
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-bold text-ink">Staffing planner · target margin</span>
            <input type="number" min={20} max={80} disabled={!isOwner} value={raw.lp_target ?? ''}
              onChange={e => setRaw(x => ({ ...x, lp_target: e.target.value }))}
              placeholder="auto"
              className="w-20 text-[12px] bg-app border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
            <span className="text-[12px] text-muted">% of cleaning revenue kept after housekeeper wages</span>
          </div>
          <div className="text-[11px] text-muted mt-1">
            Drives the &ldquo;Hours budget&rdquo; on the Weekly planner and the Hours plan line in the full morning brief.
            Blank = automatic: whatever housekeeping actually kept over the settled last 30 days, plus 3 points.
            The planner never recommends fewer hours than the booked cleans physically need, whatever the target.
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-1.5">Mailbox connections — every account the app sends or drafts as needs its own Google connection. Connect opens Google; sign in AS that mailbox and approve.</div>
          <div className="rounded-xl border border-line divide-y divide-line">
            {mailboxes.map(m => (
              <div key={m.email} className="flex items-center gap-2 px-3 py-2">
                <span className={'inline-block w-2 h-2 rounded-full ' + (m.connected ? 'bg-emerald-500' : 'bg-rose-400')} />
                <span className="text-[12px] font-semibold text-ink">{m.email}</span>
                <span className="text-[11px] text-muted">· {m.usedFor}</span>
                <span className={'ml-auto text-[11px] font-semibold ' + (m.connected ? 'text-emerald-700' : 'text-rose-600')}>{m.connected ? 'connected' : 'not connected'}</span>
                <a href={'/api/google/auth?mailbox=' + encodeURIComponent(m.email)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50">
                  {m.connected ? 'Reconnect' : 'Connect'}
                </a>
              </div>
            ))}
            {!mailboxes.length && <div className="px-3 py-2 text-[12px] text-muted">Loading…</div>}
          </div>
          <button onClick={loadMailboxes} className="mt-1.5 text-[11px] font-semibold text-brand-700 hover:underline">Refresh status after connecting</button>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-1.5">Vendor briefs — external cleaning companies (their buildings only: checkouts, arrivals, tomorrow. No internal data.)</div>
          <div className="grid sm:grid-cols-3 gap-3">
            {([['botanica','Botanica'],['pt','Park Towers'],['north','Capri · Lucerne · Amrit']] as ['botanica'|'pt'|'north', string][]).map(([k, label]) => (
              <div key={k} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold text-ink">{label}</span>
                  <a href={`/api/cron/ops-brief?preview=${k}`} target="_blank" rel="noreferrer" className="ml-auto text-[10px] font-semibold text-brand-700 hover:underline">preview</a>
                </div>
                <textarea rows={2} disabled={!isOwner}
                  value={raw['v_' + k] ?? ''}
                  onChange={e => setRaw(x => ({ ...x, ['v_' + k]: e.target.value }))}
                  placeholder="vendor emails, comma separated"
                  className="w-full mt-1.5 text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className={`inline-flex items-center gap-2 text-[12px] font-semibold ${isOwner ? 'cursor-pointer text-ink' : 'text-muted'}`}>
            <input type="checkbox" disabled={!isOwner} checked={cfg.enabled === true}
              onChange={e => setCfg(c => ({ ...c, enabled: e.target.checked }))} className="accent-brand-600 w-4 h-4" />
            Enabled — send every morning at 7:00 AM ET
          </label>
          <span className="flex-1" />
          <a href="/api/cron/ops-brief?preview=full" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:border-brand-300">
            <Eye size={12} /> Preview today&apos;s
          </a>
          <button onClick={sendTest} disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-brand-100 disabled:opacity-40">
            {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send test to me
          </button>
        </div>

        <p className="text-[11px] text-muted flex items-start gap-1.5">
          <Mail size={12} className="mt-0.5 flex-shrink-0" />
          Safe by default: with the switch off or a list empty, that variant goes to nobody. &ldquo;Send test to me&rdquo; only ever emails you.
        </p>
      </div>
    </div>
  )
}
