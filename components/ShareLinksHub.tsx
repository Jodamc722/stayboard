'use client'
// THE SHARE LINKS HUB (Jon, 2026-08-18): "a place where I can create those links based on
// properties, units, owners and customize them to show different information... any live data."
//
// One screen, two halves: the links that exist (copy / edit / revoke), and the builder. The
// builder is a sentence, not a form maze: WHO is it scoped to, WHAT sections does it show, and
// two honest switches — dollars on/off and full guest names on/off — that govern the whole link.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Plus, Copy, Check, Trash2, Pencil, Link2, Lock, Building2, User, Home, Globe, X,
} from 'lucide-react'

type LinkRow = {
  id: string; code: string; label: string | null; scope_type: string; scope_ids: string[]
  sections: Record<string, boolean>; show_money: boolean; guest_names: boolean
  window_days: number; passcode: string | null; created_by: string | null; created_at: string
}
type Meta = {
  buildings: string[]
  owners: { id: string; name: string; units: number }[]
  listings: { id: string; name: string; building: string }[]
}

const SECTIONS: { key: string; label: string; sub: string }[] = [
  { key: 'reservations', label: 'Reservations', sub: 'in-house + upcoming stays' },
  { key: 'revenue', label: 'Revenue & ADR', sub: 'stays, nights, ADR for the window' },
  { key: 'marketing', label: 'Booking sources', sub: 'direct vs OTA — the marketing lens' },
  { key: 'cleaning', label: 'Cleaning & tasks', sub: 'the next 14 days of scheduled work' },
  { key: 'verification', label: 'Guest verification', sub: 'verified / pending per arrival' },
  { key: 'notes', label: 'Reservation notes', sub: 'notes on current + upcoming stays' },
]
const SCOPES = [
  { key: 'portfolio', label: 'Whole portfolio', Icon: Globe },
  { key: 'building', label: 'Building', Icon: Building2 },
  { key: 'owner', label: 'Owner', Icon: User },
  { key: 'listing', label: 'Unit', Icon: Home },
]

