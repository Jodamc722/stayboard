// COUPON CODES — the team's side. GET lists them (edit), POST creates one and PUT changes one
// (full: a code is money). The guest side reads them through /api/public/guest-order only.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listCoupons, normCouponCode } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireLevel('guest-orders', 'edit')
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, coupons: await listCoupons() })
}

function clean(body: any): { row: Record<string, any>; error?: string } {
  const row: Record<string, any> = {}
  if (body.code !== undefined) {
    const code = normCouponCode(body.code)
    if (code.length < 3) return { row, error: 'A code needs at least 3 letters or digits.' }
    row.code = code
  }
  if (body.label !== undefined) row.label = String(body.label || '').trim().slice(0, 80) || null
  if (body.percent_off !== undefined || body.amount_off_usd !== undefined) {
    const pct = Number(body.percent_off), amt = Number(body.amount_off_usd)
    if (pct > 0) { row.percent_off = Math.min(100, Math.round(pct * 100) / 100); row.amount_off_usd = null }
    else if (amt > 0) { row.amount_off_usd = Math.round(amt * 100) / 100; row.percent_off = null }
    else return { row, error: 'Give the code a value: a percent off or a dollar amount off.' }
  }
  if (body.min_subtotal_usd !== undefined) row.min_subtotal_usd = Math.max(0, Math.round((Number(body.min_subtotal_usd) || 0) * 100) / 100)
  if (body.buildings !== undefined) row.buildings = Array.isArray(body.buildings) && body.buildings.length ? body.buildings.map((x: any) => String(x).slice(0, 60)).slice(0, 50) : null
  if (body.starts_at !== undefined) row.starts_at = body.starts_at ? new Date(body.starts_at).toISOString() : null
  if (body.expires_at !== undefined) row.expires_at = body.expires_at ? new Date(body.expires_at).toISOString() : null
  if (body.max_uses !== undefined) row.max_uses = body.max_uses === null || body.max_uses === '' ? null : Math.max(1, Math.floor(Number(body.max_uses) || 0)) || null
  if (body.active !== undefined) row.active = body.active !== false
  for (const k of ['starts_at', 'expires_at']) if (row[k] === 'Invalid Date') return { row, error: 'That date is not a date.' }
  return { row }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'full')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const { row, error } = clean(body)
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 })
  if (!row.code) return NextResponse.json({ ok: false, error: 'A code is required.' }, { status: 400 })
  if (row.percent_off === undefined && row.amount_off_usd === undefined) return NextResponse.json({ ok: false, error: 'Give the code a value: a percent off or a dollar amount off.' }, { status: 400 })
  const db = supabaseAdmin()
  const ins = await db.from('guest_order_coupons').insert({ ...row, created_by: gate.access.email || 'staff' }).select('*').limit(1)
  if (ins.error) return NextResponse.json({ ok: false, error: /duplicate|unique/i.test(ins.error.message) ? 'That code already exists.' : ins.error.message }, { status: 400 })
  return NextResponse.json({ ok: true, coupons: await listCoupons() })
}

export async function PUT(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'full')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const { row, error } = clean(body)
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 })
  const db = supabaseAdmin()
  const up = await db.from('guest_order_coupons').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 })
  return NextResponse.json({ ok: true, coupons: await listCoupons() })
}
