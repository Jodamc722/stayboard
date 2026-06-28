import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { WelcomeCallsBoard } from '@/components/WelcomeCallsBoard'
import { PhoneCall } from 'lucide-react'

export const dynamic = 'force-dynamic'

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}

export default async function WelcomeCallsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const toDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const { data } = await sb.from('guesty_reservations')
    .select('id,guest_name,listing_name,check_in,status,custom_fields')
    .gte('check_in', today).lte('check_in', toDate).order('check_in').limit(500)

  const fieldVal = (cf: any, kw: string) => {
    if (!Array.isArray(cf)) return undefined
    const ff = cf.find((c: any) => String(c?.fieldName || c?.name || c?.fieldId?.name || '').toLowerCase().includes(kw))
    return ff ? ff.value : undefined
  }
  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))

  // Calls are due in the 48h-to-arrival window. Priority buildings get called first.
  const dueDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const PRIORITY = ['17west', '17 west', 'arya', 'elser', '7071', 'amrit']
  const rows = (data || [])
    .filter((r: any) => !/cancel|declin/i.test(String(r.status || '')))
    .map((r: any) => {
      const listing = r.listing_name || ''
      const check_in = String(r.check_in).slice(0, 10)
      const lname = listing.toLowerCase()
      return {
        id: r.id,
        guest: r.guest_name || '',
        listing,
        building: rollupBuilding(r.listing_name),
        check_in,
        done: truthy(fieldVal(r.custom_fields, 'welcome')),
        sensitive: truthy(fieldVal(r.custom_fields, 'sensitive')),
        due: check_in <= dueDate,                                  // within 48h of arrival
        prio: PRIORITY.some(k => lname.includes(k)) ? 0 : 1,       // priority buildings first
      }
    })

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><PhoneCall size={13} /> Pre-arrival</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Welcome calls</h1>
        <p className="text-sm text-muted mt-1">Upcoming check-ins. Mark each guest&apos;s welcome call done — it pushes to the reservation&apos;s Welcome Call field in Guesty.</p>
      </header>
      <WelcomeCallsBoard rows={rows} />
    </Shell>
  )
}
