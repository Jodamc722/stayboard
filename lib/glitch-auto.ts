// AUTO-GLITCHES — the board held 2 cards while ~15 real guest issues lived only in Breezeway,
// because nobody does double entry. So the mirror cron now creates a glitch card for every LIVE
// guest-reported Breezeway task ("Guest Reported / Glitch - ...") that doesn't have one yet.
//
// Rules that keep this safe:
//   - linked via breezeway_task_id, so dedupe is exact and Push is auto-blocked (it IS a task)
//   - cards land in 'ops' (the work is already dispatched), never 'pool'
//   - only tasks created in the last WINDOW_DAYS - history stays in the History tab, not the board
//   - closing stays HUMAN: a finished task doesn't close the card, because done-in-Breezeway is
//     not the same as guest-made-whole. The card shows the live task status chip as always.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

const GLITCH = /glitch|guest\s*reported/i
const DONE = /complete|finish|cancel|closed|delete|approv/i
const WINDOW_DAYS = 21

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

function catFor(name: string): string {
  const s = name.toLowerCase()
  if (/a\/?c|hvac|cool|heat|thermostat|temperature/.test(s)) return 'Maintenance - HVAC/Temperature'
  if (/water heater|hot water/.test(s)) return 'Maintenance - Water Heater'
  if (/plumb|leak|drain|toilet|faucet|shower|sink|pipe/.test(s)) return 'Maintenance - Plumbing'
  if (/electric|outlet|breaker|power|light/.test(s)) return 'Maintenance - Electrical'
  if (/fridge|oven|stove|dishwasher|washer|dryer|microwave|appliance/.test(s)) return 'Maintenance - Appliances'
  if (/clean|dirty|stain|hair|trash|linen|towel/.test(s)) return 'Cleanliness - Inadequate Cleaning'
  if (/pest|bug|roach|ant|mice|rodent/.test(s)) return 'Pests/Bed Bugs'
  if (/lock|door code|safe|security|alarm|smoke/.test(s)) return 'Safety/Security Concern'
  if (/park|garage|vehicle|valet/.test(s)) return 'Parking/Vehicle'
  return 'Other'
}

export async function autoCreateGlitches(): Promise<{ scanned: number; created: number; error?: string }> {
  const db = supabaseAdmin()
  try {
    const [tRes, gRes, lRes] = await Promise.all([
      db.from('breezeway_tasks_sync')
        .select('id,reference_property_id,name,status,finished_at,scheduled_date,c1:raw->>created_at,c2:raw->>date_created,c3:raw->>createdAt')
        .or('name.ilike.%glitch%,name.ilike.%guest reported%').limit(2000),
      db.from('glitches').select('breezeway_task_id').not('breezeway_task_id', 'is', null).limit(5000),
      db.from('guesty_listings').select('id,nickname,title,building,address_city'),
    ])
    const linked = new Set<string>(((gRes.data || []) as any[]).map(g => str(g.breezeway_task_id)).filter(Boolean))
    const lmap: Record<string, any> = {}
    for (const l of (lRes.data || []) as any[]) lmap[String(l.id)] = l
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
    const rows: any[] = []
    for (const t of (tRes.data || []) as any[]) {
      const name = str(t.name)
      if (!GLITCH.test(name)) continue
      if (DONE.test(str(t.status)) || t.finished_at) continue           // only LIVE issues become cards
      if (linked.has(String(t.id))) continue                            // already on the board (either direction)
      const created = (str(t.c1) || str(t.c2) || str(t.c3) || str(t.scheduled_date)).slice(0, 10)
      if (!created || created < cutoff) continue                        // don't resurrect ancient history
      const li = lmap[String(t.reference_property_id)]
      const unit = li ? (li.nickname || li.title || 'Unit') : null
      const issue = name.replace(/^\s*guest\s*reported\s*\/?\s*(glitch)?\s*[-:]?\s*/i, '').trim() || name
      rows.push({
        status: 'ops',
        glitch_type: 'Glitch (Quality Issue)',
        category: catFor(name),
        listing_id: li ? String(li.id) : null,
        unit,
        market: li ? marketOf(li.building, li.address_city, unit) : null,
        incident_date: created,
        overview: issue,
        recovery_cost: 0,
        refund_approved: 0,
        reported_by: 'Breezeway',
        created_by: 'breezeway-auto',
        breezeway_task_id: String(t.id),
        history: [{ at: new Date().toISOString(), by: 'breezeway-auto', action: 'created_from_breezeway_task' }],
      })
    }
    if (rows.length) {
      const ins = await db.from('glitches').insert(rows)
      if (ins.error) return { scanned: (tRes.data || []).length, created: 0, error: ins.error.message.slice(0, 160) }
    }
    return { scanned: (tRes.data || []).length, created: rows.length }
  } catch (e: any) {
    return { scanned: 0, created: 0, error: String((e && e.message) || e).slice(0, 160) }
  }
}
