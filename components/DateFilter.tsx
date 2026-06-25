'use client'
import { useRouter, usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

// Day picker for operational pages. Defaults to "today"; selecting any date drives the
// whole page via the ?date=YYYY-MM-DD search param. Clearing it (Today) returns to live today.
export function DateFilter({ selected, isToday }: { selected: string; isToday: boolean }) {
  const router = useRouter()
  const pathname = usePathname()

  function go(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    router.push(`${pathname}?date=${date}`)
  }
  function shift(days: number) {
    const d = new Date(selected + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    go(d.toISOString().slice(0, 10))
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <CalendarDays size={14} className="text-muted" />
      <button onClick={() => shift(-1)} aria-label="Previous day"
        className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-line bg-white text-muted hover:text-ink hover:border-brand-200">
        <ChevronLeft size={15} />
      </button>
      <input type="date" value={selected} onChange={e => go(e.target.value)}
        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-brand-500" />
      <button onClick={() => shift(1)} aria-label="Next day"
        className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-line bg-white text-muted hover:text-ink hover:border-brand-200">
        <ChevronRight size={15} />
      </button>
      {!isToday && (
        <button onClick={() => router.push(pathname)}
          className="text-[12px] font-medium rounded-lg px-2.5 py-1.5 border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100">
          Today
        </button>
      )}
    </div>
  )
}
