'use client'
// THE STARTER KIT REPORT (Jon, 2026-11-10: "a new report, real nice, that we can share with a
// potential owner / client"). What the client sees at /kit/<code> — no sign-in.
//
//   1. Prepared for them: name, property, the note from the team, the total at a glance.
//   2. Their home: bedrooms, bathrooms, guests, and a kitchen (yes / no; when yes every appliance
//      starts ticked and they untick what the home lacks). Every quantity and item follows it.
//   It works as an INVENTORY COUNT (Jon, 2026-11-10): each line says how many the home needs, they
//   enter how many it already has, and the rest is the need list — what is left to buy.
//   3. How we size a home, in four plain rules.
//   4. The kit by room: must-haves always in, recommended in unless removed, optional out unless
//      added; any quantity can change; any product can be swapped for one they link to.
//   5. The totals and Send to Stay (name, email, note). Choices save as they go.
// Download report builds a PDF on the server from what they saved (/api/public/starter-kit/<code>/pdf).
// A MUST-HAVE means the home needs it, not that it must be ours: every line can be our pick, their
// own link, or something they provide. The coffee maker is Nespresso or Keurig only; we supply pods.
//
// Deliberately light, paper-like and self-styled (scoped under .skr): this is a document handed to
// someone outside the company, so it does not follow the app theme or its dark mode.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bath, BedDouble, Check, ChefHat, ClipboardList, Coffee, Dices, Download, ExternalLink, FileSpreadsheet, Home, Link2, Loader2, Lock, Minus, Plus, Send, ShieldCheck, Sparkles, Users, UtensilsCrossed, Wine,
} from 'lucide-react'
import {
  APPLIANCES, KIT_CATEGORIES, SIZE_LIMITS, describeSize, fmtMoney, kitTotals, normLink, ruleText,
  type KitAppliance, type KitCount, type KitLine, type KitPublic, type KitSelection, type KitSize,
} from '@/lib/starter-kit'

