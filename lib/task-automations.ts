// AUTOMATED TASK CREATION LIVES IN UPKEEP (Jon, 2026-11-09: "automated task creations (should live
// in upkeep)").
//
// ONE LIST of everything in Lighthouse that creates, moves or closes a Breezeway task — the ones
// that run on their own and the buttons a person presses — so the Upkeep → Automations tab can show,
// per creator: what it makes, when it runs, whether it is on, its cap, who gets the work, the guard
// that stops duplicates, whether it honours the no-inspection buildings, and its last receipt.
//
// NOTHING NEW IS STORED. Every row points at the switch the creator ALREADY reads (app_settings:
// task_automation, preventative_cadences, guest_orders, site_programs) and at the receipt it ALREADY
// writes (automation_runs, lib/automation-runs). A creator with no switch says so ("always on")
// rather than pretending to have one. lib/eve/automations.ts stays the registry of every scheduled
// job; this file is only the task creators, in the words a coordinator uses.
//
// ADDING A CREATOR: one entry in TASK_CREATORS. If it has a switch, name its configKey + enabledPath
// (the toggle on the tab writes exactly that path and nothing else). If it writes a receipt, name it
// in runName.
import 'server-only'
import { getSetting, getSettingFresh, setSetting } from './app-settings'
import { lastRuns, type LastRun } from './automation-runs'
import { TASK_AUTOMATION_KEY, TASK_AUTOMATION_DEFAULTS, getTaskAutomation, type TaskAutomationCfg } from './auto-inspections'
import { CADENCE_KEY, resolveCadences, type CadenceCfg } from './cadences'
import { GUEST_ORDERS_KEY, getGuestOrdersCfg } from './guest-orders'
import { getNoService } from './no-service'
import { getNeverAssign } from './never-assign'

export type CreatorKind = 'auto' | 'human' | 'retired'
export type CreatorGroup = 'Programs' | 'Preventative' | 'Inspections' | 'Guests' | 'Eve' | 'Housekeeping moves' | 'People' | 'Retired'

type Ctx = { ta: TaskAutomationCfg; cad: CadenceCfg; ordersOn: boolean; programs: { total: number; active: number } }

export type TaskCreatorDef = {
  key: string
  group: CreatorGroup
  label: string
  /** What lands in Breezeway, in one sentence. */
  makes: string
  kind: CreatorKind
  /** When it runs, in plain words (the cron lines are in vercel.json; clock times shift with DST). */
  schedule: string
  /** automation_runs name of its receipt, when it writes one. */
  runName?: string
  /** False when the receipt's count is not "tasks made" (a shared receipt): the count is hidden. */
  countIsMade?: boolean
  /** app_settings key + dot-path of ITS OWN on/off switch. Absent = no switch. */
  configKey?: string
  enabledPath?: string
  /** A second switch that must also be on (the task-automation master). */
  masterPath?: string
  /** No own switch: it is on exactly when this other row is on. */
  follows?: string
  /** The toggle on the tab may write enabledPath. False = shown, changed elsewhere. */
  toggle?: boolean
  cap?: (c: Ctx) => string
  who?: (c: Ctx) => string
  /** Extra live facts ("3 of 4 programs active"). */
  facts?: (c: Ctx) => string
  settingsHref?: string
  settingsLabel?: string
  /** What stops a second copy. */
  guard: string
  /** How it treats the no-inspection buildings (lib/no-service). */
  noService: string
  note?: string
}

const SET_AUTOMATION = '/users?tab=settings&panel=automation'
const SET_CADENCES = '/users?tab=settings&panel=cadences'
const SET_ORDERS = '/users?tab=settings&panel=orders'
const SET_EVE = '/users?tab=settings&panel=eve'
const TWIN = 'One open task per unit + name (the create guard moves the open one instead of making a second).'
const inspWho = (c: Ctx) => [c.ta.assignAlways, 'the market supervisor (' + Object.entries(c.ta.supervisors).map(([m, n]) => m + ': ' + n).join(', ') + ')'].filter(Boolean).join(' + ')

