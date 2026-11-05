// TROUBLESHOOT FIRST — MAINTENANCE TASKS ONLY (Jon, 2026-11-05: "When an issue is reported and team
// creates a maintenance task, build a troubleshoot checklist … shares in description. If unable to
// fix, the team should be required to [post] in Slack." · "This is for maintenance tasks only").
//
// Every reactive maintenance task — made in Lighthouse (createBreezewayTask) or straight in
// Breezeway (the webhook, once, right after it is created) — gets a short block at the end of its
// description:
//   1. 4–6 steps specific to the reported issue (Haiku, 6 s cap; a keyword library when the model is
//      slow, down, or the key is missing — the task is never held up for it)
//   2. a safety line
//   3. the rule: not fixed → do NOT close it; post in the building's maintenance Slack channel with
//      what you tried + photo/video, and leave the task open.
// The MARKER makes it idempotent: a description that already has it is never touched again, so the
// webhook's own PATCH (which fires another webhook) cannot loop.
// Planned work is skipped: a task on one of OUR programme templates (deep clean, A/C deep clean,
// exterior clean, inspections — they carry their own checklist) and programme / preventive names
// (filter changes, inspections, exterior cleans, PMs). Ad-hoc templates such as "Guest Reported /
// Glitch" DO get it — that is where reported issues are filed (the 2026-11-05 miss).
// DRAFT FIRST (Jon, 2026-11-05: "have it where we can draft it before pushing"): the Add-a-task sheet
// drafts the block through /api/breezeway/troubleshoot, the coordinator edits or turns it off, and
// the task carries exactly what they approved (`troubleshoot` on the create body). Turned off = the
// task id is remembered (setting troubleshoot_optout) so the webhook does not add it back.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSlackRules, groupForBuilding, channelFor } from '@/lib/slack-rules'
import { buildingOf } from '@/lib/segments'
import { BZ_TEMPLATES } from '@/lib/breezeway'
import { getSettingFresh, setSetting } from '@/lib/app-settings'

const PLANNED_TEMPLATES = new Set<number>(Object.values(BZ_TEMPLATES).map(Number))
const OPTOUT_KEY = 'troubleshoot_optout'
/** A coordinator turned the checklist off for this task — the webhook must not add it back. */
export async function rememberOptOut(taskId: string): Promise<void> {
  try {
    const cur = await getSettingFresh<string[]>(OPTOUT_KEY, [])
    const next = [String(taskId), ...(Array.isArray(cur) ? cur : []).filter(x => x !== String(taskId))].slice(0, 300)
    await setSetting(OPTOUT_KEY, next, 'troubleshoot')
  } catch { /* best effort */ }
}
export async function optedOut(taskId: string): Promise<boolean> {
  try { const cur = await getSettingFresh<string[]>(OPTOUT_KEY, []); return Array.isArray(cur) && cur.indexOf(String(taskId)) >= 0 } catch { return false }
}

export const TROUBLESHOOT_MARKER = 'TROUBLESHOOT FIRST'

const CHANNEL_NAMES: Record<string, string> = {
  C09T9T65VGU: '#vr-maintenance-17west',
  C094TA92QGM: '#vr-miami-hk-maintenance-arya-elser-district225',
  C02S24UE1EZ: '#vr-broward-maintenance',
  C08HW9XBZ8U: '#vr-lakeworth-palmbeach-amri-capri-lucerne',
  C0B1H079CF3: '#vr-botanica-garden',
}

export function isMaintenance(dept: any): boolean {
  const d = typeof dept === 'object' && dept ? (dept.name || dept.code) : dept
  return /maint/i.test(String(d || ''))
}

const PLANNED = /\b(filter (change|replace)|preventa?tive|\bpm\b|inspection|walk[- ]?through|exterior (clean|walk)|pressure wash|deep[ -]?clean|coil clean|monthly|quarterly|annual|program|checklist|turnover|departure|owner (visit|stay)|install(ation)? of new|punch ?list)\b/i

/** Does this task get the block? Reactive maintenance only, once. */
export function wantsTroubleshoot(t: { type_department?: any; name?: any; description?: any; template_id?: any }): boolean {
  if (!isMaintenance(t.type_department)) return false
  if (PLANNED_TEMPLATES.has(Number(t.template_id))) return false
  if (String(t.description || '').includes(TROUBLESHOOT_MARKER)) return false
  if (PLANNED.test(String(t.name || ''))) return false
  return true
}

