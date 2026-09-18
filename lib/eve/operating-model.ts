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
// HOW IT LEARNS (revised 2026-09-18). She derives who does what from ninety days of Breezeway
// closes, the Homebase roster and the ops-presets vendor list, writes that down as an INFERRED
// memory per building, and asks a question only where the data contradicts itself. Jon's answer
// lands here as well as in memory, so the next prompt she builds already has it. No new table: the
// model lives in app_settings, the questions in eve_questions, the answers in eve_memory.
import 'server-only'
import { getSetting, setSetting, getOpsPresets } from '@/lib/app-settings'
import { KNOWN_BUILDINGS } from '@/lib/segments'
import { modelFor } from '@/lib/ai-models'
import { askQuestion } from './questions'
import { aiFetch } from '@/lib/ai-usage'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { getEmployeeNames, nameMatchesRoster } from '@/lib/homebase'
import { vendorNameOf } from '@/lib/ops-presets'
import { rollupBuilding } from '@/lib/optimize-score'
import { saveMemory } from './memory'
import { todayET, shiftDay } from './ctx'

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
//
// DERIVE, DON'T ASK (Jon, 2026-09-18: "Questions are not very smart or intuitive, think higher
// level"). The first version of this file asked "Who does what at <building>?" once per building
// and left twelve of those open. Every one of them was answerable from tables she can read: the
// Breezeway mirror says who closed the cleans and the maintenance jobs, the Homebase roster says
// which of those names are ours, and the ops presets already list the vendor-cleaned buildings.
// So now she works it out, writes it down as an INFERRED memory (weight 5 — a person's word at 8
// still outranks it), and asks only when the data contradicts itself — and then the question says
// exactly what she saw.

export type DutyPicture = {
  tasks: number
  inhouse: number          // closed by a Homebase roster name
  outside: number          // closed by a named person who is not on the roster
  unassigned: number
  inhouseNames: string[]
  outsideNames: string[]
}
export type BuildingPicture = {
  building: string
  presetVendor: string | null    // ops-presets vendor label, when the building is on that list
  cleaning: DutyPicture
  maintenance: DutyPicture
  verdict: { cleaning: 'ours' | 'vendor' | 'mixed' | 'no signal'; maintenance: 'ours' | 'vendor' | 'mixed' | 'no signal' }
  contradiction: string | null
}

const HK = /housekeep|clean|turn/i
const MT = /maint|repair|hvac|plumb|electric|pest|handy/i

function emptyDuty(): DutyPicture { return { tasks: 0, inhouse: 0, outside: 0, unassigned: 0, inhouseNames: [], outsideNames: [] } }

function judge(d: DutyPicture): { verdict: 'ours' | 'vendor' | 'mixed' | 'no signal'; contradiction: string | null } {
  const named = d.inhouse + d.outside
  // Under eight tasks (or five with a name on them) is not a picture, and three cleans split two
  // ways must never read as a contradiction worth a question.
  if (d.tasks < 8 || named < 5) return { verdict: 'no signal', contradiction: null }
  const inShare = d.inhouse / named, outShare = d.outside / named
  // Both sides over 30% is the one shape the data cannot settle: a vendor and our crew both
  // working the building, or a roster name the Homebase pull is missing.
  if (inShare >= 0.3 && outShare >= 0.3) {
    return {
      verdict: 'mixed',
      contradiction: `${Math.round(inShare * 100)}% by roster names (${d.inhouseNames.slice(0, 3).join(', ')}) and ${Math.round(outShare * 100)}% by names not on the Homebase roster (${d.outsideNames.slice(0, 3).join(', ')})`,
    }
  }
  return { verdict: inShare >= 0.7 ? 'ours' : outShare >= 0.7 ? 'vendor' : 'mixed', contradiction: null }
}

