import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { listReservations } from '@/lib/guesty'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  checked_in: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  checked_out: 'bg-slate-50 text-slate-600 ring-slate-500/20',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  inquiry: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  reserved: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20'
}

export default async function ReservationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const rows = await listReservations(30)

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="text-sm text-slate-500">
            Live from Guesty {process.env.NEXT_PUBLIC_GUESTY_MOCK_MODE === 'true' && '(mock mode)'}
          </p>
        </div>
        <span className="text-xs text-slate-400">{rows.length} loaded</span>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Guest', 'Listing', 'Check-in', 'Check-out', 'Nights', 'Status', 'Source', 'Total'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No reservations.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{r.guest.name}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.listingName}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(r.checkIn)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(r.checkOut)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{r.nights}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[r.status] || ''}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 uppercase">{r.source}</td>
                <td className="px-4 py-3 text-sm text-slate-900 font-medium text-right">${r.money.totalPaid.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
