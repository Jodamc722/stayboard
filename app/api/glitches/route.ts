// GLITCH MANAGEMENT — the glitch pool + board (Asana "VR Glitch/Incident Reporting" rebuilt in-app).
// GET            → all board glitches grouped by status
// GET ?guest=xyz → reservation search (name → reservation details to attach)
// POST           → create a glitch in the pool
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { requireLevel } from '@/lib/access'
import { requireVrUser } from '@/lib/vr-gate'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TONES = ['understanding', 'frustrated', 'angry', 'fishing']
const VIAS = ['message', 'call', 'in_person', 'at_checkout', 'review', 'other']
export const STATUSES = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident', 'closed'] as const
// What a board card, the lanes, the filters and the header pills read — nothing else.
const CARD_COLS = 'id,status,glitch_type,category,listing_id,unit,market,reservation_id,guest_name,guest_phone,guest_email,check_in,check_out,incident_date,overview,refund_approved,refund_needs_approval,reported_by,assignee,breezeway_task_id,due_date,priority,vendor_key,vendor_name,closed_at,closed_at_estimated,created_at'
const CARD_KEYS = CARD_COLS.split(',')
// The board's Closed lane (components/GlitchBoard LANES) and how far back it shows by default.
const CLOSED_STATUSES = ['closed', 'done', 'resolved']
const CLOSED_DAYS = 14
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number | null { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }

export async function GET(req: NextRequest) {
  // Signed in AND an active Lighthouse member (a session alone let any login in, 2026-09-29).
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const db = supabaseAdmin()
    // ?fields=stage -> just {breezeway_task_id, status} for badge maps. Today-in-Ops was pulling
    // EVERY glitch with photos[], history[] and AI text (a multi-MB payload) to render seven
    // one-word stage pills on task rows.
    if (str(req.nextUrl.searchParams.get('fields')) === 'stage') {
      // A badge MAP is a lookup: every glitch that has a task, paged in id order (not the first 1,000).
      const { rows, truncated } = await pageRows((a, b) => db.from('glitches').select('id,status,breezeway_task_id').not('breezeway_task_id', 'is', null).order('id').range(a, b))
      if (truncated) console.error('[glitches] stage map read incomplete')
      return NextResponse.json({ ok: true, glitches: rows, ...(truncated ? { partial: true } : {}) })
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

    // ?report=1&from=YYYY-MM-DD&to=YYYY-MM-DD — THE REPORT (Jon, 2026-10-23: "have a report too,
    // where we can pull, show trends, recurring issues … search by name, date, reservation"). Every
    // glitch reported in the window, not the board's newest 500, with the heavy columns (photos,
    // history, AI text) left behind. Dates are Eastern days on created_at.
    if (str(req.nextUrl.searchParams.get('report')) === '1') {
      const ymd = (v: any) => { const x = str(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '' }
      const from = ymd(req.nextUrl.searchParams.get('from')) || new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
      const to = ymd(req.nextUrl.searchParams.get('to')) || new Date().toISOString().slice(0, 10)
      // Eastern midnight is 04:00 or 05:00 UTC; take the wider edge and trim exactly below.
      const lo = from + 'T03:00:00Z'
      const hiD = new Date(to + 'T12:00:00Z'); hiD.setUTCDate(hiD.getUTCDate() + 1)
      const hi = hiD.toISOString().slice(0, 10) + 'T06:00:00Z'
      const cols = 'id,status,glitch_type,category,listing_id,unit,market,reservation_id,guest_name,guest_phone,guest_email,channel,check_in,check_out,reservation_total,incident_date,overview,refund_approved,reported_by,assignee,breezeway_task_id,priority,reported_via,closed_at,created_at'
      const etDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))
      const read = (c: string) => pageRows<any>((a, b) => db.from('glitches').select(c).gte('created_at', lo).lt('created_at', hi).order('created_at', { ascending: false }).range(a, b), 10)
      let { rows: got, truncated } = await read(cols)
      // A column this database does not have yet (an unrun migration) fails the narrow read; the
      // wide one always works.
      if (truncated && !got.length) ({ rows: got, truncated } = await read('*'))
      const list = got.filter(g => { const d = etDay(str(g.created_at)); return d >= from && d <= to })
      let building: Record<string, string> = {}
      const lids = Array.from(new Set(list.map(g => str(g.listing_id)).filter(Boolean)))
      if (lids.length) {
        const { data: ls } = await db.from('guesty_listings').select('id,building').in('id', lids.slice(0, 1000))
        for (const l of (ls || []) as any[]) if (l.building) building[str(l.id)] = str(l.building)
      }
      for (const g of list) (g as any).building = building[str(g.listing_id)] || null
      return NextResponse.json({ ok: true, from, to, glitches: list, ...(truncated ? { partial: true } : {}) })
    }

    // live Breezeway status per pushed glitch, from the task mirror (webhooks keep it fresh) —
    // so the team sees Completed / In progress at a glance and can manage guest expectations.
    const withTasks = async (list: any[]) => {
      const taskIds = list.map(g => str(g.breezeway_task_id)).filter(Boolean)
      const tmap: Record<string, string> = {}
      const rmap: Record<string, string | null> = {}
      if (taskIds.length) {
        const { data: ts } = await db.from('breezeway_tasks_sync').select('id,status,finished_at,report_url').in('id', taskIds)
        for (const t of (ts || []) as any[]) {
          const st = str(t.status)
          tmap[String(t.id)] = (/complete|finish|close|approv/i.test(st) || t.finished_at) ? 'completed' : /progress|started/i.test(st) ? 'in_progress' : 'created'
          rmap[String(t.id)] = t.report_url || null
        }
      }
      for (const g of list) {
        g.task_status = g.breezeway_task_id ? (tmap[str(g.breezeway_task_id)] || null) : null
        g.task_report_url = g.breezeway_task_id ? (rmap[str(g.breezeway_task_id)] || null) : null
      }
    }

    // ?id=<glitch> — ONE WHOLE CARD (2026-11-09). The board list no longer carries each card's
    // photos, history, work notes and refund reasoning; the detail sheet asks for its own here.
    const oneId = str(req.nextUrl.searchParams.get('id')).trim()
    if (oneId) {
      const { data: one, error: oneErr } = await db.from('glitches').select('*').eq('id', oneId).maybeSingle()
      if (oneErr) return NextResponse.json({ ok: false, error: oneErr.message }, { status: 500 })
      if (!one) return NextResponse.json({ ok: false, error: 'No such glitch.' }, { status: 404 })
      await withTasks([one as any])
      return NextResponse.json({ ok: true, glitch: one })
    }

    // THE BOARD LIST (2026-11-09: 929 KB). Three shapes of the same newest-500 read:
    //   (default)  the board: card columns only; every card still in play, plus the ones closed in
    //              the last CLOSED_DAYS days. `summary` and `counts` are worked out over all 500, so
    //              the header pills say what they always said.
    //   ?slim=1    all 500, card columns only — search, "show older closed", Trends.
    //   ?full=1    all 500 whole rows, exactly as this route answered before.
    const full = str(req.nextUrl.searchParams.get('full')) === '1'
    const wantAll = full || str(req.nextUrl.searchParams.get('slim')) === '1'
    const base = (cols: string) => db.from('glitches').select(cols).order('created_at', { ascending: false }).limit(500)
    let { data: rows, error } = await base(full ? '*' : CARD_COLS)
    // A card column this database does not have yet (an unrun migration): read whole rows, as
    // before, and cut them down here.
    let cut = false
    if (error && !full) { ({ data: rows, error } = await base('*')); cut = true }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    let list = ((rows || []) as unknown) as any[]
    if (cut) list = list.map(g => { const o: any = {}; for (const k of CARD_KEYS) if (k in g) o[k] = g[k]; return o })
    const counts: Record<string, number> = {}
    for (const s of STATUSES) counts[s] = 0
    for (const g of list) counts[str(g.status)] = (counts[str(g.status)] || 0) + 1
    // What the page header reads (in play, refunded, top categories) — over all 500.
    const byCat: Record<string, number> = {}
    let refunds = 0, inPlay = 0
    for (const g of list) {
      if (g.status !== 'closed') inPlay++
      refunds += Number(g.refund_approved) || 0
      if (g.category) byCat[g.category] = (byCat[g.category] || 0) + 1
    }
    const summary = {
      total: list.length, inPlay, refunds,
      topCats: Object.keys(byCat).map(k => ({ k, n: byCat[k] })).sort((a, b) => b.n - a.n).slice(0, 3),
    }
    // The older closed cards left off the board still count in its pills (time to close, refunded,
    // need approval) — six short values each: market, created, closed, estimated?, refund, needs approval?
    let closedOlder = 0
    let olderLite: any[][] = []
    if (!wantAll) {
      const since = Date.now() - CLOSED_DAYS * 86400_000
      const recent = (g: any) => { const t = Date.parse(str(g.closed_at || g.created_at)); return !Number.isFinite(t) || t >= since }
      const keep: any[] = []
      for (const g of list) {
        if (!CLOSED_STATUSES.includes(str(g.status)) || recent(g)) keep.push(g)
        else olderLite.push([g.market || '', g.created_at || null, g.closed_at || null, g.closed_at_estimated ? 1 : 0, Number(g.refund_approved) || 0, g.refund_needs_approval ? 1 : 0])
      }
      closedOlder = olderLite.length
      list = keep
    }
    await withTasks(list)
    // Card rows travel without their empty fields (a third of the bytes were `"key":null`).
    if (!full) list = list.map(g => { const o: any = {}; for (const k of Object.keys(g)) if (g[k] !== null && g[k] !== undefined) o[k] = g[k]; return o })
    return NextResponse.json({ ok: true, glitches: list, counts, summary, all: wantAll, closedOlder, olderLite })
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
        const { data: ls } = await supabaseAdmin().from('guesty_listings').select('id, nickname, title, status').limit(1000) // deliberate cap: one row per Guesty listing (~290, inactive included)
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
      // EVERY NEW GLITCH STARTS WITH SUPPORT (Jon, 2026-09-22: "it should default to Support").
      // Support owns it until someone hands it on; an unowned card is how issues sit for days.
      assignee: str(b.assignee) || 'Support',
      // THE TEAM PICKS THE URGENCY (Jon, 2026-11-05: "when a glitch is created it marks high priority
      // automatically — allow team to select urgency"). The column defaulted every new card to
      // urgent (migration 086); now the form sends it, and a card filed without one is Normal.
      priority: ['urgent', 'high', 'normal', 'low'].includes(str(b.priority)) ? str(b.priority) : 'normal',
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
    // GUEST SENSITIVE IN GUESTY (Jon, 2026-11-05: "please make guest sensitive in our Guesty
    // reservation"). A guest with a glitch is a sensitive guest: tick the reservation's Sensitive box
    // and add a dated line to its notes — the safe read-merge-write in lib/guest-mood, never a bare
    // PUT. A Guesty hiccup never loses the glitch; the card just says it did not reach Guesty.
    let guestySensitive: boolean | null = null
    if (row.reservation_id) {
      try {
        const { markReservationSensitive } = await import('@/lib/sensitive')
        const why = 'Glitch filed: ' + [str(row.category), overview].filter(Boolean).join(' — ').replace(/\s+/g, ' ').slice(0, 160)
        const m = await markReservationSensitive(String(row.reservation_id), why)
        guestySensitive = m.ok
        try { await db.from('glitches').update({ history: [...row.history, { at: new Date().toISOString(), by: 'lighthouse', action: m.ok ? 'guesty_sensitive' : 'guesty_sensitive_failed', detail: m.ok ? 'Reservation marked Sensitive in Guesty' : String(m.error || 'failed').slice(0, 120) }] }).eq('id', data.id) } catch { /* history is a convenience */ }
      } catch { guestySensitive = false }
    }
    return NextResponse.json({ ok: true, id: data.id, guestySensitive })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