const CAT_ICON: Record<string, any> = {
  'Kitchen appliances': Coffee, 'Cookware & prep': ChefHat, 'Dining & glassware': Wine, 'Kitchen essentials': UtensilsCrossed,
  'Cleaning & safety': ShieldCheck, 'Bedroom & guest comfort': BedDouble, Games: Dices,
}
const TIER_LABEL = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const SIZE_LABEL: Record<KitCount, string> = { bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', guests: 'Guests' }
const SIZE_ICON: Record<KitCount, any> = { bedrooms: BedDouble, bathrooms: Bath, guests: Users }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const longDate = (s: string) => { const d = s ? new Date(s) : new Date(); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }

export function StarterKitReport({ initial }: { initial: KitPublic }) {
  const [size, setSize] = useState<KitSize>(initial.size)
  const [sel, setSel] = useState<KitSelection>(initial.selection)
  const [submitted, setSubmitted] = useState(initial.submitted)
  const [ownOpen, setOwnOpen] = useState<Record<string, string>>({})
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [name, setName] = useState(initial.submitted?.name || '')
  const [email, setEmail] = useState(initial.submitted?.email || '')
  const [note, setNote] = useState(initial.submitted?.note || '')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState('')
  const [justSent, setJustSent] = useState(false)
  const dirty = useRef(false)
  const t = useMemo(() => kitTotals(size, sel), [size, sel])
  const grand = t.total + (initial.setupFee || 0)

  // Saves a moment after the last change, so a client clicking through does not lose anything.
  useEffect(() => {
    if (!dirty.current) return
    setSave('saving')
    const h = setTimeout(async () => {
      const r = await fetch(`/api/public/starter-kit/${initial.code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: sel, size }) })
        .then(x => x.json()).catch(() => ({ ok: false }))
      setSave(r.ok ? 'saved' : 'error')
    }, 900)
    return () => clearTimeout(h)
  }, [sel, size, initial.code])
  const change = (fn: (s: KitSelection) => KitSelection) => { dirty.current = true; setSel(s => fn({ inc: { ...s.inc }, qty: { ...s.qty }, own: { ...s.own }, pick: { ...s.pick }, self: { ...s.self }, have: { ...s.have } })) }
  const setKitchen = (on: boolean) => { dirty.current = true; setSize(z => ({ ...z, kitchen: on })) }
  const setAppliance = (a: KitAppliance, on: boolean) => { dirty.current = true; setSize(z => ({ ...z, appliances: { ...z.appliances, [a]: on } })) }
  const setHave = (l: KitLine, n: number) => change(s => { const v = Math.max(0, Math.min(999, Math.round(n) || 0)); if (v) s.have[l.item.key] = v; else delete s.have[l.item.key]; return s })
  const setSizeKey = (k: KitCount, v: number) => { const [lo, hi] = SIZE_LIMITS[k]; dirty.current = true; setSize(z => ({ ...z, [k]: Math.max(lo, Math.min(hi, Math.round(v) || lo)) })) }

  const toggle = (l: KitLine) => change(s => { s.inc[l.item.key] = !l.included; return s })
  const setQty = (l: KitLine, n: number) => change(s => { const v = Math.max(1, Math.min(99, n)); if (v === l.suggested) delete s.qty[l.item.key]; else s.qty[l.item.key] = v; return s })
  const saveOwn = (l: KitLine) => {
    const v = normLink(ownOpen[l.item.key] || '')
    if (!v) { setOwnOpen(o => ({ ...o, [l.item.key]: o[l.item.key] || '' })); return false }
    change(s => { s.own[l.item.key] = v; delete s.self[l.item.key]; if (l.item.tier !== 'must') s.inc[l.item.key] = true; return s })
    setOwnOpen(o => { const n = { ...o }; delete n[l.item.key]; return n })
    return true
  }
  /** Who supplies it: our pick, their link (opens the link box), or they provide it. */
  const setSource = (l: KitLine, src: 'stay' | 'link' | 'self') => {
    if (src === 'link') { change(s => { delete s.self[l.item.key]; return s }); setOwnOpen(o => ({ ...o, [l.item.key]: l.own || '' })); return }
    setOwnOpen(o => { const n = { ...o }; delete n[l.item.key]; return n })
    change(s => { delete s.own[l.item.key]; if (src === 'self') s.self[l.item.key] = true; else delete s.self[l.item.key]; if (l.item.tier !== 'must') s.inc[l.item.key] = true; return s })
  }
  const setPick = (l: KitLine, id: string) => change(s => { s.pick[l.item.key] = id; delete s.own[l.item.key]; delete s.self[l.item.key]; return s })
  // Download: save what is on screen first, so the file matches it, then fetch the PDF.
  const [dl, setDl] = useState(false)
  const download = async (fmt: 'pdf' | 'xlsx' = 'pdf') => {
    setDl(true)
    await fetch(`/api/public/starter-kit/${initial.code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: sel, size }) }).catch(() => null)
    window.location.href = `/api/public/starter-kit/${initial.code}/${fmt}`
    setTimeout(() => setDl(false), 2500)
  }

  // The order form link: just what is left to buy, read-only, to send to whoever is buying.
  const [orderCopied, setOrderCopied] = useState(false)
  const shareOrder = async () => {
    await fetch(`/api/public/starter-kit/${initial.code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: sel, size }) }).catch(() => null)
    const link = `${window.location.origin}/kit/${initial.code}/order`
    try { await navigator.clipboard.writeText(link); setOrderCopied(true); setTimeout(() => setOrderCopied(false), 2000) } catch { window.open(link, '_blank') }
  }
  const send = async () => {
    setSendErr('')
    if (!name.trim()) { setSendErr('Add your name so we know who sent it.'); return }
    setSending(true)
    const r = await fetch(`/api/public/starter-kit/${initial.code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: sel, size, submit: true, name, email, note }) })
      .then(x => x.json()).catch(() => ({ ok: false, error: 'That did not send. Check your connection and try again.' }))
    setSending(false)
    if (!r.ok) { setSendErr(r.error || 'That did not send. Try again in a moment.'); return }
    setSubmitted(r.kit.submitted); setJustSent(true); setSave('saved')
  }

  const byCat = KIT_CATEGORIES.map(c => {
    const lines = t.lines.filter(l => l.item.category === c)
    const on = lines.filter(l => l.included)
    return { cat: c, lines, on: on.length, sub: on.reduce((a, l) => a + (l.total || 0), 0) }
  })
  const maxSub = Math.max(1, ...byCat.map(c => c.sub))

  return (
    <div className="skr">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="skr-top">
        <div className="skr-wrap skr-top-in">
          <img src="/stay-logo.png" alt="Stay Hospitality" className="skr-logo" />
          <div className="skr-top-r">
            <span className={'skr-save skr-noprint ' + save} aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : save === 'error' ? 'Not saved, retrying on your next change' : ''}</span>
            <button type="button" className="skr-btn ghost skr-noprint" onClick={() => download('xlsx')} disabled={dl}><FileSpreadsheet size={15} /> <span className="skr-hide-sm">Need list</span> Excel</button>
            <button type="button" className="skr-btn ghost skr-noprint" onClick={() => download('pdf')} disabled={dl}>{dl ? <Loader2 size={15} className="spin" /> : <Download size={15} />} <span className="skr-hide-sm">Report</span> PDF</button>
          </div>
        </div>
      </header>

      <main className="skr-wrap">
        {/* 1 — prepared for */}
        <section className="skr-hero">
          <div className="skr-hero-l">
            <div className="skr-eyebrow">Home inventory & starter kit · prepared for</div>
            <h1>{initial.client}</h1>
            {initial.property && <p className="skr-prop">{initial.property}</p>}
            <p className="skr-meta">{longDate(initial.createdAt)}{initial.preparedBy ? ` · Prepared by ${initial.preparedBy}, Stay Hospitality` : ' · Stay Hospitality'}</p>
            <p className="skr-lede">Everything a home needs before the first guest arrives, sized to yours. Tell us about the home, count what is already there, and the list works out what is still needed. Must-haves are things every home needs, not a requirement to use our products: take our pick, send us a link to one you prefer, or provide it yourself. Download the need list or send it to us when you are done.</p>
          </div>
          <aside className="skr-glance">
            <div className="skr-glance-k">Still to buy</div>
            <div className="skr-glance-v">{fmtMoney(t.total, false)}</div>
            <div className="skr-glance-s">{t.items} items needed · {t.toBuy} to buy · {t.covered} covered</div>
            <div className="skr-glance-s">{describeSize(size)}</div>
            <dl>
              <div><dt>Must-haves</dt><dd>{fmtMoney(t.must)}</dd></div>
              <div><dt>Your add-ons</dt><dd>{fmtMoney(t.addOns)}</dd></div>
              {initial.setupFee ? <div><dt>Setup & installation</dt><dd>{fmtMoney(initial.setupFee)}</dd></div> : null}
            </dl>
            <a href="#send" className="skr-btn solid skr-noprint"><Send size={15} /> Review and send</a>
          </aside>
        </section>

        {initial.message && (
          <blockquote className="skr-note">
            <p>{initial.message}</p>
            {initial.preparedBy && <cite>{initial.preparedBy}</cite>}
          </blockquote>
        )}

        {/* 2 — the home */}
        <section className="skr-sec">
          <div className="skr-sec-h">
            <h2>Your home</h2>
            <p>{initial.sizeLocked ? <><Lock size={13} /> Set from your property details.</> : 'Change any of these and the list below updates.'}</p>
          </div>
          <div className="skr-size">
            {(Object.keys(SIZE_LIMITS) as KitCount[]).map(k => {
              const Ico = SIZE_ICON[k]
              return (
                <div key={k} className="skr-size-c">
                  <div className="skr-size-l"><Ico size={15} /> {SIZE_LABEL[k]}</div>
                  {initial.sizeLocked ? <div className="skr-size-n">{size[k]}</div> : (
                    <div className="skr-step big">
                      <button type="button" aria-label={'Fewer ' + SIZE_LABEL[k]} onClick={() => setSizeKey(k, size[k] - 1)}><Minus size={16} /></button>
                      <input aria-label={SIZE_LABEL[k]} type="number" value={size[k]} onChange={e => setSizeKey(k, +e.target.value)} />
                      <button type="button" aria-label={'More ' + SIZE_LABEL[k]} onClick={() => setSizeKey(k, size[k] + 1)}><Plus size={16} /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="skr-kit">
            <div className="skr-kit-q">
              <ChefHat size={18} /><b>Kitchen</b>
              <div className="skr-yn" role="radiogroup" aria-label="Does the home have a kitchen">
                <button type="button" role="radio" aria-checked={size.kitchen} className={size.kitchen ? 'on' : ''} disabled={initial.sizeLocked} onClick={() => setKitchen(true)}>Yes</button>
                <button type="button" role="radio" aria-checked={!size.kitchen} className={!size.kitchen ? 'on' : ''} disabled={initial.sizeLocked} onClick={() => setKitchen(false)}>No</button>
              </div>
            </div>
            {size.kitchen ? (
              <>
                <p className="skr-kfine">Untick anything the kitchen does not have. No oven drops the bakeware, no stove drops the pots and pans, and with no dishwasher the dish rack becomes a must-have.</p>
                <div className="skr-apps">
                  {APPLIANCES.map(a => (
                    <label key={a.k} className={'skr-app' + (size.appliances[a.k] ? ' on' : '')}>
                      <input type="checkbox" checked={size.appliances[a.k]} disabled={initial.sizeLocked} onChange={e => setAppliance(a.k, e.target.checked)} />
                      <span className="skr-app-box">{size.appliances[a.k] && <Check size={13} />}</span>{a.label}
                    </label>
                  ))}
                </div>
              </>
            ) : <p className="skr-kfine">With no kitchen, the list keeps coffee, drinkware and everything outside the kitchen.</p>}
          </div>
        </section>

        {/* 3 — how we size it */}
        <section className="skr-sec">
          <div className="skr-sec-h"><h2>How we size your home</h2><p>Simple rules, so a full house never runs short between turns.</p></div>
          <div className="skr-rules">
            <div><b>{Math.ceil(size.guests * 1.5)}</b><span>place settings</span><p>{!size.kitchen ? 'Tall glasses at 1.5 per guest, so there is always a clean one between turns.' : 'Flatware, plates and tall glasses at 1.5 per guest, so the dishwasher can run while the next meal is served.'}</p></div>
            <div><b>{size.guests}</b><span>of each glass</span><p>Wine glasses, mugs and short glasses at one per guest, bought in sets of four.</p></div>
            <div><b>{Math.max(1, size.bathrooms)}</b><span>bath kits</span><p>A hair dryer, a plunger and brush set and a touchless trash can for every bathroom.</p></div>
            <div><b>{Math.max(1, size.bedrooms) * 20}</b><span>hangers</span><p>Twenty wooden hangers and a luggage rack for every bedroom.</p></div>
          </div>
        </section>

        {/* overview */}
        <section className="skr-sec">
          <div className="skr-sec-h"><h2>At a glance</h2><p>What each room’s share of the kit comes to with your current choices.</p></div>
          <div className="skr-over">
            {byCat.map(c => {
              const Ico = CAT_ICON[c.cat] || Sparkles
              return (
                <a key={c.cat} href={'#' + slug(c.cat)} className="skr-over-r">
                  <span className="skr-over-n"><Ico size={16} /> {c.cat}</span>
                  <span className="skr-over-bar"><i style={{ width: `${Math.max(2, (c.sub / maxSub) * 100)}%` }} /></span>
                  <span className="skr-over-v">{fmtMoney(c.sub, false)}<small>{c.on} of {c.lines.length}</small></span>
                </a>
              )
            })}
          </div>
        </section>

        {/* 4 — the kit */}
        <div className="skr-legend skr-noprint">
          <span><i className="skr-tier must">Must-have</i> your home needs it; our pick, your link or your own</span>
          <span><i className="skr-tier recommended">Recommended</i> included unless you remove it</span>
          <span><i className="skr-tier optional">Optional</i> add it if you’d like it</span>
        </div>
        <div className="skr-cols skr-noprint" aria-hidden="true"><span>Item</span><span>Need</span><span>Have</span><span>To buy</span><span /></div>
        {byCat.map(c => {
          const Ico = CAT_ICON[c.cat] || Sparkles
          return (
            <section key={c.cat} id={slug(c.cat)} className="skr-cat">
              <div className="skr-cat-h">
                <h3><Ico size={20} /> {c.cat}</h3>
                <span>{c.on} needed · {c.lines.filter(l => l.included && l.toBuy > 0).length} to buy · {fmtMoney(c.sub)}</span>
              </div>
              <div className="skr-items">
                {c.lines.map(l => <ItemRow key={l.item.key} l={l} size={size} ownDraft={ownOpen[l.item.key]}
                  onToggle={() => toggle(l)} onQty={n => setQty(l, n)} onHave={n => setHave(l, n)} onSource={src => setSource(l, src)} onPick={id => setPick(l, id)}
                  onOwnDraft={v => setOwnOpen(o => ({ ...o, [l.item.key]: v }))}
                  onOwnCancel={() => setOwnOpen(o => { const n = { ...o }; delete n[l.item.key]; return n })} onOwnSave={() => saveOwn(l)} />)}
              </div>
            </section>
          )
        })}

        {/* 5 — totals and send */}
        <section className="skr-sum" id="send">
          <div className="skr-sum-l">
            <h2>Your starter kit</h2>
            <table>
              <tbody>
                <tr><td>Items the home needs</td><td>{t.items}</td></tr>
                <tr><td>Already covered by what you have</td><td>{t.covered}</td></tr>
                <tr><td>Must-haves still to buy</td><td>{fmtMoney(t.must)}</td></tr>
                <tr><td>Recommended and optional items to buy</td><td>{fmtMoney(t.addOns)}</td></tr>
                {initial.setupFee ? <tr><td>Setup, delivery and installation</td><td>{fmtMoney(initial.setupFee)}</td></tr> : null}
                {t.ownLinks > 0 && <tr><td>{t.ownLinks} product{t.ownLinks === 1 ? '' : 's'} you linked</td><td className="muted">Priced on review</td></tr>}
                {t.selfSupplied > 0 && <tr><td>{t.selfSupplied} item{t.selfSupplied === 1 ? '' : 's'} you provide</td><td className="muted">Not charged</td></tr>}
                <tr className="tot"><td>Total to buy</td><td>{fmtMoney(grand)}</td></tr>
              </tbody>
            </table>
            <p className="skr-fine">Product prices are current retail prices from when this kit was prepared and can change before we order. We confirm every price with you before anything is bought. Coffee pods are on us.</p>
            <div className="skr-dls skr-noprint">
              <button type="button" className="skr-btn ghost" onClick={shareOrder}><ClipboardList size={15} /> {orderCopied ? 'Order form link copied' : 'Copy order form link'}</button>
              <button type="button" className="skr-btn ghost" onClick={() => download('xlsx')} disabled={dl}><FileSpreadsheet size={15} /> Download need list (Excel)</button>
              <button type="button" className="skr-btn ghost" onClick={() => download('pdf')} disabled={dl}>{dl ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download report (PDF)</button>
            </div>
          </div>
          <div className="skr-sum-r skr-noprint">
            {submitted && (justSent || !dirty.current) ? (
              <div className="skr-sent">
                <Check size={22} />
                <div>
                  <b>{justSent ? 'Sent to Stay. Thank you.' : `Sent ${longDate(submitted.at)}`}</b>
                  <p>{justSent ? 'We have your selections and will be in touch to confirm the order.' : 'You can still change anything above and send it again.'}</p>
                  <button type="button" className="skr-sent-dl" onClick={() => download('xlsx')}><FileSpreadsheet size={14} /> Need list (Excel)</button> <button type="button" className="skr-sent-dl" onClick={() => download('pdf')}><Download size={14} /> Report (PDF)</button>
                </div>
              </div>
            ) : null}
            <h3>{submitted ? 'Send an update' : 'Send your selections to Stay'}</h3>
            <label>Your name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
            <label>Email (optional)<input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" /></label>
            <label>Anything we should know (optional)<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Colors, finishes, a product you already own…" /></label>
            {sendErr && <p className="skr-err" role="alert">{sendErr}</p>}
            <button type="button" className="skr-btn solid wide" disabled={sending} onClick={send}>{sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />} {submitted ? 'Send update' : 'Send to Stay'} · {fmtMoney(grand, false)}</button>
          </div>
        </section>

        <footer className="skr-foot">
          <img src="/stay-logo.png" alt="" className="skr-logo sm" />
          <p>Stay Hospitality manages short-term rental homes across Miami-Dade and Broward. This kit is what we set every home up with so guests find a fully equipped place from the first night.</p>
        </footer>
      </main>

      <div className="skr-bar skr-noprint">
        <div className="skr-wrap skr-bar-in">
          <div className="skr-bar-s"><span>{t.toBuy} to buy</span><b>{fmtMoney(grand, false)}</b></div>
          <a href="#send" className="skr-btn solid"><Send size={15} /> {submitted ? 'Send update' : 'Review and send'}</a>
        </div>
      </div>
    </div>
  )
}

function ItemRow({ l, size, ownDraft, onToggle, onQty, onHave, onSource, onPick, onOwnDraft, onOwnCancel, onOwnSave }: {
  l: KitLine; size: KitSize; ownDraft: string | undefined
  onToggle: () => void; onQty: (n: number) => void; onHave: (n: number) => void; onSource: (s: 'stay' | 'link' | 'self') => void; onPick: (id: string) => void
  onOwnDraft: (v: string) => void; onOwnCancel: () => void; onOwnSave: () => boolean
}) {
  const it = l.item
  const choosable = it.price !== 0
  const [bad, setBad] = useState(false)
  const linking = ownDraft !== undefined
  const src = linking ? 'link' : l.source
  const groups = it.options ? Array.from(new Set(it.options.map(o => o.group))) : []
  return (
    <article className={'skr-item' + (l.included ? '' : ' off')}>
      <div className="skr-item-main">
        <div className="skr-item-t">
          <h4>{it.name}</h4>
          <i className={'skr-tier ' + it.tier}>{TIER_LABEL[it.tier]}</i>
          {l.source === 'link' && <i className="skr-tier own">Your product</i>}
          {l.source === 'self' && <i className="skr-tier own">You provide</i>}
        </div>
        <p className="skr-item-d">{l.source === 'link' ? 'Your linked product, in place of: ' + l.detail : l.source === 'self' ? 'You provide this. Ours would be: ' + l.detail : l.detail}{l.option && l.source === 'stay' ? ' · ' + l.option.detail : ''}</p>
        {it.note && <p className="skr-item-note">{it.note}</p>}
        <p className="skr-item-r">{ruleText(it, size)}{l.qty !== l.suggested ? ` · you chose ${l.qty} (we suggest ${l.suggested})` : ''}</p>

        {it.options && l.source === 'stay' && !linking && (
          <div className="skr-opts skr-noprint">
            {groups.map(g => (
              <div key={g} className="skr-opt-g">
                <div className="skr-opt-h">{g}</div>
                <div className="skr-opt-row">
                  {it.options!.filter(o => o.group === g).map(o => (
                    <button key={o.id} type="button" aria-pressed={l.option?.id === o.id} className={'skr-opt' + (l.option?.id === o.id ? ' on' : '')} onClick={() => onPick(o.id)}>
                      <span className="skr-opt-n">{o.name.replace(/^(Nespresso|Keurig) /, '')}</span>
                      <span className="skr-opt-p">{o.approx ? 'about ' : ''}{fmtMoney(o.price, false)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {choosable && (
          <div className="skr-src skr-noprint" role="group" aria-label={'Who supplies the ' + it.name}>
            <button type="button" aria-pressed={src === 'stay'} className={src === 'stay' ? 'on' : ''} onClick={() => onSource('stay')}><Check size={13} /> Our pick</button>
            <button type="button" aria-pressed={src === 'link'} className={src === 'link' ? 'on' : ''} onClick={() => onSource('link')}><Link2 size={13} /> My link</button>
            <button type="button" aria-pressed={src === 'self'} className={src === 'self' ? 'on' : ''} onClick={() => onSource('self')}><Home size={13} /> I’ll provide it</button>
            {l.url && l.source !== 'self' && !linking && <a href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {l.source === 'link' ? 'See your product' : 'See it'}</a>}
          </div>
        )}
        {linking && (
          <div className="skr-own skr-noprint">
            <input autoFocus type="url" value={ownDraft} placeholder={it.options ? 'Paste a link to a Nespresso or Keurig machine' : 'Paste the product link (Amazon, Wayfair, any store)'} aria-label={'Your product link for ' + it.name}
              onChange={e => { setBad(false); onOwnDraft(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') setBad(!onOwnSave()) }} />
            <button type="button" className="skr-btn solid sm" onClick={() => setBad(!onOwnSave())}>Use this</button>
            <button type="button" className="skr-btn ghost sm" onClick={onOwnCancel}>Cancel</button>
            {bad && <span className="skr-err">Paste a full link that starts with https://</span>}
          </div>
        )}
      </div>
      <div className="skr-item-qty">
        <span className="skr-qlabel">Need</span>
        <div className="skr-step">
          <button type="button" aria-label={'Need fewer ' + it.name} onClick={() => onQty(l.qty - 1)} disabled={l.qty <= 1}><Minus size={14} /></button>
          <span className="skr-qty-n" aria-live="polite">{l.qty}</span>
          <button type="button" aria-label={'Need more ' + it.name} onClick={() => onQty(l.qty + 1)}><Plus size={14} /></button>
        </div>
      </div>
      <div className="skr-item-qty">
        <span className="skr-qlabel">Have</span>
        <div className={'skr-step' + (l.have ? ' has' : '')}>
          <button type="button" aria-label={'Have fewer ' + it.name} onClick={() => onHave(l.have - 1)} disabled={l.have <= 0}><Minus size={14} /></button>
          <span className="skr-qty-n" aria-live="polite">{l.have}</span>
          <button type="button" aria-label={'Have more ' + it.name} onClick={() => onHave(l.have + 1)}><Plus size={14} /></button>
        </div>
      </div>
      <div className="skr-item-p">
        <span className="skr-qlabel">To buy</span>
        <span className={'skr-buy' + (l.toBuy === 0 ? ' ok' : '')}>{l.source === 'self' ? 'You provide' : l.toBuy === 0 ? <><Check size={13} /> Covered</> : l.toBuy}</span>
        <small>{l.source === 'self' || l.toBuy === 0 ? null : l.source === 'link' ? 'Priced on review' : l.price === 0 ? 'Included' : <>{l.option?.approx ? 'about ' : ''}{fmtMoney(l.total || 0)}</>}</small>
      </div>
      <div className="skr-item-inc">
        {it.tier === 'must' ? <span className="skr-always"><Check size={14} /> Needed</span> : (
          <button type="button" role="switch" aria-checked={l.included} aria-label={(l.included ? 'Remove ' : 'Add ') + it.name} className={'skr-switch' + (l.included ? ' on' : '')} onClick={onToggle}>
            <span className="skr-switch-t" /><span className="skr-switch-l">{l.included ? 'Added' : 'Add'}</span>
          </button>
        )}
      </div>
    </article>
  )
}

const CSS = `
.skr{--paper:#FFFFFF;--ground:#EEF1F0;--ink:#15212B;--ink2:#3C4A54;--muted:#6B7880;--line:#DCE2E0;--accent:#1F5F5B;--accent-2:#2E7C76;--accent-soft:#E2EFED;--sand:#B98B4E;
  --must:#1C4A7E;--must-bg:#E1EAF5;--rec:#25633A;--rec-bg:#E0EFE4;--opt:#56626B;--opt-bg:#ECEFF1;--own:#8A5A12;--own-bg:#F6EBD6;
  --display:'Instrument Serif',Georgia,serif;--ui:'Geist','Inter',system-ui,sans-serif;
  background:var(--ground);color:var(--ink);font-family:var(--ui);font-size:15px;line-height:1.5;min-height:100vh;color-scheme:light;padding-bottom:96px}
.skr *{box-sizing:border-box}
.skr-wrap{max-width:1040px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
.skr-top{background:var(--paper);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.skr-top-in{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:12px}
.skr-logo{height:30px;width:auto}.skr-logo.sm{height:22px;opacity:.8}
.skr-top-r{display:flex;align-items:center;gap:12px}
.skr-save{font-size:12.5px;color:var(--muted)}.skr-save.saved{color:var(--accent)}.skr-save.error{color:#A33}
.skr-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;font:600 14px var(--ui);padding:10px 18px;cursor:pointer;border:1px solid transparent;text-decoration:none;white-space:nowrap}
.skr-btn.solid{background:var(--accent);color:#fff}.skr-btn.solid:hover{background:var(--accent-2)}
.skr-btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}.skr-btn.ghost:hover{border-color:var(--ink)}
.skr-btn.sm{padding:7px 13px;font-size:13px}.skr-btn.wide{width:100%}.skr-btn:disabled{opacity:.6}
.skr-btn:focus-visible,.skr button:focus-visible,.skr input:focus-visible,.skr textarea:focus-visible,.skr a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skr-hero{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:36px;align-items:start;padding-block:48px 28px}
.skr-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
.skr-hero h1{font-family:var(--display);font-weight:400;font-size:clamp(44px,7vw,72px);line-height:1;margin:10px 0 10px;letter-spacing:-.01em;text-wrap:balance}
.skr-prop{font-size:18px;color:var(--ink2);margin:0}
.skr-meta{font-size:13.5px;color:var(--muted);margin:6px 0 0}
.skr-lede{font-size:16.5px;color:var(--ink2);max-width:60ch;margin:22px 0 0}
.skr-glance{background:var(--ink);color:#fff;border-radius:20px;padding:24px;display:grid;gap:6px}
.skr-glance-k{font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.7}
.skr-glance-v{font-family:var(--display);font-size:56px;line-height:1}
.skr-glance-s{font-size:13.5px;opacity:.8}
.skr-glance dl{margin:14px 0 16px;display:grid;gap:6px;border-top:1px solid rgba(255,255,255,.15);padding-top:14px}
.skr-glance dl div{display:flex;justify-content:space-between;font-size:14px}.skr-glance dt{opacity:.75}.skr-glance dd{margin:0;font-variant-numeric:tabular-nums}
.skr-glance .skr-btn.solid{background:#fff;color:var(--ink)}
.skr-note{margin:0 0 8px;background:var(--paper);border-radius:16px;padding:22px 26px;border:1px solid var(--line);position:relative}
.skr-note p{margin:0;font-family:var(--display);font-size:22px;line-height:1.35;color:var(--ink);white-space:pre-line}
.skr-note cite{display:block;margin-top:10px;font-style:normal;font-size:13.5px;color:var(--muted)}
.skr-note cite::before{content:"— "}
.skr-sec{margin-top:40px}
.skr-sec-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px 20px;flex-wrap:wrap;margin-bottom:14px}
.skr-sec-h h2,.skr-sum h2{font-family:var(--display);font-weight:400;font-size:32px;margin:0;line-height:1.1}
.skr-sec-h p{margin:0;color:var(--muted);font-size:14px;display:inline-flex;align-items:center;gap:6px}
.skr-size{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.skr-kit{margin-top:12px;background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.skr-kit-q{display:flex;align-items:center;gap:10px}.skr-kit-q svg{color:var(--accent)}.skr-kit-q b{font-weight:600;margin-right:auto}
.skr-yn{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.skr-yn button{border:0;background:none;border-radius:999px;padding:6px 18px;font:600 13.5px var(--ui);color:var(--muted);cursor:pointer}.skr-yn button.on{background:var(--ink);color:#fff}.skr-yn button:disabled{cursor:default}
.skr-apps{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.skr-app{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:7px 14px 7px 9px;font-size:13.5px;cursor:pointer;color:var(--muted)}
.skr-app input{position:absolute;opacity:0;width:1px;height:1px}
.skr-app-box{width:18px;height:18px;border-radius:6px;border:1.5px solid var(--line);display:grid;place-items:center;color:#fff}
.skr-app.on{color:var(--ink);border-color:var(--accent);background:var(--accent-soft)}.skr-app.on .skr-app-box{background:var(--accent);border-color:var(--accent)}
.skr-app:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.skr-cols{display:grid;grid-template-columns:minmax(0,1fr) 112px 112px 104px 92px;gap:14px;padding:22px 18px 0;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.skr-cols span:not(:first-child){text-align:center}
.skr-qlabel{display:none;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.skr-step.has{border-color:var(--accent);background:var(--accent-soft)}
.skr-buy{font-weight:700;font-size:16px;font-variant-numeric:tabular-nums}.skr-buy.ok{color:var(--rec);font-size:13px;display:inline-flex;align-items:center;gap:4px}
.skr-item-p small{display:block;font-weight:400;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.skr-dls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.skr-kitchen{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}
.skr-kopt{display:flex;gap:10px;align-items:flex-start;text-align:left;border:1px solid var(--line);background:var(--paper);border-radius:16px;padding:14px 16px;cursor:pointer;color:var(--ink);font:14px var(--ui)}
.skr-kopt svg{color:var(--muted);margin-top:2px;flex:none}.skr-kopt b{display:block;font-weight:600}.skr-kopt small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
.skr-kopt.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--accent-soft)}.skr-kopt.on svg{color:var(--accent)}
.skr-kopt:disabled{opacity:.45;cursor:default}
.skr-kfine{margin:10px 0 0;font-size:13px;color:var(--muted)}
.skr-size-c{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px;display:grid;gap:10px}
.skr-size-l{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);font-weight:500}
.skr-size-n{font-family:var(--display);font-size:40px;line-height:1}
.skr-step{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:var(--paper);overflow:hidden}
.skr-step button{border:0;background:transparent;color:var(--ink);width:34px;height:34px;display:grid;place-items:center;cursor:pointer}
.skr-step button:hover:not(:disabled){background:var(--accent-soft)}.skr-step button:disabled{opacity:.3;cursor:default}
.skr-step input{border:0;width:44px;text-align:center;font:400 28px var(--display);color:var(--ink);background:transparent;-moz-appearance:textfield}
.skr-step input::-webkit-outer-spin-button,.skr-step input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.skr-step.big{width:100%;justify-content:space-between}.skr-step.big button{width:42px;height:42px}
.skr-qty-n{min-width:26px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums}
.skr-rules{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.skr-rules>div{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:18px}
.skr-rules b{font-family:var(--display);font-weight:400;font-size:44px;line-height:1;color:var(--accent);display:block}
.skr-rules span{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink)}
.skr-rules p{margin:8px 0 0;font-size:13.5px;color:var(--ink2)}
.skr-over{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:8px 18px}
.skr-over-r{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr) 110px;gap:16px;align-items:center;padding:11px 0;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none}
.skr-over-r:last-child{border-bottom:0}.skr-over-r:hover .skr-over-n{color:var(--accent)}
.skr-over-n{display:flex;align-items:center;gap:8px;font-weight:500;font-size:14.5px}
.skr-over-bar{height:8px;background:var(--ground);border-radius:999px;overflow:hidden}.skr-over-bar i{display:block;height:100%;background:var(--accent);border-radius:999px;transition:width .3s}
.skr-over-v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.skr-over-v small{display:block;font-weight:400;font-size:12px;color:var(--muted)}
.skr-legend{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:44px;font-size:13px;color:var(--muted)}
.skr-legend span{display:flex;align-items:center;gap:7px}
.skr-tier{font-style:normal;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;letter-spacing:.01em}
.skr-tier.must{background:var(--must-bg);color:var(--must)}.skr-tier.recommended{background:var(--rec-bg);color:var(--rec)}.skr-tier.optional{background:var(--opt-bg);color:var(--opt)}.skr-tier.own{background:var(--own-bg);color:var(--own)}
.skr-cat{margin-top:30px;scroll-margin-top:80px}
.skr-cat-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px 16px;flex-wrap:wrap;padding-bottom:10px;border-bottom:2px solid var(--ink)}
.skr-cat-h h3{font-family:var(--display);font-weight:400;font-size:28px;margin:0;display:flex;align-items:center;gap:10px}
.skr-cat-h h3 svg{color:var(--accent)}
.skr-cat-h span{font-size:13.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.skr-items{background:var(--paper);border:1px solid var(--line);border-top:0;border-radius:0 0 16px 16px}
.skr-item{display:grid;grid-template-columns:minmax(0,1fr) 112px 112px 104px 92px;gap:16px;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}
.skr-item:last-child{border-bottom:0}
.skr-item.off .skr-item-main,.skr-item.off .skr-item-qty,.skr-item.off .skr-item-p{opacity:.45}
.skr-item-main{min-width:0}
.skr-item-t{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.skr-item-t h4{margin:0;font-size:16px;font-weight:600}
.skr-item-d{margin:3px 0 0;font-size:14px;color:var(--ink2)}
.skr-item-r{margin:3px 0 0;font-size:12.5px;color:var(--accent);font-weight:500}
.skr-item-note{margin:6px 0 0;font-size:13px;color:var(--ink2);background:var(--accent-soft);border-radius:10px;padding:8px 11px}
.skr-src{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
.skr-src button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--paper);color:var(--ink2);border-radius:999px;padding:5px 11px;font:500 12.5px var(--ui);cursor:pointer}
.skr-src button svg{opacity:.35}.skr-src button.on{background:var(--ink);border-color:var(--ink);color:#fff}.skr-src button.on svg{opacity:1}
.skr-src a{display:inline-flex;align-items:center;gap:5px;font:500 12.5px var(--ui);color:var(--accent);margin-left:6px;text-decoration:none}.skr-src a:hover{text-decoration:underline}
.skr-opts{display:grid;gap:10px;margin-top:12px}
.skr-opt-h{font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.skr-opt-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.skr-opt{display:grid;gap:2px;text-align:left;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:9px 11px;cursor:pointer;font:500 13px var(--ui);color:var(--ink)}
.skr-opt:hover{border-color:var(--accent)}.skr-opt.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--accent-soft)}
.skr-opt-p{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.skr-sent-dl{display:inline-flex;align-items:center;gap:6px;margin-top:8px;border:0;background:none;padding:0;color:var(--accent);font:600 13px var(--ui);cursor:pointer}
.skr-item-links{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px}
.skr-item-links a,.skr-item-links button{display:inline-flex;align-items:center;gap:5px;font:500 13px var(--ui);color:var(--ink2);background:none;border:0;padding:0;cursor:pointer;text-decoration:none}
.skr-item-links a:hover,.skr-item-links button:hover{color:var(--accent);text-decoration:underline}
.skr-own{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
.skr-own input{flex:1 1 240px;min-width:0;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font:14px var(--ui);color:var(--ink);background:var(--paper)}
.skr-item-qty{display:grid;justify-items:center;gap:4px}.skr-item-qty small{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.skr-qty-static{font-size:13.5px;color:var(--ink2)}
.skr-item-p{text-align:center;font-weight:600;font-variant-numeric:tabular-nums}
.skr .muted{color:var(--muted);font-weight:400;font-size:13px}
.skr-item-inc{display:flex;justify-content:flex-end}
.skr-always{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--must)}
.skr-switch{display:inline-flex;align-items:center;gap:8px;background:none;border:0;padding:0;cursor:pointer;font:500 13px var(--ui);color:var(--muted)}
.skr-switch-t{width:42px;height:24px;border-radius:999px;background:var(--line);position:relative;transition:background .15s}
.skr-switch-t::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.skr-switch.on .skr-switch-t{background:var(--accent)}.skr-switch.on .skr-switch-t::after{transform:translateX(18px)}.skr-switch.on{color:var(--accent)}
.skr-sum{margin-top:48px;display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px;align-items:start;scroll-margin-top:80px}
.skr-sum-l{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:26px}
.skr-sum table{width:100%;border-collapse:collapse;margin-top:16px;font-variant-numeric:tabular-nums}
.skr-sum td{padding:11px 0;border-bottom:1px solid var(--line);font-size:15px}.skr-sum td:last-child{text-align:right;font-weight:600}
.skr-sum tr.tot td{border-bottom:0;padding-top:16px;font-family:var(--display);font-weight:400;font-size:32px}
.skr-fine{font-size:13px;color:var(--muted);margin:14px 0 0}
.skr-sum-r{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:24px;display:grid;gap:12px}
.skr-sum-r h3{margin:0;font-size:18px;font-weight:600}
.skr-sum-r label{display:grid;gap:5px;font-size:13px;font-weight:500;color:var(--ink2)}
.skr-sum-r input,.skr-sum-r textarea{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:15px var(--ui);color:var(--ink);background:var(--paper);resize:vertical}
.skr-sent{display:flex;gap:12px;align-items:flex-start;background:var(--accent-soft);color:var(--accent);border-radius:14px;padding:14px}
.skr-sent b{display:block;color:var(--ink)}.skr-sent p{margin:2px 0 0;font-size:13.5px;color:var(--ink2)}
.skr-err{color:#A3302A;font-size:13px;margin:0}
.skr-foot{display:flex;gap:16px;align-items:center;margin-top:56px;padding-top:24px;border-top:1px solid var(--line);color:var(--muted);font-size:13.5px}
.skr-foot p{margin:0;max-width:62ch}
.skr-bar{position:fixed;left:0;right:0;bottom:0;background:var(--paper);border-top:1px solid var(--line);box-shadow:0 -6px 20px rgba(21,33,43,.06);z-index:20;padding-bottom:env(safe-area-inset-bottom,0px)}
.skr-bar-in{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-block:12px}
.skr-bar-s{display:flex;align-items:baseline;gap:12px}.skr-bar-s span{font-size:13.5px;color:var(--muted)}.skr-bar-s b{font-family:var(--display);font-weight:400;font-size:30px;font-variant-numeric:tabular-nums}
.skr .spin{animation:skrspin 1s linear infinite}@keyframes skrspin{to{transform:rotate(360deg)}}
@media (max-width:860px){
  .skr-hero{grid-template-columns:1fr;padding-block:32px 20px}.skr-sum{grid-template-columns:1fr}
  .skr-rules{grid-template-columns:repeat(2,minmax(0,1fr))}
  .skr-over-r{grid-template-columns:minmax(0,1fr) 96px}.skr-over-bar{grid-column:1/-1;order:3}
}
@media (max-width:640px){
  .skr-opt-row,.skr-size,.skr-kitchen{grid-template-columns:1fr}
  .skr-item{grid-template-columns:repeat(3,minmax(0,1fr));grid-template-areas:"main main inc" "need have buy";row-gap:12px;padding:14px}
  .skr-item-main{grid-area:main}.skr-item-inc{grid-area:inc;align-self:start}.skr-item-qty{justify-items:start}.skr-item-qty:nth-child(2){grid-area:need}.skr-item-qty:nth-child(3){grid-area:have}.skr-item-p{grid-area:buy;text-align:left}
  .skr-qlabel{display:block}.skr-cols{display:none}.skr-hide-sm{display:none}
  .skr-switch-l{display:none}.skr-glance-v{font-size:48px}.skr-top .skr-btn.ghost{padding:8px 12px}
}
@media (prefers-reduced-motion:reduce){.skr *{transition:none!important;animation:none!important}}
@media print{
  .skr{background:#fff;padding-bottom:0;font-size:12px}.skr-noprint,.skr-bar{display:none!important}
  .skr-top{position:static;border:0}.skr-hero{grid-template-columns:1fr 260px;padding-block:12px}
  .skr-glance{background:#fff;color:var(--ink);border:1px solid var(--line)}
  .skr-item.off{display:none}.skr-cat,.skr-sum,.skr-rules>div,.skr-size-c{break-inside:avoid}
  .skr-items,.skr-over,.skr-sum-l,.skr-note,.skr-size-c,.skr-rules>div{border-color:#ccc}
  .skr-sum{grid-template-columns:1fr}.skr-step{border:0}.skr-step button{display:none}
}
`
