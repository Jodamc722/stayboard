'use client'
// Move a weekly Action-Plan item to a different day. A small date input that PATCHes the
// item's scheduled_date and refreshes so it re-groups under the new day.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock } from 'lucide-react'

export function PlanItemReschedule({ itemId, initial }: { itemId: string; initial: string | null }) {
  const router = useRouter()
  const [date, setDate] = useState(initial || '')
  const [busy, setBusy] = useState(false)
  async function save(d: string) {
    if (busy) return
    setBusy(true); const prev = date; setDate(d)
    try {
      const res = await fetch('/api/ops-plan/item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, scheduledDate: d || null }) })
      const j = await res.json(); if (!res.ok || j.error) throw new Error(j.error || 'failed')
      router.refresh()
    } catch { setDate(prev) } finally { setBusy(false) }
  }
  return (
    <label className="inline-flex items-center gap-1 text-[11px] text-muted cursor-pointer hover:text-ink" title="Reschedule to another day">
      <CalendarClock size={12} />
      <input type="date" value={date} disabled={busy} onChange={e => save(e.target.value)}
        className="bg-transparent border border-line rounded-md px-1.5 py-0.5 text-[11px] text-ink focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:opacity-50" />
    </label>
  )
}
