'use client'
// THE OWNER'S ONBOARDING PAGE, /join/<code> (lib/owner-onboard). Built for a phone first, fine on a computer.
// Welcome → the home → what it already has → payouts and tax → the timeline. Saves as it goes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus, Lock, Phone, Mail, ChevronRight, ChevronLeft } from 'lucide-react'
import { OO_BEDS, OO_APPLIANCES, OO_APPLIANCE_LABEL, OO_STEPS, OO_TAX_CLASS, DEFAULT_HOME, routingOk, type OOHome, type OOItem, type OOMark } from '@/lib/owner-onboard'

type Any = any
type Tab = 'welcome' | 'home' | 'supplies' | 'payout' | 'timeline'

function Step({ label, value, set, min, max, step = 1, show }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step?: number; show?: (v: number) => string }) {
  return (
    <div className="oj-step"><span>{label}</span><div>
      <button type="button" disabled={value <= min} onClick={() => set(Math.max(min, value - step))} aria-label={'Fewer ' + label}><Minus size={15} /></button>
      <b>{show ? show(value) : value}</b>
      <button type="button" disabled={value >= max} onClick={() => set(Math.min(max, value + step))} aria-label={'More ' + label}><Plus size={15} /></button>
    </div></div>
  )
}
function Seg<T extends string>({ label, value, set, opts }: { label: string; value: T; set: (v: T) => void; opts: [T, string][] }) {
  return <div className="oj-step"><span>{label}</span><div className="oj-seg">{opts.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}</div></div>
}

