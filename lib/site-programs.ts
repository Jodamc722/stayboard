// PROPERTY PROGRAMS — a Breezeway template that runs on a schedule at a building or a unit (Jon,
// 2026-10-30: "This should be part of the upkeep page, programs, should be able to create them,
// manage them, update them. This should not create duplicates, if not done, should move the one from
// previous day" · "should allow us to add a template, assign it to a unit or property, and should be
// smart and intuitive").
//
// A PROGRAM is: a template (its checklist), the task title, a department, the people who always get
// it, whether whoever is cleaning there that day is added too, and a list of PLACES — a whole
// building or one unit — each with its own days:
//   days         weekdays it runs (0 = Sun … 6 = Sat)
//   alternate    every other day instead (even day numbers, so two buildings on it walk the same day)
//   onCleanDays  also any day a clean is scheduled there
//
// ONE TASK PER PLACE, EVER OPEN (the filter-change rule, 2026-10-28). Each run, per place:
//   an open task of this program dated today      → the day's task; only newly assigned cleaners are added
//   an open task from an earlier day (not done)   → MOVED to today, cleaners added — never a second task
//   more than one open                            → the newest is kept and moved; the rest are cancelled
//   none open and today is one of its days        → created
// Done or cancelled tasks are history and never moved. A place's day that is not on its schedule
// creates nothing, but a still-open task from before is still moved forward — it is still owed.
//
// WHERE a building's task lands: its Exterior/Building property in Breezeway when it has one, else
// its first unit (never a "Full" listing). A unit's task lands on that unit.
//
// Stored in app_settings (no migration). The first read seeds the Property Exterior Clean program
// Jon set up the same morning.
import 'server-only'
import { getNoService, skipsInspectionsIn } from './no-service'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { buildingOf } from './segments'
import { isTaskDone, isTaskGone } from './task-categories'
import {
  createBreezewayTask, updateBreezewayTask, cancelBreezewayTask, breezewayConfigured, breezewayPeopleLite, mapBreezewayTask,
} from './breezeway'

export const PROGRAMS_KEY = 'site_programs'
export type Person = { id: number; name: string }
export type Place = {
  id: string
  kind: 'building' | 'unit'
  /** building: the grouping key (buildingOf) · unit: the Guesty listing id */
  ref: string
  /** What the crew reads in the task title: "Eden", "Miami Rd", "Capri 109". */
  label: string
  days: number[]
  alternate: boolean
  onCleanDays: boolean
  /**
   * MONTHLY (the Eden walk, 2026-11-02): also runs on this day of every month (1–28, so every month
   * has it). A place can be monthly and nothing else — days empty, alternate off.
   */
  monthDay?: number | null
  /** This place's own team; empty/absent = the program's people. */
  people?: Person[]
}
/**
 * WHAT HAPPENS WHEN A TASK OF THE PROGRAM IS FINISHED (Jon, 2026-11-02, the Eden exterior walk:
 * "create it as a Breezeway task, once it's done it sends a report to the owners"). The checklist
 * answers, photos and notes become a walk report (lib/walk-reports) with its own link:
 *   mode     off = no report · issues = the owners get an email only when something failed ·
 *            always = an email after every finished task
 *   weekly   a Monday roll-up of the week's walks, issues and what is still open
 *   owners   send to the owners of the place's units (guesty_owners), plus `to`
 *   to       extra addresses (the property manager, the on-site contact)
 *   review   NOTHING GOES TO THE OWNERS ON ITS OWN (Jon, 2026-11-02: "let's not send anything
 *            without my approval — draft it, send it to me, I will review and push it"): the
 *            report is written as a Gmail draft addressed to the owners in the Lighthouse mailbox,
 *            and the reviewer (the `to` addresses, else the mailbox) gets a note that it is ready.
 */
export type ProgramReport = { mode: 'off' | 'issues' | 'always'; weekly: boolean; owners: boolean; to: string[]; review: boolean }
export type Program = {
  id: string
  name: string
  active: boolean
  templateId: number | null
  templateName: string
  department: 'maintenance' | 'housekeeping' | 'inspection'
  description: string
  people: Person[]
  addCleaners: boolean
  places: Place[]
  report?: ProgramReport
  updatedAt?: string
  updatedBy?: string
}
export const NO_REPORT: ProgramReport = { mode: 'off', weekly: false, owners: true, to: [], review: true }

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const NOT_A_PERSON = /customer care|support/i
const LOOKBACK_DAYS = 45

