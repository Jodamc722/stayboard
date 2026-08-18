// AI ON THE FURNITURE ORDER (Jon, 2026-08-18: "use AI to make it easier to digest — organized
// better, worded better... figure out nightstand types needed based on rooms... add a
// recommendation: we recommend this, nice to have, need to replace").
//
// POST { id, mode: 'organize' }              → classify every line into must / recommended / nice
//                                              with a one-line reason, and write an owner-readable
//                                              brief onto the order. Saves directly; the screen
//                                              reloads and the team can overrule any tier by tap.
// POST { id, mode: 'bedrooms', itemKey }     → for a per-bedroom item (nightstands, lamps), pick a
//                                              DISTINCT catalog product per bedroom slot — primary
//                                              gets the step-up, guest rooms the standard — with a
//                                              why per pick. Returns suggestions; nothing is
//                                              applied until a human taps Apply.
//
// DEGRADES WITHOUT A KEY, NEVER FAILS. Every mode has a deterministic fallback (keyword rules for
// tiers, price-ladder logic for bedroom picks, a computed template for the brief), so the buttons
// work on any deploy. The model's numbers are never trusted: totals in the brief are computed here
// and handed in; a hallucinated dollar figure cannot reach an owner.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { BEDROOM_NO } from '@/lib/ffe-checklist'
import { categoryForItem } from '@/lib/ffe-catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'
const str = (v: any) => (v == null ? '' : String(v))

async function anthropicJson(system: string, user: string, maxTokens = 4000): Promise<any | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : ''
    const m = /\{[\s\S]*\}/.exec(text)
    return m ? JSON.parse(m[0]) : null
  } catch { return null }
}

// ── DETERMINISTIC TIERING — the fallback, and the floor the model starts from ──────────────────
// The walk evidence carries the signal: what the walker WROTE beats any guess about the item.
const MUST_RE = /broken|crack|torn|rip|stain|damag|missing|unsafe|wobbl|mold|smell|burn|hole|shatter|peel|leak|no funciona|roto|rota|da[ñn]ad|manchad|falta/i
const NICE_RE = /upgrade|would be nice|optional|eventually|someday|style refresh|nice to have|si se puede/i
function ruleTier(l: any): { priority: string; reason: string } {
  const textBits = [l.note, l.walk_note, l.title, l.product].map(str).join(' ')
  if (MUST_RE.test(textBits)) return { priority: 'must', reason: 'Walk notes describe damage or a missing piece.' }
  if (l.answer === 'add' || /^x_/.test(str(l.item_key)) && NICE_RE.test(textBits)) {
    // an ADD is new capability, not a defect — recommended by default, nice if the note says so
  }
  if (NICE_RE.test(textBits)) return { priority: 'nice', reason: 'Flagged as an upgrade rather than a defect.' }
  if (str(l.answer) === 'add') return { priority: 'recommended', reason: 'Adding something the unit is missing.' }
  return { priority: 'recommended', reason: 'Flagged for replacement on the walk.' }
}

