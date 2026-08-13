// FF&E CATALOG API — the products an order can be built from (Jon, 2026-08-12).
//
// GET   ?q=&category=&kind=&tier=&all=1   list products (active only unless all=1), each with sources
// POST  {action:'save'}       add or edit one product; the code is derived if not supplied
// POST  {action:'bulk'}       add many from a pasted block (vendor quote / spreadsheet)
// POST  {action:'preview'}    read an uploaded .xlsx/.csv and say what WOULD be imported. Writes nothing.
// POST  {action:'import'}     commit the rows the preview showed, after the human has looked at them
// POST  {action:'seed'}       load the starter catalog for chosen kinds and tiers
// POST  {action:'retire'}     set active=false. NOT a delete — the code may be on a live quote.
// POST  {action:'source'}     add or edit one place to buy a product (Amazon, HostGPO, Wayfair…)
// POST  {action:'prefer'}     mark one source as the one a quote should price from
// POST  {action:'dropSource'} remove a source
//
// Signed-in and edit-gated. The catalog decides what everyone in the company can order, so it is
// not a share-link capability like the walk form.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import {
  FFE_CATEGORIES, FFE_KINDS, FFE_TIERS, FFE_VENDORS, amazonSearch, bestSource,
  nextCode, normalizeCode, normalizeKind, normalizeTier, parseProductPaste,
} from '@/lib/ffe-catalog'
import { STARTER_CATALOG } from '@/lib/ffe-starter-catalog'
import { FFE_ROOMS } from '@/lib/ffe-checklist'
import { detectHeader, readSheet, SheetColumnMap } from '@/lib/sheet-read'

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

// ── TIER AND KIND MAY NOT EXIST YET ─────────────────────────────────────────────────────────────
// Migration 039 adds them. Between shipping this code and running that migration the screen must
// still work rather than 500 — so probe once, and drop the two fields if the columns are not there.
// Only a positive result is cached: before the migration we keep re-checking (it is one cheap query
// and it means the feature lights up the moment the migration runs, with no redeploy).
let TIER_KIND_READY = false
async function tierKindReady(db: any): Promise<boolean> {
  if (TIER_KIND_READY) return true
  const { error } = await db.from('ffe_catalog').select('tier,kind').limit(1)
  if (!error) TIER_KIND_READY = true
  return TIER_KIND_READY
}
/** Strip tier/kind from a row when the columns are not there yet. */
const forDb = (row: any, ready: boolean) => {
  if (ready) return row
  const { tier, kind, ...rest } = row
  return rest
}

const BASE_COLS = 'id,code,name_en,name_es,category,room_hint,item_keys,vendor,vendor_sku,unit_cost,url,image_url,dimensions,finish,lead_time_days,notes,active,updated_at'

export async function GET(req: NextRequest) {
  const s = createClient()
  const { data: u } = await s.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    const ready = await tierKindReady(db)
    let q = db.from('ffe_catalog')
      .select(ready ? BASE_COLS + ',tier,kind' : BASE_COLS)
      .order('code', { ascending: true })
      .limit(4000)
    if (!sp.get('all')) q = q.eq('active', true)
    if (sp.get('category')) q = q.eq('category', str(sp.get('category')))
    if (ready && sp.get('kind')) q = q.eq('kind', normalizeKind(sp.get('kind')))
    if (ready && sp.get('tier')) q = q.eq('tier', normalizeTier(sp.get('tier')))
    const { data, error } = await q
    if (error) return fail(error.message)

    const term = str(sp.get('q')).trim().toLowerCase()
    const rows = ((data || []) as any[]).filter(r => !term ||
      [r.code, r.name_en, r.name_es, r.vendor, r.vendor_sku].some(x => str(x).toLowerCase().includes(term)))

    // Every place each product can be bought from. Absent table = no sources, never an error, so
    // the catalog still works before migration 038 has been run.
    let sources: any[] = []
    try {
      const { data: src } = await db.from('ffe_catalog_sources')
        .select('*').in('catalog_id', rows.map(r => r.id)).limit(8000)
      sources = (src || []) as any[]
    } catch { /* not migrated yet */ }
    const byProduct: Record<string, any[]> = {}
    for (const x of sources) (byProduct[str(x.catalog_id)] = byProduct[str(x.catalog_id)] || []).push(x)

    return NextResponse.json({
      ok: true,
      tiersReady: ready,
      products: rows.map(r => {
        const list = (byProduct[str(r.id)] || [])
          .sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0)
            || (a.unit_cost == null ? 1e12 : Number(a.unit_cost)) - (b.unit_cost == null ? 1e12 : Number(b.unit_cost)))
        const best = bestSource(list)
        return {
          ...r,
          // Before migration 039 everything reads as the honest middle rather than as blank.
          tier: r.tier || 'tier2',
          kind: r.kind || 'furniture',
          sources: list,
          // What a quote should use: the chosen source, else the cheapest, else whatever is typed
          // on the product itself for products added before sources existed.
          unit_cost: best && best.unit_cost != null ? Number(best.unit_cost) : r.unit_cost,
          vendor: best ? best.vendor : r.vendor,
          vendor_sku: best ? (best.vendor_sku || r.vendor_sku) : r.vendor_sku,
          url: best && best.url ? best.url : r.url,
          bestSourceId: best ? best.id : null,
          cheapest: list.filter(x => x.unit_cost != null).length > 1
            ? Math.min(...list.filter(x => x.unit_cost != null).map(x => Number(x.unit_cost))) : null,
        }
      }),
      categories: FFE_CATEGORIES,
      kinds: FFE_KINDS,
      tiers: FFE_TIERS,
      vendors: FFE_VENDORS,
      rooms: FFE_ROOMS.map(r => ({ key: r.key, en: r.en, es: r.es })),
    })
  } catch (e: any) { return fail(e?.message || e) }
}