export function ShareLinksHub() {
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState('')

  // Builder state. editingId set = the builder is repurposed as the editor for that link.
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [label, setLabel] = useState('')
  const [scopeType, setScopeType] = useState('portfolio')
  const [scopeIds, setScopeIds] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [sections, setSections] = useState<Record<string, boolean>>({ reservations: true })
  const [showMoney, setShowMoney] = useState(false)
  const [guestNames, setGuestNames] = useState(false)
  const [windowDays, setWindowDays] = useState(30)
  const [passcode, setPasscode] = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/share-links', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message || j?.error || 'Could not load.')
      setLinks(j.links || []); setMeta(j.meta || null)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const reset = () => {
    setEditingId(''); setLabel(''); setScopeType('portfolio'); setScopeIds([]); setQ('')
    setSections({ reservations: true }); setShowMoney(false); setGuestNames(false); setWindowDays(30); setPasscode('')
  }
  const startEdit = (l: LinkRow) => {
    setEditingId(l.id); setLabel(l.label || ''); setScopeType(l.scope_type); setScopeIds(l.scope_ids || [])
    setSections(l.sections || {}); setShowMoney(l.show_money); setGuestNames(l.guest_names)
    setWindowDays(l.window_days || 30); setPasscode(l.passcode || ''); setOpen(true); setQ('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/share-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: editingId ? 'update' : 'create', id: editingId || undefined,
          label, scopeType, scopeIds, sections, showMoney, guestNames, windowDays, passcode,
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not save.')
      setOpen(false); reset(); await load()
      if (!editingId && j.link?.code) copy(j.link.code)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const revoke = async (id: string) => {
    if (!window.confirm('Turn this link off? Anyone holding it loses access immediately.')) return
    await fetch('/api/share-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', id }) })
    await load()
  }
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(origin + '/share/' + code); setCopied(code); setTimeout(() => setCopied(''), 1800) } catch { /* blocked */ }
  }

  // Scope pick-list for the current scope type, filtered by the search box.
  const options = useMemo(() => {
    if (!meta) return []
    const n = q.trim().toLowerCase()
    if (scopeType === 'building') return meta.buildings.filter(b => !n || b.toLowerCase().includes(n)).map(b => ({ id: b, name: b, sub: '' }))
    if (scopeType === 'owner') return meta.owners.filter(o => !n || o.name.toLowerCase().includes(n)).map(o => ({ id: o.id, name: o.name, sub: o.units + ' units' }))
    if (scopeType === 'listing') return meta.listings.filter(l => !n || (l.name + ' ' + l.building).toLowerCase().includes(n)).slice(0, 30).map(l => ({ id: l.id, name: l.name, sub: l.building }))
    return []
  }, [meta, scopeType, q])
  const nameFor = (l: LinkRow, id: string) => {
    if (l.scope_type === 'owner') return meta?.owners.find(o => o.id === id)?.name || id
    if (l.scope_type === 'listing') return meta?.listings.find(x => x.id === id)?.name || id
    return id
  }

  if (!links) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…</div>

  return (
    <div className="space-y-4">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      {/* the builder */}
      {open ? (
        <div className="rounded-2xl border border-ink/20 bg-white p-4 shadow-soft space-y-3.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink flex-1">{editingId ? 'Edit link' : 'New link'}</p>
            <button onClick={() => { setOpen(false); reset() }} className="text-muted hover:text-ink p-1"><X size={15} /></button>
          </div>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="What is this link for? e.g. “Marketing partner — Botanica”"
            className="w-full rounded-xl border border-line px-3 py-2 text-[13px]" />

          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">Scoped to</p>
            <div className="flex flex-wrap gap-1.5">
              {SCOPES.map(s => (
                <button key={s.key} onClick={() => { setScopeType(s.key); setScopeIds([]); setQ('') }}
                  className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ' +
                    (scopeType === s.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
                  <s.Icon size={12} /> {s.label}
                </button>
              ))}
            </div>
            {scopeType !== 'portfolio' ? (
              <div className="mt-2">
                {scopeIds.length ? (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {scopeIds.map(id => (
                      <span key={id} className="text-[12px] font-semibold bg-app rounded-lg px-2 py-1 inline-flex items-center gap-1.5">
                        {scopeType === 'building' ? id
                          : scopeType === 'owner' ? (meta?.owners.find(o => o.id === id)?.name || id)
                            : (meta?.listings.find(l => l.id === id)?.name || id)}
                        <button onClick={() => setScopeIds(ids => ids.filter(x => x !== id))} className="text-muted hover:text-ink"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={'Search ' + scopeType + 's…'}
                  className="w-full rounded-xl border border-line px-3 py-2 text-[13px]" />
                {q.trim() ? (
                  <div className="mt-1 rounded-xl border border-line divide-y divide-line overflow-hidden">
                    {options.filter(o => !scopeIds.includes(o.id)).slice(0, 8).map(o => (
                      <button key={o.id} onClick={() => { setScopeIds(ids => [...ids, o.id]); setQ('') }}
                        className="w-full px-3 py-2 text-left text-[13px] hover:bg-app flex items-center gap-2">
                        <span className="font-semibold text-ink">{o.name}</span>
                        {o.sub ? <span className="text-[11.5px] text-muted">{o.sub}</span> : null}
                      </button>
                    ))}
                    {!options.length ? <p className="px-3 py-2 text-[12.5px] text-muted">Nothing matches.</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">Shows</p>
            <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1.5">
              {SECTIONS.map(s => (
                <label key={s.key} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!sections[s.key]} onChange={e => setSections(x => ({ ...x, [s.key]: e.target.checked }))} className="mt-0.5" />
                  <span className="text-[12.5px]"><span className="font-semibold text-ink">{s.label}</span> <span className="text-muted">— {s.sub}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-[12.5px] font-semibold text-ink">
              <input type="checkbox" checked={showMoney} onChange={e => setShowMoney(e.target.checked)} /> Show dollar figures
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-[12.5px] font-semibold text-ink">
              <input type="checkbox" checked={guestNames} onChange={e => setGuestNames(e.target.checked)} /> Full guest names
            </label>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              Window
              <input type="number" min={7} max={120} value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}
                className="w-16 rounded-lg border border-line px-2 py-1 text-[12.5px] text-center" /> days
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Lock size={11} /> Passcode
              <input value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="optional"
                className="w-28 rounded-lg border border-line px-2 py-1 text-[12.5px]" />
            </span>
          </div>

          <button onClick={save} disabled={busy}
            className="rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {editingId ? 'Save changes — every copy updates' : 'Create link (copies it too)'}
          </button>
        </div>
      ) : (
        <button onClick={() => { reset(); setOpen(true) }}
          className="rounded-xl bg-ink text-white px-4 py-2.5 text-[13px] font-bold inline-flex items-center gap-1.5">
          <Plus size={14} /> New link
        </button>
      )}

      {/* the links that exist */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
        <div className="px-4 py-3 border-b border-line flex items-center">
          <p className="text-sm font-bold text-ink flex-1">Live links</p>
          <span className="text-[11px] text-muted tabular-nums">{links.length}</span>
        </div>
        {!links.length ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted">No custom links yet — create the first one above.</p>
        ) : (
          <div className="divide-y divide-line">
            {links.map(l => {
              const secs = SECTIONS.filter(s => l.sections?.[s.key]).map(s => s.label)
              return (
                <div key={l.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link2 size={13} className="text-muted shrink-0" />
                    <span className="text-[13.5px] font-bold text-ink">{l.label || 'Untitled link'}</span>
                    <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-app text-muted">
                      {l.scope_type === 'portfolio' ? 'Portfolio' : l.scope_type}
                    </span>
                    {l.passcode ? <Lock size={11} className="text-muted" /> : null}
                    {l.show_money ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">$ on</span> : null}
                    <div className="flex-1" />
                    <button onClick={() => copy(l.code)} className="text-[12px] font-bold text-brand-700 inline-flex items-center gap-1">
                      {copied === l.code ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy link</>}
                    </button>
                    <a href={'/share/' + l.code} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-ink">Open</a>
                    <button onClick={() => startEdit(l)} className="p-1 text-muted hover:text-ink" title="Edit"><Pencil size={13} /></button>
                    <button onClick={() => revoke(l.id)} className="p-1 text-muted hover:text-rose-600" title="Revoke"><Trash2 size={13} /></button>
                  </div>
                  <p className="text-[11.5px] text-muted mt-1">
                    {l.scope_type !== 'portfolio' ? (l.scope_ids || []).map(id => nameFor(l, id)).join(', ') + ' · ' : ''}
                    {secs.join(' · ') || 'no sections'} · {l.window_days}d window
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="text-[11.5px] text-muted">
        The FF&amp;E walk links, owner order links, vendor pages and the Marketing partner page keep
        working exactly as before — this hub is for custom live-data links on top of those.
      </p>
    </div>
  )
}
