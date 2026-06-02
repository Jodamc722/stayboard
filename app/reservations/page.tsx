import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'

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

  const [{ data: rows }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, check_in, check_out, nights, status, source, money_total, money_currency, custom_fields')
      .order('check_in', { ascending: false })
      .limit(200),
    supabase.from('guesty_sync_status').select('last_sync_at, last_error').eq('entity', 'reservations').maybeSingle()
  ])

  const list = rows ?? []
  const lastSync = sync?.last_sync_at ? new Date(sync.last_sync_at) : null

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="text-sm text-slate-500">
            {lastSync
              ? <>Last synced from Guesty {timeAgo(lastSync)}</>
              : <>Not synced yet — click "Sync now"</>}
            {sync?.last_error && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-rose-50 text-rose-700 ring-1 ring-rose-600/20">
                last sync error
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{list.length} loaded</span>
          <SyncNowButton />
        </div>
      </header>

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-slate-500">No reservations in Supabase yet. Click <strong>Sync now</strong> to pull from Guesty.</p>
        </div>
      ) : (
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
              {list.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-sm font-medium">
                    <Link href={`/reservations/${r.id}`} className="text-slate-900 hover:text-brand-600">{r.guest_name || 'Unknown'}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{r.listing_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(r.check_in)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(r.check_out)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.nights ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[r.status] || 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
                      {(r.status || '').replace('_', ' ') || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs"><FlagChips fields={r.custom_fields ?? []} /></td>
                  <td className="px-4 py-3 text-xs text-slate-500 uppercase">{r.source || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 font-medium text-right">
                    {r.money_total != null ? `${r.money_currency || 'USD'} ${Number(r.money_total).toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}

function FlagChips({ fields }: { fields: any[] }) {
  if (!Array.isArray(fields) || fields.length === 0) return <span className="text-slate-300">—</span>
  // Find by fuzzy name match (case-insensitive contains)
  const find = (slug: string) => fields.find((f: any) =>
    (f.fieldName || f.name || '').toLowerCase().includes(slug))
  const truthy = (v: any) => v === true || v === 'true' || (typeof v === 'string' && v.trim().length > 0)

  const welcome   = find('welcome')
  const verified  = find('verified')
  const sensitive = find('sensitive')
  const risk      = find('risk')
  const idsub     = find('id submit') || find('id submitted')
  return (
    <div className="flex flex-wrap gap-1">
      {welcome   && truthy(welcome.value)   && <Chip tone="green"  label="Welcome"   />}
      {verified  && truthy(verified.value)  && <Chip tone="green"  label="Verified"  />}
      {idsub     && truthy(idsub.value)     && <Chip tone="green"  label="ID"        />}
      {sensitive && truthy(sensitive.value) && <Chip tone="rose"   label="Sensitive" />}
      {risk && String(risk.value).toLowerCase() === 'high'   && <Chip tone="rose"  label="High risk" />}
      {risk && String(risk.value).toLowerCase() === 'medium' && <Chip tone="amber" label="Med risk"  />}
    </div>
  )
}
function Chip({ tone, label }: { tone: 'green' | 'rose' | 'amber'; label: string }) {
  const cls = tone === 'rose'  ? 'bg-rose-50 text-rose-700 ring-rose-600/20'
            : tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
            :                    'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${cls}`}>
      <span className="w-1 h-1 rounded-full bg-current"/>{label}
    </span>
  )
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function timeAgo(d: Date) {
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
