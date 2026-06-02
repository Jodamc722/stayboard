import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { listReservations, lastGuestyError } from '@/lib/guesty'
import type { CustomFieldValue } from '@/types/guesty'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  confirmed:   'bg-blue-50 text-blue-700 ring-blue-600/20',
  checked_in:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  checked_out: 'bg-slate-50 text-slate-600 ring-slate-500/20',
  cancelled:   'bg-rose-50 text-rose-700 ring-rose-600/20',
  inquiry:     'bg-amber-50 text-amber-700 ring-amber-600/20',
  reserved:    'bg-indigo-50 text-indigo-700 ring-indigo-600/20'
}

export default async function ReservationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const rows = await listReservations(40)
  const err = lastGuestyError

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="text-sm text-slate-500">
            Live from Guesty {process.env.GUESTY_MOCK_MODE === 'true' && (
              <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 ring-1 ring-amber-600/20">mock mode</span>
            )}
          </p>
        </div>
        <span className="text-xs text-slate-400">{rows.length} loaded</span>
      </header>

      {err && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          <strong>Guesty error:</strong> <code className="font-mono text-xs">{err}</code>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Guest', 'Listing', 'Check-in', 'Check-out', 'Nights', 'Status', 'Flags', 'Source', 'Total'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No reservations.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 text-sm font-medium">
                  <Link href={`/reservations/${r.id}`} className="text-slate-900 hover:text-brand-600">
                    {r.guest.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.listingName}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(r.checkIn)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(r.checkOut)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{r.nights}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[r.status] || ''}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  <FlagChips fields={r.customFields ?? []} />
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

function FlagChips({ fields }: { fields: CustomFieldValue[] }) {
  const find = (slug: string) => fields.find(f => f.fieldName.toLowerCase().includes(slug))
  const welcome   = find('welcome')
  const verified  = find('verified')
  const sensitive = find('sensitive')
  const risk      = fields.find(f => f.fieldName.toLowerCase().includes('risk'))
  return (
    <div className="flex flex-wrap gap-1">
      <Chip on={!!welcome?.value}   label="Welcome"   />
      <Chip on={!!verified?.value}  label="Verified"  />
      {sensitive?.value && <Chip on tone="rose" label="Sensitive" />}
      {risk?.value === 'high' && <Chip on tone="rose" label="High risk" />}
      {risk?.value === 'medium' && <Chip on tone="amber" label="Med risk" />}
    </div>
  )
}
function Chip({ on, label, tone }: { on: boolean; label: string; tone?: 'rose' | 'amber' }) {
  if (!on) return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-50 text-slate-400 ring-1 ring-slate-200">
      <span className="w-1 h-1 rounded-full bg-slate-300"/>{label}
    </span>
  )
  const cls = tone === 'rose' ? 'bg-rose-50 text-rose-700 ring-rose-600/20'
            : tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
            : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${cls}`}>
      <span className="w-1 h-1 rounded-full bg-current"/>{label}
    </span>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
