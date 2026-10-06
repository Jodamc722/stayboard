// ONE MESSAGE AS GUESTY SENT IT (Jon, 2026-10-06: "more real raw data"). The thread shows our
// reading of each post — who, which channel, template or person. This is the post itself, the
// payload Guesty returned, for when our reading needs checking.
//   GET /api/messages/raw?id=<message id>
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('id') || '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const { data } = await supabaseAdmin().from('guesty_messages').select('id,conversation_id,sender,sender_name,module,is_automated,sent_at,synced_at,raw').eq('id', id).maybeSingle()
  if (!data) return NextResponse.json({ ok: false, error: 'Not in our copy.' }, { status: 404 })
  return NextResponse.json({ ok: true, message: data })
}
