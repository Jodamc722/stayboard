'use client'
// THE SHOPPING LIST (Jon, 2026-11-17: "also as a link, like a shopping list that as they get they can mark"). One
// link for whoever is buying an owner's order: made for a phone in a shop or at a desk with the tabs open. Tap a line
// when it is bought; it saves on its own and anyone else with the link sees the tick. What is left stays on top.
import { useEffect, useMemo, useRef, useState } from 'react'

type Line = { key: string; category: string; name: string; detail: string; url: string; price: number | null; qty: number[] }
type List = { place: string; units: string[]; lines: Line[]; got: Record<string, { at: string; by?: string }>; by: string }
const CSS = `
.os{--ink:#121316;--body:#3A3B40;--mut:#6E6F74;--rule:#E5E1D8;--acc:#8C6D3A;--ok:#2F7D4F;--soft:#F1EDE4;min-height:100vh;background:#F6F4EE;color:var(--body);font:400 16px/1.5 Inter,system-ui,sans-serif;color-scheme:light}
.os-in{max-width:720px;margin:0 auto;padding:18px max(16px,env(safe-area-inset-right)) 120px max(16px,env(safe-area-inset-left))}
.os img{height:28px;width:auto;display:block;margin-bottom:8px}
.os-k{font:600 11px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin:18px 0 6px}
.os h1{font:400 clamp(28px,7vw,38px)/1.08 "Instrument Serif",Georgia,serif;color:var(--ink);margin:0 0 6px;text-wrap:balance}
.os p{margin:0 0 12px}.os-mut{color:var(--mut);font-size:14px}
.os-card{background:#fff;border:1px solid var(--rule);border-radius:16px;padding:6px 16px;margin:0 0 14px}
.os-bar{position:sticky;top:0;z-index:5;background:#F6F4EE;padding:10px 0 12px;margin:0 0 4px}
.os-bar b{font:600 15px Inter,sans-serif;color:var(--ink)}.os-bar span{float:right;font-size:14px;color:var(--mut);font-variant-numeric:tabular-nums}
.os-track{height:8px;border-radius:99px;background:var(--rule);margin-top:8px;overflow:hidden}.os-track i{display:block;height:100%;background:var(--ok);border-radius:99px;transition:width .2s}
.os-tabs{display:flex;gap:8px;margin:0 0 14px}
.os-tabs button{border:1px solid var(--rule);background:#fff;border-radius:999px;padding:8px 14px;font:600 13.5px Inter,sans-serif;color:var(--mut);cursor:pointer}.os-tabs button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.os-g{font:600 11px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin:10px 0 2px;display:flex;justify-content:space-between;gap:8px}
.os-g small{color:var(--mut);letter-spacing:0;text-transform:none;font-weight:500;font-size:12px}
.os ul{list-style:none;margin:0;padding:0}
.os li{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-top:1px solid var(--rule)}.os li:first-child{border-top:0}
.os-tick{flex:0 0 auto;width:34px;height:34px;border-radius:10px;border:2px solid #C9C4B8;background:#fff;cursor:pointer;display:grid;place-items:center;font:700 18px/1 Inter,sans-serif;color:#fff;margin-top:1px}
.os li.got .os-tick{background:var(--ok);border-color:var(--ok)}
.os-t{flex:1;min-width:0;cursor:pointer}
.os-t b{display:block;font:600 16px/1.3 Inter,sans-serif;color:var(--ink)}.os li.got .os-t b{color:var(--mut);text-decoration:line-through}
.os-t small{display:block;font-size:13px;color:var(--mut);overflow-wrap:anywhere}
.os-r{flex:0 0 auto;text-align:right;font-size:13.5px;color:var(--body);font-variant-numeric:tabular-nums}
.os-r b{display:block;font:600 16px Inter,sans-serif;color:var(--ink)}
.os-r a{display:inline-block;margin-top:4px;font:600 13px Inter,sans-serif;color:var(--ink);border:1px solid var(--rule);border-radius:999px;padding:5px 11px;text-decoration:none;background:#fff}
.os-f{display:grid;gap:5px;padding:8px 0}.os-f span{font:600 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.os-f input{font:400 16px Inter,sans-serif;color:var(--ink);border:1px solid var(--rule);border-radius:10px;padding:11px 12px;width:100%;min-width:0;background:#fff}
.os-err{color:#A1332B;font-size:14px}
`
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sum = (q: number[]) => q.reduce((a, b) => a + (Number(b) || 0), 0)

