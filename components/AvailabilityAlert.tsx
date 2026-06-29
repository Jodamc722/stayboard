'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, AlertTriangle, Check, Loader2, ChevronDown } from 'lucide-react'

type Flagged = { id: string; name: string; building: string | null; horizonDays: number; furthestDate: string | null }
type Scan = {
  ok?: boolean; error?: string
  target?: number; threshold?: number; generatedAt?: string
  totalActive?: number; scanned?: number; checked?: number; flaggedCount?: number; flagged?: Flagged[]
  errorsCount?: number
}

export function AvailabilityAlert() {
  const [data, setData] = useState<Scan | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/availability-scan')
      .then(r => r.json())
      .then(j => { if (alive) { setData(j); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-white px-4 py-3 text-[13px] text-muted flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Checking booking-window coverage across active listings…
      </div>
    )
  }
  if (!data || data.error) return null

  const flagged = data.flagged ?? []
  const target = data.target ?? 600
  const threshold = data.threshold ?? 400

  if (flagged.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-[13px] text-emerald-800 flex items-center gap-2">
        <Check size={14} /> {data.checked ?? data.totalActive ?? 0} of {data.totalActive ?? 0} active listings checked — none bookable under {threshold} days. Target {target}.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
          <AlertTriangle size={15} />
          {flagged.length} active {flagged.length === 1 ? 'listing is' : 'listings are'} bookable under {threshold} days
          <span className="font-normal text-amber-700/80">(target {target} · {data.checked ?? 0}/{data.totalActive ?? 0} checked)</span>
        </span>
        <ChevronDown size={15} className={`text-amber-700 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="border-t border-amber-200 divide-y divide-amber-100 bg-white/60 max-h-80 overflow-auto">
          {flagged.map(f => (
            <li key={f.id} className="px-4 py-2 flex items-center justify-between gap-3 text-[13px]">
              <Link href={`/listings/${f.id}`} className="font-medium text-ink hover:text-brand-700 truncate">
                {f.name}{f.building ? <span className="text-muted font-normal"> · {f.building}</span> : null}
              </Link>
              <span className="inline-flex items-center gap-1.5 shrink-0">
                <CalendarClock size={13} className="text-amber-600" />
                <span className="font-semibold text-amber-800 tabular-nums">{f.horizonDays}d</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