export const TASK_CREATORS: TaskCreatorDef[] = [
  // ── Programs ──────────────────────────────────────────────────────────────────────────────────
  {
    key: 'site-programs', group: 'Programs', label: 'Property programs', kind: 'auto',
    makes: 'The scheduled walk / check of each program at each building or unit (exterior walkthrough, parking check, Eden walk…). Not done → the same task moves to today.',
    schedule: 'Four times a day', runName: 'site-programs', countIsMade: false,
    configKey: 'site_programs', toggle: false,
    facts: c => c.programs.total ? c.programs.active + ' of ' + c.programs.total + ' program' + (c.programs.total === 1 ? '' : 's') + ' active' : 'no saved programs yet',
    cap: () => 'One open task per place per program',
    who: () => 'Each program’s people, plus whoever is cleaning there that day when the program says so',
    settingsHref: '#property', settingsLabel: 'Property programs tab',
    guard: 'One open task per place: today’s is kept, an older one is moved, extras are cancelled. Plus the create guard.',
    noService: 'Skips inspection-department programs at no-inspection buildings.',
    note: 'Each program has its own pause button on the Property programs tab. The receipt counts creates + moves + updates together.',
  },
  {
    key: 'walk-fix', group: 'Programs', label: 'Fix tasks from a finished walk', kind: 'auto',
    makes: 'One maintenance task per failed line of a program walk that has an owner report, with the photo and note.',
    schedule: 'When such a walk is finished in Breezeway (checked three times a day)', runName: 'walk-reports', countIsMade: false,
    cap: () => 'At most 20 per walk',
    who: () => 'The program’s people',
    settingsHref: '#property', settingsLabel: 'Program → report settings',
    guard: TWIN + ' The same issue found again on the next walk reuses the open fix task.',
    noService: 'Not an inspection — not affected.',
    note: 'Always on for programs whose report is not “off”. No separate switch yet.',
  },
  // ── Preventative ──────────────────────────────────────────────────────────────────────────────
  {
    key: 'cadence-suggest', group: 'Preventative', label: 'Preventative jobs (morning list)', kind: 'auto',
    makes: 'Works out which preventative jobs are due and can happen today. Programs set to “create automatically” are created; the rest are only suggested on Today in Ops.',
    schedule: 'Every morning, once', runName: 'suggestions',
    configKey: CADENCE_KEY, enabledPath: 'enabled', toggle: true,
    facts: c => { const auto = c.cad.cadences.filter(x => x.mode === 'auto'), sug = c.cad.cadences.filter(x => x.mode === 'suggest'); return (auto.length ? 'Creates by itself: ' + auto.map(x => x.label).join(', ') : 'Nothing is set to create by itself') + ' · suggests ' + sug.length + ' other' + (sug.length === 1 ? '' : 's') },
    cap: c => c.cad.dailyCap + ' a day · ' + c.cad.perUnitCap + ' per unit · ' + c.cad.perPersonMinutes + ' extra minutes per person',
    who: c => 'The program’s team; otherwise whoever of that trade is already on site' + (c.cad.requireStaffOnSite ? ' (only buildings somebody is visiting)' : ''),
    settingsHref: SET_CADENCES, settingsLabel: 'Preventative cadences',
    guard: 'Any open task matching the program’s pattern suppresses a new one; plus the create guard.',
    noService: 'Skips inspection programs at no-inspection buildings.',
    note: 'On a heavy turn day it creates nothing on purpose. Per-program settings: the Programs tab → a tile → Edit.',
  },
  {
    key: 'cadence-carry', group: 'Preventative', label: 'Late preventative tasks carried to today', kind: 'auto',
    makes: 'Moves each open preventative task dated before today to today (never a second task). Older copies of the same job that Lighthouse itself created are cancelled.',
    schedule: 'Every morning, with the list above', runName: 'suggestions', countIsMade: false,
    cap: () => '120 tasks a run',
    who: () => 'Whoever is already on the task',
    guard: 'Moves only. Does not move a job that needs the unit empty or rides a departure (those wait for the next empty day / checkout). Cancels only tasks on the PM ledger or the accepted-suggestions log.',
    noService: 'Moves existing tasks only.',
    note: 'Always on — it runs even when the preventative switch is off, because the tasks exist either way. No separate switch yet.',
  },
  {
    key: 'pm-recurrence', group: 'Preventative', label: 'Next preventative task books itself', kind: 'auto',
    makes: 'When a preventative job is completed, the next one goes on the ledger and is created (or proposed to an approver) about two weeks before it is due — on an empty day when the job needs one, or on the next departure for jobs that ride the clean.',
    schedule: 'Up to four times a day, at most once every six hours', runName: 'pm-recurrence',
    follows: 'cadence-suggest',
    cap: c => c.cad.dailyCap + ' created or proposed a day (its own count, separate from the morning list) · 25 a run',
    who: c => 'Housekeeping jobs: unassigned. Others: ' + inspWho(c),
    settingsHref: SET_CADENCES, settingsLabel: 'Preventative cadences',
    guard: 'One ledger row per unit + program; no successor while a matching task is open; plus the create guard.',
    noService: 'Never books an inspection program or follow-on at a no-inspection building.',
    note: 'Uses the same master switch as the morning list. Programs with approvers wait for a yes on the Programs tab.',
  },
  {
    key: 'upkeep-approve', group: 'Preventative', label: 'Approve / book from Upkeep', kind: 'human',
    makes: 'The program’s task for one unit, on the day picked (or the best empty day / next departure).',
    schedule: 'When someone presses Approve or books a day on the calendar',
    who: () => 'The person picked; else the program’s team; else whoever of the trade is going there',
    guard: TWIN,
    noService: 'A person’s own booking is not stopped.',
  },
  {
    key: 'suggestion-add', group: 'Preventative', label: 'Add from the suggestion list', kind: 'human',
    makes: 'The suggested preventative task, with the assignee and day chosen.',
    schedule: 'When someone presses Add on a suggestion (Today in Ops, Assign, Vacant)',
    guard: TWIN, noService: 'No-inspection buildings are never suggested.',
  },
  // ── Inspections ───────────────────────────────────────────────────────────────────────────────
  {
    key: 'insp-master', group: 'Inspections', label: 'Automatic inspections — master switch', kind: 'auto',
    makes: 'Lets the four inspection rules below create tasks. Off = none of them create, and unwalked arrival inspections are not retired.',
    schedule: 'Four times a day', runName: 'auto-inspections',
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'enabled', toggle: true,
    who: inspWho,
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation',
    guard: 'Each rule keeps an exactly-once receipt (auto_inspections).',
    noService: 'Every rule skips no-inspection buildings.',
    note: 'The count is every inspection filed in the run, across the four rules.',
  },
  {
    key: 'insp-prearrival', group: 'Inspections', label: 'Pre-arrival inspection (big / VIP / owner stay)', kind: 'auto',
    makes: '“Pre-arrival inspection — unit (reason, arrives date)” on arrival day. One never walked is retired the morning after the arrival.',
    schedule: 'Four times a day', runName: 'insp-prearrival',
    follows: 'insp-master',
    facts: c => [c.ta.bigArrivals ? 'big arrivals from $' + c.ta.bigValue.toLocaleString('en-US') : '', c.ta.vip ? 'VIP guests' : '', c.ta.ownerStays ? 'owner stays' : ''].filter(Boolean).join(' · ') + ' · looks ' + c.ta.daysAhead + ' day' + (c.ta.daysAhead === 1 ? '' : 's') + ' ahead',
    cap: () => 'One per reservation',
    who: inspWho,
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation',
    guard: 'One per reservation (auto_inspections). The arrival date is in the name, so two stays back to back each get their own.',
    noService: 'Skips no-inspection buildings and buildings whose inspections are not ours.',
  },
  {
    key: 'insp-arrival-feedback', group: 'Inspections', label: 'Quality inspection before an arrival (bad review on the unit)', kind: 'auto',
    makes: '“Quality inspection — unit (what the guest named)” for arrival day, when the unit’s recent review was bad and nobody has walked it since.',
    schedule: 'Four times a day', runName: 'insp-arrival-feedback',
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'arrivalFeedback', masterPath: 'enabled', toggle: true,
    cap: () => 'One per unit; none while any inspection is open on the unit',
    who: inspWho,
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation',
    guard: 'One per review; skipped when any inspection is already open on the unit or a walk finished since the review.',
    noService: 'Skips no-inspection buildings.',
  },
  {
    key: 'insp-low-review', group: 'Inspections', label: 'Quality inspection after a low review', kind: 'auto',
    makes: '“Quality inspection — unit (rating, complaint)” on the unit’s next checkout. Not done by then → the same task rolls to the following checkout.',
    schedule: 'Four times a day', runName: 'insp-low-review',
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'lowReviews', masterPath: 'enabled', toggle: true,
    facts: c => 'reviews at ' + c.ta.lowReviewMax + '★ or below',
    cap: () => 'One per review',
    who: inspWho,
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation',
    guard: 'One per review; a walk finished since the review covers it. Does NOT yet check for another open inspection on the unit.',
    noService: 'Skips no-inspection buildings on create (the roll-forward moves an existing task without checking).',
  },
  {
    key: 'insp-deep-clean', group: 'Inspections', label: 'Deep clean inspection', kind: 'auto',
    makes: '“Deep clean inspection — unit” for the market supervisor after every finished deep clean, before the owner is billed.',
    schedule: 'Four times a day', runName: 'insp-deep-clean',
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'deepCleanInspections', masterPath: 'enabled', toggle: true,
    cap: () => 'One per finished deep clean; one per unit a run',
    who: inspWho,
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation',
    guard: 'One per deep clean; an already-open deep clean inspection on the unit covers it.',
    noService: 'Skips no-inspection buildings.',
  },
  // ── Housekeeping moves ────────────────────────────────────────────────────────────────────────
  {
    key: 'trip-sweep', group: 'Housekeeping moves', label: 'Pending maintenance joins today’s visit', kind: 'auto',
    makes: 'Creates nothing. When maintenance is already going into a unit today, that unit’s other pending maintenance tasks are moved onto the same day and stamped “[Moved to …]”.',
    schedule: 'Every morning, and when a suggestion is added', runName: 'suggestions', countIsMade: false,
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'tripSweep.enabled', toggle: true,
    cap: c => 'Up to 60 units a morning · looks back ' + c.ta.tripSweep.lookBackDays + ' days, pulls forward at most ' + c.ta.tripSweep.maxFutureDays + ' days',
    who: () => 'The person already making the visit',
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation',
    guard: 'Moves only.', noService: 'Moves existing tasks only.',
  },
  {
    key: 'stale-cleans', group: 'Housekeeping moves', label: 'Old departure cleans closed', kind: 'auto',
    makes: 'Creates nothing. Closes departure cleans left open long after the departure.',
    schedule: 'Every morning', runName: 'suggestions', countIsMade: false,
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'staleCleans.enabled', toggle: true,
    cap: c => c.ta.staleCleans.maxPerRun + ' a run · after ' + c.ta.staleCleans.afterDays + ' days' + (c.ta.staleCleans.skipOccupied ? ' · never an occupied unit' : ''),
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation (preview there)',
    guard: 'Closes only.', noService: 'Not an inspection — not affected.',
  },
  {
    key: 'stray-inspections', group: 'Housekeeping moves', label: 'Stray inspections closed', kind: 'auto',
    makes: 'Creates nothing. Closes inspections Lighthouse did not create that sat open past their day; unowned maintenance is moved forward.',
    schedule: 'Every morning', runName: 'suggestions', countIsMade: false,
    configKey: TASK_AUTOMATION_KEY, enabledPath: 'strayInspections.enabled', toggle: true,
    cap: c => c.ta.strayInspections.maxPerRun + ' a run · after ' + c.ta.strayInspections.afterDays + ' days',
    settingsHref: SET_AUTOMATION, settingsLabel: 'Task automation (audit there)',
    guard: 'Closes only.', noService: 'Closes existing tasks only.',
  },
  {
    key: 'connecting-doors', group: 'Housekeeping moves', label: 'Connecting door — Capri 115/116', kind: 'auto',
    makes: '“Open connecting door” before a combined booking arrives and “Close connecting door” at its checkout, for the cleaner on that clean; the clean’s title gets the note too.',
    schedule: 'Hourly through the day', runName: 'connecting-doors', countIsMade: false,
    cap: () => 'One open and one close task per combined booking',
    who: () => 'The cleaner(s) on that departure clean',
    guard: 'A task of the same kind already at the unit in the window is the one.',
    noService: 'Not an inspection — not affected.',
    note: 'Always on. The pair of units is set in code (lib/connecting-doors); no switch yet.',
  },
  // ── Guests ────────────────────────────────────────────────────────────────────────────────────
  {
    key: 'guest-orders', group: 'Guests', label: 'Guest orders', kind: 'auto',
    makes: '“Guest order — items · #order” for housekeeping on the delivery day, once the order is paid.',
    schedule: 'Every two hours, and at once when an order is paid (6am–9pm)', runName: 'guest-orders', countIsMade: false,
    configKey: GUEST_ORDERS_KEY, enabledPath: 'enabled', toggle: true,
    cap: () => 'One task per order',
    who: () => 'The cleaner on that unit that day, else the area’s housekeeping lead',
    settingsHref: SET_ORDERS, settingsLabel: 'Guest orders',
    guard: 'The order keeps its task id; the order number is in the task name, so two orders for the same items never share a task.',
    noService: 'Not an inspection — not affected.',
  },
  {
    key: 'lost-found', group: 'Guests', label: 'Lost & Found delivery', kind: 'human',
    makes: '“Lost & Found Delivery — guest” on the Lost and Found property for the next Tuesday. Not done → the same task moves to the following Tuesday (automatic, every 15 minutes).',
    schedule: 'When someone marks the item paid / presses ship', runName: 'lost-found', countIsMade: false,
    who: () => 'The delivery people for the item’s market',
    settingsHref: '/lost-found', settingsLabel: 'Lost & Found',
    guard: 'The item keeps its task id; one task per item.',
    noService: 'Filed on the Lost and Found property — not affected.',
  },
  {
    key: 'glitch-push', group: 'Guests', label: 'Glitch → Breezeway task', kind: 'human',
    makes: 'The guest-reported issue as a task with the glitch checklist, the guest’s words and the unit’s history.',
    schedule: 'When someone presses Push to Breezeway on a glitch',
    settingsHref: '/glitches', settingsLabel: 'Glitches',
    guard: 'The glitch keeps its task id; plus the create guard.', noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'sentiment-qc', group: 'Guests', label: 'QC task from a guest conversation', kind: 'human',
    makes: 'A targeted inspection / maintenance / housekeeping task with the guest context.',
    schedule: 'When someone presses Create QC task (never automatic)',
    guard: 'One per conversation; plus the create guard.', noService: 'A person’s own task is not stopped.',
  },
  // ── Eve ───────────────────────────────────────────────────────────────────────────────────────
  {
    key: 'eve-task-create', group: 'Eve', label: 'Eve creates a task', kind: 'auto',
    makes: 'A task Eve proposes or creates from her watches (big arrival with no inspection, bad review just landed, glitch past due with no task), from chat, or when someone approves her ask.',
    schedule: 'Watches run twice an hour; chat and approvals when they happen', runName: 'eve-watches', countIsMade: false,
    cap: () => 'Her daily action and ask limits (Agent mode)',
    who: () => 'Whoever the ask names',
    settingsHref: SET_EVE, settingsLabel: 'Eve → Agent mode',
    guard: TWIN + ' When the job was already open she says so, leaves its people alone, and offers no undo.',
    noService: 'Her automatic inspection creates are refused at no-inspection buildings; a person’s yes is not.',
    note: 'How far she may go on her own (draft / ask / act) is set per action in Agent mode — not switched here.',
  },
  // ── People ────────────────────────────────────────────────────────────────────────────────────
  {
    key: 'add-task', group: 'People', label: 'Add a task (Today in Ops, Schedule)', kind: 'human',
    makes: 'Whatever the person typed, with the unit’s history attached.',
    schedule: 'When someone presses Add task',
    guard: TWIN + ' A second inspection is refused while an automatic one is open on the unit.',
    noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'field-board-add', group: 'People', label: 'Add from a field board', kind: 'human',
    makes: 'A job filed by the person standing in the unit, on boards with Add switched on.',
    schedule: 'When a field user adds a job on their board link',
    settingsHref: '/users?tab=settings&panel=share', settingsLabel: 'Share links',
    guard: TWIN, noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'project-task', group: 'People', label: 'Project task → Breezeway', kind: 'human',
    makes: 'A project task sent to the field, with its checklist template when one is picked. “Plan with Eve” can send a batch.',
    schedule: 'When someone sends a project task to Breezeway',
    settingsHref: '/projects', settingsLabel: 'Projects',
    guard: TWIN, noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'audit-task', group: 'People', label: 'Property audit items → tasks', kind: 'human',
    makes: 'One task per audit finding (or a batch for the whole audit), with a standard brief.',
    schedule: 'When a manager presses Create task(s) on an audit',
    guard: TWIN, noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'billing-create', group: 'People', label: 'Task from Billable hours', kind: 'human',
    makes: 'A billable job with photos, an amount and an owner link.',
    schedule: 'When someone adds a task on Billable hours',
    guard: TWIN, noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'health-push', group: 'People', label: 'Listing action-plan issue → task', kind: 'human',
    makes: 'The issue as a task on the unit’s next vacant day.',
    schedule: 'When someone confirms the push (the first press is a preview)',
    guard: 'One per issue; plus the create guard.', noService: 'A person’s own task is not stopped.',
  },
  {
    key: 'create-clean', group: 'People', label: 'Create a missing departure clean', kind: 'human',
    makes: 'The departure clean Breezeway never created for a Guesty checkout.',
    schedule: 'When someone presses Create clean on the Schedule',
    guard: 'Skipped when a housekeeping clean already exists for the unit + day. Cleans are per stay and exempt from the create guard.',
    noService: 'Not an inspection — not affected.',
  },
  // ── Retired ───────────────────────────────────────────────────────────────────────────────────
  {
    key: 'walkthroughs', group: 'Retired', label: 'Weekly exterior walkthroughs (old)', kind: 'retired',
    makes: 'Nothing now — the “Property Exterior Walkthrough” program creates these.',
    schedule: 'Not scheduled', runName: 'walkthroughs', countIsMade: false,
    settingsHref: '#property', settingsLabel: 'Property programs tab',
    guard: 'Its old link only runs with ?legacy=1.', noService: 'Skips no-inspection buildings.',
  },
  {
    key: 'parking-task', group: 'Retired', label: 'Daily parking check (old)', kind: 'retired',
    makes: 'Nothing now — the “Parking Check” program creates these.',
    schedule: 'Not scheduled', runName: 'parking-task', countIsMade: false,
    settingsHref: '#property', settingsLabel: 'Property programs tab',
    guard: 'Its old link only runs with ?legacy=1.', noService: 'Skips no-inspection buildings.',
  },
]