const ALL = [0, 1, 2, 3, 4, 5, 6], MWF = [1, 3, 5]
const SEED: Program[] = [{
  id: 'exterior-clean', name: 'Property Exterior Clean', active: true,
  templateId: 921654, templateName: 'Property Exterior Clean 1.0', department: 'maintenance',
  description: 'Walk the whole property outside: grounds, entrances, walkways, parking and the trash area. Check the plants and water them if dry. Blow walkways and entrances if there are leaves or debris. Photos at each step.\n\nRecorre todo el exterior: areas comunes, entradas, pasillos, estacionamiento y area de basura. Revisa las plantas y riega si estan secas. Sopla pasillos y entradas si hay hojas o basura.',
  people: [{ id: 203520, name: 'Gehron Regis' }], addCleaners: true,
  places: [
    { id: 'eden', kind: 'building', ref: 'Eden', label: 'Eden', days: ALL, alternate: false, onCleanDays: false },
    { id: 'rustic', kind: 'building', ref: 'Rustic', label: 'Rustic', days: ALL, alternate: false, onCleanDays: false },
    { id: 'pelican', kind: 'building', ref: 'Pelican', label: 'Pelican', days: ALL, alternate: false, onCleanDays: false },
    { id: '906', kind: 'building', ref: '906', label: '906', days: ALL, alternate: false, onCleanDays: false },
    { id: 'oasis', kind: 'building', ref: 'Oasis', label: 'Oasis', days: ALL, alternate: false, onCleanDays: false },
    { id: 'hendricks', kind: 'building', ref: 'Hendricks', label: 'Hendricks', days: MWF, alternate: false, onCleanDays: false },
    { id: 'miamird', kind: 'building', ref: '2023', label: 'Miami Rd', days: MWF, alternate: false, onCleanDays: false },
    { id: 'capri', kind: 'building', ref: 'Capri', label: 'Capri', days: [], alternate: true, onCleanDays: true },
    { id: 'lucerne', kind: 'building', ref: 'Lucerne', label: 'Lucerne', days: [], alternate: true, onCleanDays: true },
    { id: 'boynton', kind: 'building', ref: 'Boynton', label: 'Boynton', days: [], alternate: true, onCleanDays: true },
  ],
}]

/** The building a listing belongs to: the segments rule, else the leading street number ("2023/1" → "2023"). */
export function buildingKey(building: string, name: string): string {
  const b = buildingOf(building || null, name || null)
  if (b) return b
  const m = str(name).trim().match(/^(\d{3,5})\b/)
  return m ? m[1] : str(name).trim()
}

/** The task title the crew reads, and the prefix every task of the program starts with. */
export const titlePrefix = (p: Program) => p.name.trim() + ':'
export const taskTitle = (p: Program, place: Place) => `${p.name.trim()}: ${place.label.trim()}`

/** Is today one of the place's days (cleans aside)? Pure. */
export function onDays(place: Place, ymd: string): boolean {
  const d = new Date(ymd + 'T12:00:00Z')
  if (place.monthDay && d.getUTCDate() === place.monthDay) return true
  if (place.alternate && Math.floor(d.getTime() / 86400000) % 2 === 0) return true
  return place.days.indexOf(d.getUTCDay()) >= 0
}

const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th')