export function OwnerJoin({ code }: { code: string }) {
  const [rec, setRec] = useState<Any>(null)
  const [items, setItems] = useState<OOItem[]>([])
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('welcome')
  // SEVERAL UNITS (Jon, 2026-11-13): one form per unit; the first is the link's home, the rest are "more".
  const [homes, setHomes] = useState<OOHome[]>([DEFAULT_HOME])
  const [ui, setUi] = useState(0)          // the unit being edited
  const [su, setSu] = useState(0)          // the unit whose supplies show
  const home = homes[Math.min(ui, homes.length - 1)]
  const setHome = (h: OOHome) => setHomes(hs => hs.map((x, i) => (i === Math.min(ui, hs.length - 1) ? h : x)))
  const [marks, setMarks] = useState<Record<string, OOMark>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pay, setPay] = useState<Any>({ w9: { name: '', business: '', taxClass: 'individual', llcCode: '', other: '', address: '', cityStateZip: '', tinType: 'ssn', tin: '' }, ach: { holder: '', bank: '', accountType: 'checking', routing: '', account: '', routing2: '', account2: '' }, sign: { name: '', agree: false } })
  const pending = useRef<Record<string, OOMark>>({})
  const timer = useRef<any>(null)

  const apply = (d: Any) => { setRec(d.record); setItems(d.items || []); setMarks(d.record.marks || {}); if (d.record.home) setHomes([d.record.home, ...(d.record.more || [])]); setNotes(d.record.ownerNotes || '') }
  // SIGN-IN (lib/owner-onboard-auth): an emailed magic link signs in once; then a password.
  const [gate, setGate] = useState<Any>(null)        // { hasPassword, emailHint, firstName } when locked
  const [needPw, setNeedPw] = useState(false)       // signed in by link, no password yet
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [sent, setSent] = useState(false)
  const auth = (body: Any) => fetch('/api/join/' + code + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }))
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const go = async () => {
      // a magic link: spend its token, then drop it from the address bar
      const k = new URLSearchParams(window.location.search).get('k')
      if (k) { const a = await auth({ magic: k }); window.history.replaceState(null, '', window.location.pathname); if (a?.ok && !a.hasPassword) setNeedPw(true); else if (!a?.ok) setMsg(a?.error || '') }
      const d = await fetch('/api/join/' + code, { cache: 'no-store' }).then(r => r.json()).catch(() => null)
      if (!d) { setErr('Could not open this link. Check your connection and try again.'); return }
      if (d.need === 'signin') { setGate(d); return }
      if (!d?.ok) { setErr(d?.error || 'This link is not active.'); return }
      setGate(null)
      apply(d)
      const r = d.record
      setTab(r.submittedAt ? 'timeline' : r.home ? (r.custom.askSupplies || r.custom.askLinen ? 'supplies' : 'payout') : 'welcome')
      if (r.payout) setPay((p: Any) => ({ ...p, w9: { ...p.w9, ...r.payout.w9, tin: '' }, ach: { ...p.ach, ...r.payout.ach, routing: '', account: '' }, sign: { name: r.payout.sign.name, agree: true } }))
    }
    go()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, tick])

  async function patch(body: Any): Promise<Any> {
    const r = await fetch('/api/join/' + code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => null)
    if (!d?.ok) throw new Error(d?.error || 'That did not save. Try again.')
    return d
  }
  // ticks save on their own, a moment after the last one
  function mark(k: string, v: OOMark) {
    setMarks(m => ({ ...m, [k]: v })); pending.current[k] = v
    clearTimeout(timer.current); timer.current = setTimeout(async () => { const m = pending.current; pending.current = {}; try { await patch({ marks: m }) } catch (e: Any) { setMsg(e.message) } }, 700)
  }
  const flags = rec?.custom || {}
  const tabs: Tab[] = (['welcome', 'home', ...(flags.askSupplies || flags.askLinen ? ['supplies'] : []), ...(flags.askPayout !== false ? ['payout'] : []), 'timeline'] as Tab[])
  const go = (t: Tab) => { setTab(t); setMsg(''); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const next = () => go(tabs[Math.min(tabs.length - 1, tabs.indexOf(tab) + 1)])
  const back = () => go(tabs[Math.max(0, tabs.indexOf(tab) - 1)])

  async function saveHome() { setBusy(true); setMsg(''); try { apply(await patch({ home: homes[0], more: homes.slice(1) })); setSu(0); next() } catch (e: Any) { setMsg(e.message) } finally { setBusy(false) } }
  async function finishSupplies() { setBusy(true); setMsg(''); try { clearTimeout(timer.current); const m = pending.current; pending.current = {}; apply(await patch({ marks: m, ownerNotes: notes, submit: flags.askPayout === false })); next() } catch (e: Any) { setMsg(e.message) } finally { setBusy(false) } }
  async function savePayout(e: React.FormEvent) {
    e.preventDefault(); setMsg('')
    const tin = pay.w9.tin.replace(/\D/g, ''), rt = pay.ach.routing.replace(/\D/g, ''), ac = pay.ach.account.replace(/\D/g, '')
    const have = !!rec?.payout
    if (!(have && !tin) && tin.length !== 9) { setMsg('The SSN or EIN must be 9 digits.'); return }
    if (!(have && !rt && !ac)) {
      if (rt.length !== 9) { setMsg('The routing number should be 9 digits. It is the first number at the bottom left of a check.'); return }
      if (!routingOk(rt)) { setMsg('That routing number does not match any US bank (banks build a check digit into it, and this one fails it). Please check it against a check or your bank’s app.'); return }
      if (rt !== String(pay.ach.routing2 || '').replace(/\D/g, '')) { setMsg('The two routing numbers do not match. Please re-enter them.'); return }
      if (ac !== String(pay.ach.account2 || '').replace(/\D/g, '')) { setMsg('The two account numbers do not match. Please re-enter them.'); return }
    }
    setBusy(true)
    try { const d = await patch({ payout: pay, submit: true }); apply(d); setPay((p: Any) => ({ ...p, w9: { ...p.w9, tin: '' }, ach: { ...p.ach, routing: '', account: '', routing2: '', account2: '' } })); go('timeline') } catch (e2: Any) { setMsg(e2.message) } finally { setBusy(false) }
  }

  const unitCount = Math.max(1, ...items.map(i => (i.unit || 0) + 1))
  const shown = useMemo(() => items.filter(i => (i.unit || 0) === Math.min(su, unitCount - 1)), [items, su, unitCount])
  const groups = useMemo(() => Array.from(new Set(shown.map(i => i.group))), [shown])
  const counts = { have: items.filter(i => marks[i.key] === 'have').length, need: items.filter(i => marks[i.key] === 'need').length }
  const c = flags.contact || {}
  const first = (flags.ownerName || '').split(' ')[0]

  const shell = (inner: React.ReactNode) => <main className="oj"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" /><style>{CSS}</style><div className="oj-wrap oj-auth"><img src="/stay-logo.png" alt="Stay Hospitality" className="oj-logo" />{inner}</div></main>
  if (gate) return shell(<>
    <p className="oj-kick">Owner onboarding</p>
    <h1>{gate.firstName ? <>Welcome back, <em>{gate.firstName}.</em></> : <>Sign in to <em>your onboarding.</em></>}</h1>
    {gate.hasPassword ? (
      <form className="oj-card oj-authcard" onSubmit={async e => { e.preventDefault(); setBusy(true); setMsg(''); const a = await auth({ password: pw }); setBusy(false); if (a?.ok) { setPw(''); setTick(t => t + 1) } else setMsg(a?.error || 'That did not work.') }}>
        <label className="oj-f"><span>Password</span><input type="password" autoComplete="current-password" required value={pw} onChange={e => setPw(e.target.value)} autoFocus /></label>
        {msg ? <p className="oj-err">{msg}</p> : null}
        <button type="submit" className="oj-cta" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    ) : <p className="oj-p">This page is private. Open the link in the email we sent you, or have a new one sent below.</p>}
    {!gate.hasPassword && msg ? <p className="oj-err">{msg}</p> : null}
    <div className="oj-card oj-authcard">
      <p className="oj-lab">{gate.hasPassword ? 'Forgot it?' : 'Need a link?'}</p>
      {sent ? <p className="oj-ok"><Check size={15} /> If we have an email for this link, a sign-in link is on its way{gate.emailHint ? ' to ' + gate.emailHint : ''}. It works for 30 minutes.</p>
        : <><p className="oj-p">We will email a one-time sign-in link{gate.emailHint ? ' to ' + gate.emailHint : ' to the address we have for you'}.</p>
          <button type="button" className="oj-ghost" onClick={async () => { await auth({ sendLink: 1 }); setSent(true) }}><Mail size={15} /> Email me a sign-in link</button></>}
    </div>
  </>)
  if (rec && (needPw)) return shell(<>
    <p className="oj-kick">One quick step</p>
    <h1>Create <em>your password.</em></h1>
    <p className="oj-p">So only you can come back to this page. You will use it with this same link.</p>
    <form className="oj-card oj-authcard" onSubmit={async e => { e.preventDefault(); if (pw.length < 8) { setMsg('Use at least 8 characters.'); return } if (pw !== pw2) { setMsg('The two passwords do not match.'); return } setBusy(true); setMsg(''); const a = await auth({ setPassword: pw }); setBusy(false); if (a?.ok) { setNeedPw(false); setPw(''); setPw2('') } else setMsg(a?.error || 'That did not save.') }}>
      <label className="oj-f"><span>Password (8 or more characters)</span><input type="password" autoComplete="new-password" required value={pw} onChange={e => setPw(e.target.value)} autoFocus /></label>
      <label className="oj-f"><span>Type it again</span><input type="password" autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></label>
      {msg ? <p className="oj-err">{msg}</p> : null}
      <button type="submit" className="oj-cta" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
    </form>
  </>)
  if (err) return <main className="oj"><style>{CSS}</style><div className="oj-wrap"><img src="/stay-logo.png" alt="Stay Hospitality" className="oj-logo" /><h1>This link is not active</h1><p className="oj-p">{err}</p></div></main>
  if (!rec) return <main className="oj"><style>{CSS}</style><div className="oj-wrap"><p className="oj-p">Opening your onboarding…</p></div></main>

  const timeline = (
    <ol className="oj-time">
      {OO_STEPS.filter(s => s.key !== 'paperwork' || flags.askPayout !== false).map(s => {
        const st = rec.steps.find((x: Any) => x.key === s.key) || { status: 'todo' }
        return (
          <li key={s.key} className={'oj-t-' + st.status}>
            <i>{st.status === 'done' ? <Check size={13} /> : null}</i>
            <div><b>{s.label}</b><span>{s.key === 'call' && rec.call?.at ? 'Scheduled for ' + new Date(rec.call.at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : s.owner}</span>
              {s.key === 'call' && rec.call?.link ? <a href={rec.call.link} target="_blank" rel="noreferrer">Join the call</a> : null}
              {st.status === 'done' && st.date ? <small>Done {new Date(st.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small> : st.status === 'doing' ? <small>In progress</small> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )

  return (
    <main className="oj">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" />
      <style>{CSS}</style>
      <header className="oj-top"><div className="oj-wrap oj-top-in"><img src="/stay-logo.png" alt="Stay Hospitality" className="oj-logo" /><span>{[rec.attach.property, rec.attach.unitLabel ? 'Unit ' + rec.attach.unitLabel : ''].filter(Boolean).join(' · ') || 'Owner onboarding'}</span></div>
        <div className="oj-wrap"><nav className="oj-tabs">{tabs.map((t, i) => <button key={t} type="button" className={(t === tab ? 'on ' : '') + (tabs.indexOf(tab) > i ? 'past' : '')} onClick={() => go(t)}><em>{i + 1}</em>{({ welcome: 'Welcome', home: 'Your home', supplies: 'Supplies', payout: 'Payouts and tax', timeline: 'Timeline' } as Record<Tab, string>)[t]}</button>)}</nav></div>
      </header>

      <div className="oj-wrap oj-body">
        {tab === 'welcome' ? (
          <section className="oj-grid">
            <div>
              <p className="oj-kick">Welcome to Stay Hospitality</p>
              <h1>{first ? <>Hi {first}, <em>let’s get started.</em></> : <>Let’s get your home <em>started.</em></>}</h1>
              <p className="oj-p">{flags.greeting || 'This page walks you through everything we need before your home goes live. It takes about ten minutes, saves as you go, and you can come back to it any time from this link.'}</p>
              <button type="button" className="oj-cta" onClick={next}>Start <ChevronRight size={16} /></button>
            </div>
            <aside className="oj-card"><p className="oj-lab">What happens next</p>{timeline}</aside>
          </section>
        ) : null}

        {tab === 'home' ? (
          <section>
            <p className="oj-kick">Step {tabs.indexOf('home') + 1}</p>
            <h1>Tell us about <em>{homes.length > 1 ? 'each unit.' : 'the home.'}</em></h1>
            <p className="oj-p">This builds the list of everything the home needs, sized to its beds, baths and kitchen. More than one unit with us? Add each one.</p>
            <div className="oj-units">
              {homes.map((h, i) => <button key={i} type="button" className={i === ui ? 'on' : ''} onClick={() => setUi(i)}>{h.unit ? 'Unit ' + h.unit : 'Unit ' + (i + 1)}</button>)}
              <button type="button" className="add" onClick={() => { setHomes(hs => [...hs, { ...DEFAULT_HOME, address: hs[0].address, uid: Math.random().toString(36).slice(2, 8) }]); setUi(homes.length) }}><Plus size={13} /> Add another unit</button>
              {ui > 0 ? <button type="button" className="rm" onClick={() => { setHomes(hs => hs.filter((_, i) => i !== ui)); setUi(ui - 1) }}>Remove this unit</button> : null}
            </div>
            <div className="oj-sec">
              <p className="oj-sec-h"><em>1</em> The basics</p>
              <div className="oj-form">
                <label className="oj-f oj-wide"><span>Address</span><input value={home.address} onChange={e => setHome({ ...home, address: e.target.value })} placeholder="Street, city" autoComplete="street-address" /></label>
                <label className="oj-f"><span>Unit</span><input value={home.unit} onChange={e => setHome({ ...home, unit: e.target.value })} placeholder="e.g. 2401" /></label>
                <label className="oj-f"><span>Square feet</span><input inputMode="numeric" value={home.sqft || ''} onChange={e => setHome({ ...home, sqft: Number(e.target.value.replace(/\D/g, '')) || 0 })} placeholder="e.g. 850" /></label>
                <Step label="Bedrooms" value={home.bedrooms} set={v => setHome({ ...home, bedrooms: v })} min={0} max={10} show={v => (v === 0 ? 'Studio' : String(v))} />
                <Step label="Bathrooms" value={home.bathrooms} set={v => setHome({ ...home, bathrooms: v })} min={1} max={10} step={0.5} />
                <Step label="Sleeps" value={home.guests} set={v => setHome({ ...home, guests: v })} min={1} max={24} />
              </div>
            </div>
            <div className="oj-sec">
              <p className="oj-sec-h"><em>2</em> Beds <small>how many of each size</small></p>
              <div className="oj-form">
                {OO_BEDS.map(b => <Step key={b} label={b} value={home.beds[b] || 0} set={v => setHome({ ...home, beds: { ...home.beds, [b]: v } })} min={0} max={8} />)}
                <Seg label="Sofa bed" value={home.sleeper ? 'y' : 'n'} set={v => setHome({ ...home, sleeper: v === 'y' })} opts={[['n', 'No'], ['y', 'Yes']]} />
              </div>
              {!OO_BEDS.some(b => home.beds[b]) ? <p className="oj-warn">Add at least one bed so we can size the linen.</p> : null}
            </div>
            <div className="oj-sec oj-kitchen">
              <p className="oj-sec-h"><em>3</em> Kitchen <small>this sets the cookware and dish list</small></p>
              <div className="oj-bigchoice">
                <button type="button" className={home.kitchen ? 'on' : ''} onClick={() => setHome({ ...home, kitchen: true })}><b>Yes, it has a kitchen</b><span>Full kitchen or kitchenette</span></button>
                <button type="button" className={!home.kitchen ? 'on' : ''} onClick={() => setHome({ ...home, kitchen: false })}><b>No kitchen</b><span>We skip the kitchen items</span></button>
              </div>
              {home.kitchen ? (<>
                <p className="oj-q">Which appliances does it have? <small>Tap each one it has</small></p>
                <div className="oj-appgrid">{OO_APPLIANCES.map(a => <button key={a} type="button" className={home.appliances[a] ? 'on' : ''} onClick={() => setHome({ ...home, appliances: { ...home.appliances, [a]: !home.appliances[a] } })}><i>{home.appliances[a] ? <Check size={14} /> : null}</i>{OO_APPLIANCE_LABEL[a]}</button>)}</div>
                <p className="oj-small">{OO_APPLIANCES.filter(a => home.appliances[a]).length} of {OO_APPLIANCES.length} selected. Leave one off and we leave out what goes with it (no oven, no baking sheets).</p>
              </>) : null}
            </div>
            <div className="oj-sec">
              <p className="oj-sec-h"><em>4</em> Laundry, parking and access</p>
              <div className="oj-form">
                <Seg label="Washer and dryer in the unit" value={home.washer ? 'y' : 'n'} set={v => setHome({ ...home, washer: v === 'y' })} opts={[['n', 'No'], ['y', 'Yes']]} />
                <label className="oj-f oj-wide"><span>Parking (optional)</span><input value={home.parking} onChange={e => setHome({ ...home, parking: e.target.value })} placeholder="e.g. one assigned space, P2 #114" /></label>
                <label className="oj-f oj-wide"><span>Access (optional)</span><input value={home.access} onChange={e => setHome({ ...home, access: e.target.value })} placeholder="e.g. front desk holds the key; building app" /></label>
              </div>
            </div>
            {msg ? <p className="oj-err">{msg}</p> : null}
            <div className="oj-nav"><button type="button" className="oj-ghost" onClick={back}><ChevronLeft size={16} /> Back</button><button type="button" className="oj-cta" disabled={busy} onClick={saveHome}>{busy ? 'Saving…' : 'Save and continue'} <ChevronRight size={16} /></button></div>
          </section>
        ) : null}

        {tab === 'supplies' ? (
          <section>
            <p className="oj-kick">Step {tabs.indexOf('supplies') + 1}</p>
            <h1>What does the home <em>already have?</em></h1>
            <p className="oj-p">Everything a rental this size needs. Tick <b>Have</b> for what is there and <b>Need</b> for what is missing; we will go through what to buy together. It saves as you tick.</p>
            {!items.length ? <p className="oj-p">Fill in the home first, then the list appears here.</p> : (<>
              {unitCount > 1 ? <div className="oj-units">{Array.from({ length: unitCount }, (_, i) => { const l = items.find(x => (x.unit || 0) === i)?.unitLabel || 'Unit ' + (i + 1); const left = items.filter(x => (x.unit || 0) === i && !marks[x.key]).length; return <button key={i} type="button" className={i === su ? 'on' : ''} onClick={() => setSu(i)}>{l}{left ? <small> · {left} to check</small> : <small> · done</small>}</button> })}</div> : null}
              <div className="oj-tally"><span><b>{counts.have}</b> have</span><span><b>{counts.need}</b> need</span><span><b>{items.length - counts.have - counts.need}</b> to check</span></div>
              <div className="oj-cols">
                {groups.map(g => {
                  const list = shown.filter(i => i.group === g)
                  return (
                    <div key={g} className="oj-group">
                      <div className="oj-g-head"><p className="oj-lab">{g}</p><button type="button" onClick={() => list.forEach(i => mark(i.key, 'have'))}>All have</button></div>
                      <ul>{list.map(i => (
                        <li key={i.key} className={'oj-m-' + (marks[i.key] || '')}>
                          <span>{i.name}{i.size ? <small> · {i.size}</small> : null}<em>×{i.qty}</em></span>
                          <div className="oj-hn">
                            <button type="button" className={marks[i.key] === 'have' ? 'on have' : ''} onClick={() => mark(i.key, marks[i.key] === 'have' ? '' : 'have')}>Have</button>
                            <button type="button" className={marks[i.key] === 'need' ? 'on need' : ''} onClick={() => mark(i.key, marks[i.key] === 'need' ? '' : 'need')}>Need</button>
                          </div>
                        </li>
                      ))}</ul>
                    </div>
                  )
                })}
              </div>
              <label className="oj-f oj-wide oj-mt"><span>Anything we should know? (optional)</span><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. the sofa is staying; we have spare towels in the closet" /></label>
            </>)}
            {msg ? <p className="oj-err">{msg}</p> : null}
            <div className="oj-nav"><button type="button" className="oj-ghost" onClick={back}><ChevronLeft size={16} /> Back</button><button type="button" className="oj-cta" disabled={busy} onClick={finishSupplies}>{busy ? 'Saving…' : 'Save and continue'} <ChevronRight size={16} /></button></div>
          </section>
        ) : null}

        {tab === 'payout' ? (
          <form onSubmit={savePayout}>
            <p className="oj-kick">Step {tabs.indexOf('payout') + 1}</p>
            <h1>Payouts <em>and tax.</em></h1>
            <p className="oj-p oj-lock"><Lock size={15} /> Your tax ID and bank numbers are encrypted the moment you send them, and only the last four digits are ever shown again. We use them for your W-9 and to pay you.</p>
            {rec.payout ? <p className="oj-ok"><Check size={15} /> Received {new Date(rec.payout.sign.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Leave the numbers blank to keep the ones on file.</p> : null}
            <div className="oj-pay">
              <fieldset><legend>W-9 · tax details</legend>
                <label className="oj-f"><span>Name (as shown on your tax return)</span><input required value={pay.w9.name} onChange={e => setPay({ ...pay, w9: { ...pay.w9, name: e.target.value } })} autoComplete="name" /></label>
                <label className="oj-f"><span>Business name, if different (optional)</span><input value={pay.w9.business} onChange={e => setPay({ ...pay, w9: { ...pay.w9, business: e.target.value } })} /></label>
                <label className="oj-f"><span>Tax classification</span><select value={pay.w9.taxClass} onChange={e => setPay({ ...pay, w9: { ...pay.w9, taxClass: e.target.value } })}>{OO_TAX_CLASS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
                {pay.w9.taxClass === 'llc' ? <label className="oj-f"><span>LLC taxed as</span><select value={pay.w9.llcCode} onChange={e => setPay({ ...pay, w9: { ...pay.w9, llcCode: e.target.value } })}><option value="">Choose</option><option value="C">C corporation (C)</option><option value="S">S corporation (S)</option><option value="P">Partnership (P)</option></select></label> : null}
                {pay.w9.taxClass === 'other' ? <label className="oj-f"><span>Describe</span><input value={pay.w9.other} onChange={e => setPay({ ...pay, w9: { ...pay.w9, other: e.target.value } })} /></label> : null}
                <label className="oj-f"><span>Mailing address</span><input required value={pay.w9.address} onChange={e => setPay({ ...pay, w9: { ...pay.w9, address: e.target.value } })} autoComplete="address-line1" /></label>
                <label className="oj-f"><span>City, state, ZIP</span><input required value={pay.w9.cityStateZip} onChange={e => setPay({ ...pay, w9: { ...pay.w9, cityStateZip: e.target.value } })} /></label>
                <Seg label="Tax ID" value={pay.w9.tinType} set={v => setPay({ ...pay, w9: { ...pay.w9, tinType: v } })} opts={[['ssn', 'SSN'], ['ein', 'EIN']]} />
                <label className="oj-f"><span>{pay.w9.tinType === 'ein' ? 'EIN' : 'Social Security number'}{rec.payout ? ' (on file: ' + rec.payout.w9.tinHint + ')' : ''}</span><input inputMode="numeric" autoComplete="off" value={pay.w9.tin} onChange={e => setPay({ ...pay, w9: { ...pay.w9, tin: e.target.value } })} placeholder={pay.w9.tinType === 'ein' ? '12-3456789' : '123-45-6789'} /></label>
              </fieldset>
              <fieldset><legend>Bank account for payouts (ACH)</legend>
                <label className="oj-f"><span>Account holder</span><input required value={pay.ach.holder} onChange={e => setPay({ ...pay, ach: { ...pay.ach, holder: e.target.value } })} /></label>
                <label className="oj-f"><span>Bank</span><input required value={pay.ach.bank} onChange={e => setPay({ ...pay, ach: { ...pay.ach, bank: e.target.value } })} placeholder="e.g. Chase" /></label>
                <Seg label="Account type" value={pay.ach.accountType} set={v => setPay({ ...pay, ach: { ...pay.ach, accountType: v } })} opts={[['checking', 'Checking'], ['savings', 'Savings']]} />
                <label className="oj-f"><span>Routing number{rec.payout ? ' (on file: ' + rec.payout.ach.routingHint + ')' : ''}</span><input inputMode="numeric" autoComplete="off" value={pay.ach.routing} onChange={e => setPay({ ...pay, ach: { ...pay.ach, routing: e.target.value } })} placeholder="9 digits" /></label>
                <label className="oj-f"><span>Confirm routing number</span><input inputMode="numeric" autoComplete="off" onPaste={e => e.preventDefault()} value={pay.ach.routing2} onChange={e => setPay({ ...pay, ach: { ...pay.ach, routing2: e.target.value } })} placeholder="Type it again" />{pay.ach.routing2 && pay.ach.routing.replace(/\D/g, '') === pay.ach.routing2.replace(/\D/g, '') && routingOk(pay.ach.routing) ? <small className="oj-match"><Check size={12} /> Matches</small> : null}</label>
                <label className="oj-f"><span>Account number{rec.payout ? ' (on file: ' + rec.payout.ach.accountHint + ')' : ''}</span><input inputMode="numeric" autoComplete="off" value={pay.ach.account} onChange={e => setPay({ ...pay, ach: { ...pay.ach, account: e.target.value } })} /></label>
                <label className="oj-f"><span>Confirm account number</span><input inputMode="numeric" autoComplete="off" onPaste={e => e.preventDefault()} value={pay.ach.account2} onChange={e => setPay({ ...pay, ach: { ...pay.ach, account2: e.target.value } })} placeholder="Type it again" />{pay.ach.account2 && pay.ach.account.replace(/\D/g, '') === pay.ach.account2.replace(/\D/g, '') ? <small className="oj-match"><Check size={12} /> Matches</small> : null}</label>
              </fieldset>
            </div>
            <fieldset className="oj-sign"><legend>Sign</legend>
              <p className="oj-small">Under penalties of perjury, I certify the W-9 statements: the number shown is my correct taxpayer identification number; I am not subject to backup withholding (unless I have been notified otherwise); I am a U.S. citizen or other U.S. person; and any FATCA code entered is correct. I also authorize Stay Hospitality to deposit my owner payouts into the account above until I cancel this in writing.</p>
              <label className="oj-f"><span>Type your full name to sign</span><input required value={pay.sign.name} onChange={e => setPay({ ...pay, sign: { ...pay.sign, name: e.target.value } })} autoComplete="name" /></label>
              <label className="oj-check"><input type="checkbox" checked={pay.sign.agree} onChange={e => setPay({ ...pay, sign: { ...pay.sign, agree: e.target.checked } })} /> I agree, and I am signing electronically.</label>
            </fieldset>
            {msg ? <p className="oj-err">{msg}</p> : null}
            <div className="oj-nav"><button type="button" className="oj-ghost" onClick={back}><ChevronLeft size={16} /> Back</button><button type="submit" className="oj-cta" disabled={busy}>{busy ? 'Sending securely…' : 'Send securely'} <Lock size={15} /></button></div>
          </form>
        ) : null}

        {tab === 'timeline' ? (
          <section className="oj-grid">
            <div>
              <p className="oj-kick">{rec.submittedAt ? 'Thank you' : 'Your onboarding'}</p>
              <h1>{rec.submittedAt ? <>You’re all set <em>for now.</em></> : <>Where things <em>stand.</em></>}</h1>
              <p className="oj-p">{rec.submittedAt ? 'We have what we need to start. Next come the photos and your listing. Once the photos are done, we will set up a call to walk you through the listing and the pricing strategy. This page shows each step as it happens.' : 'Each step, and where it stands.'}</p>
              {flags.askPayout !== false ? (
                <div className="oj-card oj-docs">
                  <p className="oj-lab">Your W-9 and payout account</p>
                  {rec.payout ? (<>
                    <p className="oj-ok"><Check size={15} /> On file since {new Date(rec.payout.sign.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    <p className="oj-small">{rec.payout.w9.tinType === 'ein' ? 'EIN' : 'SSN'} {rec.payout.w9.tinHint} · {rec.payout.ach.bank} {rec.payout.ach.accountType} {rec.payout.ach.accountHint}</p>
                    <div className="oj-docbtns">
                      <a className="oj-ghost" href={'/api/join/' + code + '/forms?doc=w9'}>Download my W-9</a>
                      <a className="oj-ghost" href={'/api/join/' + code + '/forms?doc=ach'}>Download my ACH form</a>
                      <button type="button" className="oj-ghost" onClick={() => go('payout')}>Update</button>
                    </div>
                  </>) : <><p className="oj-p">Not sent yet. We need these to pay you and for your tax form.</p><button type="button" className="oj-cta" onClick={() => go('payout')}>Fill in my W-9 and bank details <Lock size={15} /></button></>}
                </div>
              ) : null}
              {counts.need ? <p className="oj-p">You marked <b>{counts.need}</b> item{counts.need === 1 ? '' : 's'} the home still needs. We will go through them with you before anything is bought.</p> : null}
            </div>
            <aside className="oj-card">{timeline}</aside>
          </section>
        ) : null}

        {c.name ? (
          <section className="oj-who">
            {c.photo ? <img src={c.photo} alt={c.name} /> : null}
            <div><p className="oj-lab">Questions? Talk to {c.name.split(' ')[0]}</p><p className="oj-who-n">{c.name}{c.role ? <span>, {c.role}</span> : null}</p>
              <p className="oj-who-c">{c.phone ? <a href={'tel:' + c.phone.replace(/[^\d+]/g, '')}><Phone size={14} /> {c.phone}</a> : null}{c.email ? <a href={'mailto:' + c.email}><Mail size={14} /> {c.email}</a> : null}</p></div>
          </section>
        ) : null}
        <p className="oj-foot">Stay Hospitality · Short-term rental management across Miami-Dade and Broward · stay-hospitality.com</p>
      </div>
    </main>
  )
}

const CSS = `
.oj{--ink:#121316;--body:#3A3B40;--mut:#6E6F74;--rule:#E5E1D8;--acc:#8C6D3A;--soft:#F1EDE4;--navy:#14161B;--ok:#2F7D4F;--bad:#A1332B;
  min-height:100vh;background:#F7F5F0;color:var(--body);font:400 15px/1.55 Inter,system-ui,sans-serif;overflow-x:clip}
.oj *{box-sizing:border-box}
.oj-wrap{max-width:1040px;margin:0 auto;padding-left:max(18px,env(safe-area-inset-left));padding-right:max(18px,env(safe-area-inset-right))}
.oj-top{background:#fff;border-bottom:1px solid var(--rule);position:sticky;top:0;z-index:10}
.oj-top-in{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;padding-bottom:8px}
.oj-top-in span{font:600 12.5px Inter,sans-serif;color:var(--mut);text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oj-logo{height:26px}
.oj-tabs{display:flex;gap:4px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}
.oj-tabs::-webkit-scrollbar{display:none}
.oj-tabs button{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:6px 10px;border-radius:99px;font:600 12.5px Inter,sans-serif;color:var(--mut);cursor:pointer}
.oj-tabs button em{font-style:normal;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:var(--soft);font-size:11px}
.oj-tabs button.on{background:var(--navy);color:#fff}.oj-tabs button.on em{background:#fff;color:var(--navy)}
.oj-tabs button.past em{background:var(--ok);color:#fff}
.oj-body{padding-top:32px;padding-bottom:56px}
.oj-kick,.oj-lab{font:600 11px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin:0 0 8px}
.oj h1{font:400 clamp(34px,6vw,54px)/1.04 "Instrument Serif",Georgia,serif;color:var(--ink);margin:0 0 12px;letter-spacing:-.01em}
.oj h1 em{font-style:italic}
.oj-p{max-width:62ch;margin:0 0 14px}
.oj-small{font-size:12.5px;color:var(--mut);margin:0 0 10px}
.oj-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:36px;align-items:start}
.oj-card{background:#fff;border:1px solid var(--rule);border-radius:18px;padding:20px 22px}
.oj-cta{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 22px;border-radius:99px;border:0;background:var(--navy);color:#fff;font:600 14.5px Inter,sans-serif;cursor:pointer}
.oj-cta:disabled{opacity:.6}
.oj-ghost{display:inline-flex;align-items:center;gap:6px;height:48px;padding:0 18px;border-radius:99px;border:1px solid var(--rule);background:#fff;color:var(--ink);font:600 14px Inter,sans-serif;cursor:pointer}
.oj-nav{display:flex;justify-content:space-between;gap:10px;margin-top:26px;flex-wrap:wrap}
.oj-err{color:var(--bad);font-weight:600;margin:14px 0 0}
.oj-ok{display:flex;gap:6px;align-items:center;color:var(--ok);font-weight:600;margin:0 0 12px}
.oj-lock{display:flex;gap:8px;align-items:flex-start;background:var(--soft);border-radius:12px;padding:12px 14px}
.oj-lock svg{flex:0 0 auto;margin-top:3px;color:var(--acc)}
.oj-form{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;background:#fff;border:1px solid var(--rule);border-radius:18px;padding:8px 22px 18px;margin-top:18px}
.oj-wide{grid-column:1/-1}
.oj-step{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule);min-width:0}
.oj-step>span{font:600 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.oj-step>div{display:flex;align-items:center;gap:10px}
.oj-step button{width:36px;height:36px;border-radius:99px;border:1px solid var(--rule);background:#fff;color:var(--ink);display:grid;place-items:center;cursor:pointer}
.oj-step button:disabled{opacity:.35}
.oj-step b{min-width:52px;text-align:center;font:400 24px "Instrument Serif",Georgia,serif;color:var(--ink)}
.oj-seg{display:inline-flex;background:var(--soft);border-radius:99px;padding:3px}
.oj-seg button{width:auto!important;height:32px!important;border:0!important;padding:0 14px;background:transparent!important;font:600 12.5px Inter,sans-serif;color:var(--mut)!important;border-radius:99px!important}
.oj-seg button.on{background:#fff!important;color:var(--ink)!important;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.oj-sub{font:400 21px "Instrument Serif",Georgia,serif;color:var(--ink);margin:18px 0 0}
.oj-f{display:grid;gap:6px;padding:12px 0;border-bottom:1px solid var(--rule);min-width:0}
.oj-f>span{font:600 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.oj-f input,.oj-f select,.oj-f textarea{width:100%;font:500 15px Inter,sans-serif;color:var(--ink);border:1px solid var(--rule);border-radius:10px;padding:11px 12px;background:#fff}
.oj-auth{max-width:520px;padding-top:36px;padding-bottom:60px}.oj-auth .oj-logo{margin-bottom:36px}.oj-authcard{margin-top:16px;display:grid;gap:12px}.oj-authcard .oj-f{border-bottom:0;padding:0}.oj-authcard .oj-cta,.oj-authcard .oj-ghost{justify-self:start}
.oj-sec{margin-top:18px}
.oj-sec-h{display:flex;align-items:center;gap:10px;font:400 24px "Instrument Serif",Georgia,serif;color:var(--ink);margin:0 0 8px}
.oj-sec-h em{font:600 13px Inter,sans-serif;font-style:normal;width:26px;height:26px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;flex:0 0 26px}
.oj-sec-h small{font:400 13px Inter,sans-serif;color:var(--mut)}
.oj-sec .oj-form{margin-top:0}
.oj-kitchen{background:#fff;border:2px solid var(--acc);border-radius:18px;padding:16px 18px 14px}
.oj-bigchoice{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.oj-bigchoice button{text-align:left;padding:14px 16px;border-radius:14px;border:2px solid var(--rule);background:#fff;cursor:pointer;display:grid;gap:2px}
.oj-bigchoice button b{font:600 15px Inter,sans-serif;color:var(--ink)}.oj-bigchoice button span{font-size:12.5px;color:var(--mut)}
.oj-bigchoice button.on{border-color:var(--navy);background:var(--soft)}
.oj-q{font:600 15px Inter,sans-serif;color:var(--ink);margin:16px 0 8px}.oj-q small{font-weight:400;color:var(--mut);margin-left:6px}
.oj-appgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.oj-appgrid button{display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:12px;border:2px solid var(--rule);background:#fff;color:var(--ink);font:600 14px Inter,sans-serif;cursor:pointer;text-align:left}
.oj-appgrid button i{flex:0 0 22px;height:22px;border-radius:6px;border:2px solid var(--rule);display:grid;place-items:center;color:#fff}
.oj-appgrid button.on{border-color:var(--ok);background:#F1F8F3}.oj-appgrid button.on i{background:var(--ok);border-color:var(--ok)}
.oj-warn{color:#B4532A;font-weight:600;font-size:13px;margin:8px 0 0}
@media (max-width:520px){.oj-bigchoice{grid-template-columns:1fr}}
.oj-docs{margin:6px 0 16px}.oj-docbtns{display:flex;flex-wrap:wrap;gap:8px}.oj-docbtns .oj-ghost{height:40px;text-decoration:none;font-size:13px}
.oj-units{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 4px}.oj-units button{height:36px;padding:0 14px;border-radius:99px;border:1px solid var(--rule);background:#fff;color:var(--ink);font:600 13px Inter,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:4px}.oj-units button.on{background:var(--navy);border-color:var(--navy);color:#fff}.oj-units button.add{border-style:dashed;color:var(--acc)}.oj-units button.rm{border:0;background:none;color:var(--bad);font-weight:500}.oj-units small{font-weight:400;opacity:.8}
.oj-match{display:inline-flex;align-items:center;gap:4px;color:var(--ok);font-weight:600;font-size:12px}
.oj-apps{padding:12px 0;border-bottom:1px solid var(--rule)}
.oj-apps>span{font:600 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.oj-apps>div{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.oj-apps button{display:inline-flex;align-items:center;gap:4px;height:36px;padding:0 14px;border-radius:99px;border:1px solid var(--rule);background:#fff;color:var(--mut);font:600 13px Inter,sans-serif;cursor:pointer}
.oj-apps button.on{background:var(--navy);border-color:var(--navy);color:#fff}
.oj-tally{display:flex;gap:18px;flex-wrap:wrap;margin:6px 0 4px;font-size:14px}
.oj-tally b{font:400 26px "Instrument Serif",Georgia,serif;color:var(--ink);margin-right:4px}
.oj-cols{columns:2 420px;column-gap:24px;margin-top:10px}
.oj-group{break-inside:avoid;background:#fff;border:1px solid var(--rule);border-radius:16px;padding:14px 16px;margin:0 0 16px}
.oj-g-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.oj-g-head .oj-lab{margin:0}
.oj-g-head button{border:0;background:none;color:var(--acc);font:600 12px Inter,sans-serif;cursor:pointer}
.oj-group ul{list-style:none;margin:6px 0 0;padding:0}
.oj-group li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--rule)}
.oj-group li>span{min-width:0;color:var(--ink);font-size:14px}
.oj-group li small{color:var(--mut)}
.oj-group li em{font-style:normal;margin-left:8px;color:var(--mut);font:400 16px "Instrument Serif",Georgia,serif}
.oj-hn{display:flex;gap:4px;flex:0 0 auto}
.oj-hn button{height:32px;padding:0 12px;border-radius:99px;border:1px solid var(--rule);background:#fff;color:var(--mut);font:600 12.5px Inter,sans-serif;cursor:pointer}
.oj-hn button.have{background:var(--ok);border-color:var(--ok);color:#fff}
.oj-hn button.need{background:#B4532A;border-color:#B4532A;color:#fff}
.oj-mt{margin-top:8px}
.oj-pay{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px}
.oj fieldset{border:1px solid var(--rule);border-radius:16px;background:#fff;padding:10px 18px 14px;margin:0;min-width:0}
.oj legend{font:600 11px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);padding:0 6px}
.oj-sign{margin-top:18px!important}
.oj-check{display:flex;gap:8px;align-items:center;padding-top:12px;font-weight:600;color:var(--ink)}
.oj-check input{width:18px;height:18px}
.oj-time{list-style:none;margin:0;padding:0}
.oj-time li{display:flex;gap:12px;position:relative;padding:0 0 18px}
.oj-time li:not(:last-child)::before{content:"";position:absolute;left:11px;top:24px;bottom:2px;width:2px;background:var(--rule)}
.oj-time i{flex:0 0 24px;height:24px;border-radius:50%;border:2px solid var(--rule);background:#fff;display:grid;place-items:center;color:#fff}
.oj-time .oj-t-done i{background:var(--ok);border-color:var(--ok)}
.oj-time .oj-t-doing i{border-color:var(--acc);box-shadow:inset 0 0 0 4px #fff;background:var(--acc)}
.oj-time b{display:block;color:var(--ink);font-weight:600}
.oj-time span{display:block;font-size:13.5px;color:var(--body)}
.oj-time small{display:block;font-size:12px;color:var(--mut);margin-top:2px}
.oj-time a{font-weight:600;color:var(--acc)}
.oj-who{display:flex;gap:16px;align-items:center;margin-top:36px;padding:18px 20px;background:#fff;border:1px solid var(--rule);border-radius:16px}
.oj-who img{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:0 0 64px}
.oj-who>div{min-width:0}.oj-who p{margin:0}
.oj-who-n{font:600 16px Inter,sans-serif;color:var(--ink)}.oj-who-n span{font-weight:400;color:var(--mut)}
.oj-who-c{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:4px!important}
.oj-who-c a{display:inline-flex;align-items:center;gap:6px;color:var(--ink);text-decoration:none;font-weight:500;overflow-wrap:anywhere}
.oj-foot{margin-top:28px;font-size:12px;color:var(--mut)}
@media (max-width:760px){.oj-grid,.oj-pay{grid-template-columns:1fr;gap:20px}.oj-form{grid-template-columns:1fr;padding:4px 16px 14px}.oj-body{padding-top:22px}.oj-nav .oj-cta{flex:1;justify-content:center}}
`