export type TaskCreatorState = {
  key: string; group: CreatorGroup; label: string; makes: string; kind: CreatorKind; schedule: string
  /** true / false = its switch; null = no switch (always on, or a person presses it). */
  on: boolean | null
  /** The sentence beside the switch. */
  onWhy: string
  /** True when its own switch is on but the master above it is off. */
  heldByMaster: boolean
  canToggle: boolean
  cap: string | null; who: string | null; facts: string | null
  lastRun: LastRun | null
  /** Show lastRun.itemCount as "made". */
  countIsMade: boolean
  hasReceipt: boolean
  settingsHref: string | null; settingsLabel: string | null
  guard: string; noService: string; note: string | null
}
export type SharedRules = {
  neverAssign: string[]
  noInspections: string[]
  noWelcomeCalls: string[]
}
export type TaskAutomationsPayload = { ok: boolean; creators: TaskCreatorState[]; rules: SharedRules; isOwner: boolean; asOf: string; error?: string }

const readPath = (obj: any, path: string): any => path.split('.').reduce((o: any, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)

async function loadCtx(): Promise<Ctx> {
  const [ta, cadRaw, orders, progRaw] = await Promise.all([
    getTaskAutomation().catch(() => TASK_AUTOMATION_DEFAULTS),
    getSetting<any>(CADENCE_KEY, null).catch(() => null),
    getGuestOrdersCfg().catch(() => null),
    // Read raw on purpose: lib/site-programs loadPrograms() seeds the setting on a first read, and a
    // page that only LOOKS must not write.
    getSetting<any>('site_programs', null).catch(() => null),
  ])
  const list: any[] = Array.isArray(progRaw?.programs) ? progRaw.programs : []
  return {
    ta, cad: resolveCadences(cadRaw), ordersOn: !!orders && orders.enabled === true,
    programs: { total: list.length, active: list.filter(p => p && p.active !== false).length },
  }
}

/** The resolved (defaults applied) value of a creator's own switch — what the creator itself reads. */
function switchOf(def: TaskCreatorDef, c: Ctx): boolean | null {
  if (!def.configKey || !def.enabledPath) return null
  if (def.configKey === TASK_AUTOMATION_KEY) return readPath(c.ta, def.enabledPath) === true
  if (def.configKey === CADENCE_KEY) return readPath(c.cad, def.enabledPath) === true
  if (def.configKey === GUEST_ORDERS_KEY) return c.ordersOn
  return null
}

export async function taskAutomationStates(): Promise<{ creators: TaskCreatorState[]; rules: SharedRules }> {
  const names = Array.from(new Set(TASK_CREATORS.map(d => d.runName).filter((n): n is string => !!n)))
  const [c, runs, never, noSvc] = await Promise.all([
    loadCtx(),
    lastRuns(names).catch(() => ({} as Record<string, LastRun>)),
    getNeverAssign().catch(() => []),
    getNoService().catch(() => ({ inspections: [] as string[], welcomeCalls: [] as string[] })),
  ])
  const own: Record<string, boolean | null> = {}
  for (const d of TASK_CREATORS) own[d.key] = switchOf(d, c)
  const safe = (f: ((x: Ctx) => string) | undefined): string | null => { if (!f) return null; try { return f(c) || null } catch { return null } }
  const creators = TASK_CREATORS.map((d): TaskCreatorState => {
    let on: boolean | null = own[d.key]
    let onWhy = ''
    let heldByMaster = false
    if (d.kind === 'human') { on = null; onWhy = 'A person presses it' }
    else if (d.kind === 'retired') { on = false; onWhy = 'Retired' }
    else if (d.follows) {
      const f = TASK_CREATORS.find(x => x.key === d.follows)
      on = own[d.follows] ?? null
      onWhy = (on ? 'On' : 'Off') + ' — follows “' + (f ? f.label : d.follows) + '”'
    } else if (on === null) {
      onWhy = d.key === 'site-programs' ? (c.programs.active ? 'On — per program' : 'No active program') : 'Always on — no switch'
      if (d.key === 'site-programs') on = c.programs.active > 0
    } else {
      const master = d.masterPath && d.configKey === TASK_AUTOMATION_KEY ? readPath(c.ta, d.masterPath) === true : true
      heldByMaster = on && !master
      onWhy = heldByMaster ? 'On, but the master switch is off — nothing is created' : on ? 'On' : 'Off'
    }
    const run = d.runName ? runs[d.runName] || null : null
    return {
      key: d.key, group: d.group, label: d.label, makes: d.makes, kind: d.kind, schedule: d.schedule,
      on, onWhy, heldByMaster,
      canToggle: d.kind === 'auto' && d.toggle === true && !!d.configKey && !!d.enabledPath,
      cap: safe(d.cap), who: safe(d.who), facts: safe(d.facts),
      lastRun: run, countIsMade: d.countIsMade !== false, hasReceipt: !!d.runName,
      settingsHref: d.settingsHref || null, settingsLabel: d.settingsLabel || null,
      guard: d.guard, noService: d.noService, note: d.note || null,
    }
  })
  return {
    creators,
    rules: {
      neverAssign: never.map(p => String(p.name || '')).filter(Boolean),
      noInspections: noSvc.inspections || [],
      noWelcomeCalls: noSvc.welcomeCalls || [],
    },
  }
}

/**
 * Flip ONE creator's own switch. Writes exactly the registry's enabledPath inside the stored config
 * and leaves every other key as it was (a fresh, uncached read first — a cached one can be a minute
 * behind another save). A config that has never been saved starts from the creator's shipped
 * defaults, so the first flip cannot drop a key. Only keys this file names can be written.
 */
export async function setTaskAutomationSwitch(key: string, on: boolean, by: string | null): Promise<{ ok: boolean; error?: string }> {
  const def = TASK_CREATORS.find(d => d.key === key)
  if (!def || def.kind !== 'auto' || def.toggle !== true || !def.configKey || !def.enabledPath) return { ok: false, error: 'That one has no switch here.' }
  const path = def.enabledPath.split('.')
  if (!path.length || path.some(p => !/^[A-Za-z][A-Za-z0-9]*$/.test(p))) return { ok: false, error: 'bad switch path' }
  const raw = await getSettingFresh<any>(def.configKey, null)
  let base: any
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) base = raw
  else if (def.configKey === TASK_AUTOMATION_KEY) base = TASK_AUTOMATION_DEFAULTS
  else base = {}          // cadences / guest orders: their readers fill every missing key from defaults
  const next: any = JSON.parse(JSON.stringify(base))
  let node = next
  for (let i = 0; i < path.length - 1; i++) {
    // A nested block (tripSweep, staleCleans…) missing from an older saved config: start it from the defaults.
    if (!node[path[i]] || typeof node[path[i]] !== 'object') {
      const d = def.configKey === TASK_AUTOMATION_KEY ? readPath(TASK_AUTOMATION_DEFAULTS, path.slice(0, i + 1).join('.')) : null
      node[path[i]] = d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : {}
    }
    node = node[path[i]]
  }
  node[path[path.length - 1]] = on === true
  next.updatedAt = new Date().toISOString()
  next.updatedBy = by || null
  return setSetting(def.configKey, next, by)
}