/** One line for a place's schedule: "Every day", "Mon, Wed, Fri", "Every other day + clean days", "Monthly on the 1st". */
export function scheduleLine(place: Place): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const parts: string[] = []
  const days = Array.from(new Set(place.days)).sort()
  if (days.length === 7) parts.push('Every day')
  else if (days.length) parts.push(days.map(d => names[d]).join(', '))
  if (place.alternate) parts.push('every other day')
  if (place.monthDay) parts.push('monthly on the ' + ordinal(place.monthDay))
  if (place.onCleanDays) parts.push('clean days')
  if (!parts.length) return 'No days set'
  const s = parts.join(' + ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The report settings a stored program carries, with the defaults filled in. */
export function reportOf(p: Pick<Program, 'report'> | null | undefined): ProgramReport {
  const r: any = p && p.report
  if (!r || typeof r !== 'object') return { ...NO_REPORT, to: [] }
  const mode = ['off', 'issues', 'always'].indexOf(r.mode) >= 0 ? r.mode : 'off'
  const to = (Array.isArray(r.to) ? r.to : []).map((x: any) => str(x).trim().toLowerCase()).filter((x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 20)
  // review defaults ON: a report never reaches an owner unless someone switched approval off on purpose.
  return { mode, weekly: !!r.weekly, owners: r.owners !== false, to: Array.from(new Set(to)) as string[], review: r.review !== false }
}

/**
 * Which program (and which of its places) a Breezeway task belongs to, from the task's name — the
 * title is "<program name>: <place label>", and that prefix is the only thing the engine keys on.
 */
export function programForTask(name: any, programs: Program[]): { program: Program; place: Place | null } | null {
  const n = str(name).replace(/^\s*\[Moved to [^\]]+\]\s*/i, '').trim()
  if (!n) return null
  const hits = programs.filter(p => n.indexOf(titlePrefix(p)) === 0).sort((a, b) => b.name.length - a.name.length)
  const program = hits[0]
  if (!program) return null
  const rest = n.slice(titlePrefix(program).length).trim().toLowerCase()
  const place = program.places.find(pl => pl.label.trim().toLowerCase() === rest) || program.places.find(pl => rest.indexOf(pl.label.trim().toLowerCase()) === 0) || null
  return { program, place }
}

function clean(p: any): Program | null {
  if (!p || typeof p !== 'object') return null
  const name = str(p.name).trim().slice(0, 80)
  if (!name) return null
  const dept = ['maintenance', 'housekeeping', 'inspection'].indexOf(p.department) >= 0 ? p.department : 'maintenance'
  const places: Place[] = (Array.isArray(p.places) ? p.places : []).map((x: any, i: number) => ({
    id: str(x?.id) || 'p' + i + '-' + Math.random().toString(36).slice(2, 7),
    kind: x?.kind === 'unit' ? 'unit' : 'building',
    ref: str(x?.ref).trim(),
    label: str(x?.label || x?.ref).trim().slice(0, 60),
    days: (Array.isArray(x?.days) ? x.days : []).map(Number).filter((n: number) => n >= 0 && n <= 6),
    alternate: !!x?.alternate,
    onCleanDays: !!x?.onCleanDays,
    monthDay: Number(x?.monthDay) >= 1 && Number(x?.monthDay) <= 28 ? Math.round(Number(x.monthDay)) : null,
    people: (Array.isArray(x?.people) ? x.people : []).map((y: any) => ({ id: Number(y?.id), name: str(y?.name) })).filter((y: Person) => Number.isFinite(y.id) && y.id > 0).slice(0, 12),
  })).filter((x: Place) => x.ref && x.label)
  const people: Person[] = (Array.isArray(p.people) ? p.people : []).map((x: any) => ({ id: Number(x?.id), name: str(x?.name) })).filter((x: Person) => Number.isFinite(x.id) && x.id > 0)
  return {
    id: str(p.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'program',
    name, active: p.active !== false,
    templateId: Number(p.templateId) > 0 ? Number(p.templateId) : null,
    templateName: str(p.templateName).slice(0, 120), department: dept,
    description: str(p.description).slice(0, 2000), people, addCleaners: p.addCleaners !== false, places,
    report: reportOf(p),
    updatedAt: str(p.updatedAt) || undefined, updatedBy: str(p.updatedBy) || undefined,
  }
}

// EVERY RECURRING TASK LIVES HERE (Jon, 2026-11-02: "make sure we add any recurring task to
// upkeep / programs. This will be the place we can add recurring tasks to manage"). Two recurring
// Breezeway jobs used to be hard-coded crons — the weekly Property Exterior Walkthrough
// (lib/standing-walkthroughs) and the daily Parking Check (lib/parking-daily-task). They are brought
// in once as ordinary programs, with the same title prefix so their open tasks are carried rather
// than duplicated, and from then on they are edited, paused or deleted here like any other. The
// crons that ran them now stand down (they return "moved to programs").
const LEGACY_VERSION = 5
const WALK_DESC = [
  'Weekly walk of the property exterior. Check and ATTACH PHOTOS of each:',
  '• Landscaping', '• Plants', '• Weeds', '• Wall damage', '• Roof damage', '• Leaks', '• All the hoses',
  '• The pool (if applicable)', '• Barbecue grills, etc.',
  'Anything wrong: photograph it and open a maintenance task.',
].join('\n')
const PARKING_DESC = [
  'Daily parking check. Every car in the lot must be registered.',
  '',
  '{parking}',
  '',
  '1. Open the link on your phone and enter the passcode. If it asks "Which property are you at?", tap the property.',
  '2. Type your name (the phone remembers it).',
  '3. Tap "Walk the lot" and go spot by spot — or "Scan plates" and point the camera at each plate.',
  '4. Green = registered. Red = NOT registered → tap "Flag this car" and take a photo.',
  '5. A guest car that is not on the list but belongs to a guest → "Register it".',
  '6. Finish the walk, then complete this task. Flags go to the office for the 1-hour tow notice.',
].join('\n')
// THE EDEN EXTERIOR WALK (Jon, 2026-11-02: "build new inspection, call it Eden" · "the walk should be
// done weekly only, 1 a week. This report should be shared with Ownership. Note in task this will be
// completed weekly"). ONE walk a week, Monday: one Breezeway checklist built from the Seville
// 3020–3024 inspection form (docs: "Eden Exterior Walk") in route order — street and parking, front
// building, the walkway, pool and spa, rear building, perimeter, trash and utilities, life safety,
// close-out — 51 PASS / ISSUE lines. The template lives in Breezeway and is found BY NAME on the
// first run (resolveTemplateId), so the program can exist before the template does. Guillermo walks
// it; every finished walk becomes a report that goes to ownership (lib/walk-reports). The daily /
// weekly / monthly split that briefly existed on 2026-11-02 is migrated to this (migrateEden).
export const EDEN_TEMPLATE = 'Eden Walk 1.0'
const EDEN_DESC = [
  'WEEKLY WALK — completed once a week, every Monday. One task a week: a walk not finished moves to the next day, it is never re-created.',
  'Exterior walk of Eden, 3020–3024 Seville St, in route order. Every line is PASS or ISSUE. An ISSUE needs a photo and a note.',
  'Hazards get isolated on the spot: a pool gate that does not latch closes the pool; a loose railing or stair tread gets taped off; exposed wiring gets barricaded.',
  'Anything past basic maintenance (roof, panel or wiring, AC refrigerant, gas, structural, pool equipment, work near power lines) is documented and scheduled, never repaired on the spot.',
  'Finish the task when the walk is done — Lighthouse sends ownership the report and files a fix task for every ISSUE.',
  '',
  'RECORRIDO SEMANAL — se completa una vez por semana, cada lunes. Recorrido exterior de Eden en orden de ruta. Cada línea es PASS o ISSUE; un ISSUE necesita foto y nota. Un peligro se aísla en el momento (cerrar la piscina, acordonar la baranda o escalera, bloquear el cableado expuesto). Al terminar, completa la tarea.',
].join('\n')
const EDEN_REPORT: ProgramReport = { mode: 'always', weekly: false, owners: true, to: ['jon@stay-hospitality.com'], review: true }
async function legacyPrograms(): Promise<Program[]> {
  const people: Person[] = breezewayConfigured() ? await breezewayPeopleLite().catch(() => [] as any[]) as any : []
  const who = (res: RegExp[]) => res.map(re => people.find(p => re.test(str(p.name).trim()))).filter(Boolean).map(p => ({ id: Number((p as any).id), name: str((p as any).name) }))
  const bld = (ref: string, label: string, days: number[], monthDay: number | null = null): Place => ({ id: ref.toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind: 'building', ref, label, days, alternate: false, onCleanDays: false, monthDay })
  return [
    {
      id: 'exterior-walkthrough', name: 'Property Exterior Walkthrough', active: true, templateId: null, templateName: '', department: 'inspection',
      description: WALK_DESC, addCleaners: false,
      people: who([/^guillermo\b/i, /^oscar\b/i, /^gehron\b/i, /^roberto\b/i, /^jon\b|^jonathan\b/i]),
      places: [bld('906', '906', [1]), bld('Eden', 'Eden Oasis', [1]), bld('Hendricks', 'Hendricks', [1]), bld('17WEST', '17 West', [1]), bld('3316', '3316', [1]), bld('Rustic', 'Rustic', [1]), bld('Pelican', 'Pelican', [1])],
    },
    {
      id: 'parking-check', name: 'Parking Check', active: true, templateId: null, templateName: '', department: 'inspection',
      description: PARKING_DESC, addCleaners: true,
      people: who([/^guillermo\b/i, /^oscar\b/i]),
      places: [bld('Eden', 'Eden', ALL)],
    },
    // WHO WALKS (Jon, 2026-11-02): "exterior walkthroughs are done by supervisor, GM or operations
    // manager or maintenance — never by HK". The supervisor and maintenance names here are the
    // Broward crew; addCleaners stays false so the day's cleaners are never added to the walk.
    {
      id: 'eden', name: 'Eden', active: true, templateId: null, templateName: EDEN_TEMPLATE, department: 'inspection',
      description: EDEN_DESC, addCleaners: false,
      people: who([/^guillermo\b/i, /^oscar\b/i, /^gehron\b/i, /^roberto\b/i, /^jon\b|^jonathan\b/i]), places: [bld('Eden', 'Exterior walk', [1])],
      report: { ...EDEN_REPORT },
    },
  ]
}

/** The Eden walk replaces the generic weekly walkthrough at Eden — one building, one walk. */
function retireEdenWalkthrough(programs: Program[]): Program[] {
  if (!programs.some(p => p.id === 'eden')) return programs
  return programs.map(p => (p.id === 'exterior-walkthrough' ? { ...p, places: p.places.filter(pl => !/^eden\b/i.test(pl.ref)) } : p))
}

/**
 * Seed v3 (the morning of 2026-11-02) split Eden into daily / weekly / monthly programs. v4 is the one
 * weekly walk Jon asked for: the two extra programs go, and the daily one — if nobody has edited it
 * onto another template — becomes the weekly walk on the full checklist.
 */
function migrateEden(programs: Program[]): Program[] {
  return programs.filter(p => p.id !== 'eden-weekly' && p.id !== 'eden-monthly').map(p => {
    if (p.id !== 'eden' || !/^Eden Walk (Daily|Weekly|Monthly)\b/i.test(p.templateName)) return p
    return {
      ...p, templateId: null, templateName: EDEN_TEMPLATE, description: EDEN_DESC,
      places: p.places.map(pl => ({ ...pl, label: 'Exterior walk', days: [1], alternate: false, monthDay: null })),
      report: { ...EDEN_REPORT, to: reportOf(p).to },
    }
  })
}

export async function loadPrograms(): Promise<Program[]> {
  const raw = await getSetting<any>(PROGRAMS_KEY, null)
  const list = raw && Array.isArray(raw.programs) ? raw.programs : null
  let programs = list ? (list.map(clean).filter(Boolean) as Program[]) : SEED.map(p => ({ ...p }))
  if (!raw || Number(raw.legacy) !== LEGACY_VERSION) {
    const before = programs
    const add = (await legacyPrograms()).filter(l => !programs.some(p => p.id === l.id || p.name.trim().toLowerCase() === l.name.toLowerCase()))
    programs = migrateEden(retireEdenWalkthrough(programs.concat(add)))
    await savePrograms(programs, 'system: recurring tasks brought into programs').catch(() => null)
    // A program the migration removed takes its open tasks with it (deleteProgram does the same).
    const gone = before.filter(p => !programs.some(q => q.id === p.id))
    if (gone.length) await retireProgramTasks(gone.map(titlePrefix)).catch(() => null)
  }
  return programs
}

/**
 * The template a program's tasks carry. A program saved with a template name but no id (the Eden
 * seed, or a template still being built in Breezeway when the program was saved) is matched by name
 * against the account's templates on the first run that finds it, and the id is kept from then on.
 */
export async function resolveTemplateId(p: Program): Promise<number | null> {
  if (p.templateId) return p.templateId
  if (!p.templateName || !breezewayConfigured()) return null
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const want = norm(p.templateName)
  const { listBreezewayTemplates } = await import('./breezeway')
  const list = await listBreezewayTemplates().catch(() => [] as { id: number; name: string }[])
  const hit = list.find(t => norm(t.name) === want) || list.find(t => norm(t.name).replace(/\s*\d+(\.\d+)*$/, '') === want.replace(/\s*\d+(\.\d+)*$/, ''))
  if (!hit) return null
  try {
    const all = await loadPrograms()
    const at = all.findIndex(x => x.id === p.id)
    if (at >= 0 && !all[at].templateId) { all[at] = { ...all[at], templateId: hit.id, templateName: hit.name }; await savePrograms(all, 'system: template matched by name') }
  } catch { /* the id is used for this run either way */ }
  p.templateId = hit.id
  return hit.id
}

export async function savePrograms(programs: Program[], by?: string): Promise<{ ok: boolean; error?: string }> {
  return setSetting(PROGRAMS_KEY, { programs, legacy: LEGACY_VERSION }, by || null)
}

/** {parking} in a description becomes the place's parking-lot link and passcode, read live. */
async function expandDescription(desc: string, place: { ref: string; label: string }): Promise<string> {
  if (desc.indexOf('{parking}') < 0) return desc
  let block = 'Parking link: none set up for this property yet (Parking page in Lighthouse).'
  try {
    const { listLots, lotByCode } = await import('./parking-lots')
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const res = [place.ref, place.label].filter(Boolean).map(w => new RegExp('\\b' + esc(w.split(' ')[0]) + '\\b', 'i'))
    const lot = (await listLots()).find(l => l.active && res.some(re => re.test(l.building + ' ' + l.name)))
    if (lot) {
      const full = await lotByCode(lot.shareCode)
      const app = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
      block = 'LINK: ' + app + '/lot/' + lot.shareCode + '\nPASSCODE: ' + (full?.passcode || '(none — the link opens straight away)')
    }
  } catch { /* the instructions still go out */ }
  return desc.split('{parking}').join(block)
}

/** Save one program (create or replace by id). Names must be unique: the name is how its tasks are found. */
export async function upsertProgram(input: any, by: string): Promise<{ ok: boolean; error?: string; program?: Program }> {
  const p = clean(input)
  if (!p) return { ok: false, error: 'A program needs a name.' }
  const all = await loadPrograms()
  const clash = all.find(x => x.id !== p.id && x.name.trim().toLowerCase() === p.name.trim().toLowerCase())
  if (clash) return { ok: false, error: 'Another program is already called "' + p.name + '".' }
  p.updatedAt = new Date().toISOString(); p.updatedBy = by
  const at = all.findIndex(x => x.id === p.id)
  if (at < 0 && all.some(x => x.id === p.id)) p.id = p.id + '-' + Date.now().toString(36)
  const next = at >= 0 ? all.map((x, i) => (i === at ? p : x)) : all.concat([p])
  const r = await savePrograms(next, by)
  return r.ok ? { ok: true, program: p } : { ok: false, error: r.error }
}

/**
 * RETIRE a program's open Breezeway tasks: cancelled (never closed — closing says the work was done,
 * and a walk nobody walked must not read as one). `prefixes` are task-title prefixes ("Eden:");
 * `keep` are task ids to leave alone. Looks at the mirror over the look-back window, so a task the
 * sync has not seen yet is not touched. Returns what was cancelled and what Breezeway refused.
 */
export async function retireProgramTasks(prefixes: string[], opts: { keep?: string[]; only?: string[] } = {}): Promise<{ cancelled: string[]; failed: { id: string; error: string }[] }> {
  const out = { cancelled: [] as string[], failed: [] as { id: string; error: string }[] }
  const list = prefixes.map(p => p.trim()).filter(Boolean)
  if (!list.length || !breezewayConfigured()) return out
  const db = supabaseAdmin()
  const day = ymdET(new Date())
  const keep = new Set((opts.keep || []).map(String))
  const only = opts.only ? new Set(opts.only.map(String)) : null
  for (const prefix of list) {
    const { data } = await db.from('breezeway_tasks_sync').select('id,name,status,finished_at,scheduled_date')
      .ilike('name', prefix.replace(/[%_]/g, '') + '%').gte('scheduled_date', shift(day, -LOOKBACK_DAYS)).lte('scheduled_date', shift(day, 30)).limit(500)
    for (const t of (data || []) as any[]) {
      const id = str(t.id)
      if (str(t.name).indexOf(prefix) !== 0 || keep.has(id) || (only && !only.has(id))) continue
      if (isTaskDone(t.status, t.finished_at) || isTaskGone(t.status)) continue
      const r = await cancelBreezewayTask(id).catch((e: any) => ({ ok: false, text: str(e?.message || e) } as any))
      if (r.ok) { out.cancelled.push(id); try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled' }).eq('id', id) } catch { /* sync */ } }
      else out.failed.push({ id, error: str(r.text).slice(0, 140) })
    }
  }
  return out
}

/** Delete a program. Its open tasks are retired with it (Jon's rule: no task without a program behind it). */
export async function deleteProgram(id: string, by: string) {
  const all = await loadPrograms()
  const p = all.find(x => x.id === id)
  const r = await savePrograms(all.filter(x => x.id !== id), by)
  if (r.ok && p) await retireProgramTasks([titlePrefix(p)]).catch(() => null)
  return r
}

// ── the day's plan ───────────────────────────────────────────────────────────────────────────────

export type OpenTask = { id: string; date: string; assigneeIds: number[]; homeId: number }
export type PlacePlan = {
  programId: string; placeId: string; label: string; kind: Place['kind']; schedule: string
  homeId: number | null; where: string
  due: boolean; why: string
  people: Person[]; cleaners: Person[]
  today: OpenTask | null
  carry: OpenTask | null          // an open task from an earlier day, to move to today
  extras: OpenTask[]              // further open duplicates, to cancel
  action: 'create' | 'move' | 'add' | 'none' | 'skip'
  note: string
}

type Ctx = {
  props: any[]; listings: { id: string; name: string; building: string; key: string }[]
  people: any[]
}

async function context(): Promise<Ctx> {
  const db = supabaseAdmin()
  const [{ data: props }, { data: ls }, people] = await Promise.all([
    db.from('breezeway_properties').select('home_id,name,reference_property_id,status').limit(3000),
    db.from('guesty_listings').select('id,nickname,title,building,active:raw->>active').limit(3000),
    breezewayConfigured() ? breezewayPeopleLite().catch(() => []) : Promise.resolve([]),
  ])
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => {
    const name = str(l.nickname || l.title).trim()
    return { id: str(l.id), name, building: str(l.building), key: buildingKey(str(l.building), name) }
  })
  return { props: ((props || []) as any[]).filter(p => !/inactive|deleted/i.test(str(p.status))), listings, people: people as any[] }
}

/** Where a place's task lands, and every Breezeway home at the place (to find cleans there). */
function resolvePlace(place: Place, ctx: Ctx): { homeId: number | null; where: string; homeIds: number[] } {
  const homeOfListing = (id: string) => ctx.props.find(p => str(p.reference_property_id) === id)
  if (place.kind === 'unit') {
    const l = ctx.listings.find(x => x.id === place.ref)
    const p = homeOfListing(place.ref)
    return p ? { homeId: Number(p.home_id), where: l?.name || str(p.name), homeIds: [Number(p.home_id)] } : { homeId: null, where: l?.name || '', homeIds: [] }
  }
  const key = place.ref.toLowerCase()
  const units = ctx.listings.filter(l => l.key.toLowerCase() === key)
  const unitProps = units.map(u => homeOfListing(u.id)).filter(Boolean) as any[]
  // Breezeway homes not linked to a listing yet but named like the building's units (a new building).
  const named = ctx.props.filter(p => !p.reference_property_id && buildingKey('', str(p.name)).toLowerCase() === key)
  const all = unitProps.concat(named)
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const words = [place.ref, place.label].filter(Boolean).map(w => new RegExp('\\b' + esc(w) + '\\b', 'i'))
  const ext = ctx.props.find(p => /exterior|building|common/i.test(str(p.name)) && words.some(re => re.test(str(p.name))))
  const homeIds = all.map(p => Number(p.home_id)).concat(ext ? [Number(ext.home_id)] : [])
  if (ext) return { homeId: Number(ext.home_id), where: str(ext.name), homeIds }
  const first = units.filter(u => !/\bfull\b/i.test(u.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(u => ({ u, p: homeOfListing(u.id) })).find(x => x.p)
  if (first) return { homeId: Number(first.p.home_id), where: first.u.name, homeIds }
  const n = named.filter(p => !/\bfull\b/i.test(str(p.name))).sort((a, b) => str(a.name).localeCompare(str(b.name), undefined, { numeric: true }))[0]
  return n ? { homeId: Number(n.home_id), where: str(n.name), homeIds } : { homeId: null, where: '', homeIds }
}

const ids = (as: any): number[] => (Array.isArray(as) ? as : []).map((a: any) => Number(a?.id)).filter((n: number) => Number.isFinite(n))

export async function planPrograms(day = ymdET(new Date()), only?: string): Promise<{ day: string; plans: PlacePlan[] }> {
  const programs = (await loadPrograms()).filter(p => (only ? p.id === only : p.active))
  if (!programs.length) return { day, plans: [] }
  const ctx = await context()
  const db = supabaseAdmin()
  const resolved = programs.flatMap(p => p.places.map(place => ({ p, place, r: resolvePlace(place, ctx) })))
  const allHomes = Array.from(new Set(resolved.flatMap(x => x.r.homeIds.concat(x.r.homeId != null ? [x.r.homeId] : []))))
  // Two reads: today's tasks at every place (cleans → who is there), and each program's own tasks over
  // the look-back window (anything still open is carried, never duplicated).
  const tasks: any[] = [], seen = new Set<string>()
  const keep = (rows: any) => { for (const t of (rows || []) as any[]) if (!seen.has(str(t.id))) { seen.add(str(t.id)); tasks.push(t) } }
  const COLS = 'id,name,home_id,type_department,assignees,status,finished_at,scheduled_date'
  for (let i = 0; i < allHomes.length; i += 150) {
    const { data } = await db.from('breezeway_tasks_sync').select(COLS).in('home_id', allHomes.slice(i, i + 150)).eq('scheduled_date', day).limit(3000)
    keep(data)
  }
  for (const p of programs) {
    const { data } = await db.from('breezeway_tasks_sync').select(COLS).ilike('name', p.name.trim().replace(/[%_]/g, '') + ':%')
      .gte('scheduled_date', shift(day, -LOOKBACK_DAYS)).lte('scheduled_date', shift(day, 14)).limit(3000)
    keep(data)
  }
  const plans: PlacePlan[] = []
  for (const { p, place, r } of resolved) {
    const base = { programId: p.id, placeId: place.id, label: place.label, kind: place.kind, schedule: scheduleLine(place), homeId: r.homeId, where: r.where }
    const mine = new Set(r.homeIds.concat(r.homeId != null ? [r.homeId] : []))
    const here = tasks.filter(t => mine.has(Number(t.home_id)))
    // Cleaners there today.
    const cleaners: Person[] = []
    let cleanToday = false
    for (const t of here) {
      if (str(t.scheduled_date) !== day || !/housekeep|clean/i.test(str(t.type_department))) continue
      if (str(t.name).indexOf(titlePrefix(p)) === 0 || isTaskGone(t.status)) continue
      cleanToday = true
      if (!p.addCleaners) continue
      for (const a of (Array.isArray(t.assignees) ? t.assignees : []) as any[]) {
        const id = Number(a?.id)
        if (Number.isFinite(id) && !NOT_A_PERSON.test(str(a?.name)) && !cleaners.some(c => c.id === id) && !p.people.some(x => x.id === id)) cleaners.push({ id, name: str(a?.name) })
      }
    }
    // This program's open tasks at the place, newest first.
    const open = here.filter(t => str(t.name).indexOf(titlePrefix(p)) === 0 && !isTaskDone(t.status, t.finished_at) && !isTaskGone(t.status))
      .map(t => ({ id: str(t.id), date: str(t.scheduled_date), assigneeIds: ids(t.assignees), homeId: Number(t.home_id) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id)))
    // Rescheduled ahead by someone (a walkthrough moved to Friday): it is this cycle's task — left
    // where it is, and nothing new is created while it waits.
    const ahead = open.filter(t => t.date > day).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null
    const todayT = open.find(t => t.date === day) || null
    const older = open.filter(t => t !== todayT && t.date < day)
    const carry = todayT ? null : older[0] || null
    const extras = todayT ? older : older.slice(1)
    const scheduled = onDays(place, day)
    const due = scheduled || (place.onCleanDays && cleanToday)
    const why = scheduled ? scheduleLine(place) : place.onCleanDays && cleanToday ? 'clean scheduled today' : 'not today'
    const people = place.people && place.people.length ? place.people : p.people
    let action: PlacePlan['action'] = 'none', note = ''
    if (r.homeId == null && !todayT && !carry) { action = 'skip'; note = place.kind === 'unit' ? 'unit not in Breezeway' : 'no Breezeway property at this building yet' }
    else if (todayT) { action = 'add'; note = 'today’s task is on the board' }
    else if (carry) { action = 'move'; note = 'not done on ' + carry.date + ' — moves to today' }
    else if (ahead) { action = 'none'; note = 'scheduled for ' + ahead.date }
    else if (due && here.some(t => str(t.name).indexOf(titlePrefix(p)) === 0 && str(t.scheduled_date) === day && isTaskDone(t.status, t.finished_at))) { action = 'none'; note = 'done today' }
    else if (due) { action = 'create'; note = 'due — ' + why }
    else note = 'not today'
    plans.push({ ...base, due, why, people, cleaners, today: todayT, carry, extras, action, note })
  }
  return { day, plans }
}

const place0 = (p: Program, pl: PlacePlan) => { const x = p.places.find(q => q.id === pl.placeId); return { ref: x ? x.ref : pl.label, label: pl.label } }

export async function runPrograms(opts: { dryRun?: boolean; only?: string } = {}) {
  const { day, plans } = await planPrograms(undefined, opts.only)
  const programs = await loadPrograms()
  const lines: string[] = []
  let created = 0, moved = 0, updated = 0, cancelled = 0
  const noSvc = await getNoService()
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured', day, plans, created, moved, updated, cancelled, lines }
  const db = supabaseAdmin()
  const mirror = async (res: any, homeId?: number | null) => {
    try {
      if (!res?.data) return
      const m: any = mapBreezewayTask(res.data)
      if (!m?.id) return
      if (homeId != null && !m.home_id) m.home_id = homeId
      m.synced_at = new Date().toISOString(); const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null
      await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
    } catch { /* the next sync mirrors it */ }
  }
  for (const pl of plans) {
    const p = programs.find(x => x.id === pl.programId)
    if (!p) continue
    const tag = p.name + ' · ' + pl.label
    // NO-INSPECTION BUILDINGS (Jon, 2026-11-06: "We do not need to do any inspections or welcome calls
    // for any Botanica units. So don't draft them or auto create them.")
    if (p.department === 'inspection' && skipsInspectionsIn(noSvc, pl.label, pl.where)) { lines.push(tag + ': no-inspection building — skipped'); continue }
    const want = pl.people.concat(pl.cleaners).map(x => x.id)
    // Duplicates first: one open task per place.
    for (const x of pl.extras) {
      if (opts.dryRun) { lines.push(tag + ': would cancel duplicate ' + x.id + ' (' + x.date + ')'); continue }
      const c = await cancelBreezewayTask(x.id).catch(() => ({ ok: false } as any))
      if (c.ok) { cancelled++; lines.push(tag + ': cancelled duplicate ' + x.id); try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled' }).eq('id', x.id) } catch { /* sync */ } }
    }
    if (pl.action === 'skip' || pl.action === 'none') { lines.push(tag + ': ' + pl.note); continue }
    const t = pl.today || pl.carry
    if (t) {
      const add = want.filter(id => t.assigneeIds.indexOf(id) < 0)
      const moving = pl.action === 'move'
      if (!moving && !add.length) { lines.push(tag + ': today’s task ' + t.id + ' already has everyone'); continue }
      if (opts.dryRun) { lines.push(tag + ': would ' + (moving ? 'move ' + t.id + ' from ' + t.date + ' to today' : 'add ' + add.length + ' to ' + t.id) + (moving && add.length ? ' and add ' + add.length : '')); continue }
      const body: any = {}
      if (add.length) body.assignments = t.assigneeIds.concat(add)
      if (moving) body.scheduled_date = day
      const r = await updateBreezewayTask(t.id, body)
      if (!r.ok) { lines.push(tag + ': Breezeway said ' + r.status + ' ' + str(r.text).slice(0, 120)); continue }
      if (moving) moved++; else updated++
      lines.push(tag + ': ' + (moving ? 'moved ' + t.id + ' from ' + t.date + ' to today' : 'added ' + add.length + ' to ' + t.id))
      await mirror(r, t.homeId)
      continue
    }
    if (opts.dryRun) { lines.push(tag + ' (' + pl.why + '): would create at ' + pl.where + ' for ' + (pl.people.concat(pl.cleaners).map(x => x.name).join(', ') || 'nobody')); continue }
    const templateId = await resolveTemplateId(p).catch(() => p.templateId || null)
    if (!templateId && p.templateName) lines.push(tag + ': checklist "' + p.templateName + '" is not in Breezeway yet — the task goes out with the note only')
    const res = await createBreezewayTask({
      home_id: pl.homeId, name: taskTitle(p, { label: pl.label } as Place), type_department: p.department, scheduled_date: day,
      template_id: templateId || null, ...(p.description ? { description: await expandDescription(p.description, place0(p, pl)) } : {}), ...(want.length ? { assignments: want } : {}),
    })
    const id = res.ok && res.data ? str(res.data.id) : ''
    if (!id) { lines.push(tag + ': Breezeway said ' + res.status + ' ' + str(res.text).slice(0, 120)); continue }
    created++
    lines.push(tag + ' (' + pl.why + '): created ' + id + ' at ' + pl.where)
    await mirror(res, pl.homeId)
  }
  return { ok: true, day, plans, created, moved, updated, cancelled, lines }
}

/** What the editor offers as places: every building (with its unit count) and every unit. */
export async function placeOptions() {
  const ctx = await context()
  const byKey: Record<string, { key: string; units: number; sample: string; inBreezeway: boolean }> = {}
  const linked = new Set(ctx.props.map(p => str(p.reference_property_id)).filter(Boolean))
  for (const l of ctx.listings) {
    const b = byKey[l.key] || (byKey[l.key] = { key: l.key, units: 0, sample: l.name, inBreezeway: false })
    if (!/\bfull\b/i.test(l.name)) b.units++
    if (linked.has(l.id)) b.inBreezeway = true
  }
  for (const p of ctx.props) if (!p.reference_property_id) { const k = buildingKey('', str(p.name)); if (byKey[k]) byKey[k].inBreezeway = true }
  return {
    buildings: Object.values(byKey).filter(b => b.units > 0).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    units: ctx.listings.filter(l => !/\bfull\b/i.test(l.name)).map(l => ({ id: l.id, name: l.name, building: l.key, inBreezeway: linked.has(l.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  }
}
