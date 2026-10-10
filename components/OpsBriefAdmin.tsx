'use client'
// Admin console — MORNING OPS BRIEF. Who gets which variant, which mailbox sends it, and the
// on/off switch. Also the two buttons that make it trustworthy: Preview (see today's brief in a
// tab) and Send test (all three variants to YOUR inbox only). Nothing goes to the team until
// Enabled is on AND a list has addresses — safe by default.
import { useCallback, useEffect, useState } from 'react'
import { Sunrise, Loader2, Check, AlertTriangle, Save, Eye, Send, Mail } from 'lucide-react'

type Digest = { enabled?: boolean; to?: string[]; fromEmail?: string }
// The retired maintenance briefs' `maint` block (2026-09-09) is no longer edited on this card.
// Whatever is stored rides back through `...cfg` unchanged on save, so nothing is lost.
type TechCfg = { to: string[]; lang?: string }
type Cfg = { enabled?: boolean; fromEmail?: string; miami?: string[]; broward?: string[]; full?: string[]; gm?: string[]; maint?: string[]; techs?: Record<string, TechCfg>; vendors?: { botanica?: string[]; pt?: string[]; north?: string[] }; trueup?: Digest; salato?: Digest; eod?: Digest; laborPlan?: { targetMarginPct?: number | null }
  // THE CREW'S LANGUAGE (Jon, 2026-08-25). Field day sheets only —
  // Ops Command and the GM brief are management documents and stay English.
  lang?: { miami?: string; broward?: string } }

// The two other daily emails, editable on the same card (Jon, 2026-08-17). Each has its own
// on/off, its own recipient list, and sends from the ops-brief mailbox unless overridden.
const DIGESTS: { key: 'trueup' | 'salato' | 'eod'; label: string; blurb: string }[] = [
  { key: 'trueup', label: 'Labor Scorecard · 7:58am ET', blurb: 'Four numbers against their goals, what moved this week, who the numbers cannot see, and whether they can be trusted. The full three tiers live on the Labor board. Goes to the owner until a list is saved; skips the day rather than send on partial payroll.' },
  { key: 'salato', label: 'Salato front desk · 7:16am ET', blurb: 'Reservations only: arriving, departing, in-house, upcoming — hotel-related flags highlighted.' },
  { key: 'eod', label: 'End-of-day recap · evening', blurb: 'Cleans done, revenue, hours and HK profit for the day, tomorrow in one line, the week so far. Goes to the Ops Command list (and the owner) until a list is saved here. Unchecked = off; the forecast ledger still records.' },
]

