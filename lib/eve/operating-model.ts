// WHO ACTUALLY DOES WHAT, BUILDING BY BUILDING.
//
// Jon, 2026-09-11: "I dont think eve is properly calibrated, looks like all cleans are assigned.
// Botanica is a vendor operated hotel, we just manage distribution and guest communication. She
// needs to know that."
//
// WHY SHE GOT IT WRONG. There has been a `vendor: true` flag on five buildings in lib/segments for
// weeks, and it did its job for routing: vendor rooms get @here instead of named cleaners. But a
// flag is not an understanding. Nothing ever told Eve what "vendor" MEANS for the way she reasons —
// and worse, two of the four worked examples that teach her voice were about Botanica's cleans and
// Botanica's cost per clean. She was shown, by example, that Botanica is a building we clean. Given
// that, "all cleans are ours" is not a bug in her judgement; it is exactly what she was taught.
//
// So this file makes the operating model EXPLICIT and PER DUTY rather than a binary. For every
// building: who operates it, which duties are ours, which are theirs, and where that came from. A
// row marked `default` is an assumption derived from the vendor flag; a row marked `jon` is a fact
// he stated. She is shown the difference and told to ask before leaning on an assumption.
//
// HOW IT LEARNS. Every building still on a default gets ONE calibration question, through the same
// morning-ask that already reaches Jon on Telegram. His answer lands here as well as in memory, so
// the next prompt she builds already has it. No new table: the model lives in app_settings, the
// questions in eve_questions, the answers in eve_memories — three things that already exist.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { KNOWN_BUILDINGS } from '@/lib/segments'
import { modelFor } from '@/lib/ai-models'
import { askQuestion } from './questions'

export const OPERATING_MODEL_KEY = 'eve_operating_model'

/** The things a building needs done. Each is somebody's job, and "somebody" is the whole question. */
export const DUTIES = [
  'distribution',   // listing, channels, calendar, pricing
  'guest_comms',    // messaging, check-in instructions, complaints, reviews
  'cleaning',       // turnovers, mid-stays, linen
  'maintenance',    // repairs, glitches, vendors on site
  'inspections',    // pre-arrival checks, QC
  'supplies',       // consumables, restock, inventory
  'access',         // codes, keys, fobs, lock systems
  'onsite',         // anyone of ours physically at the building day to day
] as const
export type Duty = typeof DUTIES[number]

export type Operator = 'stay' | 'vendor' | 'hotel'

export type BuildingOps = {
  building: string
  market: string
  operator: Operator
  /** Our duties. */
  we: Duty[]
  /** Theirs. Anything in neither list is unknown, and unknown is a thing to ask about. */
  they: Duty[]
  /** Who "they" are, when known — a cleaning company, the hotel, a building operator. */
  partner: string | null
  /** In Jon's words. */
  notes: string
  source: 'default' | 'jon'
  updatedAt: string | null
  updatedBy: string | null
}

export type OperatingModel = { buildings: BuildingOps[]; updatedAt: string | null }

const ALL: Duty[] = DUTIES.slice() as Duty[]
const OURS_WHEN_VENDOR: Duty[] = ['distribution', 'guest_comms']
const THEIRS_WHEN_VENDOR: Duty[] = ['cleaning', 'maintenance', 'inspections', 'supplies', 'access', 'onsite']

/** What the vendor flag has always implied, now written down so it can be disagreed with. */
function defaultFor(b: { label: string; market: string; vendor: boolean }): BuildingOps {
  return {
    building: b.label, market: b.market,
    operator: b.vendor ? 'vendor' : 'stay',
    we: b.vendor ? OURS_WHEN_VENDOR.slice() : ALL.slice(),
    they: b.vendor ? THEIRS_WHEN_VENDOR.slice() : [],
    partner: null, notes: '', source: 'default', updatedAt: null, updatedBy: null,
  }
}

// What Jon has actually said, verbatim enough to be checked against. Lives in code rather than
// only in the database so a wiped settings table does not turn Botanica back into one of ours.
const STATED: Partial<Record<string, Partial<BuildingOps>>> = {
  'Botanica': {
    operator: 'hotel',
    we: ['distribution', 'guest_comms'],
    they: ['cleaning', 'maintenance', 'inspections', 'supplies', 'access', 'onsite'],
    partner: 'the hotel',
    notes: 'Vendor-operated hotel. We manage distribution and guest communication only. (Jon, 2026-09-11)',
    source: 'jon', updatedAt: '2026-09-11', updatedBy: 'jon@stay-hospitality.com',
  },
}

