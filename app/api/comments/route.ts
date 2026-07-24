// SYSTEM-WIDE comments with @mentions -> in-app notifications. A comment attaches to any
// entity via (type, id); glitches are the first consumer. Mentioned teammates (picked in the
// UI or typed as @name in the text) get a notification; on glitches the creator does too.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function teamEmails(db: any): Promise<string[]> {
  const { data } = await db.from('app_users').select('email,status')
  return ((data || []) as any[])
    .filter(u => str(u.status).toLowerCase() !== 'disabled')
    .map(u => str(u.email).toLowerCase()).filter(Boolean)
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const type = str(req.nextUrl.searchParams.get('type'))
  const id = str(req.nextUrl.searchParams.get('id'))
  if (!type || !id) return NextResponse.json({ ok: false, error: 'type and id required.' }, { status: 400 })
  const db = supabaseAdmin()
  const { data, error } = await db.from('app_comments')
    .select('id,author_email,body,mentions,created_at')
    .eq('entity_type', type).eq('entity_id', id)
    .order('created_at', { ascending: true }).limit(100)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, comments: data || [], team: await teamEmails(db) })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = user.email.toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  const type = str(b.type); const id = str(b.id); const body = str(b.body).trim()
  if (!type || !id || !body) return NextResponse.json({ ok: false, error: 'type, id and body are required.' }, { status: 400 })
  const db = supabaseAdmin()
  const team = await teamEmails(db)
  // mentions: explicit picks + @tokens in the text matched against team email prefixes
  const picked = (Array.isArray(b.mentions) ? b.mentions : []).map((x: any) => str(x).toLowerCase()).filter((x: string) => team.includes(x))
  const tokens = Array.from(body.matchAll(/@([a-z0-9._-]+)/gi)).map(m => (m as any)[1].toLowerCase())
  const fromText = team.filter(t => tokens.some(tok => t.split('@')[0] === tok || t === tok))
  const mentions: string[] = Array.from(new Set<string>(picked.concat(fromText)))
  const { data: row, error } = await db.from('app_comments')
    .insert({ entity_type: type, entity_id: id, author_email: me, body: body.slice(0, 2000), mentions })
    .select('id,author_email,body,mentions,created_at').single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // notifications: mentioned teammates always; on glitches the creator hears about every comment
  const actorName = me.split('@')[0]
  const label = str(b.label) || type
  const link = type === 'glitch' ? '/glitches' : str(b.link) || null
  if (mentions.length) await notify(mentions, { kind: 'mention', title: actorName + ' tagged you: ' + label, body, link: link || undefined, actor: me })
  if (type === 'glitch') {
    try {
      const { data: g } = await db.from('glitches').select('created_by').eq('id', id).maybeSingle()
      const creator = str(g && g.created_by).toLowerCase()
      if (creator && creator !== me && !mentions.includes(creator) && team.includes(creator)) {
        await notify([creator], { kind: 'comment', title: actorName + ' commented: ' + label, body, link: link || undefined, actor: me })
      }
    } catch { /* best effort */ }
  }
  return NextResponse.json({ ok: true, comment: row, notified: mentions })
}
