// AI revisions on a finished guidebook — "make the about section shorter", "mention the rooftop
// pool", "change quiet hours to 10 PM". Sends the current sections + the request to the model,
// merges the revised sections back (internal _keys and photo assignments are preserved).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-opus-4-8'

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (!o) o = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.search(/[[{]/); const b = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']')); if (a !== -1 && b > a) o = tryParse(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  const prompt = String(body?.prompt || '').slice(0, 2000).trim()
  if (!id || !prompt) return NextResponse.json({ error: 'id and prompt required' }, { status: 400 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const db = supabaseAdmin()
  const { data } = await db.from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const sections = gb.sections || {}
  // The model edits only visible content — internal keys (photos, assignments, toggles) stay ours.
  const visible: Record<string, any> = {}
  for (const [k, v] of Object.entries(sections)) if (!k.startsWith('_')) visible[k] = v

  const SYSTEM = `You are the editor of a luxury guest guidebook for Stay Hospitality. You receive the guidebook's current content as JSON and one revision request. Apply the request faithfully and elegantly.
RULES:
1. Return the COMPLETE revised JSON — same top-level keys and shapes as given. Execute the request FULLY: if it asks for changes across many items, update every single one — no partial work. Change nothing the request doesn't touch.
2. Keep the polished, warm, editorial voice. ACCURACY IS EVERYTHING: never invent facts, codes, addresses, phone numbers, or operating steps. When the request supplies instructions or facts, treat them as the source of truth and preserve every concrete detail (buttons, modes, warnings, fees). If you are not certain a model-specific detail is true, write the generic-but-correct version rather than a specific-but-wrong one.
3. Respect page limits: about.body 50-80 words; guidelines <= 5 items; special 2-4 groups of 2-4 short items; local/restaurant notes 6-12 words; beforeYouGo <= 5 items; houseGuide up to 8 items, 40-70 words each of clear step-by-step guest instructions.
4. "omit" lists section keys that are hidden — the request may ask you to add/remove keys from it (valid keys: retreat, special, host, houseGuide, gettingThere, gettingAround, addons).
5. STRICT minified JSON only. No markdown, no commentary.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000, system: SYSTEM,
        messages: [{ role: 'user', content: `CURRENT GUIDEBOOK CONTENT:\n${JSON.stringify(visible)}\n\nREVISION REQUEST:\n${prompt}` }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ error: 'AI error: ' + (d?.error?.message || r.status) }, { status: 502 })
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
    const revised = parseJson(text)
    if (!revised || !revised.cover) return NextResponse.json({ error: 'AI returned an unusable revision — try rephrasing the request.' }, { status: 502 })

    // Merge: revised visible content over existing, internal _keys carried forward untouched.
    const next: Record<string, any> = { ...sections, ...revised }
    for (const [k, v] of Object.entries(sections)) if (k.startsWith('_')) next[k] = v

    const { error } = await db.from('guidebooks').update({ sections: next, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, sections: next })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
