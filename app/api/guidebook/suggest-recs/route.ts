import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const MODEL = 'claude-sonnet-4-6'

async function anthropic(key: string, payload: any): Promise<string | null> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return null
    const j: any = await r.json()
    return j?.content?.[0]?.text ?? null
  } catch {
    return null
  }
}

// Suggest ~12 real nearby things-to-do for a listing so the builder can pick which to include.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ recs: [] })

  const { data: l } = await supabaseAdmin
    .from('guesty_listings')
    .select('address_full, address_city, title, nickname')
    .eq('id', listingId)
    .limit(1)
    .single()

  const where = [l?.address_full, l?.address_city].filter(Boolean).join(', ') || String(body?.where || '')
  if (!where) return NextResponse.json({ recs: [] })

  const prompt = 'You are a sharp local concierge for a short-term rental. List 12 genuinely popular, REAL, currently-operating places guests would want near this address. Location: ' + where + '. Give a spread: standout restaurants, a great coffee spot, a beach or park, a landmark or attraction, nightlife, and a grocery or pharmacy. Only real, well-known establishments — never invent names. Return ONLY a JSON array, no prose: [{"name":"","type":"restaurant|coffee|beach|attraction|nightlife|grocery|other","blurb":"under 12 words, why guests love it","area":"neighborhood"}]'

  const text = await anthropic(key, { model: MODEL, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] })
  let recs: any[] = []
  try {
    const m = text ? text.match(/\[[\s\S]*\]/) : null
    recs = JSON.parse(m ? m[0] : (text || '[]'))
  } catch {
    recs = []
  }
  recs = Array.isArray(recs)
    ? recs
        .filter((r) => r && typeof r.name === 'string' && r.name.trim())
        .slice(0, 12)
        .map((r) => ({ name: String(r.name).trim(), type: String(r.type || 'other'), blurb: String(r.blurb || '').trim(), area: String(r.area || '').trim() }))
    : []

  return NextResponse.json({ recs })
}
