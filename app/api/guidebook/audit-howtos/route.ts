import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireVrUser } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'

const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export async function GET(req: NextRequest) {
  // Signed in AND an active Lighthouse member. The local helper this replaced only checked for a
  // Supabase session, so any login got the listing's how-tos (2026-09-29).
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const listingId = String(req.nextUrl.searchParams.get('listingId') || '')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const db = supabaseAdmin()

  const { data: items } = await db.from('audit_items')
    .select('id, room, kind, title, note, details, status, item_type')
    .eq('listing_id', listingId)
    .neq('status', 'dismissed')
    .limit(500)

  const candidates: any[] = []
  const seen: Record<string, boolean> = {}
  const { data: pub } = await db.from('listing_faq')
    .select('id, category, question, answer')
    .eq('listing_id', listingId)
    .eq('status', 'published')
    .limit(300)
  for (const e of (pub || [])) {
    const title = String((e as any).question || '').slice(0, 120)
    const body = String((e as any).answer || '').slice(0, 600)
    if (!title || !body) continue
    const key = norm(title)
    if (!key || seen[key]) continue
    seen[key] = true
    candidates.push({ id: 'faq-' + (e as any).id, title, body, kind: 'faq', room: String((e as any).category || '') })
  }
  for (const it of (items || [])) {
    const d = (it && it.details) || {}
    const isFaq = it.kind === 'faq'
    const howTo = d && d.howTo ? String(d.howTo) : ''
    if (!isFaq && !howTo) continue
    const title = String(it.title || it.item_type || 'Item').slice(0, 120)
    const body = isFaq ? String(it.note || howTo || '') : howTo
    if (!body) continue
    const key = norm(title)
    if (!key || seen[key]) continue
    seen[key] = true
    candidates.push({ id: it.id, title, body: body.slice(0, 600), kind: it.kind, room: it.room || '' })
  }

  const { data: books } = await db.from('guidebooks')
    .select('sections, updated_at')
    .eq('listing_id', listingId)
    .order('updated_at', { ascending: false })
    .limit(1)
  const book: any = books && books[0]
  const existing: string[] = []
  const hg = book && book.sections && book.sections.houseGuide
  if (hg && Array.isArray(hg.items)) for (const x of hg.items) if (x && x.title) existing.push(String(x.title))
  const existingNorm = existing.map(norm)

  for (const c of candidates) {
    const ck = norm(c.title)
    c.already = existingNorm.some(e => !!e && (e === ck || e.indexOf(ck) >= 0 || ck.indexOf(e) >= 0))
  }

  return NextResponse.json({ ok: true, hasGuidebook: !!book, existing, candidates })
}
