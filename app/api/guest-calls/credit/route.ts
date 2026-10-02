// WHO GETS THE CREDIT FOR A CALL THE PHONE SYSTEM CLOSED (Jon, 2026-10-02: "if it was completed via
// Talkroute through the app, it should have a space to add the user that called it to get credit").
//
// Talkroute proves an outbound call happened but names nobody — the log reads called_by 'Talkroute'
// until a person is put on it. This writes that person. It touches only the credit: the outcome,
// the Guesty field, the attempts and the note stay exactly as they are, and a call that has not
// been completed cannot be credited (credit is for work done, not a way to mark it done).
//
// The name is free text (a new starter is never blocked by a list), defaulting to the signed-in
// person; the system's own name and e-mail addresses are refused as names, as on the desk.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { signedInName } from '@/lib/caller-name'
import { isCompleted } from '@/lib/call-desk'
import { bustDay } from '@/lib/bust'

export const dynamic = 'force-dynamic'

const KINDS = ['welcome', 'post_checkout'] as const

export async function POST(req: Request) {
  const gate = await requireLevel('welcome-calls', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const reservationId = String(body?.reservationId || '')
  const kind = (KINDS as readonly string[]).includes(String(body?.kind)) ? String(body.kind) : 'welcome'
  if (!reservationId) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })

  const sb = supabaseAdmin()
  const me = await signedInName(sb, String(user.email || ''))
  const typed = String(body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const name = typed || me
  if (name.toLowerCase() === 'talkroute' || name.indexOf('@') >= 0) return NextResponse.json({ error: 'Credit goes to a person — pick or type a name.' }, { status: 400 })

  const { data: prev, error: e0 } = await sb.from('guest_calls').select('outcome,called_by').eq('reservation_id', reservationId).eq('kind', kind).maybeSingle()
  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 })
  if (!prev || !isCompleted((prev as any).outcome)) return NextResponse.json({ error: 'That call is not completed yet — log it first, then credit it.' }, { status: 409 })

  const self = name === me
  const { error } = await sb.from('guest_calls')
    .update({ called_by: name, ...(self ? { caller_email: String(user.email || '').toLowerCase() } : {}) })
    .eq('reservation_id', reservationId).eq('kind', kind)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  bustDay()
  return NextResponse.json({ ok: true, by: name, was: String((prev as any).called_by || ''), creditedBy: me })
}