const cleanDuties = (v: any): Duty[] => Array.isArray(v) ? v.map(String).filter((d): d is Duty => (DUTIES as readonly string[]).includes(d)) : []

export async function getOperatingModel(): Promise<OperatingModel> {
  const stored = await getSetting<any>(OPERATING_MODEL_KEY, null)
  const byName: Record<string, any> = {}
  for (const r of (stored?.buildings || [])) if (r?.building) byName[String(r.building)] = r

  const buildings: BuildingOps[] = KNOWN_BUILDINGS.map(b => {
    const d = defaultFor(b)
    const s = STATED[b.label]
    const row = byName[b.label]
    // Precedence: what is stored (Jon answered a question) > what is written here > the default.
    const base: BuildingOps = s ? { ...d, ...s } as BuildingOps : d
    if (!row) return base
    return {
      ...base,
      operator: (['stay', 'vendor', 'hotel'] as string[]).includes(row.operator) ? row.operator : base.operator,
      we: row.we ? cleanDuties(row.we) : base.we,
      they: row.they ? cleanDuties(row.they) : base.they,
      partner: row.partner ? String(row.partner).slice(0, 80) : base.partner,
      notes: row.notes ? String(row.notes).slice(0, 400) : base.notes,
      source: row.source === 'jon' ? 'jon' : base.source,
      updatedAt: row.updatedAt || base.updatedAt, updatedBy: row.updatedBy || base.updatedBy,
    }
  })
  return { buildings, updatedAt: stored?.updatedAt || null }
}

export function weDo(m: OperatingModel, building: string | null | undefined, duty: Duty): boolean {
  const b = m.buildings.find(x => x.building === String(building || ''))
  return b ? b.we.includes(duty) : true   // an unknown building is assumed ours; the sweep will ask
}

/**
 * The block that goes into her prompt. Written so the distinction cannot be missed — and so that a
 * default is visibly a default. "Not confirmed" next to a building is an invitation to ask, and
 * asking is the whole point.
 */
export function renderOperatingModel(m: OperatingModel): string {
  const ours = m.buildings.filter(b => b.operator === 'stay')
  const theirs = m.buildings.filter(b => b.operator !== 'stay')
  const dutyList = (d: Duty[]) => d.length ? d.join(', ') : 'nothing'
  const line = (b: BuildingOps) => {
    const tag = b.source === 'jon' ? '' : ' (assumed — not confirmed by Jon)'
    const who = b.partner ? ` run by ${b.partner}` : ''
    return `• ${b.building}${who}: WE do ${dutyList(b.we)}; THEY do ${dutyList(b.they)}.${b.notes ? ' ' + b.notes : ''}${tag}`
  }
  return `WHO DOES WHAT, BUILDING BY BUILDING. This is the single most important thing to get right, because every number about cleaning, maintenance, inspections and staff hours only means something in a building where that work is OURS.

BUILDINGS WE OPERATE (our cleaners, our maintenance, our inspections, our supplies): ${ours.map(b => b.building).join(', ')}.

BUILDINGS WE DO NOT OPERATE — we are the distribution and guest-communication layer only:
${theirs.map(line).join('\n')}

WHAT THAT CHANGES, CONCRETELY. In a building we do not operate: a late clean is not our crew's, a cost per clean does not exist for us, a Breezeway task there (if there even is one) is not our labour, an inspection score is not our inspector's, and "who is on site" is nobody of ours. You still care about those buildings — a guest there is our guest and their message is ours to answer — but the WORK is somebody else's, and you say so: "Botanica's housekeeping is the hotel's; here is what the guest said" is right, "Botanica's cleans ran late" implies a crew we do not have. If you catch yourself attributing hands-on work to our team in one of these buildings, stop and re-read this list.

WHEN A LINE SAYS "assumed", THAT IS A GUESS. Do not build a confident answer on it. Use ask_jon to confirm who does what there, then answer with the assumption stated out loud.`
}

/** Operating-model context for ONE building, for tools and the Slack watcher. */
export function describeBuilding(m: OperatingModel, building: string | null | undefined): string {
  const b = m.buildings.find(x => x.building === String(building || ''))
  if (!b) return ''
  if (b.operator === 'stay') return `${b.building} is one we operate.`
  return `${b.building} is ${b.operator === 'hotel' ? 'a hotel' : 'vendor-run'}${b.partner ? ` (${b.partner})` : ''}: we do ${b.we.join(', ') || 'nothing'} there; ${b.they.join(', ') || 'the rest'} is theirs.`
}

