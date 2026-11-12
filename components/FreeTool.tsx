'use client'
// ONE FREE TOOL, ON ITS OWN LINK (/tools/<tool>) OR INSIDE A DIGITAL MAGAZINE PAGE (Jon, 2026-11-12:
// "options we add to the magazine and shareable links, email gated before it allows them to download
// the quote; this is more of a free offering"). The home's details in; the headline out for anyone; the
// full quote, and its PDF, once an email is left. The arithmetic and the gate are on the server
// (app/api/tools), so the full list never reaches a browser that has not unlocked it.
//
// Styled from the magazine's CSS variables with Stay Modern fallbacks, so it wears the deck's theme
// inside a magazine and Stay's own look on its own page.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Lock, Download, Phone, Mail, Check } from 'lucide-react'
import { TOOL_META, INCOME_AREAS, BED_SIZES_PUBLIC, money0, type ToolKey, type IncomeFull, type IncomeSummary, type InventoryFull, type InventorySummary, type LinenFull, type LinenSummaryOut } from '@/lib/free-tools'

type Any = any
export type ToolContact = { name?: string; role?: string; phone?: string; email?: string; photo?: string }

const DEFAULTS: Record<ToolKey, Any> = {
  income: { area: '', bedrooms: 1, bathrooms: 1 },
  inventory: { bedrooms: 2, bathrooms: 2, guests: 6, kitchen: 'full' },
  linen: { beds: { King: 1, Queen: 1 }, bathrooms: 2, guests: 6, kitchen: true, sleeper: false },
}
const emph = (x: string) => x.split(/(\*[^*]+\*)/).map((s, i) => s.startsWith('*') && s.endsWith('*') ? <em key={i}>{s.slice(1, -1)}</em> : s)
const beds = (n: number) => (n === 0 ? 'Studio' : n + (n === 1 ? ' bedroom' : ' bedrooms'))
const TIER_LABEL: Record<string, string> = { must: 'Must-have', recommended: 'Recommended', suggested: 'Optional' }

function Stepper({ label, value, set, min, max, step = 1, show }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step?: number; show?: (v: number) => string }) {
  return (
    <div className="ft-step">
      <span className="ft-lab">{label}</span>
      <div>
        <button type="button" onClick={() => set(Math.max(min, value - step))} disabled={value <= min} aria-label={'Fewer ' + label.toLowerCase()}><Minus size={15} /></button>
        <b>{show ? show(value) : value}</b>
        <button type="button" onClick={() => set(Math.min(max, value + step))} disabled={value >= max} aria-label={'More ' + label.toLowerCase()}><Plus size={15} /></button>
      </div>
    </div>
  )
}
function Seg<T extends string>({ label, value, set, opts }: { label: string; value: T; set: (v: T) => void; opts: [T, string][] }) {
  return (
    <div className="ft-step">
      <span className="ft-lab">{label}</span>
      <div className="ft-seg">{opts.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}</div>
    </div>
  )
}

