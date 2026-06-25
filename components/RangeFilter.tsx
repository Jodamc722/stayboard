'use client'
import { useRouter, usePathname } from 'next/navigation'
import { CalendarRange } from 'lucide-react'

// Date-range picker for the revenue dashboard. Drives the page via ?from=&to= (YYYY-MM-DD).
export function RangeFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const pathname = usePathname()

  function go(f: string, t: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return
    router.push(`${pathname}?from=${f}&to=${t}`)
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  function preset(kind: 'mtd' | 'd30' | 'd90' | 'ytd') {
    const now = new Date()
    let f: Date
    if (kind === 'mtd') f = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    else if (kind === 'ytd') f = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    else { f = new Date(now); f.setUTCDate(f.getUTCDate() - (kind === 'd30' ? 29 : 89)) }
    go(iso(f), iso(now))
  }

  const presets: { k: 'mtd' | 'd30' | 'd90' | 'ytd'; label: string }[] = [
    { k: 'd30', label: '30d' }, { k: 'd90', label: '90d' }, { k: 'mtd', label: 'Month' }, { k: 'ytd', label: 'YTD' },
  ]

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><CalendarRange size={14} /></span>
      <input type="date" value={from} onChange={e => go(e.target.value, to)}
        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-brand-500" />
      <span className="text-muted text-sm">to</span>
      <input type="date" value={to} onChange={e => go(from, e.target.value)}
        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-brand-500" />
      <div className="inline-flex gap-1">
        {presets.map(p => (
          <button key={p.k} onClick={() => preset(p.k)}
            className="text-[12px] font-medium rounded-lg px-2.5 py-1.5 border border-line bg-white text-muted hover:text-brand-700 hover:border-brand-200">
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
