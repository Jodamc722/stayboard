// THE BILLABLE MODEL — which tasks should bill the owner, so nobody reads 6,000 tasks to find them.
//
// Jon, 2026-09-30: "Billable is anything that we fix or clean that's done outside of a departure
// clean, like preventative maintenance, clean, or pest control. There should be a flagging system.
// It doesn't necessarily mean it's billable, but your system should identify it."
//
// Three layers, cheapest first, each one explaining itself in a sentence:
//
//   1. JON'S RULE, as categories. Repairs, preventative maintenance, pest control, extra cleans
//      (deep / carpet / owner stay / onboarding) and owner deliveries & assembly are BILLABLE.
//      Departure / turnover cleans, routine unit checks and strips, pre-arrival inspections,
//      building & common-area work (lobby, pool, exterior, trash, laundry hub) and re-cleans we owe a
//      guest are NOT. Everything else is MAYBE.
//   2. WHAT WE DID BEFORE. Every final-approved task of the last 120 days teaches the model how often
//      that kind of task (normalised name + department) was actually billed. History can move a MAYBE
//      either way and adds "billed 8 of 10 times" to the reason — it never overrules Jon's rule (PM
//      was rarely billed in the past; the rule says it is billable, so it gets flagged).
//   3. THE MODEL, for what is still MAYBE and has a real description: one short call per batch,
//      cached per task, so a MAYBE with "replaced the kitchen faucet" in it becomes LIKELY.
//
// Output per task: verdict bill | likely | maybe | no, a category, a confidence and the reasons.
// The desk flags two things: SHOULD BILL (bill/likely, finished, still $0) and BILLED, LOOKS ROUTINE
// (no, but carrying money). A flag never prices or approves anything — a person still does.
import 'server-only'
import { getSetting, setSetting } from './app-settings'

export type BillableVerdict = 'bill' | 'likely' | 'maybe' | 'no'
export type BillableCategory = 'repair' | 'pm' | 'pest' | 'extra_clean' | 'owner_item' | 'guest_fix' | 'departure_clean' | 'routine' | 'inspection' | 'building' | 'our_fault' | 'other'
export type Billable = { verdict: BillableVerdict; category: BillableCategory; confidence: number; reasons: string[]; history?: { billed: number; total: number } | null; ai?: 'bill' | 'no' | null }

export const CATEGORY_LABEL: Record<BillableCategory, string> = {
  repair: 'Repair', pm: 'Preventative', pest: 'Pest control', extra_clean: 'Extra clean', owner_item: 'Owner item / install',
  guest_fix: 'Guest-reported fix', departure_clean: 'Departure clean', routine: 'Routine check', inspection: 'Inspection',
  building: 'Building / common area', our_fault: 'Re-clean we owe', other: 'Other',
}

