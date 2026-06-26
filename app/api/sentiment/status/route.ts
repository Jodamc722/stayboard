// Close out (or reopen) a guest conversation in the sentiment queue. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const id = typeof body?.conversationId === 'string' ? body.conversationId : ''
  const next = body?.status === 'open' ? 'open' : 'closed'
  if (!id) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

  const sb = supabaseAdmin()
  const patch: any = next === 'closed'
    ? { status: 'closed', closed_at: new Date().toISOString(), closed_by: user.email || user.id }
    : { status: 'open', closed_at: null, closed_by: null }
  const { error } = await sb.from('guesty_conversation_sentiment').update(patch).eq('conversation_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: next })
}