// ── The fallback library: safe first checks anyone on the team can do ─────────────────────────
const LIB: { re: RegExp; steps: string[] }[] = [
  { re: /\b(a\/?c|hvac|air ?con|cooling|not cool|warm|hot in|thermostat|mini ?split|air handler|ptac)\b/i, steps: [
    'Thermostat: set to COOL, fan AUTO, 3–4 °F below room temp. Replace thermostat batteries if the screen is blank.',
    'Check the breaker for the AC / air handler — reset once if tripped (if it trips again, stop).',
    'Pull the return filter: replace if dirty or clogged.',
    'Check the condensate drain / float switch: water in the pan or a tripped float shuts the AC off — clear it.',
    'Make sure every vent and the return are open and not blocked by furniture.',
    'Wait 15 minutes and measure the air at a vent — it should be 15–20 °F colder than the room.'] },
  { re: /\b(leak|leaking|drip|water (on|under|in)|flood|ceiling stain|wet)\b/i, steps: [
    'Find the source: under sinks, toilet base/supply line, water heater, AC pan, window/door, ceiling above.',
    'Stop it: close the fixture shut-off valve (or the unit main) if water is still running.',
    'Dry the area, put down towels/bucket, and move guest belongings and electronics away.',
    'Tighten loose supply-line / trap connections by hand — no force on plastic fittings.',
    'Photo the source and any damage (ceiling, floor, cabinet base) before and after.'] },
  { re: /\b(toilet|clog|clogged|drain|backed up|sink|shower drain|tub|slow drain|running toilet)\b/i, steps: [
    'Plunge 10–15 strong strokes with the flange plunger (toilet) or cup plunger (sink/tub).',
    'Pull and clean the stopper / hair catcher; use a drain snake for hair clogs.',
    'Running toilet: check the flapper seals and the chain is not tangled; adjust the float.',
    'Check the toilet supply valve is fully open and the line is not leaking.',
    'Run water 2 minutes and flush twice to confirm it drains normally.'] },
  { re: /\b(hot water|no hot|water heater|cold water only|lukewarm)\b/i, steps: [
    'Run the hot tap 2–3 minutes at the furthest fixture.',
    'Check the water-heater breaker — reset once if tripped (if it trips again, stop).',
    'Check the heater for leaks or a pilot/error light; note any error code.',
    'Check the mixing valve / shower cartridge is turned fully to hot.',
    'If the tank is new-filled or reset, wait 30–45 minutes and test again.'] },
  { re: /\b(power|outlet|breaker|no electric|lights? out|gfci|tripped|sparks?)\b/i, steps: [
    'Press RESET on every GFCI outlet in kitchen, baths, balcony and laundry.',
    'Check the panel: reset a tripped breaker ONCE (fully OFF, then ON). If it trips again, stop.',
    'Unplug what was plugged in when it failed and test the outlet with a known-good device.',
    'Check for a building-wide outage with the front desk / neighbours.'] },
  { re: /\b(light|bulb|lamp|fixture|switch)\b/i, steps: [
    'Replace the bulb with a known-good one of the same type and wattage.',
    'Check the wall switch, lamp switch and any dimmer; check the lamp is plugged in.',
    'Reset nearby GFCI outlets and check the breaker.'] },
  { re: /\b(tv|television|remote|cable|roku|fire ?stick|netflix|streaming|hdmi|wi-?fi|internet|router|modem)\b/i, steps: [
    'Power-cycle: unplug the router/modem and TV 30 seconds, plug back in, wait 3 minutes.',
    'TV: check INPUT/SOURCE is on the right HDMI, replace remote batteries.',
    'Check every cable is seated (power, coax/ethernet, HDMI).',
    'Confirm the Wi-Fi name/password match the guidebook; test on your phone.',
    'Note the router lights (red/orange/blinking) with a photo.'] },
  { re: /\b(lock|door code|keypad|smart ?lock|deadbolt|key|locked out|latch|door won'?t)\b/i, steps: [
    'Replace the lock batteries (keep spare AAs in the kit).',
    'Test the guest code and the staff code; check the code in the lock app matches the reservation.',
    'Door alignment: lift/push the door while turning — if the bolt binds, the strike needs adjusting.',
    'Lubricate the cylinder with graphite (no oil).',
    'Never leave the unit unsecured — if it will not lock, stay or call your supervisor now.'] },
  { re: /\b(fridge|refrigerator|freezer|ice maker|dishwasher|oven|stove|range|microwave|cooktop|disposal)\b/i, steps: [
    'Check it is plugged in and the breaker/GFCI is on.',
    'Fridge: set to 37 °F / freezer 0 °F; clear the vents inside; vacuum the coils if dusty.',
    'Dishwasher: clean the filter at the bottom; check the door latches fully.',
    'Disposal: OFF, press the red reset button underneath, turn with the hex key, then test.',
    'Note the model number and any error code with a photo.'] },
  { re: /\b(washer|dryer|laundry|lint)\b/i, steps: [
    'Check power, breaker and that the door/lid is fully latched.',
    'Dryer: empty the lint trap and check the vent hose is not crushed.',
    'Washer: check both water valves are open; clean the pump/drain filter.',
    'Run a short cycle and watch for the error code — photo it.'] },
  { re: /\b(pest|roach|ants?|bugs?|rodent|mouse|mice)\b/i, steps: [
    'Photo the pests and where you found them.',
    'Clean the area fully — crumbs, grease, standing water.',
    'Check gaps under sinks, doors and windows; note any you find.',
    'Set bait/traps from the kit where guests cannot reach them.'] },
  { re: /\b(smell|odor|odour|sewer|musty|mold|mildew)\b/i, steps: [
    'Find the source room. Sewer smell: run water in every unused drain (dry P-trap) and flush toilets.',
    'Check under sinks and behind the toilet for leaks or wet spots.',
    'Check the AC drain pan and filter for standing water or mildew.',
    'Ventilate and photo any visible mildew/mould.'] },
  { re: /\b(window|blind|curtain|shade|slider|sliding door|balcony door|screen)\b/i, steps: [
    'Clean the track and lubricate with silicone spray.',
    'Check rollers/clips for damage; reseat a blind or curtain that came off its bracket.',
    'Confirm it locks — the unit must close and lock securely.'] },
]
const GENERAL = [
  'Reproduce the problem and photo/video it before you touch anything.',
  'Check the basics: power, breaker/GFCI, batteries, settings, water valves.',
  'Reset or restart the item once, then test it again.',
  'Look for an error code, model number or obvious damage — photo it.',
]

