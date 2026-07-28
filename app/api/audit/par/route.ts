// INVENTORY PAR — the par table for an audit, and the restock that closes the gap.
//
//   GET  ?code=<share>   -> { table, shape }   the mobile form computes counts-vs-par locally
//   GET                  -> { table, defaults } admin editor (session required)
//   PUT  { table }       -> save owner overrides to app_settings 'par_levels' (admin only)
//   POST { code, shortfalls[] } -> create one 'add' order line per shortfall on that audit
//
// The share code IS the key for the mobile paths, matching /api/audit. Shortfalls are RE-COMPUTED
// server-side from the same par table before anything is written, so a tampered client can't
// order 99 TVs — the posted qty is clamped to the real gap.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { DEFAULT_PAR, mergePar, parForRoom, parKey, unitShape, type ParTable, type UnitShape } from '@/lib/par-levels'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const PAR_KEY = 'par_levels'

async function table(): Promise<ParTable> {
  const stored = await getSetting<any>(PAR_KEY, null)
  return mergePar(stored)
}

async function auditByCode(db: any, code: string) {
  if (!code || code.length < 6) return null
  const { data } = await db.from('property_audits').select('*').eq('share_code', code).limit(1)
  return (data && data[0]) || null
}

// Unit size for scaling: the listing's bedroom/bathroom count, refined by the "Unit basics" tags
// the walker captured (Sleeps 6 / 3 beds). Prospect + building audits have no listing row, so they
// fall back to the 1-bed shape rather than erroring.
async function shapeFor(db: any, audit: any): Promise<UnitShape> {
  let bedrooms: number | null = null
  let bathrooms: number | null = null
  const lid = String(audit.listing_id || '')
  if (lid && lid.indexOf(':') < 0) {
    try {
      const { data } = await db.from('guesty_listings').select('bedrooms,bathrooms:raw->bathrooms').eq('id', lid).limit(1)
      const row = data && data[0]
      if (row) {
        bedrooms = typeof row.bedrooms === 'number' ? row.bedrooms : (parseFloat(String(row.bedrooms || '')) || null)
        const b = (row as any).bathrooms
        bathrooms = typeof b === 'number' ? b : (parseFloat(String(b || '')) || null)
      }
    } catch { /* shape falls back below */ }
  }
  let basics: string[] = []
  try {
    const { data } = await db.from('audit_items').select('title').eq('audit_id', audit.id).eq('kind', 'tag').eq('room', 'Unit basics').limit(30)
    basics = (data || []).map((x: any) => String(x.title || '')).filter(Boolean)
  } catch { /* basics are optional */ }
  return unitShape(bedrooms, bathrooms, basics)
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || ''
  const t = await table()
  if (code) {
    const db = supabaseAdmin()
    const audit = await auditByCode(db, code)
    if (!audit) return NextResponse.json({ error: 'Audit link not found.' }, { status: 404 })
    const shape = await shapeFor(db, audit)
    return NextResponse.json({ ok: true, table: t, shape })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, table: t, defaults: DEFAULT_PAR })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const merged = mergePar(body && body.table ? { rooms: body.table } : null)
  const r = await setSetting(PAR_KEY, { rooms: merged }, access.email)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save par levels.' }, { status: 500 })
  return NextResponse.json({ ok: true, table: merged })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const audit = await auditByCode(db, code)
  if (!audit) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    return NextResponse.json({ error: 'Audit link not found.' }, { status: 404 })
  }
  if (audit.status === 'completed') return NextResponse.json({ error: 'This audit is closed — reopen it to add items.' }, { status: 400 })

  const t = await table()
  const shape = await shapeFor(db, audit)
  const posted = Array.isArray(body.shortfalls) ? body.shortfalls.slice(0, 120) : []
  if (!posted.length) return NextResponse.json({ ok: true, created: 0, note: 'Nothing below par.' })

  // Everything already on this audit: inventory rows give the true count, open add rows tell us a
  // restock is already pending so we never double-order the same gap.
  const { data: existing } = await db.from('audit_items').select('id,room,kind,title,qty,status,details').eq('audit_id', audit.id).limit(1500)
  const rows = existing || []
  const haveOf = (room: string, item: string): number => {
    let n = 0
    for (const x of rows) {
      if (x.kind !== 'inventory') continue
      if (String(x.room || '') !== room) continue
      if (parKey(x.title) !== parKey(item)) continue
      n += Math.max(1, Number(x.qty) || 1)
    }
    return n
  }
  const pending = (room: string, item: string): boolean => rows.some((x: any) => x.kind === 'add' && String(x.room || '') === room && parKey(x.title) === parKey(item) && ['open', 'approved', 'ordered', 'arriving', 'task_created'].indexOf(String(x.status)) >= 0)

  const insert: any[] = []
  const skipped: string[] = []
  for (const s of posted) {
    const room = String((s && s.room) || '').slice(0, 80)
    const item = String((s && s.item) || '').slice(0, 120)
    if (!room || !item) continue
    // Re-derive par from OUR table — the client's number is a hint, never the authority.
    const line = parForRoom(room, shape, t).find(p => parKey(p.item) === parKey(item))
    if (!line) { skipped.push(item); continue }
    const have = haveOf(room, item)
    const gap = line.par - have
    if (gap <= 0) continue
    if (pending(room, item)) { skipped.push(item); continue }
    insert.push({
      audit_id: audit.id, listing_id: audit.listing_id, room, kind: 'add',
      title: line.item, qty: Math.max(1, Math.min(99, gap)),
      note: 'Below par — ' + have + ' of ' + line.par + ' in ' + room + '.',
      details: { restock: true, par: line.par, have, source: 'par' },
      status: 'open',
    })
  }
  if (!insert.length) return NextResponse.json({ ok: true, created: 0, skipped: skipped.length, note: skipped.length ? 'Already ordered or at par.' : 'Nothing below par.' })
  const ins = await db.from('audit_items').insert(insert)
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, created: insert.length, skipped: skipped.length, units: insert.reduce((n: number, r: any) => n + r.qty, 0) })
}
