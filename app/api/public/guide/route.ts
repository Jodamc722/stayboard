// PUBLIC property-guide API. Backs /guide/<slug> - the shareable guest page (activations, hours,
// menu, things to do) and its password-gated editor.
//
// GET  ?slug=garden            -> { ok, slug, content, canEdit }
// GET  ?slug=garden&quotes=1   -> live guest-review quotes about the food / coffee / property
// POST { slug, action }        -> 'unlock' (admin password -> signed cookie) | 'lock'
// PUT  { slug, content }       -> save. Requires a StayBoard session, the unlock cookie, or the
//                                 admin password in the body.
//
// Content lives in app_settings under 'guide:<slug>' as a JSON string (value is TEXT). No migration.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { adminPasswordOk } from '@/lib/shareAuth'
import { signEditToken, verifyEditToken, EDIT_TTL_MS } from '@/lib/edit-access'
import { guideKey, normSlug, seedFor, type Guide } from '@/lib/guide'

export const dynamic = 'force-dynamic'

const GUIDE_COOKIE = 'sb_guide'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function readGuide(slug: string): Promise<{ content: Guide; stored: boolean }> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', guideKey(slug)).limit(1)
    const raw = (data || [])[0] as any
    if (raw && raw.value) {
      const v = raw.value
      const parsed = typeof v === 'string' ? JSON.parse(v) : v
      if (parsed && typeof parsed === 'object') return { content: parsed as Guide, stored: true }
    }
  } catch { /* fall through to the seed */ }
  return { content: seedFor(slug), stored: false }
}

async function writeGuide(slug: string, content: Guide, by: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = { ...content, slug: normSlug(slug), updatedAt: new Date().toISOString(), updatedBy: by }
    const { error } = await supabaseAdmin().from('app_settings').upsert(
      { key: guideKey(slug), value: JSON.stringify(body), updated_by: by || null, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

async function sessionEmail(): Promise<string> {
  try {
    const { data } = await createClient().auth.getUser()
    return str(data?.user?.email)
  } catch { return '' }
}

function hasGuideCookie(): boolean {
  try { return verifyEditToken(cookies().get(GUIDE_COOKIE)?.value) } catch { return false }
}

// ---- guest quotes -----------------------------------------------------------------------------
// Real review lines about the things this page is selling (the coffee, the breakfast, the pool).
// Positive only, trimmed to the sentence that actually mentions the keyword, no guest surnames.
const BUILDING_FOR: Record<string, string> = { garden: 'botanica', botanica: 'botanica' }

function sentenceWith(text: string, words: string[]): string {
  const parts = String(text || '').split(/(?<=[.!?])\s+/)
  for (const p of parts) {
    const low = p.toLowerCase()
    for (const w of words) if (w && low.indexOf(w.toLowerCase()) >= 0) {
      const clean = p.trim().replace(/\s+/g, ' ')
      if (clean.length >= 25 && clean.length <= 260) return clean
    }
  }
  return ''
}

async function pullQuotes(slug: string, keywords: string[], limit: number) {
  const db = supabaseAdmin()
  const building = BUILDING_FOR[normSlug(slug)] || normSlug(slug)
  const re = new RegExp(building.replace(/[^a-z0-9]/gi, ''), 'i')
  const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,status')
  const ids: string[] = []
  for (const l of (listings || []) as any[]) {
    const name = str(l.nickname || l.title)
    if (!re.test(str(l.building)) && !re.test(name)) continue
    if (/inactive|disabled|archived|deleted/i.test(str(l.status))) continue
    ids.push(String(l.id))
  }
  if (!ids.length) return []
  const { data: revs } = await db.from('guesty_reviews')
    .select('id,listing_id,rating,content,channel,created_at')
    .in('listing_id', ids).gte('rating', 4)
    .order('created_at', { ascending: false }).limit(600)
  const out: { text: string; who: string; source: string; date: string }[] = []
  const seen: string[] = []
  for (const r of (revs || []) as any[]) {
    const line = sentenceWith(str(r.content), keywords)
    if (!line) continue
    const k = line.toLowerCase().slice(0, 40)
    if (seen.indexOf(k) >= 0) continue
    seen.push(k)
    const d = str(r.created_at).slice(0, 10)
    out.push({
      text: line,
      who: 'Verified guest',
      source: str(r.channel) || '',
      date: d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '',
    })
    if (out.length >= limit) break
  }
  return out
}

// ---- handlers ---------------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const slug = normSlug(url.searchParams.get('slug') || 'garden')
  if (!slug) return NextResponse.json({ ok: false, error: 'Missing slug' }, { status: 400 })
  try {
    if (url.searchParams.get('quotes') === '1') {
      const kw = str(url.searchParams.get('keywords')).split(',').map(s => s.trim()).filter(Boolean)
      const words = kw.length ? kw : ['coffee', 'breakfast', 'food', 'restaurant', 'cafe', 'pool']
      const limit = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 6))
      const items = await pullQuotes(slug, words, limit)
      return NextResponse.json({ ok: true, items })
    }
    const { content, stored } = await readGuide(slug)
    const email = await sessionEmail()
    const canEdit = !!email || hasGuideCookie()
    return NextResponse.json({ ok: true, slug, content, stored, canEdit })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = str(body?.action)
  if (action === 'lock') {
    const res = NextResponse.json({ ok: true, canEdit: false })
    res.cookies.set(GUIDE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }
  if (action === 'unlock') {
    const gate = await adminPasswordOk(str(body?.password))
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason || 'Wrong password' }, { status: 401 })
    const res = NextResponse.json({ ok: true, canEdit: true })
    res.cookies.set(GUIDE_COOKIE, signEditToken(Date.now() + EDIT_TTL_MS), {
      path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: Math.floor(EDIT_TTL_MS / 1000),
    })
    return res
  }
  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const slug = normSlug(str(body?.slug) || 'garden')
  const content = body?.content
  if (!slug || !content || typeof content !== 'object') {
    return NextResponse.json({ ok: false, error: 'Missing slug or content' }, { status: 400 })
  }
  const email = await sessionEmail()
  let who = email
  if (!email && !hasGuideCookie()) {
    const gate = await adminPasswordOk(str(body?.adminPassword))
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason || 'Locked' }, { status: 401 })
    who = 'admin-link'
  } else if (!email) who = 'admin-link'
  const saved = await writeGuide(slug, content as Guide, who)
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error || 'Save failed' }, { status: 500 })
  const { content: fresh } = await readGuide(slug)
  return NextResponse.json({ ok: true, content: fresh })
}
