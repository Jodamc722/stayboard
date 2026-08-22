'use client'

// The minimum-stay switch. One screen that answers three questions: what is the schedule, what does
// the calendar actually say right now, and what happened the last time it ran.
//
// The "run now" buttons exist because a schedule nobody can fire by hand is a schedule nobody can
// test. They use the same code path the cron does.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Plus, X, RefreshCw, Power } from 'lucide-react'

type WindowListing = { id: string; label: string; cleared: boolean }
type RunLogEntry = {
  at: string; direction: 'open' | 'close'; listingId: string; label: string
  minNights: number; ok: boolean; verified: boolean | null; note: string
}
type Config = {
  enabled: boolean; days: number; openHour: number; closeHour: number
  shortMin: number; longMin: number; listings: WindowListing[]
  ranOn: Record<string, { open?: string; close?: string }>; log: RunLogEntry[]
}
type Listing = { id: string; title?: string | null; nickname?: string | null; building?: string | null }
type LiveState = { loading: boolean; text: string; tone: 'muted' | 'good' | 'warn' }

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const ampm = h < 12 ? 'AM' : 'PM'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return { value: h, label: `${twelve}:00 ${ampm}` }
})

const CARD = 'rounded-xl border border-line bg-white p-4'
const INPUT = 'text-[13px] border border-line rounded-md px-2 py-1.5'
const BTN = 'text-[13px] font-semibold px-3 py-1.5 rounded-md bg-ink text-white disabled:opacity-50'
const BTN_GHOST = 'text-[13px] font-semibold px-3 py-1.5 rounded-md border border-line bg-white disabled:opacity-50'

function labelFor(l: Listing): string {
  return String(l.nickname || l.title || l.building || l.id)
}

