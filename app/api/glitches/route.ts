// GLITCH MANAGEMENT — the glitch pool + board (Asana "VR Glitch/Incident Reporting" rebuilt in-app).
// GET            → all board glitches grouped by status
// GET ?guest=xyz → reservation search (name → reservation details to attach)
// POST           → create a glitch in the pool
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TONES = ['understanding', 'frustrated', 'angry', 'fishing']
const VIAS = ['message', 'call', 'in_person', 'at_checkout', 'review', 'other']
export const STATUSES = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident', 'closed'] as const
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number | null { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    // ?fields=stage -> just {breezeway_task_id, status} for badge maps. Today-in-Ops was pulling
    // EVERY glitch with photos[], history[] and AI text (a multi-MB payload) to render seven
    // one-word stage pills on task rows.
    if (str(req.nextUrl.searchParams.get('fields')) === 'stage') {
      const { data } = await db.from('glitches').select('id,status,breezeway_task_id').not('breezeway_task_id', 'is', null).limit(1000)
      return NextResponse.json({ ok: true, glitches: data || [] })
    }
    const guest = str(req.nextUrl.searchParams.get('guest')).trim()

    if (guest) {
      // Reservation search. DEFAULT = guests IN-HOUSE today (most glitches are live stays);
      // ?scope=all searches past/upcoming too. Inquiries / canceled / declined (never booked)
      // are ALWAYS excluded — only real stays attach to glitches.
      const scope = str(req.nextUrl.searchParams.get('scope')) === 'all' ? 'all' : 'active'
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
      const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city')
      const lmap: Record<string, { name: string; market: string }> = {}
      for (const l of (lRows || []) as any[]) { const name = l.nickname || l.title || 'Unit'; lmap[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name) } }
      let qy = db.from('guesty_reservations')
        .select('id,listing_id,guest_name,guest_phone,guest_email,notes,check_in,check_out,status,source,confirmation_code,total:raw->money->>hostPayout,fare:raw->money->>fareAccommodationAdjusted,cleaning:raw->money->>fareCleaning')
        .ilike('guest_name', '%' + guest + '%')
        .in('status', ['confirmed', 'closed'])
      if (scope === 'active') qy = qy.lte('check_in', today).gte('check_out', today)
      const { data: rows, error } = await qy
        .order('check_in', { ascending: false })
        .limit(12)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      // Message sentiment for these reservations. 2026-08-20 FIX: this read `guest_sentiment`,
      // which does not exist — the scan (/api/sentiment/scan) writes `guesty_conversation_sentiment`.
      // Because the whole block is a best-effort try/catch it failed SILENTLY on every search, so
      // the sentiment chip on the new-glitch reservation picker was always blank.
      const smap: Record<string, any> = {}
      try {
        const rids = ((rows || []) as any[]).map(r => String(r.id))
        if (rids.length) {
          const { data: sr } = await db.from('guesty_conversation_sentiment').select('reservation_id,score,band,dissatisfied,top_issue,guest_excerpt').in('reservation_id', rids)
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
      return NextResponse.json({ ok: true, scope, today, matches })
    }

    const { data: rows, error } = await db.from('glitches').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // live Breezeway status per pushed glitch, from the task mirror (webhooks keep it fresh) —
    // so the team sees Completed / In progress at a glance and can manage guest expectations.
    const taskIds = ((rows || []) as any[]).map(g => str(g.breezeway_task_id)).filter(Boolean)
    const tmap: Record<string, string> = {}
    if (taskIds.length) {
      const { data: ts } = await db.from('breezeway_tasks_sync').select('id,status,finished_at,report_url').in('id', taskIds)
      for (const t of (ts || []) as any[]) {
        const st = str(t.status)
        tmap[String(t.id)] = (/complete|finish|close|approv/i.test(st) || t.finished_at) ? 'completed' : /progress|started/i.test(st) ? 'in_progress' : 'created'
        ;(tmap as any)[String(t.id) + ':report'] = t.report_url || null
      }
    }
    for (const g of (rows || []) as any[]) {
      ;(g as any).task_status = g.breezeway_task_id ? (tmap[str(g.breezeway_task_id)] || null) : null
      ;(g as any).task_report_url = g.breezeway_task_id ? ((tmap as any)[str(g.breezeway_task_id) + ':report'] || null) : null
    }
    const counts: Record<string, number> = {}
    for (const s of STATUSES) counts[s] = 0
    for (const g of (rows || []) as any[]) counts[str(g.status)] = (counts[str(g.status)] || 0) + 1
    return NextResponse.json({ ok: true, glitches: rows || [], counts })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'glitches' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('glitches', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const overview = str(b.overview).trim()
    if (!overview) return NextResponse.json({ ok: false, error: 'Describe the glitch (overview).' }, { status: 400 })
    if (!str(b.category).trim()) return NextResponse.json({ ok: false, error: 'Category is required.' }, { status: 400 })
    if (!str(b.incidentDate).trim()) return NextResponse.json({ ok: false, error: 'Incident date is required.' }, { status: 400 })
    // LINK THE UNIT AT THE SOURCE (2026-09-02). A glitch saved with a typed unit but no picked
    // listing is what broke Breezeway pushes — the fix downstream can match the name at push
    // time, but the RIGHT place to earn the link is the moment of filing, so the calendar, the
    // intel and every later feature see the unit from the first second. Exact-token match, one
    // hit only; anything ambiguous stays unlinked rather than guessing.
    let listingId = str(b.listingId) || null
    const typedUnit = str(b.unit).trim()
    if (!listingId && typedUnit) {
      try {
        const { data: ls } = await supabaseAdmin().from('guesty_listings').select('id, nickname, title, status').limit(2000)
        const toks = typedUnit.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
        const hits = ((ls || []) as any[]).filter(l => {
          if (String(l.status || '').trim().toLowerCase() !== 'active') return false
          const ltoks = String(l.nickname || l.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
          return toks.every(t => ltoks.indexOf(t) >= 0)
        })
        if (hits.length === 1) listingId = String(hits[0].id)
      } catch { /* stays unlinked; push-time matching still covers it */ }
    }
    const row: Record<string, any> = {
      status: 'pool',
      glitch_type: str(b.glitchType) || 'Glitch (Quality Issue)',
      category: str(b.category) || null,
      listing_id: listingId,
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
      refund_approved: num(b.refundApproved) || 0,
      // Every issue on the report. `category` stays the primary and still routes the Breezeway task.
      categories: Array.isArray(b.categories) && b.categories.length
        ? b.categories.map((c: any) => String(c).slice(0, 80)).slice(0, 8)
        : (str(b.category) ? [str(b.category)] : []),
      guest_tone: TONES.includes(String(b.guestTone || '').toLowerCase()) ? String(b.guestTone).toLowerCase() : null,
      reported_via: VIAS.includes(String(b.reportedVia || '').toLowerCase()) ? String(b.reportedVia).toLowerCase() : null,
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
      // Columns not migrated yet — save the core record rather than losing the report. A glitch
      // half-recorded beats a guest issue that vanished because a column was missing.
      delete row.reservation_notes; delete row.sentiment
      delete row.guest_tone; delete row.reported_via; delete row.categories
      ins = await db.from('glitches').insert(row).select('id').single()
    }
    const { data, error } = ins
    if (error || !data) return NextResponse.json({ ok: false, error: (error && error.message) || 'Insert failed' }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
