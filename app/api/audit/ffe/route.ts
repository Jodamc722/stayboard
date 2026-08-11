// FF&E AUDIT — the share-link API (Jon, 2026-08-10).
//
// FF&E IS A PURCHASING LIST, NOT WORK ORDERS (Jon: "make this FFE order not Maintenance or
// anything else"). The first cut reused property_audits + audit_items to avoid a migration — that
// was wrong, because audit_items is exactly what the Audit Desk dispatches into Breezeway as
// maintenance tasks. "Replace the nightstands" would have become maintenance tickets and polluted
// the maintenance cost and billing numbers. So this owns two tables of its own (migration 032) and
// touches nothing in the task pipeline.
//   ffe_audits   one row per listing, carrying the stable share_code — the link IS the key
//   ffe_answers  one row per answered item
//
//   GET  ?code=<share>              public: the unit, the checklist scope and the saved answers
//   POST { code, room, itemKey, ... } public: save one answer (upsert on room+item)
//   POST { action:'link', listingId } signed in: get/create the link for a unit
//   GET  ?building=17WEST            signed in: every unit's link + progress, for the index page
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { roomsFor, totalItems } from '@/lib/ffe-checklist'
import { buildingOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'

const str = (v: any) => (v == null ? '' : String(v))
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

function newCode(): string {
  const c: any = (globalThis as any).crypto
  const uuid = c && c.randomUUID ? c.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
  return String(uuid).replace(/-/g, '').slice(0, 14)
}
async function getUser() {
  try { const s = createClient(); const { data } = await s.auth.getUser(); return data.user || null } catch { return null }
}
const bedroomsOf = (l: any): number | null => {
  const b = l ? l.bedrooms : null
  if (typeof b === 'number') return b
  const n = parseFloat(str(b)); return Number.isFinite(n) ? n : null
}

/** The one FF&E audit row for a listing — created on first ask so the link never changes after. */
async function ffeAuditFor(db: any, listingId: string, email: string | null) {
  const { data } = await db.from('ffe_audits').select('*').eq('listing_id', listingId).limit(1)
  if (data && data[0]) return data[0]
  const ins = await db.from('ffe_audits')
    .insert({ listing_id: listingId, share_code: newCode(), status: 'open', created_by: email })
    .select('*').limit(1)
  if (ins.error) throw new Error(ins.error.message)
  return ins.data && ins.data[0]
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  const code = str(sp.get('code')).trim()
  const building = str(sp.get('building')).trim()

  try {
    // ---- index for the internal page: every unit in a building, with its link and progress ----
    if (building) {
      const user = await getUser()
      if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      const { data: ls } = await db.from('guesty_listings')
        .select('id,nickname,title,building,status,bedrooms:raw->>bedrooms').limit(2000)
      const units = ((ls || []) as any[])
        .filter(l => !DEAD.includes(str(l.status).toLowerCase()))
        .filter(l => (buildingOf(str(l.building), str(l.nickname || l.title)) || '').toLowerCase() === building.toLowerCase())
        .map(l => ({ id: String(l.id), name: l.nickname || l.title || String(l.id), bedrooms: bedroomsOf(l) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      if (!units.length) return NextResponse.json({ ok: true, building, units: [] })

      const ids = units.map(u => u.id)
      const { data: audits } = await db.from('ffe_audits')
        .select('id,listing_id,share_code').in('listing_id', ids).limit(500)
      const byListing: Record<string, any> = {}
      for (const a of ((audits || []) as any[])) byListing[String(a.listing_id)] = a
      const auditIds = ((audits || []) as any[]).map(a => a.id)
      const counts: Record<string, { answered: number; replace: number }> = {}
      if (auditIds.length) {
        const { data: items } = await db.from('ffe_answers')
          .select('audit_id,answer').in('audit_id', auditIds).limit(5000)
        for (const it of ((items || []) as any[])) {
          const e = counts[String(it.audit_id)] = counts[String(it.audit_id)] || { answered: 0, replace: 0 }
          e.answered += 1
          if (['replace', 'add'].includes(String(it.answer))) e.replace += 1
        }
      }
      return NextResponse.json({
        ok: true, building,
        units: units.map(u => {
          const a = byListing[u.id]
          const c = a ? counts[String(a.id)] : null
          return {
            ...u,
            code: a ? a.share_code : null,
            total: totalItems(u.bedrooms),
            answered: c ? c.answered : 0,
            replace: c ? c.replace : 0,
          }
        }),
      })
    }

    // ---- the public form ----
    if (!code || code.length < 6) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const { data: ar } = await db.from('ffe_audits').select('*').eq('share_code', code).limit(1)
    const audit = ar && ar[0]
    if (!audit) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const { data: lr } = await db.from('guesty_listings')
      .select('id,nickname,title,building,bedrooms:raw->>bedrooms').eq('id', audit.listing_id).limit(1)
    const l = lr && lr[0]
    const bedrooms = bedroomsOf(l)
    const { data: items } = await db.from('ffe_answers')
      .select('room,item_key,answer,qty,note').eq('audit_id', audit.id).limit(1000)
    const answers: Record<string, { answer: string; qty: number | null; note: string | null }> = {}
    for (const it of ((items || []) as any[])) {
      answers[str(it.room) + '::' + str(it.item_key)] = {
        answer: str(it.answer), qty: it.qty ?? null, note: it.note ?? null,
      }
    }
    return NextResponse.json({
      ok: true,
      unit: { name: l ? (l.nickname || l.title || 'Unit') : 'Unit', building: l ? str(l.building) : '', bedrooms },
      rooms: roomsFor(bedrooms).map(r => r.key),
      total: totalItems(bedrooms),
      answers,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))

  try {
    // ---- signed-in: mint or fetch a unit's link ----
    if (String(body.action || '') === 'link') {
      const user = await getUser()
      if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      const listingId = str(body.listingId)
      if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
      const audit = await ffeAuditFor(db, listingId, user.email || null)
      return NextResponse.json({ ok: true, code: audit.share_code, url: req.nextUrl.origin + '/audit/ffe/' + audit.share_code })
    }

    // ---- public: save one answer ----
    const code = str(body.code).trim()
    if (!code || code.length < 6) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const { data: ar } = await db.from('ffe_audits').select('id,listing_id').eq('share_code', code).limit(1)
    const audit = ar && ar[0]
    if (!audit) return NextResponse.json({ error: 'link not found' }, { status: 404 })

    const room = str(body.room).slice(0, 40)
    const itemKey = str(body.itemKey).slice(0, 40)
    if (!room || !itemKey) return NextResponse.json({ error: 'room and itemKey required' }, { status: 400 })
    const answer = str(body.answer)
    if (!['replace', 'add', 'keep', 'na'].includes(answer)) return NextResponse.json({ error: 'bad answer' }, { status: 400 })
    const qtyN = Number(body.qty)
    const qty = Number.isFinite(qtyN) && qtyN > 0 ? Math.min(Math.round(qtyN), 99) : 1
    const note = str(body.note).slice(0, 500) || null
    const title = str(body.title).slice(0, 120) || itemKey

    const row = {
      audit_id: audit.id, listing_id: audit.listing_id,
      room, item_key: itemKey, title, answer, qty, note,
      updated_at: new Date().toISOString(),
    }
    const { data: ex } = await db.from('ffe_answers')
      .select('id').eq('audit_id', audit.id).eq('room', room).eq('item_key', itemKey).limit(1)
    if (ex && ex[0]) {
      const up = await db.from('ffe_answers').update(row).eq('id', ex[0].id)
      if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    } else {
      const ins = await db.from('ffe_answers').insert(row)
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
