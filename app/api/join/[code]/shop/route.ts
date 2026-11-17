// THE SHOPPING LIST (lib/owner-onboard `shop`), for whoever is buying an owner's order (Jon, 2026-11-17: "also as a
// link, like a shopping list that as they get they can mark"). No login: the long random key in the link is the pass,
// checked on every call, the same as the walkthrough sheet. It shows only what a person buying needs: the place, the
// lines to buy with their quantity, price and link, and what is already ticked. Nothing about the owner.
//   GET   ?k=                 → the list
//   PATCH { k, got: { lineKey: true | false }, by? } → ticks or unticks lines as they are bought
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { unitsOf, unitName } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const hits = new Map<string, number[]>()
const limited = (k: string) => { const now = Date.now(), w = (hits.get(k) || []).filter(t => now - t < 60_000); w.push(now); hits.set(k, w); if (hits.size > 5000) hits.clear(); return w.length > 120 }
const keyOk = (want: string | undefined, got: string) => !!want && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))
const NOPE = () => NextResponse.json({ ok: false, error: 'This shopping link is not active. Ask the office for a new one.' }, { status: 404, headers: NO_STORE })

function list(r: any) {
  const o = r.order, skip: string[] = o?.review?.skip || []
  const units = unitsOf(r).map((h: any, i: number) => unitName(h, i))
  // what the owner said they already have is not on the buying list
  const lines = (o?.lines || []).filter((l: any) => skip.indexOf(l.key) < 0 && l.qty.some((q: number) => Number(q) > 0))
    .map((l: any) => ({ key: l.key, category: l.category || 'Other', name: l.name, detail: l.detail && l.detail !== l.name ? l.detail : '', url: l.url || '', price: l.price, qty: l.qty }))
  const got: Record<string, { at: string; by?: string }> = {}
  for (const l of lines) if (r.shop?.got?.[l.key]) got[l.key] = r.shop.got[l.key]
  return { ok: true, place: r.attach?.property || '', units, lines, got, by: r.shop?.by || '' }
}
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  if (limited(params.code)) return NextResponse.json({ ok: false, error: 'Too many requests. Wait a moment.' }, { status: 429, headers: NO_STORE })
  const r = await readRecord(params.code)
  if (!r || r.archived || !r.order || !keyOk(r.shop?.key, String(req.nextUrl.searchParams.get('k') || ''))) return NOPE()
  return NextResponse.json(list(r), { headers: NO_STORE })
}
export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  if (limited(params.code)) return NextResponse.json({ ok: false, error: 'Too many saves. Wait a moment.' }, { status: 429, headers: NO_STORE })
  const r = await readRecord(params.code)
  const b = await req.json().catch(() => ({} as any))
  if (!r || r.archived || !r.order || !r.shop || !keyOk(r.shop.key, String(b?.k || ''))) return NOPE()
  const sh = r.shop
  if (!sh.openedAt) sh.openedAt = new Date().toISOString()
  if (typeof b.by === 'string') sh.by = b.by.replace(/\s+/g, ' ').trim().slice(0, 80)
  // only lines on this order can be ticked
  const valid = new Set(r.order.lines.map(l => l.key))
  const got = { ...(sh.got || {}) }
  if (b.got && typeof b.got === 'object') for (const [k, v] of Object.entries(b.got).slice(0, 400)) {
    if (!valid.has(k)) continue
    if (v) { if (!got[k]) got[k] = { at: new Date().toISOString(), by: sh.by || undefined } } else delete got[k]
  }
  sh.got = got
  await saveRecord(r, null)
  return NextResponse.json(list(r), { headers: NO_STORE })
}
