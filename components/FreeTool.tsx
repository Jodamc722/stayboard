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
import { TOOL_META, INCOME_AREAS, BED_SIZES_PUBLIC, APPLIANCE_KEYS, APPLIANCE_LABEL, money0, type ToolKey, type IncomeFull, type IncomeSummary, type InventoryFull, type InventorySummary } from '@/lib/free-tools'

type Any = any
export type ToolContact = { name?: string; role?: string; phone?: string; email?: string; photo?: string }

const DEFAULTS: Record<ToolKey, Any> = {
  income: { area: '', bedrooms: 1, bathrooms: 1, managed: false },
  inventory: { bedrooms: 2, bathrooms: 2, guests: 6, beds: { King: 1, Queen: 1 }, sleeper: false, kitchen: true, appliances: { stove: true, oven: true, microwave: true, fridge: true, dishwasher: true } },
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
  const fullRef = useRef<Any>(null)
  useEffect(() => { fullRef.current = full }, [full])
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
      // Straight to the download (Jon, 2026-11-12: "should just be a download").
      fullRef.current = d.full; pdf(d.full)
    } catch { setErr('That did not go through. Try again.') } finally { setBusy(false) }
  }
  // A REAL PDF FILE, DOWNLOADED (Jon, 2026-11-12: "should just be a download"), built with jsPDF from the
  // unlocked quote: no print dialog, so it works the same on a phone.
  async function pdf(f: Any = fullRef.current) {
    if (!f) return
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'pt', format: 'letter' })
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48
      let y = M
      const ink = [16, 17, 20] as const, mute = [107, 108, 114] as const, acc = [140, 109, 58] as const
      const ensure = (h: number) => { if (y + h > H - M - 30) { doc.addPage(); y = M } }
      try {
        const img = await fetch('/stay-logo.png').then(r => r.blob()).then(b => new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b) }))
        doc.addImage(img, 'PNG', M, y, 74, 30); y += 48
      } catch { doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('STAY HOSPITALITY', M, y + 12); y += 32 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...acc); doc.text(meta.kicker.toUpperCase(), M, y); y += 20
      doc.setFont('times', 'normal'); doc.setFontSize(26); doc.setTextColor(...ink); doc.text(meta.short, M, y); y += 22
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...mute)
      const line = (t: string, size = 10, color: readonly number[] = mute, font: [string, string] = ['helvetica', 'normal']) => {
        doc.setFont(font[0], font[1]); doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2])
        const ls = doc.splitTextToSize(t, W - M * 2); ensure(ls.length * size * 1.3); doc.text(ls, M, y); y += ls.length * size * 1.3 + 4
      }
      const row = (a: string, b: string, bold = false) => {
        ensure(18); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(...ink)
        doc.text(doc.splitTextToSize(a, W - M * 2 - 80)[0], M, y); doc.text(b, W - M, y, { align: 'right' })
        doc.setDrawColor(228, 226, 221); doc.line(M, y + 6, W - M, y + 6); y += 18
      }
      const head = (t: string) => { ensure(36); y += 10; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...acc); doc.text(t.toUpperCase(), M, y); y += 14 }
      if (tool === 'income') {
        const g = f as IncomeFull
        if (!g.found) line('We will email you a projection built for your home within 48 hours.', 12, ink)
        else {
          line('Could earn in a year, ' + g.area, 9, acc, ['helvetica', 'bold'])
          line(money0(g.lo) + ' – ' + money0(g.hi), 28, ink, ['times', 'normal'])
          head('The figures'); row('Per month, average', money0(g.monthLo) + ' – ' + money0(g.monthHi)); row('Nightly rate', money0(g.nightlyLo) + ' – ' + money0(g.nightlyHi)); row('Occupancy', g.occLo + '–' + g.occHi + '%'); row('You keep, est.', money0(g.netLo) + ' – ' + money0(g.netHi))
          head('Through the year'); g.months.forEach((m, i) => row(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][i], money0(m.lo) + ' – ' + money0(m.hi)))
          y += 6; line('Gross rental revenue for an established listing. “You keep” takes off typical booking-site fees (' + g.channelPct + '%)' + (g.mgmtPct ? ' and a ' + g.mgmtPct + '% management fee' : ', self-managed') + '. Built from ' + g.basis + ' comparable homes in Stay Hospitality’s South Florida data. Estimates, not guarantees.', 8.5)
        }
      } else {
        const g = f as InventoryFull
        line(g.describe, 10, mute)
        line((g.pieces + g.linenPieces).toLocaleString() + ' pieces: ' + g.items + ' supply items (' + g.pieces + ' pieces) and ' + g.linenPieces + ' pieces of linen at a par of ' + g.par + '.', 11, ink)
        for (const gr of g.groups) { head(gr.group); g.rows.filter(r => r.group === gr.group).forEach(r => row(r.name + (r.tier !== 'must' ? '  (' + TIER_LABEL[r.tier].toLowerCase() + ')' : ''), String(r.qty))) }
        head('Linen at par'); line(g.parText, 9)
        for (const gr of Array.from(new Set(g.linen.map(r => r.group)))) { head('Linen · ' + gr); g.linen.filter(r => r.group === gr).forEach(r => row(r.name + (r.size ? ' · ' + r.size : ''), String(r.qty))) }
      }
      const pages = doc.getNumberOfPages()
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mute)
        doc.text([contact?.name, contact?.phone, contact?.email].filter(Boolean).join('  ·  ') + '   ·   Stay Hospitality · stay-hospitality.com', M, H - 28)
        doc.text(i + ' / ' + pages, W - M, H - 28, { align: 'right' })
      }
      doc.save(meta.short.replace(/\s+/g, '-').toLowerCase() + '.pdf')
    } catch { setErr('The download did not start. Try again.') }
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
      <Seg label="Run by" value={inp.managed ? 'm' : 's'} set={v => set('managed', v === 'm')} opts={[['s', 'Myself'], ['m', 'A manager']]} />
    </>
  ) : (
    <>
      <Stepper label="Bedrooms" value={inp.bedrooms} set={v => set('bedrooms', v)} min={0} max={6} show={v => (v === 0 ? 'Studio' : String(v))} />
      <Stepper label="Bathrooms" value={inp.bathrooms} set={v => set('bathrooms', v)} min={1} max={6} step={0.5} />
      <Stepper label="Sleeps" value={inp.guests} set={v => set('guests', v)} min={1} max={16} />
      <p className="ft-sub">Beds, by size</p>
      {BED_SIZES_PUBLIC.map(x => <Stepper key={x} label={x} value={inp.beds[x] || 0} set={v => set('beds', { ...inp.beds, [x]: v })} min={0} max={6} />)}
      <Seg label="Sofa bed" value={inp.sleeper ? 'y' : 'n'} set={v => set('sleeper', v === 'y')} opts={[['n', 'No'], ['y', 'Yes']]} />
      <Seg label="Kitchen" value={inp.kitchen ? 'y' : 'n'} set={v => set('kitchen', v === 'y')} opts={[['y', 'Yes'], ['n', 'No']]} />
      {inp.kitchen ? (
        <div className="ft-apps">
          <span className="ft-lab">Appliances in the kitchen</span>
          <div>{APPLIANCE_KEYS.map(k => <button key={k} type="button" className={inp.appliances[k] ? 'on' : ''} onClick={() => set('appliances', { ...inp.appliances, [k]: !inp.appliances[k] })}>{inp.appliances[k] ? <Check size={13} /> : null}{APPLIANCE_LABEL[k]}</button>)}</div>
        </div>
      ) : null}
    </>
  )

  const headline = useMemo(() => {
    if (!summary) return <p className="ft-wait">Working it out…</p>
    if (tool === 'income') {
      const s = summary as IncomeSummary
      if (!s.found) return <div className="ft-head"><p className="ft-lab">A custom projection</p><p className="ft-note">We do not have enough figures for a {beds(s.bedrooms).toLowerCase()} home here yet. Leave your email and we will send a projection built for your home, free.</p></div>
      return (
        <div className="ft-head">
          <p className="ft-lab">Could earn in a year, {s.area}</p>
          <p className="ft-big">{money0(s.lo)} <i>–</i> {money0(s.hi)}</p>
          <p className="ft-note">About {money0(s.monthLo)} to {money0(s.monthHi)} a month, gross, once the listing is established. Based on {s.basis} comparable {beds(s.bedrooms).toLowerCase()} home{s.basis === 1 ? '' : 's'}.</p>
        </div>
      )
    }
    const s = summary as InventorySummary
    return (
      <div className="ft-head">
        <p className="ft-lab">What this home needs</p>
        <p className="ft-big">{(s.pieces + s.linenPieces).toLocaleString()} <small>pieces</small></p>
        <p className="ft-note">{s.items} supply items in {s.groups.length} sets ({s.pieces} pieces), plus {s.linenPieces} pieces of linen at a par of {s.par}.</p>
      </div>
    )
  }, [summary, tool, contact?.name])

  const quote = !full ? null : tool === 'income' ? (() => {
    const f = full as IncomeFull
    if (!f.found) return <p className="ft-note">Thank you. We will email you a projection for your home within 48 hours, free and with no obligation.</p>
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
        <p className="ft-fine">Gross rental revenue for an established listing. “You keep” takes off typical booking-site fees ({f.channelPct}%){f.mgmtPct ? <> and a {f.mgmtPct}% management fee</> : <>; self-managed, so no management fee, but cleaning, supplies and your time are yours</>}. Built from {f.basis} comparable home{f.basis === 1 ? '' : 's'} in Stay Hospitality’s South Florida data. Estimates, not guarantees.</p>
      </>
    )
  })() : (() => {
    const f = full as InventoryFull
    const lg = Array.from(new Set(f.linen.map(r => r.group)))
    return (
      <>
        <p className="ft-note">{f.describe}</p>
        {f.groups.map(g => (
          <div key={g.group} className="ft-group">
            <p className="ft-lab">{g.group}</p>
            <ul>{f.rows.filter(r => r.group === g.group).map((r, i) => <li key={i}><span>{r.name}</span><em className={'t-' + r.tier}>{TIER_LABEL[r.tier]}</em><b>{r.qty}</b></li>)}</ul>
          </div>
        ))}
        <p className="ft-sub ft-mt">Linen at par</p>
        <p className="ft-note">{f.parText}</p>
        {lg.map(g => (
          <div key={g} className="ft-group">
            <p className="ft-lab">Linen · {g}</p>
            <ul>{f.linen.filter(r => r.group === g).map((r, i) => <li key={i}><span>{r.name}{r.size ? <small> · {r.size}</small> : null}</span><em /><b>{r.qty}</b></li>)}</ul>
          </div>
        ))}
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
              <p className="ft-lab">Your email, to download</p>
              <input type="email" required placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} autoComplete="email" />
              <div className="ft-two">
                <input placeholder="Name (optional)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoComplete="name" />
                <input placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} autoComplete="tel" inputMode="tel" />
              </div>
              <input className="ft-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} aria-hidden />
              <button type="submit" disabled={busy}>{busy ? 'Preparing…' : 'Download the PDF'}</button>
              {err ? <p className="ft-err">{err}</p> : null}
              <p className="ft-fine">The PDF downloads right away. No spam, never shared, and no obligation to work with us.</p>
            </form>
          ) : (
            <button type="button" className="ft-cta" onClick={() => setGate(true)}><Download size={15} /> Download the full list, free</button>
          )
        ) : (
          <div className="ft-quote">
            <p className="ft-ok"><Check size={15} /> Your PDF is downloading. Change the details above and download again any time.</p>
            {quote}
            <div className="ft-actions">
              <button type="button" onClick={() => pdf()}><Download size={15} /> Download PDF</button>
              {tel ? <a href={'tel:' + tel}><Phone size={15} /> Questions? Call {first || 'us'}</a> : null}
              {contact?.email ? <a href={'mailto:' + contact.email + '?subject=' + encodeURIComponent(meta.short)}><Mail size={15} /> Email {first || 'us'}</a> : null}
            </div>
          </div>
        )}
        {!full && !gate ? <p className="ft-fine">Download {meta.unlock}, as a PDF.</p> : null}
      </div>
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
.ft-sub{margin:14px 0 0;font:400 20px var(--ft-display);color:var(--ft-ink)}
.ft-apps{padding:12px 0;border-bottom:1px solid var(--ft-rule)}
.ft-apps>div{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ft-apps button{display:inline-flex;align-items:center;gap:4px;height:34px;padding:0 12px;border-radius:99px;border:1px solid var(--ft-rule);background:#fff;color:var(--ft-muted);font:600 12.5px "Inter",sans-serif;cursor:pointer}
.ft-apps button.on{background:var(--ft-navy);border-color:var(--ft-navy);color:#fff}
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
@media (max-width:760px){.ft{grid-template-columns:1fr;gap:16px}.ft-big{font-size:36px}.ft-card{padding:18px 16px}}
.ft-embedded .ft-card{box-shadow:none}
`
