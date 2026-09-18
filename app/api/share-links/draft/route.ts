// DESCRIBE THE LINK YOU NEED (Jon, 2026-09-18: "have a prompt for creating one").
//
// One model call, one forced tool call, and the answer is a FILLED-IN FORM the person reviews and
// clicks Create on — the model never writes a row. The tool schema pins kind and audience to the
// real enums, and the prompt carries the real building / vendor / market / owner names so "the
// Pompano cleaners" resolves to a building that exists rather than a spelling that does not. When
// the model or the key is missing, the hub falls back to the normal form.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, canSeeMoney } from '@/lib/access'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelPairFor } from '@/lib/ai-models'
import { MARKETS } from '@/lib/segments'
import { AUDIENCES, CREATABLE_KINDS, KIND_LABEL, VENDOR_LABEL, FIXED_CODE_KINDS } from '@/lib/share-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))

const KIND_GUIDE: Record<string, string> = {
  'vendor-board': 'a vendor cleaning crew\'s board for one of the four vendor-serviced properties (Botanica, Park Towers, Amrit/Capri/Lucerne, Salato front desk): today and tomorrow\'s turns, door codes, no guest names. scope.vendor is required; scope.buildings can narrow it.',
  scheduler: 'the team scheduler for OUR in-house cleaners in one market (Miami, Broward, North, or All): they assign the week and submit. scope.market required; scope.viewOnly for a read-only copy.',
  'field-board': 'a LIVE field board for our crew or a lead: today\'s priorities, units in ops, crew on shift, cleans, arrivals, vacant units, work, issues, requests; scoped to a market, building, owner, units or the portfolio. Use scope.sections with those keys.',
  parking: 'a parking garage vendor\'s board: upcoming stays in scope and a QR upload per stay. Scoped like a field board.',
  'day-sheet': 'the mobile day sheet (/day) — arrivals, departures, cleans and who clocked in. ONE fixed page; scope.market pins it to a market. Only describe it; the existing row is edited, not duplicated.',
  delivery: 'the delivery log (/delivery). One fixed page.',
  'orders-live': 'today\'s guest orders for the field team (/orders-live). One fixed page.',
  marketing: 'the direct-bookings report for a marketing partner (/report/marketing). One fixed page; scope.from / scope.to can pin a date range, scope.showMoney=false hides dollars.',
  'owner-audit': 'the owner statement audit for a reviewer (/report/owner-audit). One fixed page.',
  botanica: 'the Botanica performance report for the hotel GM (/report/botanica). One fixed page.',
  'custom-page': 'a custom live REPORT (reservations, revenue & ADR, booking sources, audience counts, contact list, cleaning & tasks, verification, notes, weekly cleaning planner "team", weekly maintenance planner "team_maint") scoped to a market, building, owner, units or the portfolio. Use scope.sections with those keys; showMoney / guestNames / windowDays as asked.',
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('share-links', 'edit')
  if (!gate.ok) return gate.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'AI is not configured (ANTHROPIC_API_KEY missing).' }, { status: 400 })
  const body = await req.json().catch(() => ({} as any))
  const text = str(body.text).trim().slice(0, 1200)
  if (text.length < 4) return NextResponse.json({ ok: false, error: 'Say what the link is for.' }, { status: 400 })

  // THE REGISTRY the model may choose from — real names, so the draft can only point at things
  // that exist. Names only: no ids, no money, no guest data.
  const db = supabaseAdmin()
  const [{ data: listings }, { data: owners }] = await Promise.all([
    db.from('guesty_listings').select('nickname, title, building, status').limit(2000),
    db.from('guesty_owners').select('full_name').limit(500),
  ])
  const active = ((listings || []) as any[]).filter(l => str(l.status).toLowerCase() !== 'inactive')
  const buildings = Array.from(new Set(active.map(l => str(l.building)).filter(Boolean))).sort()
  const units = active.map(l => str(l.nickname || l.title)).filter(Boolean).slice(0, 300)
  const ownerNames = ((owners || []) as any[]).map(o => str(o.full_name)).filter(Boolean).slice(0, 120)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date())

  const tool = {
    name: 'draft_share_link',
    description: 'The filled-in share-link form for the person to review. Never invent a building, unit, owner, vendor or market that is not in the registry.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: CREATABLE_KINDS },
        title: { type: 'string', description: 'Short human title, e.g. "Pompano cleaners — turns"' },
        audience: { type: 'string', enum: AUDIENCES },
        scope: {
          type: 'object',
          properties: {
            scopeType: { type: 'string', enum: ['portfolio', 'market', 'building', 'owner', 'listing'] },
            scopeIds: { type: 'array', items: { type: 'string' }, description: 'Building names, owner names, unit names or market names from the registry, matching scopeType' },
            vendor: { type: 'string', enum: Object.keys(VENDOR_LABEL) },
            market: { type: 'string', enum: [...MARKETS, 'All'] },
            buildings: { type: 'array', items: { type: 'string' } },
            viewOnly: { type: 'boolean' },
            sections: { type: 'object', additionalProperties: { type: 'boolean' } },
            showMoney: { type: 'boolean' },
            guestNames: { type: 'boolean' },
            windowDays: { type: 'integer' },
            from: { type: 'string' }, to: { type: 'string' },
          },
        },
        expiresAt: { type: ['string', 'null'], description: 'YYYY-MM-DD or null for never' },
        showMoney: { type: 'boolean', description: 'false unless the person clearly asked for dollars' },
        reasoning: { type: 'string', description: 'One or two sentences on why this kind and scope' },
      },
      required: ['kind', 'title', 'audience', 'scope', 'expiresAt', 'showMoney', 'reasoning'],
    },
  }

  const system = [
    'You draft share links for Stay Hospitality\'s Lighthouse app. Return ONE draft_share_link tool call and nothing else.',
    `Today is ${dow} ${today} (America/New_York). "Sunday" means the next Sunday on or after today.`,
    'KINDS (pick exactly one):',
    ...CREATABLE_KINDS.map(k => `  • ${k} — ${KIND_LABEL[k]}: ${KIND_GUIDE[k] || ''}`),
    `Fixed-page kinds (${FIXED_CODE_KINDS.join(', ')}) already exist once; still draft them — the hub will edit the existing row.`,
    'AUDIENCES: crew (our own cleaners/maintenance), vendor (outside cleaning crews, garages), owner, guest, partner (marketing agencies, hotel front desks), internal (VAs, accountants, reviewers).',
    'RULES: guestNames false unless asked. showMoney false unless the person clearly wants dollars. "no guest names" → guestNames false. Prefer the narrowest scope the wording supports. Our own cleaners by market → scheduler or field-board (never vendor-board). Vendor crews (Botanica, Park Towers, Amrit/Capri/Lucerne, Salato) → vendor-board with scope.vendor.',
    'REGISTRY — use these spellings only:',
    `  markets: ${MARKETS.join(', ')}, All`,
    `  vendors: ${Object.keys(VENDOR_LABEL).map(k => `${k} (${VENDOR_LABEL[k]})`).join(', ')}`,
    `  buildings: ${buildings.join(' | ')}`,
    `  owners: ${ownerNames.join(' | ')}`,
    `  units: ${units.join(' | ')}`,
  ].join('\n')

  try {
    const { model, fallback } = await modelPairFor('links-draft')
    const r = await anthropicMessages(key, {
      model, max_tokens: 700, temperature: 0,
      system,
      tools: [tool], tool_choice: { type: 'tool', name: 'draft_share_link' },
      messages: [{ role: 'user', content: text }],
    }, fallback, 'links-draft')
    if (!r.ok) return NextResponse.json({ ok: false, error: `Model said ${r.status}: ${JSON.stringify(r.data?.error || r.data).slice(0, 200)}` }, { status: 502 })
    const call = (r.data?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === 'draft_share_link')
    const d: any = call?.input
    if (!d || !d.kind) return NextResponse.json({ ok: false, error: 'The model did not return a draft.' }, { status: 502 })
    // Resolve names the model chose back to the ids the form uses. Buildings and markets ARE their
    // names; owners and units need the id. Anything unresolved is dropped, never guessed.
    const scope: any = d.scope && typeof d.scope === 'object' ? d.scope : {}
    if (scope.scopeType === 'owner' || scope.scopeType === 'listing') {
      const { data: rows } = scope.scopeType === 'owner'
        ? await db.from('guesty_owners').select('id, full_name').limit(2000)
        : await db.from('guesty_listings').select('id, nickname, title').limit(2000)
      const byName: Record<string, string> = {}
      for (const x of (rows || []) as any[]) byName[str(x.full_name || x.nickname || x.title).toLowerCase()] = str(x.id)
      scope.scopeIds = (Array.isArray(scope.scopeIds) ? scope.scopeIds : []).map((n: any) => byName[str(n).toLowerCase()]).filter(Boolean)
    }
    if (d.showMoney === true && !canSeeMoney(gate.access)) { d.showMoney = false; scope.showMoney = false }
    if (scope.showMoney === undefined) scope.showMoney = d.showMoney === true
    return NextResponse.json({ ok: true, draft: { kind: d.kind, title: str(d.title).slice(0, 120), audience: d.audience, scope, expiresAt: d.expiresAt || null, showMoney: d.showMoney === true, reasoning: str(d.reasoning).slice(0, 400) }, model: r.model })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