// Four audiences, deliberately different documents (2026-08-07). The blurb is the promise each
// one makes — if a brief stops matching its blurb, one of the two is wrong.
const LISTS: { key: 'miami' | 'broward' | 'full' | 'gm'; label: string; blurb: string }[] = [
  { key: 'miami', label: 'Field Run · Miami', blurb: 'The field coordinator: do first, the run per cleaner, the shape of the day. One screen.' },
  { key: 'broward', label: 'Field Run · Broward', blurb: 'Same, for the Broward coordinator' },
  { key: 'full', label: 'Ops Desk · manager', blurb: 'Unblock today, the markets at a glance, free trips, maintenance in three lines, paperwork in two' },
  { key: 'gm', label: 'GM Brief · owner', blurb: 'Decide today, the blocks work can reopen, the tiles, guests & risk' },
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
  // THE MAINTENANCE RUN — one row per technician: the name as Breezeway spells it, addresses, language.
  const [techRows, setTechRows] = useState<{ name: string; to: string; lang: string }[]>([])
  const [techNames, setTechNames] = useState<string[]>([])
  const techsFromCfg = (c: Cfg) => Object.keys(c.techs || {}).map(n => ({ name: n, to: (c.techs![n].to || []).join(', '), lang: c.techs![n].lang === 'es' ? 'es' : 'en' }))
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const rawFromCfg = (c: Cfg): Record<string, string> => ({
    miami: (c.miami || []).join(', '), broward: (c.broward || []).join(', '), full: (c.full || []).join(', '), gm: (c.gm || []).join(', '),
    maint: (c.maint || []).join(', '),
    v_botanica: (c.vendors?.botanica || []).join(', '), v_pt: (c.vendors?.pt || []).join(', '), v_north: (c.vendors?.north || []).join(', '),
    d_trueup: (c.trueup?.to || []).join(', '), d_salato: (c.salato?.to || []).join(', '), d_eod: (c.eod?.to || []).join(', '),
    lp_target: c.laborPlan?.targetMarginPct != null ? String(c.laborPlan.targetMarginPct) : '',
  })
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/ops-brief', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) {
        const c = j.config || {}
        setCfg(c); setTechRows(techsFromCfg(c)); const rw = rawFromCfg(c); setRaw(rw); setSaved(JSON.stringify({ rw, enabled: c.enabled === true, dt: c.trueup?.enabled === true, ds: c.salato?.enabled === true, de: c.eod?.enabled !== false, lg: JSON.stringify([c.lang?.miami, c.lang?.broward]) }))
      }
    } catch { /* card stays editable with defaults */ }
  }, [])
  useEffect(() => { load(); loadMailboxes() }, [load, loadMailboxes])

  const langSig = JSON.stringify([cfg.lang?.miami, cfg.lang?.broward])
  // One control per market day sheet. English stays the default everywhere, so nothing changes for
  // anyone until somebody chooses.
  const langPick = (value: string | undefined, onPick: (v: string) => void) => (
    <select value={value || 'en'} onChange={e => onPick(e.target.value)} disabled={!isOwner}
      className="text-[11.5px] bg-app border border-line rounded-lg px-1.5 py-1 disabled:opacity-60">
      <option value="en">English</option>
      <option value="es">Español</option>
    </select>
  )

  const dirty = JSON.stringify({ rw: raw, enabled: cfg.enabled === true, dt: cfg.trueup?.enabled === true, ds: cfg.salato?.enabled === true, de: cfg.eod?.enabled !== false, lg: langSig }) !== saved
  const parse = (v: string) => v.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))

  async function save() {
    setBusy('save'); setMsg(null)
    try {
      const config: Cfg = {
        ...cfg,
        miami: parse(raw.miami || ''), broward: parse(raw.broward || ''), full: parse(raw.full || ''), gm: parse(raw.gm || ''),
        maint: parse(raw.maint || ''),
        techs: Object.fromEntries(techRows.filter(t => t.name.trim()).map(t => [t.name.trim(), { to: parse(t.to), lang: t.lang }])),
        vendors: { botanica: parse(raw.v_botanica || ''), pt: parse(raw.v_pt || ''), north: parse(raw.v_north || '') },
        trueup: { ...(cfg.trueup || {}), to: parse(raw.d_trueup || '') },
        salato: { ...(cfg.salato || {}), to: parse(raw.d_salato || '') },
        eod: { enabled: cfg.eod ? cfg.eod.enabled !== false : true, ...(cfg.eod || {}), to: parse(raw.d_eod || '') },
        laborPlan: (() => {
          const t = (raw.lp_target || '').trim()
          const n = Number(t)
          return { targetMarginPct: t && Number.isFinite(n) ? n : null }
        })(),
        lang: { miami: cfg.lang?.miami || 'en', broward: cfg.lang?.broward || 'en' },
      }
      const r = await fetch('/api/settings/ops-brief', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      const c = j.config || config
      setCfg(c); setTechRows(techsFromCfg(c)); const rw = rawFromCfg(c); setRaw(rw); setSaved(JSON.stringify({ rw, enabled: c.enabled === true, dt: c.trueup?.enabled === true, ds: c.salato?.enabled === true, de: c.eod?.enabled !== false, lg: JSON.stringify([c.lang?.miami, c.lang?.broward]) }))
      const total = (c.miami || []).length + (c.broward || []).length + (c.full || []).length + (c.gm || []).length + (c.maint || []).length + (Object.values(c.techs || {}) as TechCfg[]).reduce((a: number, t) => a + (t.to || []).length, 0)
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

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Sunrise size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Briefs — the Morning System</span>
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
          One role, one email (2026-10-01): the field coordinator gets the Field Run, the operations manager the Ops Desk,
          each technician his Maintenance Run, the owner the GM Brief, and labor lives only in the Labor Scorecard (7:58).
          Roberto is copied on all of them.
          Sends from <b>{cfg.fromEmail || 'jon@stay-hospitality.com'}</b> via its Google connection — if a test says the
          Gmail permission is missing, reconnect Google from Owner Reports and approve the send-email permission.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {LISTS.map(l => (
            <div key={l.key} className={'rounded-xl border p-3 ' + (l.key === 'gm' ? 'border-brand-200 bg-brand-50/40' : 'border-line')}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-ink">{l.label}</span>
                {(l.key === 'miami' || l.key === 'broward') && langPick(
                  l.key === 'miami' ? cfg.lang?.miami : cfg.lang?.broward,
                  v => setCfg(c => ({ ...c, lang: { ...(c.lang || {}), [l.key]: v } })))}
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

        {/* MAINTENANCE RUN (Jon, 2026-10-01): one email per technician, in his language. */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-bold text-ink">Maintenance Run · one email per technician</span>
            <button type="button" onClick={async () => { try { const r = await fetch('/api/cron/ops-brief?preview=techs', { cache: 'no-store' }); const j = await r.json(); setTechNames(Array.isArray(j.techs) ? j.techs : []) } catch { setTechNames([]) } }}
              className="text-[10px] font-semibold text-brand-700 hover:underline">who is on the board today?</button>
            <a href="/api/cron/ops-brief?preview=maint" target="_blank" rel="noreferrer" className="ml-auto text-[10px] font-semibold text-brand-700 hover:underline">preview combined</a>
          </div>
          <div className="text-[11px] text-muted mb-1.5">Each technician gets only his own ordered list (urgent → empty units → arrivals → occupied, call first → building), in English or Spanish. The combined run goes to the addresses below (Roberto).</div>
          {techNames.length > 0 && <div className="text-[11px] text-muted mb-1.5">On the board today: {techNames.map(n => <button key={n} type="button" disabled={!isOwner || techRows.some(t => t.name === n)} onClick={() => setTechRows(x => x.concat([{ name: n, to: '', lang: 'en' }]))} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded border border-line bg-white text-[11px] disabled:opacity-50">{n} +</button>)}</div>}
          {techRows.map((t, i) => (
            <div key={i} className="grid sm:grid-cols-[1fr_2fr_auto_auto] gap-2 items-center mb-1.5">
              <input disabled={!isOwner} value={t.name} onChange={e => setTechRows(x => x.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} placeholder="Name as Breezeway spells it"
                className="text-[12px] bg-app border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
              <input disabled={!isOwner} value={t.to} onChange={e => setTechRows(x => x.map((r, j) => j === i ? { ...r, to: e.target.value } : r))} placeholder="emails, comma separated"
                className="text-[12px] bg-app border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
              {langPick(t.lang, v => setTechRows(x => x.map((r, j) => j === i ? { ...r, lang: v } : r)))}
              <div className="flex items-center gap-2">
                <a href={`/api/cron/ops-brief?preview=maint:${encodeURIComponent(t.name)}&lang=${t.lang}`} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-brand-700 hover:underline">preview</a>
                <button type="button" disabled={!isOwner} onClick={() => setTechRows(x => x.filter((_, j) => j !== i))} className="text-[10px] text-muted hover:text-rose-600">remove</button>
              </div>
            </div>
          ))}
          <button type="button" disabled={!isOwner} onClick={() => setTechRows(x => x.concat([{ name: '', to: '', lang: 'en' }]))} className="text-[11px] font-semibold text-brand-700 hover:underline disabled:opacity-50">+ add a technician</button>
          <div className="mt-2">
            <div className="text-[11px] font-semibold text-ink mb-1">Combined run (every technician) — the ops manager</div>
            <textarea rows={1} disabled={!isOwner} value={raw.maint ?? ''} onChange={e => setRaw(x => ({ ...x, maint: e.target.value }))} placeholder="emails, comma separated"
              className="w-full text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {DIGESTS.map(dg => (
            <div key={dg.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-ink">{dg.label}</span>
                <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted cursor-pointer">
                  <input type="checkbox" disabled={!isOwner} checked={dg.key === 'eod' ? (cfg as any).eod?.enabled !== false : (cfg as any)[dg.key]?.enabled === true}
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
              // A full mailbox address plus what it is used for plus the status plus Connect does
              // not fit on one phone line; Connect was the part that disappeared.
              <div key={m.email} className="flex items-center gap-2 gap-y-1 flex-wrap px-3 py-2">
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
