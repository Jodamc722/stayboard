'use client'
// Labor — Homebase timesheet upload + labor KPIs joined against Breezeway completed work.
// Upload the Homebase timesheet CSV export; the board shows hours, cost, cleans completed,
// and hours/cost per clean for each person over the selected range.
import { useState, useEffect, useCallback } from 'react'
import { Shell } from '@/components/Shell'
import { Timer, UploadCloud, RefreshCw } from 'lucide-react'

type Person = { employee: string; hours: number; cost: number; days: number; cleans: number; hoursPerClean: number | null; costPerClean: number | null }
type Data = { ok: boolean; from: string; to: string; totals: { hours: number; cost: number; cleans: number; people: number }; people: Person[]; hasData: boolean; error?: string }

function shiftDay(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function money(n: number) { return '$' + Math.round(n).toLocaleString() }

export default function LaborPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setErr('')
      const qs = range ? '?from=' + range.from + '&to=' + range.to : ''
      const r = await fetch('/api/labor' + qs, { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [range])
  useEffect(() => { setLoading(true); load() }, [load])

  const upload = async (file: File) => {
    setBusy(true); setMsg(''); setErr('')
    try {
      const csv = await file.text()
      const r = await fetch('/api/labor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, filename: file.name }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not parse the file'); setBusy(false); return }
      setMsg('Imported ' + j.rows + ' person-days (' + j.shifts + ' shifts) covering ' + j.from + ' → ' + j.to)
      setRange({ from: j.from, to: j.to })
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const d = data
  return (
    <Shell>
      <header className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted flex items-center gap-1.5"><Timer size={12} /> Team</div>
        <h1 className="text-3xl font-bold text-ink mt-1">Labor</h1>
        <p className="text-sm text-muted mt-1">Upload the Homebase timesheet export, and this joins hours + wages against completed Breezeway cleans: hours per clean and cost per clean, per person.</p>
      </header>

      <div className="rounded-2xl border border-line bg-white p-4 mb-4 flex items-center gap-3 flex-wrap">
        <label className={'inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-line cursor-pointer hover:bg-app ' + (busy ? 'opacity-50 pointer-events-none' : '')}>
          <UploadCloud size={15} /> {busy ? 'Importing…' : 'Upload Homebase CSV'}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files && e.target.files[0]; if (f) upload(f); e.currentTarget.value = '' }} />
        </label>
        <span className="text-xs text-muted">Timesheets &rarr; Export in Homebase. Re-uploading the same file just updates it.</span>
        {d && (
          <span className="ml-auto inline-flex items-center rounded-lg border border-line overflow-hidden divide-x divide-line">
            <button onClick={() => setRange({ from: shiftDay((d.to || ''), -6), to: d.to })} className="text-sm font-medium px-2.5 py-1.5 bg-white hover:bg-app">7d</button>
            <button onClick={() => setRange({ from: shiftDay((d.to || ''), -13), to: d.to })} className="text-sm font-medium px-2.5 py-1.5 bg-white hover:bg-app">14d</button>
            <button onClick={() => setRange({ from: shiftDay((d.to || ''), -29), to: d.to })} className="text-sm font-medium px-2.5 py-1.5 bg-white hover:bg-app">30d</button>
            <button onClick={() => { setLoading(true); load() }} className="text-sm font-medium px-2.5 py-1.5 bg-white hover:bg-app inline-flex items-center gap-1"><RefreshCw size={12} /></button>
          </span>
        )}
      </div>

      {msg && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{msg}</div>}
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {loading && !d && <div className="text-sm text-muted py-10 text-center">Loading labor data&hellip;</div>}

      {d && !d.hasData && !msg && (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">No timesheet data for {d.from} &rarr; {d.to} yet. Upload a Homebase CSV above to light this page up.</div>
      )}

      {d && d.hasData && (
        <>
          <div className="text-xs text-muted mb-2">{d.from} &rarr; {d.to}</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
            <div className="rounded-2xl border border-line bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-muted">Hours</div><div className="text-2xl font-bold text-ink">{d.totals.hours.toLocaleString()}</div></div>
            <div className="rounded-2xl border border-line bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-muted">Labor cost</div><div className="text-2xl font-bold text-ink">{d.totals.cost ? money(d.totals.cost) : '—'}</div></div>
            <div className="rounded-2xl border border-line bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-muted">Cleans done</div><div className="text-2xl font-bold text-ink">{d.totals.cleans}</div></div>
            <div className="rounded-2xl border border-line bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-muted">Hours / clean</div><div className="text-2xl font-bold text-ink">{d.totals.cleans ? Math.round((d.totals.hours / d.totals.cleans) * 10) / 10 : '—'}</div></div>
            <div className="rounded-2xl border border-line bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-muted">Cost / clean</div><div className="text-2xl font-bold text-ink">{d.totals.cleans && d.totals.cost ? money(d.totals.cost / d.totals.cleans) : '—'}</div></div>
          </div>

          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-app text-muted text-[11px] uppercase tracking-wider text-left border-b border-line">
                <th className="px-3 py-2 font-semibold">Person</th><th className="px-3 py-2 font-semibold text-right">Days</th><th className="px-3 py-2 font-semibold text-right">Hours</th><th className="px-3 py-2 font-semibold text-right">Cost</th><th className="px-3 py-2 font-semibold text-right">Cleans</th><th className="px-3 py-2 font-semibold text-right">Hrs / clean</th><th className="px-3 py-2 font-semibold text-right">Cost / clean</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {d.people.map(p => (
                  <tr key={p.employee} className="hover:bg-app/50">
                    <td className="px-3 py-2 font-medium text-ink">{p.employee}</td>
                    <td className="px-3 py-2 text-right text-muted">{p.days}</td>
                    <td className="px-3 py-2 text-right text-ink">{p.hours}</td>
                    <td className="px-3 py-2 text-right text-ink">{p.cost ? money(p.cost) : '—'}</td>
                    <td className="px-3 py-2 text-right text-ink">{p.cleans || '—'}</td>
                    <td className="px-3 py-2 text-right text-ink">{p.hoursPerClean != null ? p.hoursPerClean : '—'}</td>
                    <td className="px-3 py-2 text-right text-ink">{p.costPerClean != null ? money(p.costPerClean) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">Cleans are matched by first name + last initial between Homebase and Breezeway. People with hours but no cleans are usually maintenance / inspectors / office &mdash; their cost still counts in the totals.</p>
        </>
      )}
    </Shell>
  )
}