// ── IMPORT ──────────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-08-13: "can we have a place where we can upload a catalog."
//
// TWO STEPS ON PURPOSE. Upload reads the file and shows what it found; nothing is written until
// somebody has looked at it and pressed the second button. An import that writes on upload is how
// you end up with four hundred products called "Item" and no way back — and unlike a walk answer,
// a bad catalog row propagates into orders and onto owner quotes.
type DraftRow = {
  name: string; code?: string; category?: string; kind?: string; tier?: string
  vendor?: string; sku?: string; price?: any; url?: string; image?: string
  spec?: string; room?: string; notes?: string; problem?: string
}

/** Guess the category from the product name when the sheet does not say. */
function guessCategory(name: string): string {
  const n = String(name || '').toLowerCase()
  const rules: [RegExp, string][] = [
    [/\b(sofa|couch|loveseat|sectional|sleeper)\b/, 'sofa'],
    [/\b(chair|stool|recliner|bench)\b/, 'chair'],
    [/\b(table|desk|console|nightstand table)\b/, 'table'],
    [/\b(bed|mattress|headboard|box spring)\b/, 'bed'],
    [/\b(nightstand|dresser|chest|credenza|media console|tv stand|cabinet|bookcase|luggage rack)\b/, 'case'],
    [/\b(lamp|light|sconce|chandelier|pendant|bulb)\b/, 'lamp'],
    [/\b(rug|carpet|runner|mat|rug pad)\b/, 'rug'],
    [/\b(art|mirror|print|canvas|frame)\b/, 'art'],
    [/\b(curtain|drape|blind|shade|rod)\b/, 'window'],
    [/\b(tv|television|monitor|mount|soundbar|streaming)\b/, 'tv'],
    [/\b(pillow|throw|vase|plant|decor|tray|basket)\b/, 'decor'],
  ]
  for (const [re, key] of rules) if (re.test(n)) return key
  return 'misc'
}

