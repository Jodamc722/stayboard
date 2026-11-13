'use client'
// AN ADDRESS BOX THAT KNOWS REAL ADDRESSES (Jon, 2026-11-13: "give any address entering real details"). Suggestions
// as you type; picking one fills the full address with its city, state and ZIP and drops a pin. "Check this
// address" verifies whatever was typed. Styled inline so it sits in the owner portal and in Lighthouse alike.
import { useEffect, useRef, useState } from 'react'
import { StayMap } from './StayMap'

export type AddressPick = { address: string; lat?: number; lng?: number }
type Hit = { label: string; lat: number; lng: number }
export function AddressInput({ value, lat, lng, onChange, inputClassName, placeholder = 'Start typing the street address', showMap = true }: { value: string; lat?: number; lng?: number; onChange: (p: AddressPick) => void; inputClassName?: string; placeholder?: string; showMap?: boolean }) {
  const [hits, setHits] = useState<Hit[]>([]); const [open, setOpen] = useState(false)
  const [note, setNote] = useState<'' | 'checking' | 'bad'>('')
  const seq = useRef(0); const typed = useRef(false)
  const pinned = lat != null && lng != null
  useEffect(() => {
    if (!typed.current) return
    const q = value.trim(); if (q.length < 4) { setHits([]); return }
    const n = ++seq.current
    const t = setTimeout(async () => { const d = await fetch('/api/geo?q=' + encodeURIComponent(q)).then(r => r.json()).catch(() => null); if (n === seq.current) { setHits(d?.hits || []); setOpen(true) } }, 260)
    return () => clearTimeout(t)
  }, [value])
  const pick = (h: Hit) => { typed.current = false; setOpen(false); setHits([]); setNote(''); onChange({ address: h.label, lat: h.lat, lng: h.lng }) }
  async function check() {
    setNote('checking'); setOpen(false)
    const d = await fetch('/api/geo?verify=' + encodeURIComponent(value)).then(r => r.json()).catch(() => null)
    if (d?.hit) pick(d.hit); else setNote('bad')
  }
  const small: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.4, margin: '6px 0 0' }
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <input value={value} className={inputClassName} placeholder={placeholder} autoComplete="off" spellCheck={false}
        onChange={e => { typed.current = true; setNote(''); onChange({ address: e.target.value }) }}
        onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }} role="combobox" aria-expanded={open} aria-autocomplete="list" />
      {open && hits.length ? (
        <ul role="listbox" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', margin: '4px 0 0', padding: 4, listStyle: 'none', background: '#fff', border: '1px solid #E5E1D8', borderRadius: 12, boxShadow: '0 14px 34px -14px rgba(0,0,0,.35)', maxHeight: 280, overflowY: 'auto' }}>
          {hits.map(h => <li key={h.label + h.lat}><button type="button" role="option" aria-selected={false} onMouseDown={e => e.preventDefault()} onClick={() => pick(h)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderRadius: 8, padding: '9px 10px', font: '400 14px/1.35 Inter,system-ui,sans-serif', color: '#121316', cursor: 'pointer' }}>{h.label}</button></li>)}
        </ul>
      ) : null}
      {pinned ? <p style={{ ...small, color: '#2F7D4F', fontWeight: 600 }}>✓ Found on the map</p>
        : note === 'checking' ? <p style={{ ...small, color: '#6E6F74' }}>Checking…</p>
        : note === 'bad' ? <p style={{ ...small, color: '#A1332B' }}>We could not find that address. Check the street number, city and state. You can still continue.</p>
        : value.trim().length >= 8 ? <p style={small}><button type="button" onClick={check} style={{ background: 'none', border: 0, padding: 0, font: '600 12.5px Inter,system-ui,sans-serif', color: '#121316', textDecoration: 'underline', cursor: 'pointer' }}>Check this address</button></p> : null}
      {showMap && pinned ? <div style={{ marginTop: 8 }}><StayMap points={[{ id: 'home', lat: lat as number, lng: lng as number, label: value, kind: 'pin' }]} height={170} interactive={false} /></div> : null}
    </div>
  )
}
