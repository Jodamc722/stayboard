'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { Check, X } from 'lucide-react'

const PRIORITY: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
}

export function PendingRow({ r }: { r: any }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const router = useRouter()

  async function decide(approved: boolean) {
    setBusy(approved ? 'a' : 'r')
    const supabase = createClient()
    const { error } = await supabase.from('field_requests').update({
      approval_status: approved ? 'approved' : 'rejected',
      status: approved ? 'open' : 'rejected',
      updated_at: new Date().toISOString(),
    }).eq('id', r.id)
    setBusy(null)
    if (!error) { setDone(approved ? 'Approved' : 'Rejected'); router.refresh() }
    else alert('Could not update: ' + error.message)
  }

  const pk = (r.priority || 'low').toLowerCase()
  const meta = [r.type, [r.building, r.unit].filter(Boolean).join(' '), r.vendor].filter(Boolean).join(' · ')

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-app transition-colors">
      <Link href={`/requests/${r.id}`} className="flex-1 min-w-0 group">
        <div className="font-medium text-ink truncate text-sm group-hover:text-brand-700">{r.title || 'Untitled request'}</div>
        <div className="text-xs text-muted truncate mt-0.5">
          {meta}{r.amount_usd != null ? <span className="font-semibold text-ink"> · ${Number(r.amount_usd).toLocaleString()}</span> : null}
        </div>
      </Link>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY[pk] || PRIORITY.low}`}>
        {(r.priority || 'low').replace(/^\w/, (c: string) => c.toUpperCase())}
      </span>
      {done ? (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap ${done === 'Approved' ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>{done}</span>
      ) : (
        <div className="flex items-center gap-1.5">
          <button onClick={() => decide(true)} disabled={!!busy}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check size={13} /> {busy === 'a' ? '…' : 'Approve'}
          </button>
          <button onClick={() => decide(false)} disabled={!!busy}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 disabled:opacity-50">
            <X size={13} /> {busy === 'r' ? '…' : 'Reject'}
          </button>
        </div>
      )}
    </li>
  )
}
