// DRAFT THE PROPERTY'S OWN WORDS.
//
// Jon, 2026-09-16: "make sure there's AI integration".
//
// WHY THIS IS A BETTER AI JOB THAN THE PER-LISTING OPTIMIZER, not a copy of it. /api/optimize-listing
// writes about one home — its rooms, its photos, its bed count — and the three sections here are not
// about a home at all. Guest access is the lobby. Neighborhood is the block. Getting around is the
// rideshare corner. Those are BUILDING facts, and the building facts in lib/building-facts were
// written and checked by staff, which makes them the one source the model is allowed to be specific
// from. So a property-level draft is grounded in exactly the material these sections need, and the
// per-unit noise that makes the same paragraph come out eleven different ways is simply absent.
//
// It reads what the property's units already say and is told to keep whatever is true in them. The
// existing copy is thirty units' worth of institutional knowledge; throwing it away to write
// something prettier would be a downgrade dressed as an improvement.
//
// Draft only. Nothing here reaches Guesty — a person reads it, edits it, and pushes it from the
// panel, which is the same shape as every other AI write in this app.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildingFactsFor, factsPrompt } from '@/lib/building-facts'
import { HONESTY } from '@/lib/listing-rules'
import { loadListingAi } from '@/lib/listing-ai-server'
import { sectionRules, bannedRule } from '@/lib/listing-ai'
import { modelFor } from '@/lib/ai-models'
import { rollupBuilding } from '@/lib/optimize-score'
import { pageRows } from '@/lib/db-page'
import { norm, sectionOf, allowedAt, type BulkSectionKey, type BulkScope } from '@/lib/listing-copy-bulk'
import { aiFetch } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const SAMPLE_UNITS = 8        // enough to see what the building already says without paying for 32