async function rosterNames(): Promise<string[]> {
  // The same 6-hour cache lib/billing keeps, read first so this never adds a Homebase hop when the
  // billing board has already paid for one today.
  try {
    const c = await getSetting<{ at: number; names: string[] }>('homebase_roster_cache', { at: 0, names: [] })
    if (c && Array.isArray(c.names) && c.names.length && Date.now() - Number(c.at) < 6 * 3600_000) return c.names
  } catch { /* fall through */ }
  try { return await getEmployeeNames() } catch { return [] }
}

/** Ninety days of Breezeway closes, sorted into who did what, per building. */
export async function deriveOperatingPicture(days = 90): Promise<BuildingPicture[]> {
  const db = supabaseAdmin()
  const from = shiftDay(todayET(), -days)
  const [roster, presets, listings, tasks] = await Promise.all([
    rosterNames(),
    getOpsPresets().catch(() => null),
    db.from('guesty_listings').select('id,building,nickname,title').limit(1000).then(r => (r.data || []) as any[]),
    pageRows((a, b) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,type_department,assignees,assignee_name,finished_by_name,status,scheduled_date')
      .gte('scheduled_date', from).order('id').range(a, b), 15),
  ])
  const rollupOf: Record<string, string> = {}
  for (const l of listings) rollupOf[String(l.id)] = rollupBuilding(l.building, l.nickname || l.title)

  const by: Record<string, BuildingPicture> = {}
  const pic = (b: string): BuildingPicture => {
    if (!by[b]) by[b] = { building: b, presetVendor: presets ? vendorNameOf(presets.vendorBuildings, b) : null, cleaning: emptyDuty(), maintenance: emptyDuty(), verdict: { cleaning: 'no signal', maintenance: 'no signal' }, contradiction: null }
    return by[b]
  }
  for (const t of tasks.rows as any[]) {
    // A deleted row is the ghost Breezeway leaves when a task moves days; the replacement is its own row.
    if (String(t.status || '').toLowerCase() === 'deleted') continue
    const b = rollupOf[String(t.reference_property_id || '')]
    if (!b || b === 'Unassigned') continue
    const dept = String(t.type_department || '')
    const duty: DutyPicture | null = HK.test(dept) ? pic(b).cleaning : MT.test(dept) ? pic(b).maintenance : null
    if (!duty) continue
    duty.tasks++
    // `assignees` is an array of {id,name} from the Breezeway mirror, but a string or a bare name
    // has been seen in older rows — read whichever it is, same as lib/labor-econ's doer().
    const listed = (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => String((a && typeof a === 'object' ? a.name : a) || '').trim()).filter(Boolean)
    const doer = listed[0] || String(t.assignee_name || '').trim() || String(t.finished_by_name || '').trim()
    if (!doer) { duty.unassigned++; continue }
    if (roster.length && nameMatchesRoster(doer, roster)) {
      duty.inhouse++
      if (duty.inhouseNames.indexOf(doer) < 0 && duty.inhouseNames.length < 8) duty.inhouseNames.push(doer)
    } else {
      duty.outside++
      if (duty.outsideNames.indexOf(doer) < 0 && duty.outsideNames.length < 8) duty.outsideNames.push(doer)
    }
  }
  // Buildings with no Breezeway rows at all still get a picture when the presets name a vendor.
  for (const b of KNOWN_BUILDINGS) pic(b.label)

  const out = Object.keys(by).sort().map(k => by[k])
  for (const p of out) {
    // No roster means every name reads as "outside", which is not a finding — say no signal.
    if (!roster.length) { p.verdict = { cleaning: 'no signal', maintenance: 'no signal' }; continue }
    const c = judge(p.cleaning), m = judge(p.maintenance)
    p.verdict = { cleaning: c.verdict, maintenance: m.verdict }
    if (p.presetVendor && c.verdict === 'no signal') p.verdict.cleaning = 'vendor'
    // A preset that says vendor while the roster is closing most of the cleans is its own contradiction.
    if (p.presetVendor && c.verdict === 'ours') p.contradiction = `the ops presets list ${p.building} as vendor-cleaned (${p.presetVendor}) but ${p.cleaning.inhouse} of ${p.cleaning.inhouse + p.cleaning.outside} named cleans in ${days} days were closed by roster names (${p.cleaning.inhouseNames.slice(0, 3).join(', ')})`
    else p.contradiction = c.contradiction ? `cleaning: ${c.contradiction}` : m.contradiction ? `maintenance: ${m.contradiction}` : null
  }
  return out
}