function fallbackSteps(text: string): string[] {
  const hits = LIB.filter(x => x.re.test(text))
  if (!hits.length) return GENERAL
  const out: string[] = []
  for (const h of hits.slice(0, 2)) for (const s of h.steps) if (out.length < 6 && out.indexOf(s) < 0) out.push(s)
  return out
}

async function aiSteps(name: string, description: string): Promise<string[] | null> {
  const key = process.env.ANTHROPIC_API_KEY || ''
  if (!key) return null
  try {
    const [{ anthropicMessages, textOf }, { modelPairFor }] = await Promise.all([import('@/lib/anthropic-call'), import('@/lib/ai-models')])
    const { model, fallback } = await modelPairFor('maintenance-troubleshoot')
    const call = anthropicMessages(key, {
      model, max_tokens: 500,
      system: 'You write troubleshooting checklists for a vacation-rental maintenance team in South Florida condos (tech or handyman, not a licensed electrician/plumber). Given a reported issue, reply with ONLY a JSON array of 4 to 6 short steps (each under 120 characters, imperative, concrete, in the order to do them) the tech should try before calling a vendor. Safe checks only: no opening electrical panels beyond resetting a breaker once, no gas work, no refrigerant. Mention photographing the problem once. No numbering, no preamble.',
      messages: [{ role: 'user', content: `Task: ${name}\nDetails: ${description.slice(0, 1200)}` }],
    }, fallback, 'maintenance-troubleshoot')
    const r = await Promise.race([call, new Promise<null>(res => setTimeout(() => res(null), 6000))])
    if (!r || !r.ok) return null
    const raw = textOf(r.data)
    const m = raw.match(/\[[\s\S]*\]/)
    const arr = m ? JSON.parse(m[0]) : null
    if (!Array.isArray(arr)) return null
    const steps = arr.map(x => String(x || '').replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(s => s.length > 3 && s.length < 200).slice(0, 6)
    return steps.length >= 3 ? steps : null
  } catch { return null }
}

async function channelForHome(homeId: any): Promise<string> {
  try {
    const id = Number(homeId)
    if (!Number.isFinite(id)) return ''
    const { data } = await supabaseAdmin().from('breezeway_properties').select('name').eq('home_id', id).limit(1)
    const name = String(data?.[0]?.name || '')
    if (!name) return ''
    const rules = await getSlackRules()
    const group = groupForBuilding(rules, buildingOf(null, name))
    const ch = channelFor(rules, group, 'maintenance')
    return ch ? (CHANNEL_NAMES[ch] || (group ? group.label + ' maintenance channel' : '')) : ''
  } catch { return '' }
}

/** The block to append — never throws. */
export async function troubleshootBlock(t: { name?: any; description?: any; home_id?: any }): Promise<string> {
  const name = String(t.name || '')
  const desc = String(t.description || '')
  const [ai, channel] = await Promise.all([aiSteps(name, desc), channelForHome(t.home_id)])
  const steps = ai || fallbackSteps(name + ' ' + desc)
  const where = channel || "your building's maintenance channel"
  const dondeEs = channel || 'el canal de mantenimiento de tu edificio'
  return [
    '',
    `🔧 ${TROUBLESHOOT_MARKER} — try these before calling a vendor:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '⚠️ Safety: water near power, burning smell, sparks or gas → shut it off, step away, call your supervisor now.',
    '',
    '❌ STILL NOT FIXED? Do NOT close this task as done.',
    `→ Post in Slack (${where}): the unit, what you tried (step numbers), and a photo/video.`,
    '→ Leave the task open so it is escalated.',
    `🇪🇸 ¿No se pudo arreglar? NO cierres la tarea. Publica en Slack (${dondeEs}): unidad, qué intentaste y foto/video.`,
  ].join('\n')
}

/** description + block, or null when this task does not get one. */
export async function withTroubleshoot(t: { type_department?: any; name?: any; description?: any; template_id?: any; home_id?: any }): Promise<string | null> {
  if (!wantsTroubleshoot(t)) return null
  const block = await troubleshootBlock(t)
  return (String(t.description || '').trimEnd() + '\n' + block).trim()
}