function parseJson(t: string): any {
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try { return JSON.parse(t.slice(s, e + 1)) } catch { return null }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const building = norm(body?.building)
  const want: BulkSectionKey[] = Array.isArray(body?.sections)
    ? body.sections.filter((k: any) => !!sectionOf(k))
    : []
  const steer = norm(body?.instruction).slice(0, 600)
  // PER-SECTION PROMPTS. Jon, 2026-09-16: "Have a prompt feature, too." One box for the whole draft
  // is not enough when the sections are this different — "mention the new garage" belongs to Getting
  // around and nowhere else, and pasting it into a shared box makes it leak into Neighborhood.
  const perSection: Partial<Record<BulkSectionKey, string>> = {}
  if (body?.prompts && typeof body.prompts === 'object') {
    for (const [k, v] of Object.entries(body.prompts)) {
      if (sectionOf(k) && typeof v === 'string' && norm(v)) perSection[k as BulkSectionKey] = norm(v).slice(0, 600)
    }
  }
  if (!want.length) return NextResponse.json({ error: 'Name at least one section to draft.' }, { status: 400 })

  const scope: BulkScope = body?.scope === 'portfolio' ? 'portfolio' : 'property'
  const wrong = want.filter(k => !allowedAt(k, scope))
  if (wrong.length) return NextResponse.json({ error: wrong.map(k => sectionOf(k)!.label).join(', ') + ' can only be drafted for one property at a time.' }, { status: 400 })
  if (!building && scope === 'property') return NextResponse.json({ error: 'building required' }, { status: 400 })

  const sb = supabaseAdmin()
  const cfg = await loadListingAi()

  // What this property's units say today — the draft is a consolidation of these, not a replacement.
  let existing: { name: string; text: Partial<Record<BulkSectionKey, string>> }[] = []
  let facts = ''
  let place = ''     // WHERE THIS BUILDING ACTUALLY IS
  if (building) {
    const { rows } = await pageRows<any>((a, b) => sb.from('guesty_listings')
      .select('id, title, nickname, building, status, raw').order('id').range(a, b), 12)
    const units = (rows || []).filter((r: any) =>
      DEAD.indexOf(String(r.status || '').toLowerCase()) < 0 &&
      rollupBuilding(r.building, r.nickname || r.title).toLowerCase() === building.toLowerCase())
    if (!units.length) return NextResponse.json({ error: 'No live listings found for that property.' }, { status: 404 })

    // Prefer the units that actually have something to say — a sample of eight blanks teaches
    // the model nothing.
    const scored = units.map((u: any) => {
      const p = (u.raw?.publicDescription && typeof u.raw.publicDescription === 'object') ? u.raw.publicDescription : {}
      const text: Partial<Record<BulkSectionKey, string>> = {}
      for (const k of want) text[k] = norm(p[k])
      const filled = Object.values(text).filter(Boolean).length
      return { name: String(u.nickname || u.title || u.id), text, filled }
    }).sort((a, b) => b.filled - a.filled)
    existing = scored.filter(x => x.filled > 0).slice(0, SAMPLE_UNITS)

    const f = await buildingFactsFor({ building: units[0].building, nickname: units[0].nickname, title: units[0].title })
    facts = factsPrompt(f)

    // THE ADDRESS, WHICH IS THE POINT OF THESE TWO SECTIONS. Jon, 2026-09-16: "Getting around should
    // be able to generate it based on location. Location: same thing."
    //
    // The verified building facts in lib/building-facts only exist for buildings somebody has
    // written a guide for — most have none, and those are exactly the properties sitting blank.
    // Guesty knows where every one of them is, so the address goes in every time and a model that
    // knows Fort Lauderdale can say something true about the block without inventing a café.
    // Addresses are agreed across the units of a building; the one the most units share wins, so a
    // single mistyped unit cannot move the whole property.
    const tally: Record<string, { n: number; a: any }> = {}
    for (const u of units) {
      const a = (u.raw?.address && typeof u.raw.address === 'object') ? u.raw.address : null
      const k = norm(a?.full || a?.street || '')
      if (!k) continue
      if (tally[k]) tally[k].n++; else tally[k] = { n: 1, a }
    }
    const best = Object.values(tally).sort((x, y) => y.n - x.n)[0]?.a
    if (best) {
      const L: string[] = ['WHERE THIS PROPERTY IS']
      const full = norm(best.full)
      if (full) L.push('- Address: ' + full)
      else {
        const bits = [norm(best.street), norm(best.city), norm(best.state), norm(best.zipcode || best.zip)].filter(Boolean)
        if (bits.length) L.push('- Address: ' + bits.join(', '))
      }
      const nb = norm(best.neighborhood)
      if (nb) L.push('- Neighbourhood as Guesty has it: ' + nb)
      const lat = Number(best.lat), lng = Number(best.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) L.push('- Coordinates: ' + lat.toFixed(5) + ', ' + lng.toFixed(5))
      L.push('You may use general, durable knowledge of this area — the kind of neighbourhood it is, which')
      L.push('way the water or the highway lies, that an airport is a drive rather than a walk. You may NOT')
      L.push('name a specific business, quote a distance in minutes or blocks, or claim a transit stop exists')
      L.push('unless it appears in the verified facts or in what the units already say. A guest checks these')
      L.push('on arrival, and a confident invented detail is worse than a plain true sentence.')
      place = L.join('\n')
    }
  }

  const specs = want.map(k => {
    const s = sectionOf(k)!
    const c = (cfg.sections as any)[k]
    const ask = perSection[k] ? ` THE PERSON ASKED, FOR THIS SECTION ONLY: ${perSection[k]}` : ''
    const how = k === 'notes'
      // Jon: "Other things to note could be kind of generic, based on what's currently there."
      ? ' Build it from what the listings already say. Keep it general and durable — the things that stay true next season — and leave out anything tied to one unit or one date.'
      : (k === 'transit' || k === 'neighborhood')
        ? ' Work from where this property actually is, plus the verified facts and what the units already say.'
        : ''
    return `- "${k}" (${s.label}): ${s.hint}${how}${c ? ' ' + sectionRules(c) : ''} Hard limit ${s.max} characters.${ask}`
  }).join('\n')

  const scopeNote = scope === 'portfolio'
    ? `This text goes on EVERY listing in the portfolio, across different buildings and neighbourhoods. Write nothing that is true of only one building, one city or one unit — no addresses, no distances, no building names, no bed counts. If you cannot say it about every property we manage, leave it out.`
    : `This text goes on EVERY unit in ${building} and on no other property. Write about the BUILDING and its block — the lobby, the entry, the elevator, the street, the walk, the parking, the transit. Never describe a particular unit: no floor numbers, no bed counts, no views from a specific line, nothing that is true of 2201 and false of 2202. A guest in any unit in this building must read it and find it accurate.`

  const SYSTEM = `${cfg.voice}

${HONESTY}

${bannedRule(cfg) ? bannedRule(cfg) + '\n' : ''}
${scopeNote}

WHAT IS ALREADY WRITTEN IS EVIDENCE, NOT A DRAFT TO BEAT. The text below was written by people who
have stood in this building. Keep every concrete, checkable thing in it — a door, a corner, a
distance, a name, a rule. You are consolidating many versions of the same truth into one, not
inventing a better-sounding version. If two units disagree on a fact, keep the more specific one and
do not split the difference. If nothing in the existing text covers a section, write the plainest
true thing you can from the verified facts and stop — a short honest paragraph beats a long invented
one, and a person is about to read this before it goes live.

Return ONLY JSON: {${want.map(k => `"${k}":"..."`).join(',')},"rationale":"one or two sentences on what you kept and why"}`

  const USER = [
    building ? `PROPERTY: ${building} (${existing.length ? existing.length + ' units sampled' : 'no existing text found'})` : 'SCOPE: the whole portfolio',
    place ? '\n' + place : '',
    facts ? '\n' + facts : '',
    existing.length ? '\nWHAT THE UNITS SAY TODAY:\n' + existing.map(u =>
      `· ${u.name}\n` + want.filter(k => u.text[k]).map(k => `  [${sectionOf(k)!.label}] ${u.text[k]}`).join('\n')).join('\n\n') : '',
    '\nSECTIONS TO WRITE:\n' + specs,
    steer ? `\nTHE PERSON ASKED FOR: ${steer}` : '',
  ].filter(Boolean).join('\n')

  try {
    const r = await aiFetch('listing-copy', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await modelFor('listing-copy'),
        max_tokens: 1600,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
    const text = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    const parsed = parseJson(text)
    if (!parsed) return NextResponse.json({ error: 'The model returned something unreadable — try again.' }, { status: 502 })

    const sections: Record<string, string> = {}
    for (const k of want) {
      const v = norm(parsed[k])
      if (v) sections[k] = v.slice(0, sectionOf(k)!.max)
    }
    if (!Object.keys(sections).length) return NextResponse.json({ error: 'The model returned no usable text.' }, { status: 502 })

    return NextResponse.json({
      ok: true, building: building || null, sections,
      rationale: norm(parsed.rationale),
      sampled: existing.length,
      grounded: !!facts,
      located: !!place,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
