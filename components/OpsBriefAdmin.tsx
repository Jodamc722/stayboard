'use client'
// Admin console — MORNING OPS BRIEF. Who gets which variant, which mailbox sends it, and the
// on/off switch. Also the two buttons that make it trustworthy: Preview (see today's brief in a
// tab) and Send test (all three variants to YOUR inbox only). Nothing goes to the team until
// Enabled is on AND a list has addresses — safe by default.
import { useCallback, useEffect, useState } from 'react'
import { Sunrise, Loader2, Check, AlertTriangle, Save, Eye, Send, Mail } from 'lucide-react'

type Cfg = { enabled?: boolean; fromEmail?: string; miami?: string[]; broward?: string[]; full?: string[]; vendors?: { botanica?: string[]; pt?: string[]; north?: string[] } }

const LISTS: { key: 'miami' | 'broward' | 'full'; label: string; blurb: string }[] = [
  { key: 'miami', label: 'Miami brief', blurb: 'Miami-market cleans & priorities only' },
  { key: 'broward', label: 'Broward brief', blurb: 'Broward-market cleans & priorities only' },
  { key: 'full', label: 'Full portfolio brief', blurb: 'Everything — for leadership' },
]

export function OpsBriefAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<Cfg>({})
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/ops-brief', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) { setCfg(j.config || {}); setSaved(JSON.stringify(j.config || {})) }
    } catch { /* card stays editable with defaults */ }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = JSON.stringify(cfg) !== saved
  const listStr = (k: 'miami' | 'broward' | 'full') => (cfg[k] || []).join(', ')
  const setList = (k: 'miami' | 'broward' | 'full', v: string) =>
    setCfg(c => ({ ...c, [k]: v.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /@/.test(x)) }))

  async function save() {
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/ops-brief', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      setSaved(JSON.stringify(cfg))
      setMsg({ tone: 'ok', text: 'Saved.' })
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

        <div className="grid sm:grid-cols-3 gap-3">
          {LISTS.map(l => (
            <div key={l.key} className="rounded-xl border border-line p-3">
              <div className="text-[12px] font-bold text-ink">{l.label}</div>
              <div className="text-[11px] text-muted mb-1.5">{l.blurb}</div>
              <textarea rows={2} disabled={!isOwner} value={listStr(l.key)} onChange={e => setList(l.key, e.target.value)}
                placeholder="emails, comma separated"
                className="w-full text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
            </div>
          ))}
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
                  value={((cfg.vendors || {})[k] || []).join(', ')}
                  onChange={e => setCfg(c => ({ ...c, vendors: { ...(c.vendors || {}), [k]: e.target.value.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /@/.test(x)) } }))}
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