export function OwnerShop({ code, k }: { code: string; k: string }) {
  const [d, setD] = useState<List | null>(null)
  const [err, setErr] = useState('')
  const [got, setGot] = useState<Record<string, { at: string; by?: string }>>({})
  const [by, setBy] = useState('')
  const [show, setShow] = useState<'left' | 'all'>('all')
  const [saveErr, setSaveErr] = useState('')
  const pending = useRef<Record<string, boolean>>({}); const timer = useRef<any>(null); const busy = useRef(false)
  const api = `/api/join/${code}/shop`
  useEffect(() => { fetch(api + '?k=' + encodeURIComponent(k), { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { setD(j); setGot(j.got || {}); setBy(j.by || '') } else setErr(j?.error || 'This link is not active.') }).catch(() => setErr('Could not load the list. Check your connection and reload.')) }, [api, k])
  // Others may be ticking the same list: pick up their ticks every 20 seconds while nothing of ours is waiting to save.
  useEffect(() => { const t = setInterval(() => { if (busy.current || Object.keys(pending.current).length || document.hidden) return; fetch(api + '?k=' + encodeURIComponent(k), { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok && !busy.current && !Object.keys(pending.current).length) { setD(j); setGot(j.got || {}) } }).catch(() => {}) }, 20000); return () => clearInterval(t) }, [api, k])
  async function flush(name?: string) {
    const send = pending.current; pending.current = {}
    if (!Object.keys(send).length && name === undefined) return
    busy.current = true
    const j = await fetch(api, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, got: send, by: name ?? by }) }).then(r => r.json()).catch(() => null)
    busy.current = false
    if (j?.ok) { setSaveErr(''); if (!Object.keys(pending.current).length) setGot(j.got || {}) }
    else { pending.current = { ...send, ...pending.current }; setSaveErr(j?.error || 'Not saved. Check your connection; it will try again on your next tap.') }
  }
  function tick(key: string) {
    const on = !got[key]
    setGot(g => { const n = { ...g }; if (on) n[key] = { at: new Date().toISOString(), by: by || undefined }; else delete n[key]; return n })
    pending.current[key] = on
    clearTimeout(timer.current); timer.current = setTimeout(() => flush(), 500)
  }
  const lines = d?.lines || []
  const done = lines.filter(l => got[l.key]).length
  const cats = useMemo(() => Array.from(new Set(lines.map(l => l.category))), [lines])
  const total = lines.reduce((a, l) => a + (l.price || 0) * sum(l.qty), 0), spent = lines.filter(l => got[l.key]).reduce((a, l) => a + (l.price || 0) * sum(l.qty), 0)
  if (err) return <main className="os"><style>{CSS}</style><div className="os-in"><img src="/stay-logo.png" alt="Stay Hospitality" /><h1 style={{ marginTop: 24 }}>This link is not active</h1><p>{err}</p></div></main>
  if (!d) return <main className="os"><style>{CSS}</style><div className="os-in"><p className="os-mut">Loading the list…</p></div></main>
  const multi = d.units.length > 1
  return (
    <main className="os"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;500;600;700&display=swap" /><style>{CSS}</style>
      <div className="os-in">
        <img src="/stay-logo.png" alt="Stay Hospitality" />
        <p className="os-k">Shopping list{d.place ? ' · ' + d.place : ''}</p>
        <h1>{lines.length ? (done === lines.length ? 'Everything is bought' : 'What to buy') : 'Nothing to buy yet'}</h1>
        <p>Tap a line when you have bought it. It saves on its own, and everyone with this link sees the same ticks.{multi ? ' Quantities are shown for each unit: ' + d.units.join(', ') + '.' : d.units[0] ? ' For ' + d.units[0] + '.' : ''}</p>
        <div className="os-bar"><b>{done} of {lines.length} bought</b><span>{total ? usd(spent) + ' of ' + usd(total) : ''}</span><div className="os-track"><i style={{ width: (lines.length ? done / lines.length * 100 : 0) + '%' }} /></div></div>
        {saveErr ? <p className="os-err" role="alert">{saveErr}</p> : null}
        <div className="os-tabs"><button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All {lines.length}</button><button type="button" className={show === 'left' ? 'on' : ''} onClick={() => setShow('left')}>Still to buy {lines.length - done}</button></div>
        {cats.map(c => { const all = lines.filter(l => l.category === c); const list = all.filter(l => show === 'all' || !got[l.key]).sort((a, b) => Number(!!got[a.key]) - Number(!!got[b.key])); if (!list.length) return null; const left = all.filter(l => !got[l.key]).length; return (
          <div key={c}>
            <p className="os-g">{c}<small>{left ? left + ' to buy' : 'done'}</small></p>
            <div className="os-card"><ul>{list.map(l => { const on = !!got[l.key], q = sum(l.qty); return (
              <li key={l.key} className={on ? 'got' : ''}>
                <button type="button" className="os-tick" role="checkbox" aria-checked={on} aria-label={(on ? 'Bought: ' : 'Mark as bought: ') + l.name} onClick={() => tick(l.key)}>{on ? '✓' : ''}</button>
                <span className="os-t" onClick={() => tick(l.key)}>
                  <b>{l.name}</b>
                  {l.detail ? <small>{l.detail}</small> : null}
                  {multi ? <small>{d.units.map((u, i) => (Number(l.qty[i]) ? u + ': ' + l.qty[i] : '')).filter(Boolean).join(' · ')}</small> : null}
                  {on && got[l.key] ? <small>Bought {new Date(got[l.key].at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{got[l.key].by ? ' by ' + got[l.key].by : ''}</small> : null}
                </span>
                <span className="os-r"><b>×{q}</b>{l.price != null ? (q > 1 ? usd(l.price) + ' each' : usd(l.price)) : 'no price yet'}{l.url ? <><br /><a href={l.url} target="_blank" rel="noreferrer">Open item</a></> : null}</span>
              </li>) })}</ul></div>
          </div>) })}
        <div className="os-card"><label className="os-f"><span>Your name (shown next to what you tick)</span><input value={by} onChange={e => setBy(e.target.value)} onBlur={() => flush(by)} placeholder="Who is buying" autoComplete="name" /></label></div>
      </div>
    </main>
  )
}