export function FreeTool({ tool, refCode, where, area, contact, embedded }: { tool: ToolKey; refCode?: string; where?: string; area?: string; contact?: ToolContact; embedded?: boolean }) {
  const meta = TOOL_META[tool]
  const [inp, setInp] = useState<Any>(() => ({ ...DEFAULTS[tool], ...(tool === 'income' && area ? { area } : {}) }))
  const [summary, setSummary] = useState<Any>(null)
  const [full, setFull] = useState<Any>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', phone: '', website: '' })
  const [err, setErr] = useState('')
  const [gate, setGate] = useState(false)
  const unlocked = useRef<{ email: string; name: string; phone: string } | null>(null)
  const set = (k: string, v: Any) => setInp((p: Any) => ({ ...p, [k]: v }))
  const key = JSON.stringify(inp)

  // The headline follows every change; once unlocked, the full quote follows too.
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        const u = unlocked.current
        const r = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, input: inp, ref: refCode, where, ...(u || {}) }) })
        const d = await r.json()
        if (d?.ok) { setSummary(d.summary); if (d.full) setFull(d.full) }
      } catch { /* the last good numbers stay */ }
    }, 280)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function unlock(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, input: inp, ref: refCode, where, ...form }) })
      const d = await r.json().catch(() => null)
      if (!d?.ok || !d.full) { setErr(d?.error || 'That did not go through. Try again.'); return }
      unlocked.current = { email: form.email, name: form.name, phone: form.phone }
      setFull(d.full); setSummary(d.summary); setGate(false)
    } catch { setErr('That did not go through. Try again.') } finally { setBusy(false) }
  }
  function pdf() {
    document.body.classList.add('ft-printing')
    const done = () => { document.body.classList.remove('ft-printing'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    setTimeout(() => { window.print(); setTimeout(done, 1500) }, 50)
  }

  const inputs = tool === 'income' ? (
    <>
      <div className="ft-step">
        <span className="ft-lab">Neighborhood</span>
        <select value={inp.area} onChange={e => set('area', e.target.value)}>
          <option value="">South Florida, any</option>
          {Array.from(new Set([area, ...INCOME_AREAS].filter(Boolean) as string[])).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <Stepper label="Bedrooms" value={inp.bedrooms} set={v => set('bedrooms', v)} min={0} max={5} show={v => (v === 0 ? 'Studio' : String(v))} />
      <Stepper label="Bathrooms" value={inp.bathrooms} set={v => set('bathrooms', v)} min={1} max={5} step={0.5} />
    </>
  ) : tool === 'inventory' ? (
    <>
      <Stepper label="Bedrooms" value={inp.bedrooms} set={v => set('bedrooms', v)} min={0} max={6} show={v => (v === 0 ? 'Studio' : String(v))} />
      <Stepper label="Bathrooms" value={inp.bathrooms} set={v => set('bathrooms', v)} min={1} max={6} step={0.5} />
      <Stepper label="Sleeps" value={inp.guests} set={v => set('guests', v)} min={1} max={16} />
      <Seg label="Kitchen" value={inp.kitchen} set={v => set('kitchen', v)} opts={[['full', 'Full'], ['kitchenette', 'Kitchenette'], ['none', 'None']]} />
    </>
  ) : (
    <>
      {BED_SIZES_PUBLIC.map(s => <Stepper key={s} label={s + ' beds'} value={inp.beds[s] || 0} set={v => set('beds', { ...inp.beds, [s]: v })} min={0} max={6} />)}
      <Stepper label="Bathrooms" value={inp.bathrooms} set={v => set('bathrooms', v)} min={1} max={6} step={0.5} />
      <Stepper label="Sleeps" value={inp.guests} set={v => set('guests', v)} min={1} max={16} />
      <Seg label="Sofa bed" value={inp.sleeper ? 'y' : 'n'} set={v => set('sleeper', v === 'y')} opts={[['n', 'No'], ['y', 'Yes']]} />
      <Seg label="Kitchen" value={inp.kitchen ? 'y' : 'n'} set={v => set('kitchen', v === 'y')} opts={[['y', 'Yes'], ['n', 'No']]} />
    </>
  )

  const headline = useMemo(() => {
    if (!summary) return <p className="ft-wait">Working it out…</p>
    if (tool === 'income') {
      const s = summary as IncomeSummary
      if (!s.found) return <div className="ft-head"><p className="ft-lab">A custom projection</p><p className="ft-note">We have not published figures for a {beds(s.bedrooms).toLowerCase()} home here yet. Leave your email and {contact?.name?.split(' ')[0] || 'our team'} will send one built for your home.</p></div>
      return (
        <div className="ft-head">
          <p className="ft-lab">Could earn in a year, {s.area}</p>
          <p className="ft-big">{money0(s.lo)} <i>–</i> {money0(s.hi)}</p>
          <p className="ft-note">About {money0(s.monthLo)} to {money0(s.monthHi)} a month, gross, once the listing is established. From {s.basis} Stay projection{s.basis === 1 ? '' : 's'} for {beds(s.bedrooms).toLowerCase()} homes.</p>
        </div>
      )
    }
    if (tool === 'inventory') {
      const s = summary as InventorySummary
      return (
        <div className="ft-head">
          <p className="ft-lab">What this home needs</p>
          <p className="ft-big">{s.pieces.toLocaleString()} <small>pieces</small></p>
          <p className="ft-note">{s.items} items in {s.groups.length} sets: {s.must} must-have, {s.recommended} recommended{s.suggested ? ', ' + s.suggested + ' optional' : ''}.</p>
        </div>
      )
    }
    const s = summary as LinenSummaryOut
    return (
      <div className="ft-head">
        <p className="ft-lab">Linen at par, {s.par} sets in rotation</p>
        <p className="ft-big">{s.pieces.toLocaleString()} <small>pieces</small></p>
        <p className="ft-note">{s.groups.map(g => g.pieces + ' ' + g.group.toLowerCase()).join(' · ')}</p>
      </div>
    )
  }, [summary, tool, contact?.name])

  const quote = !full ? null : tool === 'income' ? (() => {
    const f = full as IncomeFull
    if (!f.found) return <p className="ft-note">Thank you. {contact?.name?.split(' ')[0] || 'Our team'} will send a projection for your home within 48 hours.</p>
    const mx = Math.max(1, ...f.months.map(m => m.hi))
    return (
      <>
        <dl className="ft-figs">
          <div><dt>Per month, average</dt><dd>{money0(f.monthLo)}–{money0(f.monthHi).slice(1)}</dd></div>
          <div><dt>Nightly rate</dt><dd>{money0(f.nightlyLo)}–{money0(f.nightlyHi).slice(1)}</dd></div>
          <div><dt>Occupancy</dt><dd>{f.occLo}–{f.occHi}%</dd></div>
          <div><dt>You keep, est.</dt><dd>{money0(f.netLo)}–{money0(f.netHi).slice(1)}</dd></div>
        </dl>
        <p className="ft-lab ft-mt">Through the year, high end</p>
        <div className="ft-bars">{f.months.map((m, i) => <span key={i} title={money0(m.lo) + '–' + money0(m.hi)}><i style={{ height: (m.hi / mx * 100) + '%' }}><b style={{ height: (m.lo / m.hi * 100) + '%' }} /></i><em>{'JFMAMJJASOND'[i]}</em></span>)}</div>
        <p className="ft-fine">Gross rental revenue for an established listing, before channel fees ({f.channelPct}%) and Stay’s management fee ({f.mgmtPct}%); “you keep” takes both off. Built from {f.basis} Stay projection{f.basis === 1 ? '' : 's'} and comparables. Estimates, not guarantees; every home is priced on its own.</p>
      </>
    )
  })() : tool === 'inventory' ? (() => {
    const f = full as InventoryFull
    return (
      <>
        <p className="ft-note">{f.describe}</p>
        {f.groups.map(g => (
          <div key={g.group} className="ft-group">
            <p className="ft-lab">{g.group}</p>
            <ul>{f.rows.filter(r => r.group === g.group).map((r, i) => <li key={i}><span>{r.name}</span><em className={'t-' + r.tier}>{TIER_LABEL[r.tier]}</em><b>{r.qty}</b></li>)}</ul>
          </div>
        ))}
      </>
    )
  })() : (() => {
    const f = full as LinenFull
    const groups = Array.from(new Set(f.rows.map(r => r.group)))
    return (
      <>
        <p className="ft-note">{f.parText}</p>
        {groups.map(g => (
          <div key={g} className="ft-group">
            <p className="ft-lab">{g}</p>
            <ul>{f.rows.filter(r => r.group === g).map((r, i) => <li key={i}><span>{r.name}{r.size ? <small> · {r.size}</small> : null}</span><b>{r.qty}</b></li>)}</ul>
          </div>
        ))}
        <p className="ft-fine">For the homes we manage, Stay selects and supplies the linen to this standard.</p>
      </>
    )
  })()

  const first = contact?.name?.split(' ')[0]
  const tel = (contact?.phone || '').replace(/[^\d+]/g, '')
  return (
    <div className={'ft' + (embedded ? ' ft-embedded' : '')}>
      <style>{FT_CSS}</style>
      <div className="ft-inputs">{inputs}</div>
      <div className="ft-card">
        {headline}
        {!full ? (
          gate ? (
            <form className="ft-gate" onSubmit={unlock}>
              <p className="ft-lab">Where should we send it?</p>
              <input type="email" required placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} autoComplete="email" />
              <div className="ft-two">
                <input placeholder="Name (optional)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoComplete="name" />
                <input placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} autoComplete="tel" inputMode="tel" />
              </div>
              <input className="ft-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} aria-hidden />
              <button type="submit" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock the full quote'}</button>
              {err ? <p className="ft-err">{err}</p> : null}
              <p className="ft-fine">We use it to send this quote and to follow up once. No spam, and we never share it.</p>
            </form>
          ) : (
            <button type="button" className="ft-cta" onClick={() => setGate(true)}><Lock size={15} /> Get the full quote, free</button>
          )
        ) : (
          <div className="ft-quote">
            <p className="ft-ok"><Check size={15} /> Unlocked. This quote updates as you change the details above.</p>
            {quote}
            <div className="ft-actions">
              <button type="button" onClick={pdf}><Download size={15} /> Download PDF</button>
              {tel ? <a href={'tel:' + tel}><Phone size={15} /> Call {first || 'us'}</a> : null}
              {contact?.email ? <a href={'mailto:' + contact.email + '?subject=' + encodeURIComponent(meta.short + (where ? ' · ' + where : ''))}><Mail size={15} /> Email {first || 'us'}</a> : null}
            </div>
          </div>
        )}
        {!full && !gate ? <p className="ft-fine">Unlock {meta.unlock}, and download it as a PDF.</p> : null}
      </div>
      {/* What prints: the quote alone, branded (see pdf()). */}
      {full ? (
        <div className="ft-print" aria-hidden>
          <img src="/stay-logo.png" alt="Stay Hospitality" style={{ height: 34 }} />
          <h1>{meta.short}{where ? ' · ' + where : ''}</h1>
          {headline}
          {quote}
          <p className="ft-fine">{contact?.name ? contact.name + (contact.role ? ', ' + contact.role : '') + ' · ' : ''}{[contact?.phone, contact?.email].filter(Boolean).join(' · ')}{contact?.name ? ' · ' : ''}Stay Hospitality · stay-hospitality.com</p>
        </div>
      ) : null}
    </div>
  )
}

