'use client'
// THE WALKTHROUGH COUNT SHEET (Jon, 2026-11-13: "a link for marking yes or no so we can get the actual count. Should allow
// us to put a number… if it is a single item, they can mark it yes or no"). Made for a phone in one hand, standing in
// the unit: big targets, one set at a time, saves on its own, and a running count of what is left.
import { useEffect, useMemo, useRef, useState } from 'react'

type Item = { key: string; name: string; group: string; qty: number; unit: number; unitLabel: string; owner: number | null }
type Sheet = { place: string; units: { label: string; address: string; access: string; parking: string }[]; stock: string; items: Item[]; counts: Record<string, number>; note: string; by: string; doneAt: string }
const CSS = `
.ow{--ink:#121316;--body:#3A3B40;--mut:#6E6F74;--rule:#E5E1D8;--acc:#8C6D3A;--ok:#2F7D4F;--bad:#A1332B;--soft:#F1EDE4;min-height:100vh;background:#F6F4EE;color:var(--body);font:400 16px/1.5 Inter,system-ui,sans-serif;color-scheme:light}
.ow-in{max-width:720px;margin:0 auto;padding:18px max(16px,env(safe-area-inset-right)) 120px max(16px,env(safe-area-inset-left))}
.ow img{height:28px;width:auto}
.ow-k{font:600 11px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin:18px 0 6px}
.ow h1{font:400 clamp(28px,7vw,38px)/1.08 "Instrument Serif",Georgia,serif;color:var(--ink);margin:0 0 6px;text-wrap:balance}
.ow p{margin:0 0 12px}.ow-mut{color:var(--mut);font-size:14px}
.ow-card{background:#fff;border:1px solid var(--rule);border-radius:16px;padding:14px 16px;margin:0 0 14px}
.ow-f{display:grid;gap:5px}.ow-f span{font:600 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.ow-f input,.ow-f textarea{font:400 16px Inter,sans-serif;color:var(--ink);border:1px solid var(--rule);border-radius:10px;padding:11px 12px;width:100%;min-width:0;background:#fff}
.ow-units{display:flex;gap:8px;overflow-x:auto;margin:0 0 14px;padding-bottom:2px}
.ow-units button{flex:0 0 auto;border:1px solid var(--rule);background:#fff;border-radius:999px;padding:9px 14px;font:600 13.5px Inter,sans-serif;color:var(--mut);cursor:pointer}.ow-units button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.ow-g{font:600 11px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin:0 0 4px;display:flex;justify-content:space-between;gap:8px}
.ow-g small{color:var(--mut);letter-spacing:0;text-transform:none;font-weight:500;font-size:12px}
.ow ul{list-style:none;margin:0;padding:0}
.ow li{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--rule)}.ow li:first-child{border-top:0}
.ow li>span{flex:1;min-width:0}.ow li b{display:block;font:600 15px/1.3 Inter,sans-serif;color:var(--ink)}
.ow li small{display:block;font-size:12.5px;color:var(--mut)}
.ow li.done b{color:var(--ok)}.ow li.short b{color:var(--bad)}
.ow-qty{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.ow-qty button{width:42px;height:42px;border-radius:999px;border:1px solid var(--rule);background:#fff;font:600 20px/1 Inter,sans-serif;color:var(--ink);cursor:pointer}
.ow-qty input{width:54px;height:42px;text-align:center;border:1px solid var(--rule);border-radius:10px;font:600 17px Inter,sans-serif;color:var(--ink);background:#fff;padding:0}
.ow-yn{display:flex;gap:6px;flex:0 0 auto}
.ow-yn button{min-width:58px;height:42px;border-radius:999px;border:1px solid var(--rule);background:#fff;font:600 14px Inter,sans-serif;color:var(--mut);cursor:pointer}
.ow-yn button.y{background:var(--ok);border-color:var(--ok);color:#fff}.ow-yn button.n{background:var(--bad);border-color:var(--bad);color:#fff}
.ow-bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--rule);padding:10px max(16px,env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left))}
.ow-bar-in{max-width:720px;margin:0 auto;display:flex;align-items:center;gap:12px}
.ow-bar p{margin:0;flex:1;font-size:13.5px;color:var(--mut)}.ow-bar p b{color:var(--ink)}
.ow-cta{background:var(--ink);color:#fff;border:0;border-radius:999px;padding:13px 22px;font:600 15px Inter,sans-serif;cursor:pointer}.ow-cta:disabled{opacity:.5}
.ow-err{color:var(--bad);font-size:14px}.ow-ok{color:var(--ok);font-weight:600}
`
export function OwnerWalk({ code, k }: { code: string; k: string }) {
  const [d, setD] = useState<Sheet | null>(null); const [err, setErr] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({}); const [note, setNote] = useState(''); const [by, setBy] = useState('')
  const [ui, setUi] = useState(0); const [saving, setSaving] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const pend = useRef<Record<string, number>>({}); const timer = useRef<any>(null)
  const call = (method: string, body?: unknown) => fetch('/api/join/' + code + '/walk' + (method === 'GET' ? '?k=' + encodeURIComponent(k) : ''), { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify({ k, ...(body as object) }) : undefined }).then(r => r.json()).catch(() => null)
  useEffect(() => { call('GET').then(x => { if (!x?.ok) { setErr(x?.error || 'Could not open the walkthrough. Check your connection.'); return } setD(x); setCounts(x.counts || {}); setNote(x.note || ''); setBy(x.by || '') }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code, k])
  async function flush(extra: Record<string, unknown> = {}) {
    clearTimeout(timer.current); const c = pend.current; pend.current = {}
    setSaving(true); const x = await call('PATCH', { counts: c, note, by, ...extra }); setSaving(false)
    if (!x?.ok) { Object.assign(pend.current, c); setMsg(x?.error || 'Not saved. Check your connection; your counts are kept on this screen.'); return null }
    setMsg(''); return x as Sheet
  }
  function set(key: string, n: number) { const v = Math.max(0, Math.min(999, Math.round(n))); setCounts(c => ({ ...c, [key]: v })); pend.current[key] = v; clearTimeout(timer.current); timer.current = setTimeout(() => flush(), 800) }
  const mine = useMemo(() => (d ? d.items.filter(i => i.unit === ui) : []), [d, ui])
  const groups = useMemo(() => Array.from(new Set(mine.map(i => i.group))), [mine])
  if (err) return <main className="ow"><style>{CSS}</style><div className="ow-in"><img src="/stay-logo.png" alt="Stay Hospitality" /><p className="ow-k">Walkthrough</p><h1>This link is not active.</h1><p>{err}</p></div></main>
  if (!d) return <main className="ow"><style>{CSS}</style><div className="ow-in"><p className="ow-mut">Opening the count sheet…</p></div></main>
  const total = d.items.length, counted = d.items.filter(i => typeof counts[i.key] === 'number').length
  const unit = d.units[ui]
  const left = (u: number) => d.items.filter(i => i.unit === u && typeof counts[i.key] !== 'number').length
  async function finish() { setBusy(true); const x = await flush({ done: true }); setBusy(false); if (x) setD(x) }
  return (
    <main className="ow"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;500;600&display=swap" /><style>{CSS}</style>
      <div className="ow-in">
        <img src="/stay-logo.png" alt="Stay Hospitality" />
        <p className="ow-k">Walkthrough{d.place ? ' · ' + d.place : ''}</p>
        <h1>Count what is in the home</h1>
        <p>For each item, enter how many are actually there. For single items, tap Yes or No. It saves as you go, so you can stop and come back from the same link.</p>
        {d.stock ? <p className="ow-mut">The owner says {d.stock === 'full' ? 'the home is fully stocked' : 'nothing has been bought yet'}. The grey note under each item is what the owner told us.</p> : null}
        {d.doneAt ? <div className="ow-card"><p className="ow-ok" style={{ margin: 0 }}>✓ Walkthrough finished {new Date(d.doneAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. You can still correct a count below.</p></div> : null}
        <div className="ow-card"><label className="ow-f"><span>Your name</span><input value={by} onChange={e => setBy(e.target.value)} onBlur={() => flush()} placeholder="Who is doing the walkthrough" autoComplete="name" /></label></div>
        {d.units.length > 1 ? <div className="ow-units">{d.units.map((u, i) => <button key={i} type="button" className={i === ui ? 'on' : ''} onClick={() => setUi(i)}>{u.label}{left(i) ? ' · ' + left(i) + ' left' : ' · done'}</button>)}</div> : null}
        {unit ? <p className="ow-mut">{[d.units.length === 1 ? unit.label : '', unit.address, unit.access ? 'Access: ' + unit.access : '', unit.parking ? 'Parking: ' + unit.parking : ''].filter(Boolean).join(' · ')}</p> : null}
        {groups.map(g => { const list = mine.filter(i => i.group === g); const todo = list.filter(i => typeof counts[i.key] !== 'number').length; return (
          <div key={g} className="ow-card">
            <p className="ow-g">{g}<small>{todo ? todo + ' to count' : 'done'}</small></p>
            <ul>{list.map(i => { const n = counts[i.key]; const has = typeof n === 'number'; return (
              <li key={i.key} className={has ? (n >= i.qty ? 'done' : 'short') : ''}>
                <span><b>{i.name}</b><small>{i.qty > 1 ? 'Needs ' + i.qty : 'Needs 1'}{i.owner != null ? ' · owner says ' + (i.qty > 1 ? i.owner : i.owner >= 1 ? 'yes' : 'no') : ''}</small></span>
                {i.qty > 1 ? (
                  <div className="ow-qty">
                    <button type="button" aria-label={'One fewer ' + i.name} onClick={() => set(i.key, (has ? n : 0) - 1)}>−</button>
                    <input inputMode="numeric" aria-label={'How many ' + i.name} value={has ? String(n) : ''} placeholder="?" onChange={e => { const v = e.target.value.replace(/\D/g, ''); if (v !== '') set(i.key, Number(v)) }} />
                    <button type="button" aria-label={'One more ' + i.name} onClick={() => set(i.key, (has ? n : 0) + 1)}>+</button>
                  </div>
                ) : (
                  <div className="ow-yn">
                    <button type="button" className={has && n >= 1 ? 'y' : ''} onClick={() => set(i.key, 1)}>Yes</button>
                    <button type="button" className={has && n < 1 ? 'n' : ''} onClick={() => set(i.key, 0)}>No</button>
                  </div>
                )}
              </li>) })}</ul>
          </div>) })}
        <div className="ow-card"><label className="ow-f"><span>Notes for the office (optional)</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} onBlur={() => flush()} placeholder="e.g. the pots are worn and should be replaced; no iron found" /></label></div>
        {msg ? <p className="ow-err">{msg}</p> : null}
      </div>
      <div className="ow-bar"><div className="ow-bar-in">
        <p><b>{counted}</b> of {total} counted{saving ? ' · saving…' : ''}</p>
        <button type="button" className="ow-cta" disabled={busy} onClick={finish}>{busy ? 'Saving…' : d.doneAt ? 'Save changes' : counted < total ? 'Finish anyway' : 'Finish walkthrough'}</button>
      </div></div>
    </main>
  )
}
