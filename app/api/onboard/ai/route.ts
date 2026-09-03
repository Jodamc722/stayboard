// ONBOARDING — READ THE ROOM PHOTOS (Jon, 2026-09-03: "should have a photo add section and AI should
// add the details. It should then allow details to be added.")
//
// The walker photographs the room, taps "Read the photos", and Claude (vision) lists what it can see
// — every piece of furniture, appliance, decor and countable tableware, with a count, a condition
// guess and a size/brand when legible. We then MATCH that list against the room's checklist so the
// answer comes back as "set Dinner plates to 6 (list expects 12)" and "new: Bar cart ×1", ready for
// the walker to approve. This route only PROPOSES; `applyItems` on /api/onboard writes what was
// approved. Nothing is confirmed by a model.
//
// Same raw Anthropic call pattern as app/api/sentiment/scan/route.ts (no shared helper in the app).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CATEGORIES, CONDITIONS } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CODE_RE = /^[a-f0-9]{8,32}$/i
const str = (v: any) => (v == null ? '' : String(v)).trim()

// Jon, 2026-09-03: "Think big picture from the photos. Details would be more specific to the actual
// items in the kitchen, where a count of cups, plates, utensils, hangers will matter more." So the
// model names the furniture, appliances, lighting and decor it can see with a rough count, and for
// small countables it only says PRESENT — the walker counts those by hand.
const SYSTEM = `You are a short-term-rental onboarding inspector looking at photos of ONE room. Think big picture: name the furniture, appliances, electronics, lighting, decor and soft goods you can clearly see (sofa, TV, coffee table, floor lamp, bed, nightstands, dresser, fridge, stove, microwave, dining table, chairs, rug, curtains, mirror, wall art…) with a count for those. For small countable things — plates, bowls, glasses, mugs, cutlery, utensils, hangers, towels, pillows — do NOT count them: list them once with "count_by_hand": true so the walker counts them. Give a condition from: new, good, fair, worn. Never say "missing" — you cannot see what is absent. Read brand/model/size when legible ("Samsung 55in", "King"). Reply with strict minified JSON only, no prose, shape:
{"items":[{"name":"Sofa","qty":1,"condition":"good","category":"furniture","brand":"","notes":"","count_by_hand":false}],"room_notes":"one line: damage, wear, anything a photo shows that a list does not"}
Categories: furniture, appliance, electronics, kitchen, linen, decor, safety, other. Use the checklist's exact names when you see the same thing. At most 40 items.`

// ITEM MODE (Jon, 2026-09-03: "yes" to reading a single item photo — the appliance's model plate, the TV's
// size, the mattress tag). One object, one answer: brand, model, size, condition, a note.
const ITEM_SYSTEM = `You are reading ONE photo of a single item in a short-term-rental unit (an appliance, a TV, a piece of furniture, a mattress tag, a label). Identify it and read what is legible: brand, model number, size/dimensions/capacity, and its visible condition (new, good, fair, worn). If a label or plate is readable, transcribe it exactly. Reply with strict minified JSON only: {"name":"Refrigerator","brand":"Samsung","model":"RF28R7351SG","size":"28 cu ft, 36in","condition":"good","notes":"minor scuff on the door","confidence":"high|medium|low"}. Leave a field empty if you cannot read it — never guess a model number.`

const HAND = /plate|bowl|glass|mug|cup|fork|knife|knives|spoon|cutlery|flatware|utensil|hanger|towel|washcloth|pillowcase|sheet|napkin|placemat|coaster|container/i

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (o) return o
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m) { o = tryParse(m[1]); if (o) return o }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a >= 0 && b > a) return tryParse(raw.slice(a, b + 1))
  return null
}