/** Turn a parsed sheet into candidate products, without touching the database. */
function rowsToDrafts(rows: string[][], map: SheetColumnMap | null, fallback: { category: string; kind: string; tier: string }): DraftRow[] {
  const body = map ? rows.slice(1) : rows
  const at = (r: string[], i: number | undefined) => (i == null ? '' : str(r[i]).trim())
  const out: DraftRow[] = []

  for (const r of body) {
    let name = ''
    let vendor = '', sku = '', price: any = '', url = '', image = '', spec = '', notes = '', code = ''
    let category = '', kind = '', tier = ''

    if (map) {
      name = at(r, map.name)
      code = at(r, map.code)
      category = at(r, map.category)
      kind = at(r, map.kind)
      tier = at(r, map.tier)
      vendor = at(r, map.vendor)
      sku = at(r, map.sku)
      price = at(r, map.price)
      url = at(r, map.url)
      image = at(r, map.image)
      spec = at(r, map.spec)
      notes = at(r, map.notes)
    } else {
      // No header row — fall back to the same shape-based reading the paste box uses: a $ amount is
      // the price, an http… is the link, the first thing left over is the name.
      const p = parseProductPaste(r.join('\t'))[0]
      if (p) { name = p.name; vendor = p.vendor || ''; sku = p.sku || ''; price = p.unitCost ?? ''; url = p.url || '' }
    }

    if (!name) continue // a blank name is a spacer row, not an error worth reporting
    const cat = CAT_KEYS.has(category.toLowerCase()) ? category.toLowerCase()
      : (fallback.category === 'auto' ? guessCategory(name) : fallback.category)

    out.push({
      name: name.slice(0, 120),
      code: normalizeCode(code) || undefined,
      category: cat,
      kind: kind ? normalizeKind(kind) : fallback.kind,
      tier: tier ? normalizeTier(tier) : fallback.tier,
      vendor: vendor.slice(0, 80) || undefined,
      sku: sku.slice(0, 64) || undefined,
      price: priceOf(price),
      url: urlOf(url) || undefined,
      image: urlOf(image) || undefined,
      spec: spec.slice(0, 80) || undefined,
      notes: notes.slice(0, 500) || undefined,
    })
  }
  return out
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
    // ---- PREVIEW: read the upload, write nothing ----
    // Done before the existing-codes query because it does not need the database at all.
    if (action === 'preview') {
      const b64 = str(body.data)
      if (!b64) return NextResponse.json({ error: 'no file' }, { status: 400 })
      // ~6MB of base64 is ~4.5MB of file. A catalog spreadsheet is a few hundred KB; anything an
      // order of magnitude past that is a mistake and refusing is kinder than timing out.
      if (b64.length > 6_000_000) return NextResponse.json({ error: 'That file is too big — keep it under about 4 MB.' }, { status: 413 })

      let rows: string[][] = []
      try {
        rows = readSheet(Buffer.from(b64, 'base64'), str(body.filename))
      } catch (e: any) {
        return NextResponse.json({ error: 'Could not read that file. Save it as .xlsx or .csv and try again.' }, { status: 400 })
      }
      if (!rows.length) return NextResponse.json({ error: 'That file had no rows in it.' }, { status: 400 })

      const map = detectHeader(rows)
      const drafts = rowsToDrafts(rows, map, {
        category: CAT_KEYS.has(str(body.category)) ? str(body.category) : 'auto',
        kind: normalizeKind(body.kind),
        tier: normalizeTier(body.tier),
      })

      // Which of these we already have, so the preview can say "12 new, 3 already here".
      const { data: ex } = await db.from('ffe_catalog').select('code,name_en').limit(5000)
      const haveCode = new Set(((ex || []) as any[]).map(r => str(r.code).toUpperCase()))
      const haveName = new Set(((ex || []) as any[]).map(r => str(r.name_en).trim().toLowerCase()))

      return NextResponse.json({
        ok: true,
        headerFound: !!map,
        columns: map || null,
        firstRow: rows[0] || [],
        totalRows: rows.length,
        rows: drafts.slice(0, 500).map(d => ({
          ...d,
          duplicate: (d.code && haveCode.has(d.code.toUpperCase())) || haveName.has(d.name.trim().toLowerCase()),
        })),
        truncated: drafts.length > 500,
      })
    }

    // Every existing code, once — both the uniqueness check and the next-number are derived from it.
    const { data: existing, error: exErr } = await db.from('ffe_catalog').select('id,code,name_en').limit(5000)
    if (exErr) return fail(exErr.message)
    const taken = ((existing || []) as any[]).map(r => str(r.code))
    const byCode: Record<string, string> = {}
    const byName: Record<string, string> = {}
    for (const r of ((existing || []) as any[])) {
      byCode[str(r.code).toUpperCase()] = str(r.id)
      byName[str(r.name_en).trim().toLowerCase()] = str(r.id)
    }
    const ready = await tierKindReady(db)

    // ---- retire (never delete: the code may sit on an approved quote) ----
    if (action === 'retire' || action === 'restore') {
      const id = str(body.id)
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const r = await db.from('ffe_catalog')
        .update({ active: action === 'restore', updated_at: now }).eq('id', id)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    // ---- COMMIT THE IMPORT ----
    if (action === 'import') {
      const list: DraftRow[] = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : []
      if (!list.length) return NextResponse.json({ error: 'nothing to import' }, { status: 400 })
      const skipDupes = body.skipDuplicates !== false

      const running = taken.slice()
      const inserts: any[] = []
      const updates: { id: string; row: any }[] = []
      let skipped = 0

      for (const d of list) {
        const name = str(d.name).trim().slice(0, 120)
        if (!name) { skipped++; continue }
        const category = CAT_KEYS.has(str(d.category)) ? str(d.category) : guessCategory(name)

        // An existing product with this code — or, failing that, this exact name — is the SAME
        // product being re-uploaded with a fresh price. Updating it is what a buyer means by
        // "import the new price list"; inserting a second copy is how a catalog becomes unusable.
        const wanted = normalizeCode(str(d.code))
        const hit = (wanted && byCode[wanted.toUpperCase()]) || byName[name.toLowerCase()] || ''

        const row: any = {
          name_en: name,
          category,
          tier: normalizeTier(d.tier),
          kind: normalizeKind(d.kind),
          room_hint: ROOM_KEYS.has(str(d.room)) ? str(d.room) : null,
          vendor: clean(d.vendor, 80),
          vendor_sku: clean(d.sku, 64),
          unit_cost: priceOf(d.price),
          url: urlOf(d.url),
          image_url: urlOf(d.image),
          dimensions: clean(d.spec, 80),
          notes: clean(d.notes, 500),
          active: true,
          updated_at: now,
        }

        if (hit) {
          if (skipDupes) { skipped++; continue }
          updates.push({ id: hit, row: forDb(row, ready) })
          continue
        }
        const code = wanted || nextCode(category, running)
        running.push(code)
        byCode[code.toUpperCase()] = 'pending'
        byName[name.toLowerCase()] = 'pending'
        inserts.push(forDb({ ...row, code, item_keys: [], created_by: who }, ready))
      }

      let added = 0
      // In chunks: one 900-row insert is one failure for everybody, and Postgres is happier anyway.
      for (let i = 0; i < inserts.length; i += 200) {
        const r = await db.from('ffe_catalog').insert(inserts.slice(i, i + 200)).select('id')
        if (r.error) return fail(r.error.message)
        added += (r.data || []).length
      }
      let updated = 0
      for (const u of updates) {
        const r = await db.from('ffe_catalog').update(u.row).eq('id', u.id)
        if (!r.error) updated++
      }
      return NextResponse.json({ ok: true, added, updated, skipped, tiersReady: ready })
    }

    // ---- SEED THE STARTER CATALOG ----
    // Jon, 2026-08-13: "create one with links for all Amazon."
    if (action === 'seed') {
      const kinds: string[] = Array.isArray(body.kinds) ? body.kinds.map(normalizeKind) : []
      const tiers: string[] = Array.isArray(body.tiers) ? body.tiers.map(normalizeTier) : []
      const picked = STARTER_CATALOG.filter(p =>
        (!kinds.length || kinds.indexOf(p.kind) >= 0) && (!tiers.length || tiers.indexOf(p.tier) >= 0))

      if (body.dryRun) return NextResponse.json({ ok: true, would: picked.length })

      const running = taken.slice()
      const rows: any[] = []
      let skipped = 0
      for (const p of picked) {
        // Never a second copy of something already in the catalog. Seeding twice is a no-op.
        if (byName[p.name.trim().toLowerCase()]) { skipped++; continue }
        byName[p.name.trim().toLowerCase()] = 'pending'
        const category = CAT_KEYS.has(p.category) ? p.category : 'misc'
        const code = nextCode(category, running)
        running.push(code)
        rows.push(forDb({
          code,
          name_en: p.name,
          name_es: null,
          category,
          tier: p.tier,
          kind: p.kind,
          room_hint: p.room && ROOM_KEYS.has(p.room) ? p.room : null,
          item_keys: (p.itemKeys || []).slice(0, 20),
          vendor: 'Amazon Business',
          vendor_sku: null,
          unit_cost: p.est ?? null,
          // A SEARCH, not a product page — see the header of lib/ffe-starter-catalog.ts.
          url: amazonSearch(p.search),
          image_url: null,
          dimensions: p.spec || null,
          finish: null,
          lead_time_days: null,
          notes: [p.note, 'Starter catalog — price is a planning estimate and the link is an Amazon search. Replace both once you pick the actual item.']
            .filter(Boolean).join(' · ').slice(0, 500),
          active: true,
          created_by: who,
          updated_at: now,
        }, ready))
      }

      let added = 0
      for (let i = 0; i < rows.length; i += 200) {
        const r = await db.from('ffe_catalog').insert(rows.slice(i, i + 200)).select('id')
        if (r.error) return fail(r.error.message)
        added += (r.data || []).length
      }
      return NextResponse.json({ ok: true, added, skipped, tiersReady: ready })
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
        rows.push(forDb({
          code, name_en: p.name, name_es: null, category, room_hint: roomHint,
          tier: normalizeTier(body.tier), kind: normalizeKind(body.kind),
          item_keys: Array.isArray(body.itemKeys) ? body.itemKeys.map(String).slice(0, 20) : [],
          vendor: p.vendor || null, vendor_sku: p.sku || null,
          unit_cost: p.unitCost == null ? null : p.unitCost,
          url: p.url || null, active: true, created_by: who, updated_at: now,
        }, ready))
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
        tier: normalizeTier(body.tier),
        kind: normalizeKind(body.kind),
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
      const payload = forDb(row, ready)
      const r = id
        ? await db.from('ffe_catalog').update(payload).eq('id', id).select('id,code').limit(1)
        : await db.from('ffe_catalog').insert({ ...payload, created_by: who }).select('id,code').limit(1)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, product: (r.data || [])[0] || null, code })
    }

    // ---- WHERE WE BUY IT: several answers per product, decided later ----
    if (action === 'source') {
      const catalogId = str(body.catalogId)
      const vendor = clean(body.vendor, 80)
      if (!catalogId || !vendor) return NextResponse.json({ error: 'a product and a vendor are required' }, { status: 400 })
      const row: any = {
        catalog_id: catalogId,
        vendor,
        vendor_sku: clean(body.vendorSku, 64),
        url: urlOf(body.url),
        unit_cost: priceOf(body.unitCost),
        lead_time_days: Number.isFinite(Number(body.leadTimeDays)) && Number(body.leadTimeDays) > 0
          ? Math.min(365, Math.round(Number(body.leadTimeDays))) : null,
        member_price: body.memberPrice === true,
        in_stock: typeof body.inStock === 'boolean' ? body.inStock : null,
        note: clean(body.note, 300),
        updated_at: now,
      }
      const sid = str(body.id)
      const r = sid
        ? await db.from('ffe_catalog_sources').update(row).eq('id', sid)
        : await db.from('ffe_catalog_sources').insert({ ...row, created_by: who })
      if (r.error) {
        // A repeat vendor+SKU is an edit, not an error — update the one already there.
        if (/duplicate key/i.test(r.error.message || '')) {
          const { data: ex2 } = await db.from('ffe_catalog_sources').select('id')
            .eq('catalog_id', catalogId).eq('vendor', vendor).limit(1)
          if (ex2 && ex2[0]) {
            const r2 = await db.from('ffe_catalog_sources').update(row).eq('id', ex2[0].id)
            if (r2.error) return fail(r2.error.message)
            return NextResponse.json({ ok: true, merged: true })
          }
        }
        return fail(r.error.message)
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'prefer') {
      const sid = str(body.id), catalogId = str(body.catalogId)
      if (!sid || !catalogId) return NextResponse.json({ error: 'id and catalogId required' }, { status: 400 })
      // Exactly one preferred per product — clearing first is what makes that true.
      const clr = await db.from('ffe_catalog_sources').update({ preferred: false, updated_at: now }).eq('catalog_id', catalogId)
      if (clr.error) return fail(clr.error.message)
      const r = await db.from('ffe_catalog_sources').update({ preferred: true, updated_at: now }).eq('id', sid)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    if (action === 'dropSource') {
      const sid = str(body.id)
      if (!sid) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const r = await db.from('ffe_catalog_sources').delete().eq('id', sid)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    // ---- what the next code would be, so the form can show it while you type ----
    if (action === 'peek') {
      const category = CAT_KEYS.has(str(body.category)) ? str(body.category) : 'misc'
      return NextResponse.json({ ok: true, code: nextCode(category, taken) })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return fail(e?.message || e) }
}
