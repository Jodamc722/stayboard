'use client'
// components/LaborSettings.tsx — labor thresholds, editable per market.
// Render inside the settings area (e.g. /settings/labor or a card on Users & admin).
import { useCallback, useEffect, useState } from 'react'
import { Settings2, Check } from 'lucide-react'

const FIELDS = [
  { key: 'pct_good', label: 'Labor % — on target when ≤', hint: '% of revenue' },
  { key: 'pct_bad', label: 'Labor % — over target when >', hint: '% of revenue' },
  { key: 'grace_min', label: 'Clock-in grace', hint: 'minutes' },
  { key: 'over_sched_min', label: 'Over-schedule flag after', hint: 'minutes past schedule' },
  { key: 'ot_weekly_hours', label: 'Overtime week threshold', hint: 'hours' },
  { key: 'attribution_min', label: 'Per-cleaner board reliability gate', hint: '0–1 share of revenue attributed' },
] as const

export function LaborSettings() {
  const [rows, setRows] = useState<any[]>([])
  const [saving, setSaving] = useState('')
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await (await fetch('/api/labor/settings', { cache: 'no-store' })).json()
      if (j.ok) setRows(j.settings)
      else setErr(j.error || 'Could not load')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (market: string) => {
    const row = rows.find(r => r.market === market)
    setSaving(market); setErr(''); setSaved('')
    try {
      const r = await fetch('/api/labor/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Save failed')
      setSaved(market); setTimeout(() => setSaved(''), 2000)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setSaving('')
  }

  const set = (market: string, key: string, v: string) =>
    setRows(rs => rs.map(r => r.market === market ? { ...r, [key]: v } : r))

  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-bold text-ink flex items-center gap-1.5">
        <Settings2 size={15} /> Labor thresholds
      </h2>
      <p className="text-[12.5px] text-muted -mt-2">
        Per-market bands for the briefs and the labor page. The <b>default</b> row applies wherever a market has no value of its own.
      </p>
      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{err}</div>}

      <div className="grid gap-3 md:grid-cols-3">
        {rows.map(r => (
          <div key={r.market} className="rounded-xl border border-line bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide font-bold text-ink mb-3">{r.market}</p>
            <div className="space-y-2.5">
              {FIELDS.map(f => (
                <label key={f.key} className="block">
                  <span className="text-[11.5px] text-muted">{f.label} <span className="opacity-60">({f.hint})</span></span>
                  <input
                    type="number" step="any" value={r[f.key] ?? ''}
                    onChange={e => set(r.market, f.key, e.target.value)}
                    className="mt-0.5 w-full text-[13px] border border-line rounded-lg px-2 py-1.5 bg-white tabular-nums"
                  />
                </label>
              ))}
            </div>
            <button onClick={() => save(r.market)} disabled={saving === r.market}
              className="mt-3 w-full text-[12px] font-semibold rounded-lg px-3 py-1.5 bg-ink text-white hover:opacity-90 disabled:opacity-50">
              {saved === r.market ? <span className="inline-flex items-center gap-1"><Check size={12} /> Saved</span> : saving === r.market ? 'Saving…' : 'Save ' + r.market}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
