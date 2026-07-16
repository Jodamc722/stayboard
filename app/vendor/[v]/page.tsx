'use client'
import { useEffect, useState } from 'react'

type Clean = { unit: string; date: string; bedrooms: number | null; doorCode: string | null; checkOut: string; sameDayTurn: boolean }
type Day = { date: string; dow: string; count: number; cleans: Clean[] }
type Data = { ok: boolean; vendor?: string; today?: string; weekEnd?: string; total?: number; days?: Day[]; error?: string }

function fmtDate(iso: string) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }

export default function VendorPage({ params }: { params: { v: string } }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/public/vendor-checkouts?v=' + encodeURIComponent(params.v))
      .then(r => r.json())
      .then((j: Data) => { if (!j || !j.ok) setErr(j?.error || 'Could not load the schedule.'); else setData(j) })
      .catch(() => setErr('Could not load the schedule.'))
  }, [params.v])

  function exportCsv() {
    if (!data?.days) return
    const rows: string[][] = [['Date', 'Day', 'Unit', 'Bedrooms', 'Checkout', 'Door code', 'Same-day turn']]
    for (const day of data.days) for (const c of day.cleans) rows.push([c.date, day.dow, c.unit, String(c.bedrooms ?? ''), c.checkOut, c.doorCode || '', c.sameDayTurn ? 'YES' : ''])
    const csv = rows.map(r => r.map(x => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (data.vendor || 'vendor') + '-checkouts.csv'; a.click(); URL.revokeObjectURL(a.href)
  }

  if (err) return <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm p-6">{err}</div>
  if (!data) return <div className="min-h-screen flex items-center justify-center text-neutral-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">Checkout schedule</div>
            <h1 className="text-2xl font-bold">{data.vendor}</h1>
            <div className="text-xs text-neutral-500">{data.total} checkouts \u00b7 {data.today && fmtDate(data.today)} \u2013 {data.weekEnd && fmtDate(data.weekEnd)}</div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={exportCsv} className="text-sm px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 font-medium">Download CSV</button>
            <button onClick={() => window.print()} className="text-sm px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 font-medium">Print / PDF</button>
          </div>
        </div>
        <div className="space-y-4">
          {data.days!.map(day => (
            <div key={day.date} className="rounded-xl border border-neutral-200 bg-white overflow-hidden break-inside-avoid">
              <div className="flex items-center justify-between px-4 py-2 bg-neutral-100 border-b border-neutral-200">
                <div className="font-semibold text-sm">{fmtDate(day.date)}</div>
                <div className="text-xs text-neutral-500">{day.count} clean{day.count === 1 ? '' : 's'}</div>
              </div>
              {day.cleans.length === 0 ? (
                <div className="px-4 py-3 text-xs text-neutral-400">No checkouts.</div>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {day.cleans.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <div className="flex-1 font-medium">{c.unit}{c.sameDayTurn && <span className="ml-2 text-[10px] font-bold text-rose-600 uppercase">Same-day turn</span>}</div>
                      <div className="text-xs text-neutral-500 w-16 text-right">{c.bedrooms != null ? (c.bedrooms === 0 ? 'Studio' : c.bedrooms + 'BR') : ''}</div>
                      <div className="text-xs text-neutral-500 w-20 text-right">out {c.checkOut}</div>
                      <div className="text-xs font-mono font-semibold w-16 text-right">{c.doorCode || ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="text-[11px] text-neutral-400 mt-6">Live schedule \u2014 refresh for the latest. Stay Hospitality.</div>
      </div>
    </div>
  )
}
