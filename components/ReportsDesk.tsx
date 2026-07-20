'use client'
// Owner Reports desk: list of generated reports + the New-report flow
// (pick buildings, period, as-of → generate → open the share page).
import { useEffect, useState } from 'react'
import { FileText, Loader2, Plus, Trash2, ExternalLink, Sparkles } from 'lucide-react'

type ReportRow = {
  id: string; code: string; title: string; scope_label: string | null
  period_start: string; period_end: string; as_of: string; theme: string; status: string
  created_at: string; updated_at: string
}

function monthDefaults(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear(); const m = now.getMonth()
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
  return { start, end }
}

export function ReportsDesk() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [buildings, setBuildings] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const defaults = monthDefaults()
  const [periodStart, setPeriodStart] = useState(defaults.start)
  const [periodEnd, setPeriodEnd] = useState(defaults.end)
  const [showNew, setShowNew] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  function loadReports() {
    fetch('/api/reports').then(r => r.json()).then(d => {
      if (Array.isArray(d?.reports)) setReports(d.reports)
      setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => {
    loadReports()
    fetch('/api/reports/budgets?buildings=1').then(r => r.json()).then(d => {
      if (Array.isArray(d?.buildings)) setBuildings(d.buildings)
    }).catch(() => {})
  }, [])

  function toggleBuilding(b: string) {
    setPicked(prev => prev.indexOf(b) >= 0 ? prev.filter(x => x !== b) : [...prev, b])
  }

  async function generate() {
    if (!picked.length) { setMsg('Pick at least one property.'); return }
    setGenerating(true); setMsg('Pulling data + writing the report… (~30s)')
    try {
      const r = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildings: picked, periodStart, periodEnd }),
      })
      const d = await r.json()
      if (d?.ok && d?.code) {
        window.location.href = '/r/' + d.code
        return
      }
      setMsg(d?.error || 'Generate failed')
    } catch { setMsg('Generate failed') }
    setGenerating(false)
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this report? The share link will stop working.')) return
    await fetch('/api/reports?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {})
    loadReports()
  }

  return (
    <div className="space-y-5">
      {/* New report */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-ink flex items-center gap-1.5"><Sparkles size={14} className="text-brand-600" /> New owner report</h2>
            <p className="text-[12px] text-muted mt-0.5">Pick properties + a period. Revenue, occupancy, reviews and completed work are pulled automatically.</p>
          </div>
          {!showNew && (
            <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-4 py-2 hover:bg-brand-700">
              <Plus size={14} /> New report
            </button>
          )}
        </div>
        {showNew && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Properties</p>
              <div className="flex flex-wrap gap-2">
                {buildings.map(b => {
                  const on = picked.indexOf(b) >= 0
                  return (
                    <button key={b} onClick={() => toggleBuilding(b)}
                      className={'rounded-full px-3 py-1.5 text-[12.5px] font-semibold border transition-colors ' + (on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:border-brand-300')}>
                      {b}
                    </button>
                  )
                })}
                {!buildings.length && <span className="text-sm text-muted italic">Loading properties…</span>}
              </div>
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Period start</span>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Period end</span>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="mt-1 block rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
              </label>
              <button onClick={generate} disabled={generating || !picked.length}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-semibold px-5 py-2 hover:bg-brand-700 disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate report
              </button>
              <button onClick={() => { setShowNew(false); setMsg('') }} className="text-sm text-muted hover:text-ink px-2 py-2">Cancel</button>
            </div>
            {msg && <p className="text-[13px] text-amber-700">{msg}</p>}
            <p className="text-[11px] text-muted">Performance vs Plan appears automatically when the property has a stored budget. PriceLabs pacing + owner statements arrive as upload options next.</p>
          </div>
        )}
      </section>

      {/* List */}
      <section className="rounded-2xl border border-line bg-white overflow-hidden">
        {loading ? (
          <div className="text-sm text-muted italic py-10 text-center">Loading reports…</div>
        ) : !reports.length ? (
          <div className="text-sm text-muted italic py-10 text-center">No reports yet — generate the first one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-line bg-app/50">
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">Report</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">Period</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">As of</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-app/40">
                  <td className="px-4 py-3">
                    <a href={'/r/' + r.code} className="font-semibold text-ink hover:text-brand-700 inline-flex items-center gap-1.5">
                      <FileText size={14} className="text-muted" /> {r.title}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted tabular-nums">{r.period_start} → {r.period_end}</td>
                  <td className="px-4 py-3 text-muted tabular-nums">{r.as_of}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 uppercase tracking-wider">{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <a href={'/r/' + r.code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800 mr-3">
                      <ExternalLink size={12} /> Open
                    </a>
                    <button onClick={() => remove(r.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-red-600">
                      <Trash2 size={12} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
