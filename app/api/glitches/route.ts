// GLITCH MANAGEMENT — the glitch pool + board (Asana "VR Glitch/Incident Reporting" rebuilt in-app).
// GET            → all board glitches grouped by status
// GET ?guest=xyz → reservation search (name → reservation details to attach)
// POST           → create a glitch in the pool
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const STATUSES = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident', 'closed'] as const
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number | null { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const guest = str(req.nextUrl.searchParams.get('guest')).trim()

    if (guest) {
      // reservation search: latest stays matching the guest name
      const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city')
      const lmap: Record<string, { name: string; market: string }> = {}
      for (const l of (lRows || []) as any[]) { const name = l.nickname || l.title || 'Unit'; lmap[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name) } }
      const { data: rows, error } = await db.from('guesty_reservations')
        .select('id,listing_id,guest_name,guest_phone,guest_email,notes,check_in,check_out,status,source,confirmation_code,total:raw->money->>hostPayout,fare:raw->money->>fareAccommodationAdjusted,cleaning:raw->money->>fareCleaning')
        .ilike('guest_name', '%' + guest + '%')
        .order('check_in', { ascending: false })
        .limit(12)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      // message sentiment for these reservations (guest_sentiment scan results) — best effort
      const smap: Record<string, any> = {}
      try {
        const rids = ((rows || []) as any[]).map(r => String(r.id))
        if (rids.length) {
          const { data: sr } = await db.from('guest_sentiment').select('reservation_id,score,band,dissatisfied,top_issue,guest_excerpt').in('reservation_id', rids)
          for (const x of (sr || []) as any[]) if (x.reservation_id) smap[String(x.reservation_id)] = { score: x.score, band: x.band, dissatisfied: !!x.dissatisfied, topIssue: x.top_issue || null, excerpt: x.guest_excerpt || null }
        }
      } catch { /* sentiment table optional */ }
      const matches = ((rows || []) as any[]).filter(r => !/cancel|inquiry/i.test(str(r.status))).map(r => {
        const li = lmap[String(r.listing_id)]
        const total = num(r.total) ?? (((num(r.fare) || 0) + (num(r.cleaning) || 0)) || null)
        return {
          reservationId: String(r.id), listingId: String(r.listing_id),
          unit: li ? li.name : 'Unknown unit', market: li ? li.market : 'Other',
          guestName: r.guest_name || '', guestPhone: r.guest_phone || null, guestEmail: r.guest_email || null,
          checkIn: r.check_in, checkOut: r.check_out, channel: r.source || null,
          confirmationCode: r.confirmation_code || null, total,
          notes: (str(r.notes).trim() || null), sentiment: smap[String(r.id)] || null,
          guestyUrl: 'https://app.guesty.com/reservations/' + String(r.id) + '/summary',
        }
      })
      return NextResponse.json({ ok: true, matches })
    }

    const { data: rows, error } = await db.from('glitches').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // live Breezeway status per pushed glitch, from the task mirror (webhooks keep it fresh) —
    // so the team sees Completed / In progress at a glance and can manage guest expectations.
    const taskIds = ((rows || []) as any[]).map(g => str(g.breezeway_task_id)).filter(Boolean)
    const tmap: Record<string, string> = {}
    if (taskIds.length) {
      const { data: ts } = await db.from('breezeway_tasks_sync').select('id,status,finished_at').in('id', taskIds)
      for (const t of (ts || []) as any[]) {
        const st = str(t.status)
        tmap[String(t.id)] = (/complete|finish|close|approv/i.test(st) || t.finished_at) ? 'completed' : /progress|started/i.test(st) ? 'in_progress' : 'created'
      }
    }
    for (const g of (rows || []) as any[]) (g as any).task_status = g.breezeway_task_id ? (tmap[str(g.breezeway_task_id)] || null) : null
    const counts: Record<string, number> = {}
    for (const s of STATUSES) counts[s] = 0
    for (const g of (rows || []) as any[]) counts[str(g.status)] = (counts[str(g.status)] || 0) + 1
    return NextResponse.json({ ok: true, glitches: rows || [], counts })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const overview = str(b.overview).trim()
    if (!overview) return NextResponse.json({ ok: false, error: 'Describe the glitch (overview).' }, { status: 400 })
    if (!str(b.category).trim()) return NextResponse.json({ ok: false, error: 'Category is required.' }, { status: 400 })
    if (!str(b.incidentDate).trim()) return NextResponse.json({ ok: false, error: 'Incident date is required.' }, { status: 400 })
    const row: Record<string, any> = {
      status: 'pool',
      glitch_type: str(b.glitchType) || 'Glitch (Quality Issue)',
      category: str(b.category) || null,
      listing_id: str(b.listingId) || null,
      unit: str(b.unit) || null,
      market: str(b.market) || null,
      reservation_id: str(b.reservationId) || null,
      guest_name: str(b.guestName) || null,
      guest_phone: str(b.guestPhone) || null,
      channel: str(b.channel) || null,
      check_in: str(b.checkIn) || null,
      check_out: str(b.checkOut) || null,
      reservation_total: num(b.reservationTotal),
      incident_date: str(b.incidentDate) || null,
      overview,
      recovery_cost: num(b.recoveryCost) || 0,
      refund_approved: num(b.refundApproved) || 0,
      reported_by: str(b.reportedBy) || null,
      guest_email: str(b.guestEmail) || null,
      reservation_notes: str(b.reservationNotes) || null,
      sentiment: (b.sentiment && typeof b.sentiment === 'object') ? b.sentiment : null,
      photos: Array.isArray(b.photos) ? b.photos.filter((x: any) => typeof x === 'string').slice(0, 20) : [],
      created_by: user.email || 'team',
      history: [{ at: new Date().toISOString(), by: user.email || 'team', action: 'created' }],
    }
    const db = supabaseAdmin()
    let ins = await db.from('glitches').insert(row).select('id').single()
    if (ins.error && /column|schema/i.test(ins.error.message)) {
      // snapshot columns not migrated yet — save the core record rather than failing
      delete row.reservation_notes; delete row.sentiment
      ins = await db.from('glitches').insert(row).select('id').single()
    }
    const { data, error } = ins
    if (error || !data) return NextResponse.json({ ok: false, error: (error && error.message) || 'Insert failed' }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