const norm = (s: string) => str(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an|of|and|w|with|set|sets|pcs|pieces|x)\b/g, ' ').replace(/s\b/g, '').replace(/\s+/g, ' ').trim()
const tokens = (s: string) => new Set(norm(s).split(' ').filter(Boolean))
function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0
  let hit = 0; A.forEach(t => { if (B.has(t)) hit++ })
  const j = hit / new Set([...Array.from(A), ...Array.from(B)]).size
  if (norm(a) === norm(b)) return 1
  if (norm(a).includes(norm(b)) || norm(b).includes(norm(a))) return Math.max(0.75, j)
  return j
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const code = str(b.code).toLowerCase(); const roomId = str(b.roomId); const itemId = str(b.itemId)
  if (!CODE_RE.test(code) || !roomId) return NextResponse.json({ ok: false, error: 'code and roomId required' }, { status: 400 })
  const db = supabaseAdmin()
  const { data: unit } = await db.from('onboarding_units').select('id,status,name,details').eq('code', code).maybeSingle()
  if (!unit) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
  if (unit.status === 'archived') return NextResponse.json({ ok: false, error: 'This link has been closed.' }, { status: 410 })

  // ── one item ──
  if (itemId) {
    const { data: item } = await db.from('onboarding_items').select('id,name,brand,photo_url,category').eq('id', itemId).eq('unit_id', unit.id).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'item not found' }, { status: 404 })
    if (!item.photo_url) return NextResponse.json({ ok: false, error: 'Take a photo of the item first.' }, { status: 400 })
    let text = ''
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system: ITEM_SYSTEM, messages: [{ role: 'user', content: [
          { type: 'text', text: `The checklist calls this item "${item.name}"${item.brand && !['size', 'model'].includes(item.brand) ? ' (' + item.brand + ')' : ''}.` },
          { type: 'image', source: { type: 'url', url: item.photo_url } },
        ] }] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return NextResponse.json({ ok: false, error: 'AI: ' + (j?.error?.message || r.status) }, { status: 502 })
      text = (j.content || []).map((c: any) => c.text || '').join('')
    } catch (e: any) { return NextResponse.json({ ok: false, error: 'AI unreachable: ' + String(e?.message || e) }, { status: 502 }) }
    const p = parseJson(text)
    if (!p) return NextResponse.json({ ok: false, error: 'Could not read that photo — try closer, on the label.' }, { status: 502 })
    const brandBits = [str(p.brand), str(p.model), str(p.size)].filter(Boolean)
    const conds = CONDITIONS.map(c => c.key).filter(c => c !== 'missing')
    return NextResponse.json({ ok: true, item: { name: str(p.name).slice(0, 120), brand: brandBits.join(' · ').slice(0, 120), condition: conds.includes(p.condition) ? p.condition : null, notes: str(p.notes).slice(0, 300), confidence: str(p.confidence) || 'medium' } })
  }
  const [{ data: room }, { data: items }] = await Promise.all([
    db.from('onboarding_rooms').select('id,name,kind,photos').eq('id', roomId).eq('unit_id', unit.id).maybeSingle(),
    db.from('onboarding_items').select('id,name,qty,expected,condition,category,brand').eq('room_id', roomId).order('sort'),
  ])
  if (!room) return NextResponse.json({ ok: false, error: 'room not found' }, { status: 404 })
  const photos: string[] = (Array.isArray(room.photos) ? room.photos : []).map((p: any) => str(p?.url)).filter(Boolean).slice(-6)
  if (!photos.length) return NextResponse.json({ ok: false, error: 'Take a photo of the room first.' }, { status: 400 })

  const content: any[] = [{ type: 'text', text: `Room: ${room.name} (${room.kind}). Unit: ${unit.name}. The checklist for this room expects: ${(items || []).map((i: any) => i.name + (i.expected ? ' ×' + i.expected : '')).join('; ').slice(0, 1500)}. Use those exact names when you see the same thing.` }]
  for (const url of photos) content.push({ type: 'image', source: { type: 'url', url } })

  let text = ''
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2500, system: SYSTEM, messages: [{ role: 'user', content }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ ok: false, error: 'AI: ' + (j?.error?.message || r.status) }, { status: 502 })
    text = (j.content || []).map((c: any) => c.text || '').join('')
  } catch (e: any) { return NextResponse.json({ ok: false, error: 'AI unreachable: ' + String(e?.message || e) }, { status: 502 }) }
  const parsed = parseJson(text)
  if (!parsed || !Array.isArray(parsed.items)) return NextResponse.json({ ok: false, error: 'AI returned nothing usable — try a clearer, wider photo.' }, { status: 502 })

  const CONDS = CONDITIONS.map(c => c.key).filter(c => c !== 'missing')
  const CATS = CATEGORIES.map(c => c.key)
  const list = (items || []) as any[]
  const taken = new Set<string>()
  const matched: any[] = []; const unmatched: any[] = []; const seenByHand: any[] = []
  for (const raw of parsed.items.slice(0, 60)) {
    const name = str(raw.name).slice(0, 120); if (!name) continue
    const qty = Math.max(0, Math.min(999, Math.round(Number(raw.qty) || 1)))
    const condition = CONDS.includes(raw.condition) ? raw.condition : 'good'
    const category = CATS.includes(raw.category) ? raw.category : 'other'
    const brand = str(raw.brand).slice(0, 120); const notes = str(raw.notes).slice(0, 300)
    const byHand = raw.count_by_hand === true || HAND.test(name)
    let best: any = null, score = 0
    for (const it of list) { if (taken.has(it.id)) continue; const sc = similarity(name, it.name); if (sc > score) { score = sc; best = it } }
    if (best && score >= 0.5) {
      taken.add(best.id)
      if (byHand) seenByHand.push({ itemId: best.id, name: best.name, expected: best.expected })
      else matched.push({ itemId: best.id, listName: best.name, seenName: name, qty, expected: best.expected, currentQty: best.qty, currentCondition: best.condition, condition, brand: brand || null, notes: notes || null, score: Math.round(score * 100) / 100 })
    }
    else if (byHand) seenByHand.push({ itemId: null, name, expected: null })
    else unmatched.push({ name, qty, condition, category, brand: brand || null, notes: notes || null })
  }
  const notSeen = list.filter(i => !taken.has(i.id)).map(i => ({ itemId: i.id, name: i.name, expected: i.expected }))
  return NextResponse.json({ ok: true, photos: photos.length, matched, unmatched, seenByHand, notSeen, roomNotes: str(parsed.room_notes).slice(0, 600) || null })
}
