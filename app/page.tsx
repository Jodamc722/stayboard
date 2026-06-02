import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { listReservations, listListings } from '@/lib/guesty'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [reservations, listings] = await Promise.all([listReservations(50), listListings()])
  const today = new Date().toDateString()
  const checkInsToday = reservations.filter(r => new Date(r.checkIn).toDateString() === today).length
  const checkOutsToday = reservations.filter(r => new Date(r.checkOut).toDateString() === today).length

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Good morning</h1>
        <p className="text-sm text-slate-500">Welcome back to STAYBOARD, {user.email?.split('@')[0]}</p>
      </header>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Active reservations" value={reservations.length} />
        <Stat label="Properties under mgmt" value={listings.length} />
        <Stat label="Check-ins today" value={checkInsToday} highlight />
        <Stat label="Check-outs today" value={checkOutsToday} highlight />
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-2">Quick links</h2>
        <div className="grid grid-cols-2 gap-3">
          <a href="/reservations" className="block p-4 rounded-lg border border-slate-200 hover:border-brand-500 transition">
            <div className="font-medium text-slate-900">📅 Reservations</div>
            <div className="text-xs text-slate-500 mt-1">View all bookings, check-ins, check-outs</div>
          </a>
          <a href="/listings" className="block p-4 rounded-lg border border-slate-200 hover:border-brand-500 transition">
            <div className="font-medium text-slate-900">🏘️ Listings</div>
            <div className="text-xs text-slate-500 mt-1">Manage properties + sync from Guesty</div>
          </a>
        </div>
      </div>
    </Shell>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${highlight ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-slate-200'}`}>
      <div className={`text-xs uppercase tracking-wider ${highlight ? 'text-white/80' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-3xl font-bold mt-1 ${highlight ? 'text-white' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}
