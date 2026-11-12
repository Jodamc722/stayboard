// A PHOTO OR FILE A GUEST SENT, OPENED FROM THE THREAD (Jon, 2026-11-12: "Photos & files").
//   GET ?c=<conversation id>&k=<the post's attachmentURL>  → 302 to a short-lived download link Guesty mints
//
// Guesty keeps message attachments private; the post carries a key (attachments[].attachmentURL) and
// GET /communication/conversations/get-attachments?keys[]=… turns it into a temporary link. The link is never
// stored — every view asks again, so nothing here outlives Guesty's own expiry. Gated on view access to Messages,
// and only a key that one of our cached messages in that conversation carries is minted (no fishing for files).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestyGet } from '@/lib/guesty'

export const dynamic = 'force-dynamic'

/** The first http(s) link anywhere in Guesty's answer — its shape is not documented beyond "temporary links". */
function firstLink(v: any, depth = 0): string {
  if (depth > 6 || v == null) return ''
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? v : ''
  if (Array.isArray(v)) { for (const x of v) { const l = firstLink(x, depth + 1); if (l) return l } return '' }
  if (typeof v === 'object') { for (const k of Object.keys(v)) { const l = firstLink(v[k], depth + 1); if (l) return l } }
  return ''
}

export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view'); if (!g.ok) return g.res
  const k = String(req.nextUrl.searchParams.get('k') || '').trim()
  const c = String(req.nextUrl.searchParams.get('c') || '').trim()
  if (!k || k.length > 1000 || !c) return NextResponse.json({ ok: false, error: 'k and c required' }, { status: 400 })
  const { data } = await supabaseAdmin().from('guesty_messages').select('attachments').eq('conversation_id', c).not('attachments', 'is', null).limit(500)
  const needle = JSON.stringify(k).slice(1, -1)
  const known = (data || []).some((r: any) => JSON.stringify(r.attachments || '').indexOf(needle) >= 0)
  if (!known) return NextResponse.json({ ok: false, error: 'That file is not on this conversation.' }, { status: 404 })
  try {
    const r = await guestyGet<any>('/communication/conversations/get-attachments?keys[]=' + encodeURIComponent(k))
    const link = firstLink(r)
    if (!link) return NextResponse.json({ ok: false, error: 'Guesty returned no link for that file.' }, { status: 502 })
    return NextResponse.redirect(link, { status: 302, headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 502 })
  }
}
