// Property Audit: per-room AI suggestion strip. Suggestions are OFFERED, never auto-added -
// the inspector taps to add one as an item (Jon's rule). Cached in-memory per room type.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const cache: Record<string, { at: number; list: any[] }> = {}
const TTL = 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const code = req.nextUrl.searchParams.get('code') || ''
  const room = (req.nextUrl.searchParams.get('room') || '').slice(0, 60)
  if (!room) return NextResponse.json({ error: 'room required' }, { status: 400 })
  const { data: audits } = await db.from('property_audits').select('id').eq('share_code', code).limit(1)
  if (!audits || !audits[0]) return NextResponse.json({ error: 'invalid audit link' }, { status: 401 })
  const roomType = room.replace(/\s*\d+$/, '').toLowerCase()
  const hit = cache[roomType]
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ok: true, suggestions: hit.list, cached: true })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, suggestions: [] })
  try {
    const SYS = 'You advise a short-term-rental operations team inspecting units. Given a room type, suggest 5 concise, high-impact things worth checking or adding in that room (guest-experience upgrades, common wear points, safety). STRICT JSON only: [{"title":"2-5 words","why":"one short sentence"}]. No markdown.'
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 500,
        system: SYS,
        messages: [{ role: 'user', content: 'Room: ' + roomType }],
      }),
    })
    const j = await r.json().catch(() => null)
    const txt = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = txt.match(/\[[\s\S]*\]/)
    const list = m ? JSON.parse(m[0]) : []
    const clean = Array.isArray(list) ? list.filter((x: any) => x && x.title).slice(0, 6).map((x: any) => ({ title: String(x.title).slice(0, 60), why: String(x.why || '').slice(0, 140) })) : []
    cache[roomType] = { at: Date.now(), list: clean }
    return NextResponse.json({ ok: true, suggestions: clean })
  } catch { return NextResponse.json({ ok: true, suggestions: [] }) }
}
