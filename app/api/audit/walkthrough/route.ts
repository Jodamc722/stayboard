import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const transcript = String(body.transcript || '').slice(0, 6000)
  if (!code || !transcript.trim()) return NextResponse.json({ error: 'code and transcript required' }, { status: 400 })
  const db = supabaseAdmin()
  const { data: audits } = await db.from('property_audits').select('id').eq('share_code', code).limit(1)
  if (!audits || !audits[0]) return NextResponse.json({ error: 'audit not found' }, { status: 404 })
  const rooms: string[] = Array.isArray(body.rooms) ? body.rooms.slice(0, 40).map((x: any) => String(x || '').slice(0, 80)) : []
  const mode = String(body.mode || 'quality')
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, items: [], note: 'no ai key' })
  const OSYS = 'You turn a property manager walkthrough dictation into structured onboarding capture for a short-term rental unit. Each spoken point becomes ONE item with room, kind, title, note. kind is one of: inventory (a thing the unit has - bed, TV, appliance - put brand or size detail in note), faq (an operations fact or how-to a team member or guest would ask about - breaker box location, water shut-off, filter size, how an appliance works - title = the thing, note = the answer or steps). Pick room from the provided list when it matches, else use the spoken name, else General. Do not invent items. STRICT JSON ONLY, no markdown: {"items":[{"room":"","kind":"","title":"","note":""}]}'
  const SYS = 'You turn a property manager walkthrough dictation into a clean task list for a short-term rental unit. Each spoken point becomes ONE item with room, kind, title, note. kind is one of: maintenance (fix, repair, touch-up, look at), replace (swap or upgrade an existing thing), add (buy or add something new). Pick room from the provided room list when it matches; if the point names a room not in the list use that name; if no room is clear use General. title = short imperative task, max 10 words. note = extra detail from the dictation, else empty. Do not invent tasks. STRICT JSON ONLY, no markdown: {"items":[{"room":"","kind":"","title":"","note":""}]}'
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1500, system: mode === 'onboarding' ? OSYS : SYS, messages: [{ role: 'user', content: 'Rooms in this unit: ' + (rooms.join(', ') || 'unknown') + '. Dictation: ' + transcript }] }) })
    const j = await r.json()
    const text = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    const KINDS = mode === 'onboarding' ? ['inventory', 'faq'] : ['maintenance', 'replace', 'add']
    const items = (parsed && Array.isArray(parsed.items) ? parsed.items : []).slice(0, 30).map((x: any) => ({ room: String(x.room || 'General').slice(0, 80), kind: KINDS.includes(String(x.kind)) ? String(x.kind) : KINDS[0], title: String(x.title || '').slice(0, 160), note: String(x.note || '').slice(0, 400) })).filter((x: any) => x.title)
    return NextResponse.json({ ok: true, items })
  } catch { return NextResponse.json({ error: 'parse failed' }, { status: 500 }) }
}