function describePicture(p: BuildingPicture, days: number): string {
  const duty = (label: string, d: DutyPicture, v: string) => {
    if (v === 'no signal') return `${label}: no signal (${d.tasks} Breezeway tasks in ${days}d)`
    const who = v === 'ours' ? `our team (${d.inhouseNames.slice(0, 4).join(', ') || 'roster names'})` : v === 'vendor' ? `an outside crew (${d.outsideNames.slice(0, 4).join(', ') || 'names not on our roster'})` : 'a mix of our team and outside names'
    return `${label}: ${who} — ${d.inhouse} in-house / ${d.outside} outside / ${d.unassigned} unassigned of ${d.tasks} tasks`
  }
  return `INFERRED who-does-what at ${p.building}${p.presetVendor ? ` (ops presets: vendor-cleaned, ${p.presetVendor})` : ''}. ${duty('Cleaning', p.cleaning, p.verdict.cleaning)}. ${duty('Maintenance', p.maintenance, p.verdict.maintenance)}.`
}

/**
 * Work out who does what from the data, write it down as an inferred memory per building, and ask
 * ONLY where the data contradicts itself. Replaces the per-building calibration question
 * (2026-09-18). Idempotent: memories supersede the previous night's copy; questions dedupe.
 */
export async function askCalibrationQuestions(): Promise<{ asked: number; repeated: number; derived: number; contradictions: number }> {
  const days = 90
  const m = await getOperatingModel()
  const pictures = await deriveOperatingPicture(days)
  const db = supabaseAdmin()
  let asked = 0, repeated = 0, derived = 0, contradictions = 0
  for (const p of pictures) {
    const stated = m.buildings.find(b => b.building === p.building)
    const scope = 'building:' + p.building
    const finding = 'ops-picture:' + p.building
    try {
      const { data: prior } = await db.from('eve_memory').select('id').eq('source', 'system').is('superseded_by', null)
        .contains('evidence', { finding }).limit(1)
      const saved = await saveMemory({
        kind: 'insight', text: describePicture(p, days).slice(0, 900),
        why: `Derived from ${days} days of Breezeway closes matched against the Homebase roster and the ops-presets vendor list. Inferred, not stated — anything Jon says outranks it.`,
        scope, weight: 5, source: 'system', confidence: p.contradiction ? 0.4 : 0.7,
        evidence: { finding, inferred: true, building: p.building, cleaning: p.cleaning, maintenance: p.maintenance, verdict: p.verdict, presetVendor: p.presetVendor, contradiction: p.contradiction, days },
        supersedes: (prior || [])[0]?.id || null,
      })
      if (saved.ok) derived++
    } catch { /* one building's memory failing must not stop the rest */ }

    // Jon has already said who does what here — nothing to ask, whatever the data shows.
    if (stated?.source === 'jon') continue
    if (!p.contradiction) continue
    contradictions++
    const r = await askQuestion({
      question: `At ${p.building} the data disagrees with itself: ${p.contradiction}. Is that building ours, a vendor's, or genuinely shared — and which should I count as our labour?`,
      why: `Every cleaning, maintenance and labour number I quote for ${p.building} depends on whose work it is. Until I know, I will count only roster names as ours and say the rest is outside labour.`,
      scope: p.building, kind: 'conflict', source: 'system',
      evidence: { calibration: true, building: p.building, assumed: stated ? { operator: stated.operator, we: stated.we, they: stated.they } : null, seen: { cleaning: p.cleaning, maintenance: p.maintenance, presetVendor: p.presetVendor } },
    })
    if (r.ok) { if (r.repeated) repeated++; else asked++ }
  }
  return { asked, repeated, derived, contradictions }
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
    const r = await aiFetch('learn', {
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
