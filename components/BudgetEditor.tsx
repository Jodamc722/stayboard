'use client'
// Budget grid editor: pick building + year, edit 12 months x 4 metrics, Save.
// Empty cells = no budget for that metric; a month with all cells empty is still
// saved as nulls (harmless) — Performance vs Plan only renders metrics that exist.
import { useEffect, useState } from 'react'
import { Save, Loader2, Building2 } from 'lucide-react'

type MonthRow = { month: number; occupancy_pct: number | null; adr: number | null; revpar: number | null; gross_revenue: number | null }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const METRICS: { key: keyof MonthRow; label: string; hint: string }[] = [
  { key: 'occupancy_pct', label: 'Occupancy %', hint: 'e.g. 80' },
  { key: 'adr', label: 'ADR $', hint: 'e.g. 276' },
  { key: 'revpar', label: 'RevPAR $', hint: 'e.g. 221' },
  { key: 'gross_revenue', label: 'Gross Rev $', hint: 'e.g. 178000' },
]

export function BudgetEditor() {
  const [buildings, setBuildings] = useState<string[]>([])
  const [building, setBuilding] = useState<string>('')
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [months, setMonths] = useState<MonthRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string>('')

  useEffect(() => {
    fetch('/api/reports/budgets?buildings=1')
      .then(r => r.json())
      .then(d => {
        const list: string[] = Array.isArray(d?.buildings) ? d.buildings : []
        setBuildings(list)
        const seventeen = list.find(b => /17\s*west/i.test(b))
        if (seventeen) setBuilding(seventeen)
        else if (list.length) setBuilding(list[0])
      })
      .catch(() => setMsg('Could not load buildings'))
  }, [])

  useEffect(() => {
    if (!building) return
    setLoading(true); setMsg('')
    fetch('/api/reports/budgets?building=' + encodeURIComponent(building) + '&year=' + year)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.months)) setMonths(d.months)
        else { setMonths([]); setMsg(d?.error || 'Load failed') }
      })
      .catch(() => setMsg('Load failed'))
      .then(() => setLoading(false))
  }, [building, year])

  function setCell(month: number, key: string, raw: string) {
    setMonths(prev => prev.map(m => {
      if (m.month !== month) return m
      const v = raw.trim() === '' ? null : Number(raw)
      const next: any = { ...m }
      next[key] = v != null && Number.isFinite(v) ? v : (raw.trim() === '' ? null : (next as any)[key])
      return next
    }))
  }

  async function save() {
    if (!building) return
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/reports/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, year, months }),
      })
      const d = await r.json()
      setMsg(d?.ok ? 'Saved.' : (d?.error || 'Save failed'))
    } catch { setMsg('Save failed') }
    setSaving(false)
  }

  const hasAny = months.some(m => m.occupancy_pct != null || m.adr != null || m.revpar != null || m.gross_revenue != null)

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-muted font-semibold flex items-center gap-1"><Building2 size={11} /> Building</span>
          <select
            value={building}
            onChange={e => setBuilding(e.target.value)}
            className="mt-1 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink min-w-[220px]"
          >
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Year</span>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="mt-1 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button
          onClick={save}
          disabled={saving || loading || !building}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-4 py-2 hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save budget
        </button>
        {msg && <span className={'text-sm ' + (msg === 'Saved.' ? 'text-emerald-700' : 'text-amber-700')}>{msg}</span>}
      </div>

      <section className="rounded-2xl border border-line bg-white p-4 overflow-x-auto">
        {loading ? (
          <div className="text-sm text-muted italic py-8 text-center">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-3 text-[11px] uppercase tracking-wider text-muted font-semibold">Month</th>
                {METRICS.map(mt => (
                  <th key={String(mt.key)} className="py-2 pr-3 text-[11px] uppercase tracking-wider text-muted font-semibold">{mt.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map(m => (
                <tr key={m.month} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-semibold text-ink">{MONTH_NAMES[m.month - 1]}</td>
                  {METRICS.map(mt => (
                    <td key={String(mt.key)} className="py-1.5 pr-3">
                      <input
                        type="number"
                        placeholder={mt.hint}
                        value={(m as any)[mt.key] ?? ''}
                        onChange={e => setCell(m.month, String(mt.key), e.target.value)}
                        className="w-28 rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink tabular-nums"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !hasAny && (
          <p className="mt-3 text-[12px] text-muted">No budget saved for {building || 'this building'} in {year} yet. Reports for it will skip &ldquo;Performance vs Plan&rdquo; until one exists.</p>
        )}
      </section>
    </div>
  )
}
