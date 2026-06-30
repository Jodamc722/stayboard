import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { WelcomeCallsBoard } from '@/components/WelcomeCallsBoard'
import { PhoneCall } from 'lucide-react'
import { getToken } from '@/lib/guesty'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}

// Some Airbnb reservations embed only a STUB guest (id + name, no phone) even though Guesty has the
// number on the guest record. For any displayed reservation missing a phone we fetch /guests/{id} and
// fill it in. Cached 30 min, gentle concurrency to respect Guesty's rate limit.
const guestPhones = unstable_cache(async (ids: string[]) => {
  const map: Record<string, string> = {}
  if (!ids.length) return map
  let tok = ''
  try { tok = await getToken() } catch { return map }
  const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
  const queue = [...ids]
  async function worker() {
    while (queue.length) {
      const id = queue.shift()
      if (!id) break
      try {
        const r = await fetch(`${BASE}/guests/${id}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' })
        if (r.ok) {
          const g: any = await r.json()
          const ph = g?.phone || (Array.isArray(g?.phones) && g.phones.length ? (typeof g.phones[0] === 'string' ? g.phones[0] : (g.phones[0]?.number || g.phones[0]?.phone)) : '')
          if (ph) map[id] = String(ph)
        }
      } catch { /* skip */ }
      await new Promise(res => setTimeout(res, 120))
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return map
}, ['welcome-guest-phones'], { revalidate: 1800 })

export default async function WelcomeCallsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const toDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const { data } = await sb.from('guesty_reservations')
    .select('id,guest_name,guest_phone,listing_name,check_in,check_out,nights,status,money_total,money_paid,money_balance,money_currency,custom_fields,source,raw')
    .gte('check_in', today).lte('check_in', toDate).order('check_in').limit(500)

  const fieldVal = (cf: any, kw: string) => {
    if (!Array.isArray(cf)) return undefined
    const ff = cf.find((c: any) => String(c?.fieldName || c?.name || c?.fieldId?.name || '').toLowerCase().includes(kw))
    return ff ? ff.value : undefined
  }
  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
  // Guesty's reservation customFields arrive as { fieldId, value } with NO field name, and the
  // field-definition name map isn't synced — so we match the "Welcome Call" field by its known id.
  // (Confirmed from live data: the team writes "Completed - <initials>" or a note in this field.)
  const WELCOME_FIELD_ID = '68d59ad7e34f25001311d85a'
  const cfId = (c: any) => String((c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : '') || '')
  const welcomeOf = (cf: any) => Array.isArray(cf) ? cf.find((c: any) => cfId(c) === WELCOME_FIELD_ID || /welcome/i.test(String(c?.fieldName || c?.name || c?.fieldId?.name || ''))) : undefined
  // For a free-text Welcome Call field, "done" = the value reads as a completion (Completed / Done /
  // Called / Yes), or we marked it via the app (_by stamped). Plain notes don't count as done.
  const callDone = (v: any) => typeof v === 'string' && v.trim().length > 0  // any writing in the Welcome Call field = done

  // Calls are due in the 48h-to-arrival window. Priority buildings get called first.
  const dueDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const PRIORITY = ['17west', '17 west', 'arya', 'elser', '7071', 'amrit']
  const recs = (data || []).filter((r: any) => String(r.status || '').toLowerCase() === 'confirmed')
  const rows = recs
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
        phone: r.guest_phone || '',
        value: Number(r.money_total) || 0,
        source: r.source || '',
        notes: (Array.isArray(r.custom_fields) ? ((r.custom_fields.find((c: any) => /reservation[_ ]?notes/i.test(String(c?.fieldName || c?.name || ''))) || {}).value) : '') || '',
        status: (() => {
          const m = (r.raw && typeof r.raw === 'object') ? (r.raw.money || {}) : {}
          const balance = typeof m.balanceDue === 'number' ? m.balanceDue : (Number(r.money_balance) || 0)
          const total = Number(r.money_total) || 0
          const paidFull = m.isFullyPaid === true || (total > 0 && balance <= 0.01)
          const items = Array.isArray(m.invoiceItems) ? m.invoiceItems : []
          const NOTABLE = /park|pet|resort|early\s*check|late\s*check|crib|baby|amenit|pool\s*heat|extra\s*guest|luggage|transfer|airport/i
          const STD = /accommodation|cleaning|markup|revenue|host channel|management|commission|tourism|tax|booking fee|marketing|length of stay|verify|resolution/i
          const addOns = items
            .map((it: any) => ({ t: String(it.title || it.name || '').trim(), amt: Number(it.amount) || 0 }))
            .filter((x: any) => x.t && NOTABLE.test(x.t) && !STD.test(x.t))
          const parking = addOns.find((x: any) => /park/i.test(x.t)) || null
          return {
            paidFull,
            balance,
            currency: r.money_currency || 'USD',
            parking: parking ? parking.amt : null,
            addOns: addOns.filter((x: any) => !/park/i.test(x.t)).slice(0, 4),
            nights: Number(r.nights) || Number((r.raw || {}).nightsCount) || 0,
            checkOut: String(r.check_out || '').slice(0, 10),
          }
        })(),
        done: (() => { const w = welcomeOf(r.custom_fields); return !!w && (callDone(w.value) || !!w._by) })(),
        callValue: (() => { const w = welcomeOf(r.custom_fields); return (w && typeof w.value === 'string') ? w.value : '' })(),
        calledBy: (() => { const w: any = welcomeOf(r.custom_fields) || {}; if (w._by) return w._by; const v = typeof w.value === 'string' ? w.value : ''; const m = v.match(/[-:]\s*([A-Za-z][A-Za-z.\s]{0,18})\s*$/); return m ? m[1].trim() : '' })(),
        calledAt: ((welcomeOf(r.custom_fields) || {}) as any)._at || '',
        sensitive: truthy(fieldVal(r.custom_fields, 'sensitive')),
        due: check_in <= dueDate,                                  // within 48h of arrival
        dueToday: check_in <= today,                               // arriving today (call must happen today)
        prio: PRIORITY.some(k => lname.includes(k)) ? 0 : 1,       // priority buildings first
      }
    })

  // Backfill phones for displayed (confirmed) reservations whose embedded guest is just a stub.
  const missing = rows.map((row: any, i: number) => ({ row, i })).filter((x: any) => !x.row.phone && recs[x.i]?.raw?.guest?._id)
  if (missing.length) {
    const ids = Array.from(new Set(missing.map((x: any) => recs[x.i].raw.guest._id as string)))
    const pmap = await guestPhones(ids)
    for (const x of missing) {
      const gid = recs[x.i].raw.guest._id
      if (gid && pmap[gid]) x.row.phone = pmap[gid]
    }
  }

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