// ── Layer 1: the rules ────────────────────────────────────────────────────────────────────────
const RX = {
  departure: /(departure|turnover|check-?out)[\s\-_/]*clean|departure clean checklist/i,
  ownerClean: /owner[\s-]*(charge|stay|clean|request)|deep[\s-]*clean|move[\s-]*(in|out)[\s-]*clean|post[\s-]*construction|onboarding[\s-]*clean|carpet|shampoo?|upholster|window[s]?[\s-]*clean|oven[\s-]*clean|fridge[\s-]*clean|grout[\s-]*clean|pressure[\s-]*wash|power[\s-]*wash|mid[\s-]*stay[\s-]*clean|touch[\s-]*up[\s-]*clean/i,
  ourFault: /re[\s-]*clean|reclean|guest complaint|missed (spot|area)|not clean(ed)? properly|redo/i,
  pest: /pest|fog(g)?|extermin|roach|\bants?\b|bed[\s-]*bug|rodent|termite|mosquito|spray(ed)? (for|the unit)/i,
  pm: /preventat|preventiv|\bpm\b|filter|a\/?c[\s-]*(deep[\s-]*)?(clean|service|maint)|coil|batter(y|ies)|dryer[\s-]*vent|water[\s-]*heater|drain[s]?[\s-]*(clean|flush)|gutter|smoke[\s-]*detector|caulk|seal(ant)?|grease trap|flush the|descal/i,
  repair: /repair|fix|replace|replac|broken|broke|leak|clog|not work|doesn'?t work|isn'?t work|(no )?hot water|not heating|install|paint|touch[\s-]*up|drywall|patch|hinge|handle|toilet|faucet|shower|sink|door[\s-]*lock|lock\b|refrigerat|fridge|dishwasher|washer|dryer|microwave|stove|oven|burner|a\/?c\b|air[\s-]*condition|thermostat|electric|outlet|breaker|light(s)?\b|bulb|ceiling|tile|floor|blind|curtain|rod|tv\b|remote|wifi|internet|router|plumb|pipe|garbage disposal|mold|water damage/i,
  ownerItem: /purchas|\bbuy\b|bought|\bbring (a|the|some)\b|missing items|kitchen (items|utensils)|utensil|silverware|arriv(ed|es|ing)|assembl|deliver(ed|y)? (of|the)|mount(ed)?|\bhang(ed|ing)?\b|set[\s-]*up (the|new)|new (fridge|tv|sofa|bed|mattress|lamp|stools?|table|chair)|box[\s-]*spring|furniture|night[\s-]*stand|lamp|stool|mattress|pillow|oven tray|toaster|dispenser/i,
  inspection: /pre[\s-]*arrival inspection|post[\s-]*clean inspection|audit scoring|inspection checklist|walk[\s-]*through inspection|quality (audit|inspection)|lista de verificaci/i,
  building: /common area|lobby|landing|pool|fitness|gym|exterior|parking|office clean|office cleaning|hub laundry|push laundry|laundry room|water plants|blower|trash (pick|take|&)|trash pickup|pick up trash|take trash|dumpster|elevator|hallway|stairwell|mailroom|master code/i,
  guestReported: /guest[\s-]*reported|glitch|guest (request|has request|requested)/i,
  guestService: /deliver (fresh )?towels|refresh|exchange linen|extra (towels|linen|amenit)|amenit(y|ies) (drop|restock)/i,
}

