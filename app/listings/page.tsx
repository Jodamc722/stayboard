import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { listListings } from '@/lib/guesty'

export const dynamic = 'force-dynamic'

export default async function ListingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const rows = await listListings()

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Listings</h1>
        <p className="text-sm text-slate-500">All properties under management</p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(l => (
          <div key={l.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">{l.address.city}, {l.address.state}</div>
                <h3 className="font-semibold text-slate-900 mt-0.5">{l.nickname}</h3>
                <div className="text-xs text-slate-500 mt-1">{l.title}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${l.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{l.status}</span>
            </div>
            <div className="mt-4 flex gap-4 text-sm text-slate-600">
              <span>🛏 {l.bedrooms} bd</span>
              <span>🚿 {l.bathrooms} ba</span>
              <span>👥 {l.maxOccupancy} max</span>
            </div>
            {!!l.amenities.length && (
              <div className="mt-3 flex flex-wrap gap-1">
                {l.amenities.slice(0, 4).map(a => (
                  <span key={a} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{a}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Shell>
  )
}