// ── Learning ───────────────────────────────────────────────────────────────────────────────────

/**
 * One question per building still on a default. Goes through eve_questions, which the morning ask
 * already batches to Jon on Telegram — so nothing new has to be wired for the asking, only for
 * what happens to the answer (see applyCalibrationAnswer).
 */
export async function askCalibrationQuestions(): Promise<{ asked: number; repeated: number }> {
  const m = await getOperatingModel()
  let asked = 0, repeated = 0
  for (const b of m.buildings) {
    if (b.source === 'jon') continue
    const assumed = b.operator === 'stay'
      ? 'that our own team does everything there — cleaning, maintenance, inspections, supplies'
      : `that an outside operator does the cleaning, maintenance and inspections, and we only do distribution and guest messaging`
    const r = await askQuestion({
      question: `Who does what at ${b.building}? I am assuming ${assumed}. Is that right — and if not, what is ours and what is theirs?`,
      why: `Every cleaning, maintenance and labour number I quote for ${b.building} depends on whether that work is ours. If it is not, I should stop attributing it to our crew and stop computing a cost per clean there.`,
      scope: b.building, kind: 'verify', source: 'system',
      evidence: { calibration: true, building: b.building, assumed: { operator: b.operator, we: b.we, they: b.they } },
    })
    if (r.ok) { if (r.repeated) repeated++; else asked++ }
  }
  return { asked, repeated }
}

const SYSTEM = `You turn one sentence from a property manager into a structured statement of who does what at one building. Return JSON only:
{"operator":"stay|vendor|hotel","we":[...],"they":[...],"partner":"name or null","notes":"their words, one line"}
Duties, and nothing else: distribution, guest_comms, cleaning, maintenance, inspections, supplies, access, onsite.
"stay" means our own company operates the building. "vendor" means an outside company does the hands-on work. "hotel" means the building is a hotel that runs itself and we only list it and talk to guests.
If the answer confirms the assumption, return the assumption. If it says "we do everything", we = all eight duties. If a duty is not mentioned, leave it in whichever list the assumption had it. Never invent a partner name.`

/**
 * Jon answered. Fold it into the model so the next prompt already knows — and keep the raw words,
 * because the structured version is a reading of them and readings can be wrong.
 */
export async function applyCalibrationAnswer(building: string, answer: string, by: string, assumed?: any): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const m = await getOperatingModel()
  const current = m.buildings.find(b => b.building === building)
  if (!current) return { ok: false, error: `unknown building ${building}` }

  let parsed: any = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await modelFor('learn'), max_tokens: 400, system: SYSTEM,
        messages: [{ role: 'user', content: `BUILDING: ${building}\nASSUMPTION: ${JSON.stringify(assumed || { operator: current.operator, we: current.we, they: current.they })}\nANSWER: ${answer.slice(0, 1200)}` }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: String(d?.error?.message || `anthropic ${r.status}`).slice(0, 200) }
    const raw = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : ''
    const a = raw.indexOf('{'), z = raw.lastIndexOf('}')
    parsed = JSON.parse(a >= 0 && z > a ? raw.slice(a, z + 1) : raw)
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }

  const next: BuildingOps = {
    ...current,
    operator: (['stay', 'vendor', 'hotel'] as string[]).includes(parsed?.operator) ? parsed.operator : current.operator,
    we: cleanDuties(parsed?.we).length ? cleanDuties(parsed.we) : current.we,
    they: cleanDuties(parsed?.they),
    partner: parsed?.partner ? String(parsed.partner).slice(0, 80) : current.partner,
    notes: `${String(parsed?.notes || answer).slice(0, 300)} (${by.split('@')[0]}, ${new Date().toISOString().slice(0, 10)})`,
    source: 'jon', updatedAt: new Date().toISOString(), updatedBy: by,
  }
  const stored = await getSetting<any>(OPERATING_MODEL_KEY, null)
  const rows: any[] = (stored?.buildings || []).filter((r: any) => r?.building !== building)
  rows.push(next)
  const res = await setSetting(OPERATING_MODEL_KEY, { buildings: rows, updatedAt: new Date().toISOString() }, by)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