/** Normalise a task name the way people vary it: numbers, dates, "[moved to sep 3]", unit tags. */
export function nameKey(department: string, name: string): string {
  const n = String(name || '').toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ').replace(/[0-9#]+/g, ' ').replace(/⚠.*$/, ' ')
    .replace(/[^a-z/&\- ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(/\s*[/|]\s*/).slice(0, 2).join(' / ').slice(0, 48)
  return `${String(department || 'other').slice(0, 12)}|${n}`
}

type Input = {
  id: string; department: string; name: string; description: string | null; status?: string; finished?: boolean
  actualMinutes: number | null; laborAmount: number; itemsOwner: number; routine: string | null
  isDeparture: boolean; aiVerdict?: string | null
}
type Model = { at: number; keys: Record<string, { b: number; n: number }>; ai: Record<string, { v: 'bill' | 'no'; r: string }> }

export function classify(t: Input, model?: Model | null): Billable {
  const text = `${t.name} ${t.description || ''}`
  const name = t.name
  const reasons: string[] = []
  let category: BillableCategory = 'other'
  let verdict: BillableVerdict = 'maybe'
  let conf = 0.5

  // Hard NOs first — Jon's exclusions.
  if (t.isDeparture && !RX.ownerClean.test(name)) { category = 'departure_clean'; verdict = 'no'; conf = 0.95; reasons.push('Departure clean — part of the turnover, never billed separately') }
  else if (t.routine && t.aiVerdict !== 'bill') { category = 'routine'; verdict = 'no'; conf = 0.9; reasons.push(t.routine === 'strip' ? 'Strip & walkthrough — part of the turnover' : 'Unit check — an access log, not work') }
  else if (RX.ourFault.test(name) && !RX.ownerClean.test(name)) { category = 'our_fault'; verdict = 'no'; conf = 0.8; reasons.push('A re-clean after a guest complaint — ours to absorb') }
  else if (t.department === 'inspection' && RX.inspection.test(name)) { category = 'inspection'; verdict = 'no'; conf = 0.85; reasons.push('Inspection / audit — quality control, not work for the owner') }
  else if (RX.building.test(name) && !RX.repair.test(name) && !RX.pest.test(name)) { category = 'building'; verdict = 'no'; conf = 0.8; reasons.push('Building or common-area work — not one owner\'s unit') }
  // Jon's YES categories.
  else if (RX.pest.test(text)) { category = 'pest'; verdict = 'bill'; conf = 0.9; reasons.push('Pest control — billable') }
  else if (RX.pm.test(name) || (/preventat/i.test(text))) { category = 'pm'; verdict = 'bill'; conf = 0.85; reasons.push('Preventative maintenance — billable') }
  else if (RX.ownerClean.test(text) && !t.isDeparture) { category = 'extra_clean'; verdict = 'bill'; conf = 0.85; reasons.push('A clean outside the departure clean — billable') }
  else if (RX.ownerClean.test(name) && t.isDeparture) { category = 'extra_clean'; verdict = 'bill'; conf = 0.8; reasons.push('Owner-charge / owner-stay clean — billable') }
  else if (RX.guestReported.test(name) && RX.repair.test(text)) { category = 'guest_fix'; verdict = 'likely'; conf = 0.7; reasons.push('Guest-reported problem that needed a fix') }
  else if (RX.repair.test(text) && t.department !== 'housekeeping') { category = 'repair'; verdict = 'bill'; conf = 0.8; reasons.push('A fix or repair — billable') }
  else if (RX.guestService.test(name)) { category = 'other'; verdict = 'maybe'; conf = 0.4; reasons.push('Guest service (towels / linen) — usually not billed') }
  else if (RX.ownerItem.test(text)) { category = 'owner_item'; verdict = 'likely'; conf = 0.65; reasons.push('Delivering, assembling or installing an owner item — labor to bill') }
  else if (RX.repair.test(text)) { category = 'repair'; verdict = 'likely'; conf = 0.6; reasons.push('Mentions a fix or replacement') }
  else if (RX.guestReported.test(name)) { category = 'guest_fix'; verdict = 'maybe'; conf = 0.5; reasons.push('Guest-reported — billable only if something was fixed') }
  else if (t.department === 'maintenance') { category = 'repair'; verdict = 'likely'; conf = 0.55; reasons.push('Maintenance work outside a departure clean') }

  // Evidence of real work moves a MAYBE up; nothing moves a hard NO.
  if (verdict === 'maybe' || verdict === 'likely') {
    if (t.itemsOwner > 0) { verdict = verdict === 'maybe' ? 'likely' : 'bill'; conf += 0.15; reasons.push('Has owner-billed cost lines') }
    else if ((t.actualMinutes || 0) >= 20 && t.department === 'maintenance') { conf += 0.1; reasons.push(`${Math.round(t.actualMinutes! / 6) / 10}h on the clock`) }
  }

  // Layer 2: what we did before with this kind of task.
  const h = model?.keys?.[nameKey(t.department, t.name)]
  const history = h && h.n >= 3 ? { billed: h.b, total: h.n } : null
  if (history) {
    const rate = history.billed / history.total
    reasons.push(`Billed ${history.billed} of ${history.total} times before`)
    if (verdict === 'maybe') { if (rate >= 0.6) { verdict = 'likely'; conf = Math.max(conf, 0.65) } else if (rate <= 0.1 && history.total >= 5) { verdict = 'no'; conf = 0.6 } }
    else if (verdict === 'likely' && rate >= 0.8) { verdict = 'bill'; conf = Math.max(conf, 0.8) }
  }

  // Layer 3: the model's read of a MAYBE with a description.
  const ai = model?.ai?.[t.id] || null
  if (ai && (verdict === 'maybe' || verdict === 'likely')) {
    if (ai.v === 'bill') { verdict = verdict === 'maybe' ? 'likely' : 'bill'; conf = Math.max(conf, 0.7) } else if (verdict === 'maybe') { verdict = 'no'; conf = 0.6 }
    reasons.push('AI: ' + ai.r)
  }
  return { verdict, category, confidence: Math.min(0.99, Math.round(conf * 100) / 100), reasons, history, ai: ai ? ai.v : null }
}

// ── Model state (app_settings billable_model) ─────────────────────────────────────────────────
const KEY = 'billable_model'
let _m: { at: number; val: Model } | null = null
export async function loadModel(): Promise<Model> {
  if (_m && Date.now() - _m.at < 5 * 60 * 1000) return _m.val
  const v = await getSetting<any>(KEY, null).catch(() => null)
  const val: Model = { at: Number(v?.at) || 0, keys: v?.keys || {}, ai: v?.ai || {} }
  _m = { at: Date.now(), val }
  return val
}
export const modelStale = (m: Model) => !m.at || Date.now() - m.at > 24 * 3600 * 1000

/** Learn from final-approved tasks: how often each kind of task actually billed. */
export async function trainModel(): Promise<{ kinds: number; tasks: number }> {
  const { billingRange } = await import('./billing')
  const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
  const to = ymd(new Date()), from = ymd(new Date(Date.now() - 120 * 864e5))
  const { tasks } = await billingRange(from, to)
  const keys: Record<string, { b: number; n: number }> = {}
  let n = 0
  for (const t of tasks) {
    // A decision a PERSON made: final-approved by someone (not 'auto'), or priced / left off by hand.
    const human = (t.reviewState === 'gm_approved' && t.gmBy && t.gmBy !== 'auto') || t.overrideAmount != null || t.excluded
    if (!human) continue
    const k = nameKey(t.department, t.name)
    const x = keys[k] = keys[k] || { b: 0, n: 0 }
    x.n++; if (t.billedAmount > 0) x.b++
    n++
  }
  const cur = await loadModel()
  await setSetting(KEY, { at: Date.now(), keys, ai: cur.ai }, 'billable-model')
  _m = null
  return { kinds: Object.keys(keys).length, tasks: n }
}

/** Layer 3: ask the model about MAYBEs with a real description, once each. */
export async function judgeMaybes(items: { id: string; name: string; description: string | null; department: string; minutes: number | null; lines: { what: string; amount: number }[] }[]): Promise<{ judged: number; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || !items.length) return { judged: 0, error: key ? undefined : 'AI not configured' }
  const { anthropicMessages } = await import('./anthropic-call')
  const { modelPairFor } = await import('./ai-models')
  const { model, fallback } = await modelPairFor('billing-judge')
  const system = `You review work orders for a short-term rental property manager. The owner is billed for anything we FIX or CLEAN outside of the departure clean: repairs, replacements, preventative maintenance, pest control, extra/deep cleans, delivering or assembling the owner's items. NOT billed: departure/turnover cleans, routine checks and inspections, building/common-area work, guest-service drop-offs (towels, linen), and re-cleans we owe a guest. For each task decide "bill" (real work the owner should pay for) or "no". Be conservative with "bill" only when the text is vague. STRICT JSON ONLY: {"verdicts":[{"id":"<id>","verdict":"bill"|"no","reason":"<one short sentence>"}]}`
  const r = await anthropicMessages(key, { model, max_tokens: 3000, system, messages: [{ role: 'user', content: 'Tasks: ' + JSON.stringify(items.slice(0, 40).map(i => ({ ...i, description: String(i.description || '').slice(0, 500) }))) }] }, fallback, 'billing-judge')
  if (!r.ok) return { judged: 0, error: String(r.data?.error?.message || r.status) }
  let verdicts: any[] = []
  try { const text = (r.data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'); verdicts = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).verdicts || [] } catch { return { judged: 0, error: 'unreadable answer' } }
  const cur = await getSetting<any>(KEY, null).catch(() => null) || {}
  const ai = { ...(cur.ai || {}) }
  const ids = new Set(items.map(i => i.id))
  let judged = 0
  for (const v of verdicts) { const id = String(v?.id || ''); if (!ids.has(id)) continue; ai[id] = { v: v.verdict === 'bill' ? 'bill' : 'no', r: String(v.reason || '').slice(0, 160) }; judged++ }
  // Keep the cache bounded: the newest 3,000 verdicts.
  const keysArr = Object.keys(ai); if (keysArr.length > 3000) for (const k of keysArr.slice(0, keysArr.length - 3000)) delete ai[k]
  await setSetting(KEY, { at: cur.at || 0, keys: cur.keys || {}, ai }, 'billable-model')
  _m = null
  return { judged }
}