const FT_CSS = `
.ft{--ft-ink:var(--mz-ink,#101114);--ft-body:var(--mz-body,#3A3B40);--ft-muted:var(--mz-muted,#6B6C72);--ft-rule:var(--mz-grid,#E4E2DD);--ft-acc:var(--mz-glow,#8C6D3A);--ft-navy:var(--mz-navy,#14161B);--ft-soft:var(--mz-warm,#F3F2EF);--ft-display:var(--mz-display,"Instrument Serif",Georgia,serif);
  display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);gap:28px;font-family:"Inter",system-ui,sans-serif;color:var(--ft-body)}
.ft em{font-style:italic}
.ft-inputs{display:grid;gap:2px;align-content:start}
.ft-step{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--ft-rule)}
.ft-step>div{display:flex;align-items:center;gap:10px}
.ft-step button{width:34px;height:34px;border-radius:99px;border:1px solid var(--ft-rule);background:#fff;color:var(--ft-ink);display:grid;place-items:center;cursor:pointer}
.ft-step button:disabled{opacity:.35;cursor:default}
.ft-step b{min-width:52px;text-align:center;font:400 22px var(--ft-display);color:var(--ft-ink);font-variant-numeric:lining-nums}
.ft-step select{font:500 14px "Inter",sans-serif;border:1px solid var(--ft-rule);border-radius:10px;padding:8px 10px;background:#fff;color:var(--ft-ink);max-width:60%}
.ft-seg{display:inline-flex;background:var(--ft-soft);border-radius:99px;padding:3px}
.ft-seg button{width:auto!important;height:30px!important;border:0!important;padding:0 12px;background:transparent!important;font:600 12.5px "Inter",sans-serif;color:var(--ft-muted)!important}
.ft-seg button.on{background:#fff!important;color:var(--ft-ink)!important;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ft-lab{font:600 10px "Inter",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--ft-muted);margin:0}
.ft-card{background:#fff;border:1px solid var(--ft-rule);border-radius:16px;padding:22px 22px 18px;align-self:start;min-width:0}
.ft-head .ft-lab{color:var(--ft-acc)}
.ft-big{font:400 42px/1.05 var(--ft-display);color:var(--ft-ink);margin:10px 0 0;letter-spacing:-.01em;font-variant-numeric:lining-nums}
.ft-big i{font-style:normal;color:var(--ft-muted)} .ft-big small{font:500 14px "Inter",sans-serif;color:var(--ft-muted)}
.ft-note{font:400 14px/1.55 "Inter",sans-serif;margin:10px 0 0;color:var(--ft-body)}
.ft-wait{color:var(--ft-muted);font-size:14px}
.ft-cta,.ft-gate button[type=submit]{margin-top:18px;width:100%;height:48px;border:0;border-radius:99px;background:var(--ft-navy);color:#fff;font:600 14.5px "Inter",sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
.ft-gate{margin-top:16px;padding-top:16px;border-top:1px solid var(--ft-rule);display:grid;gap:8px}
.ft-gate input{font:500 15px "Inter",sans-serif;border:1px solid var(--ft-rule);border-radius:10px;padding:11px 12px;color:var(--ft-ink);background:#fff;min-width:0;width:100%;box-sizing:border-box}
.ft-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ft-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0}
.ft-err{color:#A1332B;font-size:13px;margin:0}
.ft-fine{font:400 11.5px/1.5 "Inter",sans-serif;color:var(--ft-muted);margin:12px 0 0}
.ft-quote{margin-top:16px;padding-top:14px;border-top:1px solid var(--ft-rule)}
.ft-ok{display:flex;gap:6px;align-items:center;font:600 12.5px "Inter",sans-serif;color:#2F6B47;margin:0 0 12px}
.ft-figs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px;margin:0}
.ft-figs dt{font:600 9.5px "Inter",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--ft-muted)}
.ft-figs dd{margin:4px 0 0;font:400 22px var(--ft-display);color:var(--ft-ink);font-variant-numeric:lining-nums}
.ft-mt{margin-top:18px}
.ft-bars{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;height:110px;margin-top:10px;align-items:end}
.ft-bars span{display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:4px}
.ft-bars i{display:flex;flex-direction:column;justify-content:flex-end;width:100%;max-width:18px;background:color-mix(in srgb,var(--ft-navy) 25%,transparent);border-radius:3px 3px 0 0}
.ft-bars b{display:block;background:var(--ft-navy);border-radius:3px 3px 0 0}
.ft-bars em{font:600 9px "Inter",sans-serif;font-style:normal;color:var(--ft-muted)}
.ft-group{margin-top:16px}
.ft-group ul{list-style:none;margin:6px 0 0;padding:0}
.ft-group li{display:grid;grid-template-columns:1fr auto 36px;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--ft-rule);font-size:13.5px;color:var(--ft-ink)}
.ft-group li small{color:var(--ft-muted)}
.ft-group li b{text-align:right;font:400 17px var(--ft-display);font-variant-numeric:lining-nums}
.ft-group li em{font:600 9.5px "Inter",sans-serif;font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:var(--ft-muted)}
.ft-group li em.t-must{color:var(--ft-acc)}
.ft-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.ft-actions button,.ft-actions a{display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 16px;border-radius:99px;font:600 13px "Inter",sans-serif;text-decoration:none;cursor:pointer;border:1px solid var(--ft-rule);background:#fff;color:var(--ft-ink)}
.ft-actions button{background:var(--ft-navy);color:#fff;border-color:var(--ft-navy)}
.ft-print{display:none}
@media (max-width:760px){.ft{grid-template-columns:1fr;gap:16px}.ft-big{font-size:36px}.ft-card{padding:18px 16px}}
.ft-embedded .ft-card{box-shadow:none}
@media print{
  body.ft-printing *{visibility:hidden!important}
  body.ft-printing .ft-print,body.ft-printing .ft-print *{visibility:visible!important}
  body.ft-printing .ft-print{display:block!important;position:absolute;left:0;top:0;width:100%;padding:24px 32px;font-family:"Inter",sans-serif;color:#101114}
  body.ft-printing .ft-print h1{font:400 30px "Instrument Serif",Georgia,serif;margin:18px 0 6px}
  body.ft-printing .ft-print .ft-group li{break-inside:avoid}
}
`