export function StayWindowPanel() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [all, setAll] = useState<Listing[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [live, setLive] = useState<Record<string, LiveState>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/stay-window?config=1', { cache: 'no-store' })
      const j = await r.json()
      if (j?.config) setCfg(j.config as Config)
      else setMsg({ tone: 'bad', text: j?.message || j?.error || 'Could not read the schedule.' })
    } catch { setMsg({ tone: 'bad', text: 'Could not read the schedule.' }) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/listings', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setAll(Array.isArray(j?.results) ? j.results : []))
      .catch(() => setAll([]))
  }, [])

  // What the calendar says for one listing right now — the honest check on whether a run landed.
  const refreshLive = useCallback(async (id: string, days: number) => {
    setLive(s => ({ ...s, [id]: { loading: true, text: 'reading…', tone: 'muted' } }))
    try {
      const r = await fetch(`/api/stay-window?listingId=${encodeURIComponent(id)}&days=${days}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j?.error) {
        setLive(s => ({ ...s, [id]: { loading: false, text: String(j?.message || j?.error || 'read failed'), tone: 'warn' } }))
        return
      }
      const d: Array<{ minNights: number | null; count: number }> = j?.calendar?.distinct || []
      const terms = j?.terms || {}
      const spread = d.length === 0
        ? 'no calendar days returned'
        : d.map(x => `${x.count}d at ${x.minNights == null ? '—' : x.minNights}`).join(', ')
      setLive(s => ({
        ...s,
        [id]: {
          loading: false,
          tone: d.length === 1 ? 'good' : 'warn',
          text: `calendar: ${spread} · listing default ${terms.minNights ?? '—'}/${terms.maxNights ?? '—'} min/max`,
        },
      }))
    } catch {
      setLive(s => ({ ...s, [id]: { loading: false, text: 'read failed', tone: 'warn' } }))
    }
  }, [])

  const save = async (next: Config) => {
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/stay-window', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config', config: next }),
      })
      const j = await r.json()
      if (!r.ok || j?.error) { setMsg({ tone: 'bad', text: String(j?.message || j?.error) }); return }
      setCfg(j.config as Config)
      setMsg({ tone: 'ok', text: 'Schedule saved.' })
    } catch { setMsg({ tone: 'bad', text: 'Save failed.' }) }
    finally { setBusy('') }
  }

  const runNow = async (direction: 'open' | 'close') => {
    if (!cfg) return
    setBusy(direction); setMsg(null)
    try {
      const r = await fetch('/api/stay-window', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', direction }),
      })
      const j = await r.json()
      if (!r.ok || j?.error) { setMsg({ tone: 'bad', text: String(j?.message || j?.error) }); return }
      const results: RunLogEntry[] = Array.isArray(j?.results) ? j.results : []
      const good = results.filter(x => x.ok).length
      setMsg({
        tone: good === results.length && results.length > 0 ? 'ok' : 'bad',
        text: `${good} of ${results.length} listings written. ${results.map(x => `${x.label}: ${x.note}`).join(' · ')}`,
      })
      await load()
      for (const l of cfg.listings) refreshLive(l.id, cfg.days)
    } catch { setMsg({ tone: 'bad', text: 'Run failed.' }) }
    finally { setBusy('') }
  }

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    const chosen = (cfg?.listings || []).map(x => x.id)
    return all
      .filter(l => chosen.indexOf(String(l.id)) === -1)
      .filter(l => labelFor(l).toLowerCase().includes(term) || String(l.id).includes(term))
      .slice(0, 8)
  }, [q, all, cfg])

  if (!cfg) {
    return <div className={CARD}><p className="text-[13px] text-muted">Loading the schedule…</p></div>
  }

  const set = (patch: Partial<Config>) => setCfg({ ...cfg, ...patch })
  const shortIsUnder30 = cfg.shortMin < 30

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-xl border p-3 text-[13px] ${msg.tone === 'ok'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{msg.text}</div>
      )}

      {/* ---- the switch itself ---- */}
      <div className={CARD}>
        <div className="flex items-center gap-3">
          <Power size={15} className={cfg.enabled ? 'text-emerald-600' : 'text-muted'} />
          <div>
            <p className="text-[13px] font-semibold text-ink">
              Schedule is {cfg.enabled ? 'ON' : 'OFF'}
            </p>
            <p className="text-[12px] text-muted">
              {cfg.enabled
                ? `Every day at ${HOURS[cfg.openHour].label} Eastern the minimum drops to ${cfg.shortMin} nights, and at ${HOURS[cfg.closeHour].label} it goes back to ${cfg.longMin}.`
                : 'Nothing is being written. Turn it on once you have watched a manual run land.'}
            </p>
          </div>
          <button
            className={`ml-auto ${cfg.enabled ? BTN_GHOST : BTN}`}
            disabled={busy !== ''}
            onClick={() => save({ ...cfg, enabled: !cfg.enabled })}
          >{cfg.enabled ? 'Turn off' : 'Turn on'}</button>
        </div>
      </div>

      {/* ---- times and values ---- */}
      <div className={CARD}>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5 mb-3">
          <Clock size={12} /> Times and limits
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="text-[12px] text-muted">
            Drop to short at (ET)
            <select className={`${INPUT} w-full mt-1`} value={cfg.openHour}
              onChange={e => set({ openHour: Number(e.target.value) })}>
              {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            Back to long at (ET)
            <select className={`${INPUT} w-full mt-1`} value={cfg.closeHour}
              onChange={e => set({ closeHour: Number(e.target.value) })}>
              {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            Days ahead to write
            <input type="number" min={1} max={365} className={`${INPUT} w-full mt-1`} value={cfg.days}
              onChange={e => set({ days: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-muted">
            Short minimum (nights)
            <input type="number" min={1} max={365} className={`${INPUT} w-full mt-1`} value={cfg.shortMin}
              onChange={e => set({ shortMin: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-muted">
            Long minimum (nights)
            <input type="number" min={1} max={365} className={`${INPUT} w-full mt-1`} value={cfg.longMin}
              onChange={e => set({ longMin: Number(e.target.value) })} />
          </label>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button className={BTN} disabled={busy !== ''} onClick={() => save(cfg)}>Save schedule</button>
          <button className={BTN_GHOST} disabled={busy !== '' || !cfg.listings.length} onClick={() => runNow('open')}>
            Run now → {cfg.shortMin} nights
          </button>
          <button className={BTN_GHOST} disabled={busy !== '' || !cfg.listings.length} onClick={() => runNow('close')}>
            Run now → {cfg.longMin} nights
          </button>
        </div>
        <p className="text-[11.5px] text-muted mt-2">
          Only these dates are written: today through day {cfg.days}. Anything further out keeps the
          listing default, which is why the long minimum stays in force indefinitely without us
          touching it.
        </p>
      </div>

      {/* ---- listings on the schedule ---- */}
      <div className={CARD}>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-3">
          Listings on the schedule
        </p>

        {cfg.listings.length === 0 && (
          <p className="text-[13px] text-muted mb-3">None yet. Search below to add one.</p>
        )}

        <div className="space-y-2">
          {cfg.listings.map(l => {
            const st = live[l.id]
            const ran = cfg.ranOn[l.id] || {}
            return (
              <div key={l.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink">{l.label}</span>
                  {!l.cleared && shortIsUnder30 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-300">
                      not cleared — short runs will skip it
                    </span>
                  )}
                  <button className="ml-auto text-muted hover:text-ink" title="Remove"
                    onClick={() => save({ ...cfg, listings: cfg.listings.filter(x => x.id !== l.id) })}>
                    <X size={14} />
                  </button>
                </div>

                <label className="flex items-center gap-2 mt-2 text-[12px] text-muted">
                  <input type="checkbox" checked={l.cleared}
                    onChange={e => set({
                      listings: cfg.listings.map(x => x.id === l.id ? { ...x, cleared: e.target.checked } : x),
                    })} />
                  Cleared for stays under 30 nights in this city (registration on file)
                </label>

                <div className="flex items-center gap-2 mt-2">
                  <button className="text-[12px] text-muted hover:text-ink flex items-center gap-1"
                    onClick={() => refreshLive(l.id, cfg.days)}>
                    <RefreshCw size={11} /> Check the calendar
                  </button>
                  <span className={`text-[12px] ${st?.tone === 'good' ? 'text-emerald-700' : st?.tone === 'warn' ? 'text-amber-800' : 'text-muted'}`}>
                    {st ? st.text : ''}
                  </span>
                </div>

                {(ran.open || ran.close) && (
                  <p className="text-[11.5px] text-muted mt-1">
                    Last short run {ran.open || '—'} · last long run {ran.close || '—'}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2">
            <Plus size={13} className="text-muted" />
            <input className={`${INPUT} w-full sm:w-72`} placeholder="Search a listing by name or unit"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {candidates.length > 0 && (
            <div className="mt-2 rounded-lg border border-line divide-y divide-line">
              {candidates.map(c => (
                <button key={String(c.id)}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50"
                  onClick={() => {
                    setQ('')
                    save({ ...cfg, listings: cfg.listings.concat([{ id: String(c.id), label: labelFor(c), cleared: false }]) })
                  }}>
                  {labelFor(c)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- what actually happened ---- */}
      <div className={CARD}>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-3">Recent runs</p>
        {cfg.log.length === 0 && <p className="text-[13px] text-muted">Nothing has run yet.</p>}
        <div className="space-y-1.5">
          {cfg.log.slice(0, 12).map((e, i) => (
            /* Four fixed-width columns (36+40+24 = 400px) in a row that never wrapped: on a phone
               the run log ran straight off the card. Below sm the columns size to their text
               and wrap; the desktop column widths are untouched. */
            <div key={i} className="text-[12.5px] flex items-start gap-x-2 gap-y-0.5 flex-wrap sm:flex-nowrap">
              <span className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full ${e.ok && e.verified ? 'bg-emerald-500' : e.ok ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="text-muted w-auto sm:w-36 shrink-0">{new Date(e.at).toLocaleString()}</span>
              <span className="text-ink font-medium w-auto sm:w-40 shrink-0">{e.label}</span>
              <span className="text-muted w-auto sm:w-24 shrink-0">{e.direction === 'open' ? 'short' : 'long'} · {e.minNights}n</span>
              <span className="text-muted">{e.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
