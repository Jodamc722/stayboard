// FF&E CATALOG API — the products an order can be built from (Jon, 2026-08-12).
//
// GET   ?q=&category=&all=1   list products (active only unless all=1)
// POST  {action:'save'}       add or edit one product; the code is derived if not supplied
// POST  {action:'bulk'}       add many from a pasted block (vendor quote / spreadsheet)
// POST  {action:'retire'}     set active=false. NOT a delete — the code may be on a live quote.
//
// Signed-in and edit-gated. The catalog decides what everyone in the company can order, so it is
// not a share-link capability like the walk form.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { FFE_CATEGORIES, nextCode, normalizeCode, parseProductPaste } from '@/lib/ffe-catalog'
import { FFE_ROOMS } from '@/lib/ffe-checklist'

export const dynamic = 'force-dynamic'

const str = (v: any) => (v == null ? '' : String(v))
const ROOM_KEYS = new Set(FFE_ROOMS.map(r => r.key))
const CAT_KEYS = new Set(FFE_CATEGORIES.map(c => c.key))

const isMissingTable = (msg: any) => /schema cache|does not exist/i.test(String(msg || ''))
const SETUP = 'The furniture catalog is not set up yet — migration 034 has not been run on the database.'
const fail = (msg: any, status = 500) =>
  isMissingTable(msg)
    ? NextResponse.json({ ok: false, setupRequired: true, error: SETUP }, { status: 503 })
    : NextResponse.json({ ok: false, error: String(msg) }, { status })

/** Money in, cents-safe out. Anything unparseable becomes null rather than 0 — a missing price and
 *  a free item are different facts and a quote must not confuse them. */
function priceOf(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
const clean = (v: any, max: number) => {
  const s = str(v).trim()
  return s ? s.slice(0, max) : null
}
const urlOf = (v: any) => {
  const s = str(v).trim()
  return /^https?:\/\//i.test(s) ? s.slice(0, 500) : null
}

export async function GET(req: NextRequest) {
  const s = createClient()
  const { data: u } = await s.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    let q = db.from('ffe_catalog')
      .select('id,code,name_en,name_es,category,room_hint,item_keys,vendor,vendor_sku,unit_cost,url,image_url,dimensions,finish,lead_time_days,notes,active,updated_at')
      .order('code', { ascending: true })
      .limit(2000)
    if (!sp.get('all')) q = q.eq('active', true)
    if (sp.get('category')) q = q.eq('category', str(sp.get('category')))
    const { data, error } = await q
    if (error) return fail(error.message)

    const term = str(sp.get('q')).trim().toLowerCase()
    const rows = ((data || []) as any[]).filter(r => !term ||
      [r.code, r.name_en, r.name_es, r.vendor, r.vendor_sku].some(x => str(x).toLowerCase().includes(term)))

    return NextResponse.json({
      ok: true,
      products: rows,
      categories: FFE_CATEGORIES,
      rooms: FFE_ROOMS.map(r => ({ key: r.key, en: r.en, es: r.es })),
    })
  } catch (e: any) { return fail(e?.message || e) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('ffe', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = str(body.action) || 'save'
  const who = gate.access.email || null
  const now = new Date().toISOString()

  try {
    // Every existing code, once — both the uniqueness check and the next-number are derived from it.
    const { data: existing, error: exErr } = await db.from('ffe_catalog').select('id,code').limit(5000)
    if (exErr) return fail(exErr.message)
    const taken = ((existing || []) as any[]).map(r => str(r.code))
    const byCode: Record<string, string> = {}
    for (const r of ((existing || []) as any[])) byCode[str(r.code).toUpperCase()] = str(r.id)

    // ---- retire (never delete: the code may sit on an approved quote) ----
    if (action === 'retire' || action === 'restore') {
      const id = str(body.id)
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const r = await db.from('ffe_catalog')
        .update({ active: action === 'restore', updated_at: now }).eq('id', id)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    // ---- bulk add from a pasted block ----
    if (action === 'bulk') {
      const category = CAT_KEYS.has(str(body.category)) ? str(body.category) : 'misc'
      const roomHint = ROOM_KEYS.has(str(body.roomHint)) ? str(body.roomHint) : null
      const parsed = parseProductPaste(str(body.text))
      const rows: any[] = []
      const skipped: { raw: string; why: string }[] = []
      const running = taken.slice()
      for (const p of parsed) {
        if (!p.name) { skipped.push({ raw: p.raw, why: p.problem || 'no product name' }); continue }
        const code = nextCode(category, running)
        running.push(code)
        rows.push({
          code, name_en: p.name, name_es: null, category, room_hint: roomHint,
          item_keys: Array.isArray(body.itemKeys) ? body.itemKeys.map(String).slice(0, 20) : [],
          vendor: p.vendor || null, vendor_sku: p.sku || null,
          unit_cost: p.unitCost == null ? null : p.unitCost,
          url: p.url || null, active: true, created_by: who, updated_at: now,
        })
      }
      if (!rows.length) return NextResponse.json({ ok: true, added: 0, skipped })
      const r = await db.from('ffe_catalog').insert(rows).select('id,code,name_en')
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, added: (r.data || []).length, products: r.data, skipped })
    }

    // ---- add or edit one ----
    if (action === 'save') {
      const id = str(body.id)
      const nameEn = str(body.nameEn).trim().slice(0, 120)
      if (!nameEn) return NextResponse.json({ error: 'a product name is required' }, { status: 400 })
      const category = CAT_KEYS.has(str(body.category)) ? str(body.category) : 'misc'

      let code = normalizeCode(str(body.code))
      if (!code) code = nextCode(category, taken)
      // A code already in use by a DIFFERENT product is the one thing worth refusing outright —
      // two products sharing a code is how a delivery ends up in the wrong unit.
      const clash = byCode[code.toUpperCase()]
      if (clash && clash !== id) {
        return NextResponse.json({ error: `Code ${code} is already used by another product.` }, { status: 409 })
      }

      const itemKeys = Array.isArray(body.itemKeys)
        ? Array.from(new Set(body.itemKeys.map((k: any) => str(k).slice(0, 40)).filter(Boolean))).slice(0, 30)
        : []
      const row: any = {
        code,
        name_en: nameEn,
        name_es: clean(body.nameEs, 120),
        category,
        room_hint: ROOM_KEYS.has(str(body.roomHint)) ? str(body.roomHint) : null,
        item_keys: itemKeys,
        vendor: clean(body.vendor, 80),
        vendor_sku: clean(body.vendorSku, 64),
        unit_cost: priceOf(body.unitCost),
        url: urlOf(body.url),
        image_url: urlOf(body.imageUrl),
        dimensions: clean(body.dimensions, 80),
        finish: clean(body.finish, 60),
        lead_time_days: Number.isFinite(Number(body.leadTimeDays)) && Number(body.leadTimeDays) > 0
          ? Math.min(365, Math.round(Number(body.leadTimeDays))) : null,
        notes: clean(body.notes, 500),
        active: body.active === false ? false : true,
        updated_at: now,
      }
      const r = id
        ? await db.from('ffe_catalog').update(row).eq('id', id).select('id,code').limit(1)
        : await db.from('ffe_catalog').insert({ ...row, created_by: who }).select('id,code').limit(1)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, product: (r.data || [])[0] || null, code })
    }

    // ---- what the next code would be, so the form can show it while you type ----
    if (action === 'peek') {
      const category = CAT_KEYS.has(str(body.category)) ? str(body.category) : 'misc'
      return NextResponse.json({ ok: true, code: nextCode(category, taken) })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return fail(e?.message || e) }
}
