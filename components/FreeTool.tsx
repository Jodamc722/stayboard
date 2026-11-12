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
import { TOOL_META, PARTNER_NOTE, BED_SIZES_PUBLIC, APPLIANCE_KEYS, APPLIANCE_LABEL, money0, type ToolKey, type IncomeFull, type IncomeSummary, type InventoryFull, type InventorySummary } from '@/lib/free-tools'

type Any = any
export type ToolContact = { name?: string; role?: string; phone?: string; email?: string; photo?: string }

const DEFAULTS: Record<ToolKey, Any> = {
  income: { building: '', libId: '', address: '', area: '', bedrooms: 1, bathrooms: 1, sqft: 0, kitchen: 'full', balcony: false, view: 'none', amenities: [], managed: false },
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

function BuildingSearch({ value, onPick, onType }: { value: Any; onPick: (h: Any) => void; onType: (v: string) => void }) {
  const [hits, setHits] = useState<Any[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const q = String(value.building || '')
    if (q.length < 2 || value.libId || value.lat != null) { setHits([]); return }
    const id = setTimeout(() => fetch('/api/tools/buildings?q=' + encodeURIComponent(q)).then(r => r.json()).then(d => { setHits(d?.buildings || []); setOpen(true) }).catch(() => {}), 220)
    return () => clearTimeout(id)
  }, [value.building, value.libId, value.lat])
  return (
    <div className="ft-field ft-search">
      <span className="ft-lab">Building</span>
      <input value={value.building} placeholder="Search a building, e.g. Elser" onChange={e => onType(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} autoComplete="off" />
      {open && hits.length ? (
        <ul className="ft-hits">{hits.map(h => (
          <li key={h.key}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(h); setOpen(false) }}>
            <b>{h.name}</b><span>{[h.address, h.area].filter(Boolean).join(' · ') || 'Address not on file'}</span>{h.projections ? <em>Our projections</em> : null}
          </button></li>
        ))}</ul>
      ) : null}
      {value.libId ? <p className="ft-hint">We hold projections for this building; the estimate starts from them.</p> : null}
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
  const [fmt, setFmt] = useState<'pdf' | 'xlsx'>(tool === 'inventory' ? 'xlsx' : 'pdf')
  const unlocked = useRef<{ email: string; name: string; phone: string } | null>(null)
  const set = (k: string, v: Any) => setInp((p: Any) => ({ ...p, [k]: v }))
  const [opts, setOpts] = useState<Any>(null)
  useEffect(() => { if (tool === 'income') fetch('/api/tools/options').then(r => r.json()).then(d => d?.ok && setOpts(d)).catch(() => {}) }, [tool])
  const key = JSON.stringify(inp)

  // The headline follows every change; once unlocked, the full quote follows too.
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        const u = unlocked.current
        const r = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, input: inp, ref: refCode, where, ...(u || {}), ...(u ? { refresh: true } : {}) }) })
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
      fullRef.current = d.full
      if (tool === 'income') { /* the projection shows on the page; the PDF is a button under it */ }
      else if (fmt === 'xlsx') xlsx(form.email); else pdf(d.full)
    } catch { setErr('That did not go through. Try again.') } finally { setBusy(false) }
  }
  // THE EXCEL CHECKLIST (supply calculator only): counts, a Bought and an In-the-home tick column, notes.
  async function xlsx(email = unlocked.current?.email || '') {
    try {
      const r = await fetch('/api/tools/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: inp, email }) })
      if (!r.ok) { setErr('The download did not start. Try again.'); return }
      const blob = await r.blob(), url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'rental-supply-checklist.xlsx'; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { setErr('The download did not start. Try again.') }
  }
  // A REAL PDF FILE, DOWNLOADED (Jon, 2026-11-12: "should just be a download"; "looks bad" → the designed
  // layout in lib/free-tool-pdf). No print dialog, so it works the same on a phone.
  async function pdf(f: Any = fullRef.current) {
    if (!f) return
    try {
      const { toolPdf } = await import('@/lib/free-tool-pdf')
      await toolPdf({ tool, full: f, title: tool === 'income' ? 'Your rental projection' : 'Everything your rental needs', kicker: meta.short, contact: contact || undefined, estimateNote: tool === 'income' ? (f as Any).note : undefined, subtitle: tool === 'income' ? [inp.building, inp.address].filter(Boolean).join(' · ') : undefined,
        file: (tool === 'income' ? 'rental-projection' : 'rental-supply-list') + '.pdf' })
    } catch { setErr('The download did not start. Try again.') }
  }

  const inputs = tool === 'income' ? (
    <>
      <BuildingSearch value={inp} onPick={h => setInp((p: Any) => ({ ...p, building: h.name, libId: h.libId || '', address: h.address || p.address, area: h.area || p.area, lat: h.lat ?? undefined, lng: h.lng ?? undefined }))}
        onType={v => setInp((p: Any) => ({ ...p, building: v, libId: '', lat: undefined, lng: undefined }))} />
      <div className="ft-field"><span className="ft-lab">Address</span><input value={inp.address} placeholder="Street address, city" onChange={e => setInp((p: Any) => ({ ...p, address: e.target.value, lat: undefined, lng: undefined }))} autoComplete="street-address" /></div>
      <Stepper label="Bedrooms" value={inp.bedrooms} set={v => set('bedrooms', v)} min={0} max={5} show={v => (v === 0 ? 'Studio' : String(v))} />
      <Stepper label="Bathrooms" value={inp.bathrooms} set={v => set('bathrooms', v)} min={1} max={5} step={0.5} />
      <div className="ft-field"><span className="ft-lab">Square feet</span><input inputMode="numeric" value={inp.sqft || ''} placeholder="e.g. 850" onChange={e => set('sqft', Number(e.target.value.replace(/\D/g, '')) || 0)} /></div>
      <Seg label="Kitchen" value={inp.kitchen} set={v => set('kitchen', v)} opts={[['full', 'Full'], ['kitchenette', 'Kitchenette'], ['none', 'None']]} />
      <Seg label="Balcony" value={inp.balcony ? 'y' : 'n'} set={v => set('balcony', v === 'y')} opts={[['n', 'No'], ['y', 'Yes']]} />
      <div className="ft-field"><span className="ft-lab">View</span>
        <select value={inp.view} onChange={e => set('view', e.target.value)}>{(opts?.views || [{ key: 'none', label: 'No particular view' }, { key: 'city', label: 'City view' }, { key: 'water', label: 'Bay or water view' }, { key: 'ocean', label: 'Ocean view' }, { key: 'beachfront', label: 'Beachfront' }]).map((v: Any) => <option key={v.key} value={v.key}>{v.label}</option>)}</select>
      </div>
      {opts?.amenities?.length ? (
        <div className="ft-apps">
          <span className="ft-lab">Amenities</span>
          <div>{opts.amenities.map((am: Any) => { const on = inp.amenities.includes(am.key); return <button key={am.key} type="button" className={on ? 'on' : ''} onClick={() => set('amenities', on ? inp.amenities.filter((x: string) => x !== am.key) : [...inp.amenities, am.key])}>{on ? <Check size={13} /> : null}{am.label}</button> })}</div>
        </div>
      ) : null}
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
      // No numbers before the email (Jon: "should not just give it to them, gated once they fill out the info").
      return (
        <div className="ft-head">
          <p className="ft-lab">Your projection is ready to build</p>
          <p className="ft-note">{s.found ? <>From {s.basisLabel}, adjusted for the size, view, kitchen, balcony, amenities and how far the home is from the beach.</> : <>We do not have enough figures for this home yet. Leave your email and we will build a projection for it, free.</>}</p>
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
    if (!f.found) return <><p className="ft-note">Thank you. We will email you a projection built for your home within 48 hours, free and with no obligation.</p><div className="ft-notes"><p className="ft-lab">This is an estimate</p><p>{f.note}</p></div></>
    const mx = Math.max(1, ...f.months.map(m => m.hi))
    return (
      <>
        <p className="ft-lab ft-acc">Could earn in a year{f.area ? ', ' + f.area : ''}</p>
        <p className="ft-big">{money0(f.lo)} <i>–</i> {money0(f.hi)}</p>
        <p className="ft-note">Gross rental revenue once the listing is established. From {f.basisLabel}, adjusted for the details you gave.</p>
        <dl className="ft-figs ft-mt">
          <div><dt>Per month, average</dt><dd>{money0(f.monthLo)}–{money0(f.monthHi).slice(1)}</dd></div>
          <div><dt>Nightly rate</dt><dd>{money0(f.nightlyLo)}–{money0(f.nightlyHi).slice(1)}</dd></div>
          <div><dt>Occupancy</dt><dd>{f.occLo}–{f.occHi}%</dd></div>
          <div><dt>You keep, est.</dt><dd>{money0(f.netLo)}–{money0(f.netHi).slice(1)}</dd></div>
        </dl>
        <p className="ft-lab ft-mt">Through the year</p>
        <div className="ft-bars">{f.months.map((m, i) => <span key={i} title={money0(m.lo) + '–' + money0(m.hi)}><i style={{ height: (m.hi / mx * 100) + '%' }}><b style={{ height: (m.lo / m.hi * 100) + '%' }} /></i><em>{'JFMAMJJASOND'[i]}</em></span>)}</div>
        {f.comps.length ? (
          <div className="ft-group">
            <p className="ft-lab">The comparables behind it</p>
            <ul>{f.comps.map((c, i) => <li key={i} className="ft-comp"><span>{c.name}<small className="ft-cline">{[c.market, c.nightly, c.occ].filter(Boolean).join(' · ')}</small></span><em /><b>{c.gross}</b></li>)}</ul>
          </div>
        ) : null}
        {f.places.length ? (
          <div className="ft-group">
            <p className="ft-lab">Nearby{f.beachMi != null ? `, about ${f.beachMi < 0.95 ? f.beachMi.toFixed(1) : Math.round(f.beachMi)} mi to the beach` : ''}</p>
            <ul>{f.places.map((x, i) => <li key={i}><span>{x.name}</span><em>{x.kind}</em><b>{x.mi} mi</b></li>)}</ul>
          </div>
        ) : null}
        <p className="ft-fine">“You keep” takes off typical booking-site fees ({f.channelPct}%){f.mgmtPct ? <> and a {f.mgmtPct}% management fee</> : <>; self-managed, so no management fee, but cleaning, supplies and your time are yours</>}. Distances are straight-line.</p>
        <div className="ft-notes"><p className="ft-lab">This is an estimate</p><p>{f.note}</p></div>
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
        <div className="ft-notes"><p className="ft-lab">Notes</p><p>{PARTNER_NOTE}</p></div>
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
        {tool === 'income' && full ? null : headline}
        {!full ? (
          gate ? (
            <form className="ft-gate" onSubmit={unlock}>
              <p className="ft-lab">{tool === 'income' ? 'Your email, to see it' : 'Your email, to download'}</p>
              <input type="email" required placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} autoComplete="email" />
              <div className="ft-two">
                <input placeholder="Name (optional)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoComplete="name" />
                <input placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} autoComplete="tel" inputMode="tel" />
              </div>
              <input className="ft-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} aria-hidden />
              {tool === 'inventory' ? (
                <div className="ft-seg ft-fmt">{([['xlsx', 'Excel checklist'], ['pdf', 'PDF']] as ['xlsx' | 'pdf', string][]).map(([k, l]) => <button key={k} type="button" className={fmt === k ? 'on' : ''} onClick={() => setFmt(k)}>{l}</button>)}</div>
              ) : null}
              <button type="submit" disabled={busy}>{busy ? 'Preparing…' : tool === 'income' ? 'See my projection' : fmt === 'xlsx' ? 'Download the Excel checklist' : 'Download the PDF'}</button>
              {err ? <p className="ft-err">{err}</p> : null}
              <p className="ft-fine">{tool === 'income' ? 'It shows right here, with a PDF to keep.' : 'It downloads right away.'} No spam, never shared, and no obligation to work with us.</p>
            </form>
          ) : (
            <button type="button" className="ft-cta" onClick={() => setGate(true)}><Download size={15} /> {tool === 'income' ? 'See my projection, free' : 'Download the full list, free'}</button>
          )
        ) : (
          <div className="ft-quote">
            <p className="ft-ok"><Check size={15} /> {tool === 'income' ? 'Here is your projection. Change the details above and it updates.' : 'Your download has started. Change the details above and download again any time.'}</p>
            {quote}
            <div className="ft-actions">
              {tool === 'inventory' ? <button type="button" onClick={() => xlsx()}><Download size={15} /> Excel checklist</button> : null}
              <button type="button" onClick={() => pdf()}><Download size={15} /> PDF</button>
              {tel && !contact?.name ? <a href={'tel:' + tel}><Phone size={15} /> Questions? Call us</a> : null}
            </div>
            {contact?.name ? (
              <div className="ft-who">
                {contact.photo ? <img src={contact.photo} alt={contact.name} width={64} height={64} /> : null}
                <div>
                  <p className="ft-lab">Talk to {first}</p>
                  <p className="ft-who-n">{contact.name}{contact.role ? <span>, {contact.role}</span> : null}</p>
                  <p className="ft-who-c">
                    {contact.phone ? <a href={'tel:' + tel}><Phone size={13} /> {contact.phone}</a> : null}
                    {contact.email ? <a href={'mailto:' + contact.email}><Mail size={13} /> {contact.email}</a> : null}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {!full && !gate ? <p className="ft-fine">{tool === 'income' ? 'Leave your email to see ' + meta.unlock + ', with the comparables behind it, and download it as a PDF.' : 'Download ' + meta.unlock + ', as a PDF.'}</p> : null}
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
.ft-field{display:grid;gap:6px;padding:11px 0;border-bottom:1px solid var(--ft-rule);position:relative}
.ft-field input,.ft-field select{font:500 15px "Inter",sans-serif;border:1px solid var(--ft-rule);border-radius:10px;padding:10px 12px;background:#fff;color:var(--ft-ink);width:100%;box-sizing:border-box;min-width:0}
.ft-hits{position:absolute;left:0;right:0;top:100%;z-index:20;list-style:none;margin:4px 0 0;padding:4px;background:#fff;border:1px solid var(--ft-rule);border-radius:12px;box-shadow:0 14px 34px rgba(20,18,15,.16);max-height:300px;overflow-y:auto}
.ft-hits button{display:grid;grid-template-columns:1fr auto;gap:2px 8px;width:100%;text-align:left;border:0;background:none;padding:9px 10px;border-radius:8px;cursor:pointer;color:var(--ft-ink)}
.ft-hits button:hover{background:var(--ft-soft)}
.ft-hits b{font:600 14px "Inter",sans-serif}.ft-hits span{grid-column:1;font-size:12px;color:var(--ft-muted)}
.ft-hits em{grid-row:1/3;grid-column:2;align-self:center;font:600 9.5px "Inter",sans-serif;font-style:normal;letter-spacing:.08em;text-transform:uppercase;color:var(--ft-acc)}
.ft-hint{margin:0;font-size:12px;color:#2F6B47}
.ft-acc{color:var(--ft-acc)}
.ft-group li b.neg{color:#A1332B}
.ft-group li.ft-comp{grid-template-columns:minmax(0,1fr) auto}.ft-comp em{display:none}.ft-comp span{display:flex;flex-direction:column;min-width:0}.ft-comp b{white-space:nowrap;font-size:15px!important}.ft-cline{display:block;color:var(--ft-muted);font-size:11.5px;margin-top:2px}
.ft-fmt{margin:4px 0 2px;align-self:flex-start;justify-self:start}
.ft-notes{margin-top:18px;padding:14px 16px;border-radius:12px;background:var(--ft-soft)}
.ft-notes p{margin:0;font:400 14px/1.5 "Inter",sans-serif;color:var(--ft-ink)}
.ft-notes .ft-lab{margin-bottom:6px;color:var(--ft-acc)}
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
.ft-who{display:flex;gap:14px;align-items:center;margin-top:18px;padding:14px 16px;border-radius:12px;background:var(--ft-soft)}
.ft-who img{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:0 0 64px}
.ft-who>div{min-width:0}
.ft-who p{margin:0}
.ft-who .ft-lab{margin-bottom:2px;color:var(--ft-acc)}
.ft-who-n{font:600 16px/1.3 "Inter",sans-serif;color:var(--ft-ink)}
.ft-who-n span{font-weight:400;color:var(--ft-body)}
.ft-who-c{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:4px!important}
.ft-who-c a{display:inline-flex;align-items:center;gap:5px;font:500 14px "Inter",sans-serif;color:var(--ft-ink);text-decoration:none;white-space:nowrap}
.ft-actions button,.ft-actions a{display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 16px;border-radius:99px;font:600 13px "Inter",sans-serif;text-decoration:none;cursor:pointer;border:1px solid var(--ft-rule);background:#fff;color:var(--ft-ink)}
.ft-actions button{background:var(--ft-navy);color:#fff;border-color:var(--ft-navy)}
@media (max-width:760px){.ft{grid-template-columns:1fr;gap:16px}.ft-big{font-size:36px}.ft-card{padding:18px 16px}}
.ft-embedded .ft-card{box-shadow:none}
`
