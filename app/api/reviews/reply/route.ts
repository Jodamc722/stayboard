// Post a host reply to a Guesty review. PUT /reviews/{id}/reply { reviewReply }.
// Uses the shared cached Guesty token. Requires a logged-in user (the human approves each post).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { reviewId, reviewReply } = await req.json().catch(() => ({} as any))
  if (!reviewId || !reviewReply || !String(reviewReply).trim()) {
    return NextResponse.json({ error: 'reviewId and reviewReply are required' }, { status: 400 })
  }

  const sb = supabaseAdmin()
  const { data: tok } = await sb
    .from('guesty_tokens')
    .select('access_token, expires_at')
    .eq('id', 'singleton')
    .maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now())
  if (!valid) return NextResponse.json({ error: 'Guesty token is refreshing - try again in a moment.' }, { status: 503 })

  const r = await fetch(`${BASE}/reviews/${encodeURIComponent(reviewId)}/reply`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tok!.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reviewReply: String(reviewReply) })
  })
  const body = await r.text().catch(() => '')
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${body.slice(0, 200)}` }, { status: 502 })

  // Persist locally so it shows immediately and review counts stay accurate. Also mirror the
  // reply into raw.hostResponse, because the listing page derives "replied" from raw (not the
  // reply column) - this makes the unit page reflect the reply right after posting and on reload.
  try {
    const { data: row } = await sb.from('guesty_reviews').select('raw').eq('id', reviewId).maybeSingle()
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    const newRaw = { ...raw, hostResponse: String(reviewReply) }
    await sb.from('guesty_reviews').update({ reply: String(reviewReply), has_reply: true, raw: newRaw }).eq('id', reviewId)
  } catch {
    await sb.from('guesty_reviews').update({ reply: String(reviewReply), has_reply: true }).eq('id', reviewId)
  }

  return NextResponse.json({ ok: true, reply: String(reviewReply) })
}