const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export async function POST(req: NextRequest) {
  const gate = await requireLevel('ffe', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const id = str(body.id).trim()
  const mode = str(body.mode)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const [{ data: ords }, { data: lines }] = await Promise.all([
      db.from('ffe_orders').select('*').eq('id', id).limit(1),
      db.from('ffe_order_lines').select('*').eq('order_id', id).limit(3000),
    ])
    const order = (ords || [])[0]
    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
    const rows = (lines || []) as any[]

    // The walk's notes ride along for classification (same live join the detail view uses).
    const walkBy: Record<string, any> = {}
    try {
      const lids = Array.from(new Set(rows.map(l => str(l.listing_id))))
      if (lids.length) {
        const { data: wa } = await db.from('ffe_answers')
          .select('listing_id,room,item_key,note,answer,photo_url').in('listing_id', lids).limit(20000)
        for (const a of ((wa || []) as any[])) walkBy[str(a.listing_id) + '|' + str(a.room) + '|' + str(a.item_key)] = a
      }
    } catch { /* fine */ }
    const withWalk = rows.map(l => {
      const w = walkBy[str(l.listing_id) + '|' + str(l.room) + '|' + str(l.item_key)] || {}
      return { ...l, walk_note: w.note || null, answer: w.answer || null, has_photo: !!w.photo_url }
    })

    // ── ORGANIZE: tier every line + write the brief ─────────────────────────────────────────
    if (mode === 'organize') {
      // Floor: rules. The model then refines WORDING and can move a line between tiers when the
      // note justifies it — but it only ever chooses among the three tiers we defined.
      const base: Record<string, { priority: string; reason: string }> = {}
      for (const l of withWalk) base[str(l.id)] = ruleTier(l)

      const compact = withWalk.slice(0, 400).map(l => ({
        id: str(l.id), unit: str(l.unit_name), item: str(l.title || l.product || l.item_key),
        qty: l.qty, cost: l.unit_cost, note: str(l.note || ''), walkNote: str(l.walk_note || ''),
        action: str(l.answer || 'replace'), start: base[str(l.id)].priority,
      }))
      const ai = await anthropicJson(
        'You classify furniture-order lines for a property manager and write a short owner-facing brief. ' +
        'Tiers: "must" = needs replacing (damage, missing, unusable); "recommended" = we recommend (worn, dated, below standard); ' +
        '"nice" = nice to have (upgrade, not a defect). Respect the walker\'s notes above all. ' +
        'Return STRICT JSON: {"lines":[{"id":"...","priority":"must|recommended|nice","reason":"<one plain sentence an owner understands>"}],' +
        '"brief":"<120-180 words, warm and plain, organized: what needs replacing now, what we recommend, what is nice to have. NO dollar totals — they are added separately.>"} ' +
        'Include every id you were given exactly once.',
        JSON.stringify({ order: { title: order.title, units: new Set(rows.map(r => r.listing_id)).size }, lines: compact }),
        8000,
      )

      const finalBy: Record<string, { priority: string; reason: string }> = { ...base }
      if (ai && Array.isArray(ai.lines)) {
        for (const x of ai.lines) {
          const k = str(x.id)
          if (finalBy[k] && ['must', 'recommended', 'nice'].includes(str(x.priority))) {
            finalBy[k] = { priority: str(x.priority), reason: str(x.reason || finalBy[k].reason).slice(0, 200) }
          }
        }
      }

      // Write tiers in chunks; a single failed row must not abandon the rest.
      const ids = Object.keys(finalBy)
      for (const k of ids) {
        await db.from('ffe_order_lines').update({
          priority: finalBy[k].priority, priority_reason: finalBy[k].reason, updated_at: new Date().toISOString(),
        }).eq('id', k)
      }

      // The brief: model wording + OUR arithmetic. Totals computed here, never by the model.
      const live = withWalk.filter(l => l.stage !== 'declined')
      const sum = (p: string) => live.filter(l => finalBy[str(l.id)]?.priority === p)
        .reduce((a, l) => a + (l.unit_cost == null ? 0 : Number(l.unit_cost) * (l.qty || 1)), 0)
      const cnt = (p: string) => live.filter(l => finalBy[str(l.id)]?.priority === p).length
      const totals = `Needs replacing: ${cnt('must')} item${cnt('must') === 1 ? '' : 's'} (${money0(sum('must'))}) · ` +
        `Recommended: ${cnt('recommended')} (${money0(sum('recommended'))}) · Nice to have: ${cnt('nice')} (${money0(sum('nice'))}).`
      const brief = (ai && str(ai.brief).trim()
        ? str(ai.brief).trim().slice(0, 1500)
        : 'This order covers ' + new Set(rows.map(r => r.listing_id)).size + ' units. The items marked "needs replacing" are damaged, missing or unusable and we would order them first. The "recommended" group is furniture that is worn or below the standard guests expect. "Nice to have" items are upgrades — good for the listing, but nothing is wrong with what is there today.'
      ) + '\n\n' + totals
      await db.from('ffe_orders').update({ ai_brief: brief }).eq('id', id)

      return NextResponse.json({ ok: true, classified: ids.length, brief })
    }

    // ── BEDROOMS: distinct styles per bedroom slot ───────────────────────────────────────────
    if (mode === 'bedrooms') {
      const itemKey = str(body.itemKey)
      if (!itemKey) return NextResponse.json({ error: 'itemKey required' }, { status: 400 })
      const fam = rows.filter(l => str(l.item_key) === itemKey && BEDROOM_NO[str(l.room)])
      const slots = Array.from(new Set(fam.map(l => BEDROOM_NO[str(l.room)]))).sort()
      if (slots.length < 2) return NextResponse.json({ error: 'This item only appears in one bedroom here.' }, { status: 400 })

      const category = categoryForItem(itemKey)
      const { data: prods } = await db.from('ffe_catalog')
        .select('id,code,name_en,category,unit_cost,dimensions,notes,tier')
        .eq('active', true).eq('category', category).limit(200)
      const pool = ((prods || []) as any[]).filter(p => p.unit_cost != null)
        .sort((a, b) => Number(a.unit_cost) - Number(b.unit_cost))
      if (pool.length < 2) return NextResponse.json({ error: 'Not enough catalog products in this category to vary by bedroom — add a couple more first.' }, { status: 400 })

      // Fallback ladder: primary gets the step-up, guest rooms share the solid middle. Distinct
      // products by construction; if the pool only holds 2, bedrooms 2 and 3 share on purpose.
      const mid = pool[Math.floor(pool.length / 2)]
      const upper = pool[Math.min(pool.length - 1, Math.floor(pool.length * 0.75))]
      const lower = pool[Math.max(0, Math.floor(pool.length / 2) - 1)]
      const fallback = slots.map(s => s === 1
        ? { bedroom: 1, catalogId: str(upper.id), why: 'Primary bedroom — the step-up piece guests photograph.' }
        : s === 2
          ? { bedroom: 2, catalogId: str(mid.id), why: 'Guest bedroom — the standard piece at the sensible price.' }
          : { bedroom: s, catalogId: str(lower.id !== mid.id ? lower.id : mid.id), why: 'Second guest bedroom — durable and simple.' })

      const ai = await anthropicJson(
        'You are picking furniture per bedroom for a short-term rental so the rooms read as designed, not identical. ' +
        'Bedroom 1 is the primary (step-up piece); guest bedrooms get distinct but coordinated picks. Only use the provided catalog ids. ' +
        'Return STRICT JSON: {"slots":[{"bedroom":1,"catalogId":"...","why":"<one sentence>"}]} with one entry per requested bedroom.',
        JSON.stringify({ item: itemKey, bedrooms: slots, catalog: pool.slice(0, 40).map(p => ({ id: str(p.id), code: p.code, name: p.name_en, cost: p.unit_cost, size: p.dimensions, tier: p.tier })) }),
        1500,
      )
      let picks = fallback
      if (ai && Array.isArray(ai.slots)) {
        const valid = ai.slots.filter((s: any) => slots.includes(Number(s.bedroom)) && pool.some(p => str(p.id) === str(s.catalogId)))
        if (valid.length === slots.length) picks = valid.map((s: any) => ({ bedroom: Number(s.bedroom), catalogId: str(s.catalogId), why: str(s.why).slice(0, 160) }))
      }

      // Hand back everything the client needs to show and apply: the pick, the product, the lines.
      const prodById: Record<string, any> = Object.fromEntries(pool.map(p => [str(p.id), p]))
      return NextResponse.json({
        ok: true,
        suggestions: picks.map(p => ({
          ...p,
          product: prodById[p.catalogId] ? { id: str(prodById[p.catalogId].id), code: prodById[p.catalogId].code, name: prodById[p.catalogId].name_en, cost: prodById[p.catalogId].unit_cost } : null,
          lineIds: fam.filter(l => BEDROOM_NO[str(l.room)] === p.bedroom).map(l => str(l.id)),
        })),
      })
    }

    return NextResponse.json({ error: 'unknown mode' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
