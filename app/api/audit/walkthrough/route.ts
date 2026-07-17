// Walkthrough parse - dictated walk -> organized items with routing, auto-tags + photo prompts.
// Quality = improvements only (fix / replace / add / clean). Onboarding = inventory + ops-fact FAQ.
// Tags come from a learning taxonomy (tag_taxonomy table, seeded below): known words auto-attach,
// new furniture/appliance types come back flagged isNew and join the taxonomy once kept+saved.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SEED_TAGS = ['Smart TV', 'TV', 'Coffee maker', 'Espresso machine', 'Keurig', 'Blender', 'Toaster', 'Microwave', 'Air fryer', 'Dishwasher', 'Washer', 'Dryer', 'Refrigerator', 'Oven', 'Stove', 'King bed', 'Queen bed', 'Full bed', 'Twin bed', 'Sofa bed', 'Bunk bed', 'Sofa', 'Sectional', 'Dining table', 'Dining chairs', 'Bar stools', 'Nightstand', 'Dresser', 'Desk', 'Mattress', 'Headboard', 'Coffee table', 'TV stand', 'Rug', 'Curtains', 'Blinds', 'Lamp', 'Light bulbs', 'Ceiling fan', 'AC unit', 'Thermostat', 'Smart lock', 'Safe', 'Iron', 'Hair dryer', 'Vacuum', 'Cooking utensils', 'Knife set', 'Cookware', 'Dinnerware', 'Glassware', 'Patio furniture', 'Grill', 'Crib', 'High chair', 'Mirror', 'Shower head', 'Vanity']

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
  let taxonomy: string[] = []
  try { const t = await db.from('tag_taxonomy').select('name').eq('approved', true).limit(400); taxonomy = (t.data || []).map((x: any) => String(x.name)).filter(Boolean) } catch {}
  for (const s of SEED_TAGS) { let have = false; for (const t of taxonomy) if (t.toLowerCase() === s.toLowerCase()) have = true; if (!have) taxonomy.push(s) }
  const TAGRULES = ' photo = a short request for the ONE photo that would help act on this item, max 8 words (example: Photo of the bulb type), or empty if a photo adds nothing. tags = item-type tags for any furniture, appliance, bed size or amenity the point mentions - use EXACT names from the TAG LIST when one matches; if the thing is clearly a trackable furniture or appliance type not on the list, add a short 1-3 word tag for it anyway. Max 3 tags per item, empty array if none.'
  const OSYS = 'You turn a property manager walkthrough dictation into structured onboarding capture for a short-term rental unit. Each spoken point becomes ONE item with room, kind, title, note, photo, tags. kind is one of: inventory (a thing the unit has - bed, TV, appliance - put brand or size detail in note), faq (an operations fact or how-to a team member or guest would ask about - breaker box location, water shut-off, filter size, how an appliance works - title = the thing, note = the answer or steps). Pick room from the provided list when it matches, else use the spoken name, else General.' + TAGRULES + ' Do not invent items. STRICT JSON ONLY, no markdown: {"items":[{"room":"","kind":"","title":"","note":"","photo":"","tags":[""]}]}'
  const SYS = 'You turn a property manager walkthrough dictation into a clean improvement list for a short-term rental unit. Quality walks are about IMPROVEMENTS - things that need to be fixed, altered, changed, cleaned, replaced or added. This is NOT an inventory check. Each spoken point becomes ONE item with room, kind, title, note, photo, tags. kind is one of: maintenance (fix, repair, touch-up, look at), replace (swap or upgrade an existing thing), add (buy or add something new, including need-more-of-something), clean (a cleanliness or housekeeping issue - stains, dust, odor, dirty or sticky items). Pick room from the provided room list when it matches; if the point names a room not in the list use that spoken name; if no room is clear use General. title = short imperative task, max 10 words. note = extra detail from the dictation, else empty.' + TAGRULES + ' Do not invent tasks. STRICT JSON ONLY, no markdown: {"items":[{"room":"","kind":"","title":"","note":"","photo":"","tags":[""]}]}'
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 2000, system: mode === 'onboarding' ? OSYS : SYS, messages: [{ role: 'user', content: 'TAG LIST: ' + taxonomy.join(', ') + '. Rooms in this unit: ' + (rooms.join(', ') || 'unknown - rooms come from the dictation') + '. Dictation: ' + transcript }] }) })
    const j = await r.json()
    const text = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    const KINDS = mode === 'onboarding' ? ['inventory', 'faq'] : ['maintenance', 'replace', 'add', 'clean']
    const known: Record<string, string> = {}
    for (const t of taxonomy) known[t.toLowerCase()] = t
    const items = (parsed && Array.isArray(parsed.items) ? parsed.items : []).slice(0, 30).map((x: any) => {
      const tags = (Array.isArray(x.tags) ? x.tags : []).map((t: any) => String(t || '').trim().slice(0, 60)).filter(Boolean).slice(0, 3).map((t: string) => { const k = known[t.toLowerCase()]; return { name: k || t, isNew: !k } })
      return { room: String(x.room || 'General').slice(0, 80), kind: KINDS.includes(String(x.kind)) ? String(x.kind) : KINDS[0], title: String(x.title || '').slice(0, 160), note: String(x.note || '').slice(0, 400), photo: String(x.photo || '').slice(0, 120), tags }
    }).filter((x: any) => x.title)
    return NextResponse.json({ ok: true, items })
  } catch { return NextResponse.json({ error: 'parse failed' }, { status: 500 }) }
}
