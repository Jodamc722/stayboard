'use client'
// THE HOURS-PER-CLEAN TABLE (Jon, 2026-11-02). The P&L cleaning rate per building and size, and
// what it buys at $20/hour. Admins edit the dollars; everyone else sees the hours. Saved to
// app_settings (clean_rates_v1), read by the scheduler's staffing need and the clean-time chips.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RATE_SIZES, rateSizeLabel, type CleanRates, type RateSize } from '@/lib/clean-rates'

const MK_LABEL: Record<string, string> = { Miami: 'Miami-Dade', Broward: 'Broward', North: 'Palm Beach' }

export function CleanRatesEditor({ onClose, onSaved }: { onClose: () => void; onSaved?: (c: CleanRates) => void }) {
  const [cfg, setCfg] = useState<CleanRates | null>(null)
  const [dollars, setDollars] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/settings/clean-rates', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j.config) { setCfg(j.config); setDollars(!!j.dollars) } else setErr(j.error || 'Could not read the rates') }).catch(e => setErr(String(e?.message || e)))
  }, [])
  const setRate = (label: string, k: RateSize | 'full', v: string) => setCfg(c => c && ({
    ...c,
    buildings: c.buildings.map(b => b.label !== label ? b : k === 'full'
      ? { ...b, fullRate: v === '' ? undefined : Number(v) }
      : { ...b, rates: { ...b.rates, [k]: v === '' ? (null as any) : Number(v) } }),
  }))
  const save = async (reset = false) => {
    if (!cfg) return
    setState('saving'); setErr('')
    try {
      const r = await fetch('/api/settings/clean-rates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reset ? { reset: true } : { config: cfg }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
      setCfg(j.config); setState('saved'); onSaved && onSaved(j.config)
    } catch (e: any) { setState('error'); setErr(String(e?.message || e)) }
  }
  // Portalled to <body>: the rail it opens from is sticky, which traps a fixed overlay under the board.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const hrs = (n: number | undefined | null) => n == null || !cfg ? '' : (Math.round((n / cfg.payPerHour) * 100) / 100) + 'h'
  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/30 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-3xl p-5 mt-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[15px] font-bold text-ink">Hours per clean</div>
            <div className="text-[12px] text-muted mt-0.5">P&amp;L cleaning rate ÷ ${cfg && dollars ? cfg.payPerHour : 20}/hour = the paid hours a clean carries. The scheduler adds a day&apos;s cleans up in hours and divides by a {cfg?.shiftHours || 8}h shift to size each market.</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none">×</button>
        </div>
        {err && <div className="text-[12px] text-rose-700 mb-2">{err}</div>}
        {!cfg ? <div className="text-[12px] text-muted">Reading…</div> : (
          <>
            {dollars && (
              <div className="flex gap-4 mb-3 text-[12px]">
                <label className="flex items-center gap-1.5">Pay per hour $<input type="number" className="w-16 border border-line rounded px-1.5 py-0.5" value={cfg.payPerHour} onChange={e => setCfg({ ...cfg, payPerHour: Number(e.target.value) || 20 })} /></label>
                <label className="flex items-center gap-1.5">Shift hours <input type="number" className="w-14 border border-line rounded px-1.5 py-0.5" value={cfg.shiftHours} onChange={e => setCfg({ ...cfg, shiftHours: Number(e.target.value) || 8 })} /></label>
              </div>
            )}
            {(['Miami', 'Broward', 'North'] as const).map(mk => (
              <div key={mk} className="mb-3">
                <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">
                  <span>{MK_LABEL[mk]}</span>
                  <span className="normal-case tracking-normal">fallback {dollars ? '$' + cfg.marketRate[mk] + ' · ' : ''}{hrs(cfg.marketRate[mk])}</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead><tr className="text-muted text-[10.5px]"><th className="text-left font-semibold py-0.5">Building</th>{RATE_SIZES.map(k => <th key={k} className="text-right font-semibold">{rateSizeLabel(k)}</th>)}<th className="text-right font-semibold">Full</th></tr></thead>
                  <tbody>
                    {cfg.buildings.filter(b => b.market === mk).map(b => (
                      <tr key={b.label} className="border-t border-line">
                        <td className="py-1 text-ink font-semibold">{b.label}{b.outsourced ? <span className="block text-[10px] font-normal text-muted">outsourced</span> : null}{b.ownerCleans ? <span className="block text-[10px] font-normal text-muted">owner cleans</span> : null}</td>
                        {[...RATE_SIZES, 'full' as const].map(k => {
                          const v = k === 'full' ? b.fullRate : b.rates[k]
                          return (
                            <td key={k} className="text-right py-1 tabular-nums">
                              {dollars && !b.ownerCleans
                                ? <span className="inline-flex items-center gap-1"><input type="number" step="0.01" className="w-16 text-right border border-line rounded px-1 py-0.5" value={v == null ? '' : v} placeholder="—" onChange={e => setRate(b.label, k, e.target.value)} /><span className="w-10 text-left text-muted text-[10.5px]">{hrs(v)}</span></span>
                                : <span className={v == null ? 'text-muted' : 'text-ink'}>{v == null ? '—' : hrs(v)}</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {dollars && (
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => save(false)} disabled={state === 'saving'} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{state === 'saving' ? 'Saving…' : 'Save rates'}</button>
                <button onClick={() => save(true)} disabled={state === 'saving'} className="text-[12px] px-3 py-1.5 rounded-lg border border-line">Reset to the P&amp;L table</button>
                {state === 'saved' && <span className="text-[12px] text-emerald-700">Saved — the scheduler uses these now.</span>}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
