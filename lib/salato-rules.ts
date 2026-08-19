// Salato house rules shown on the iPad check-in / verification flow. The guest initials each
// rule and signs at the end; the signed set + version are stored with the verification record.
// These four rules + the intro and IMPORTANT note mirror the official "SALATO — Pompano Beach"
// printed house-rules card exactly. Bump SALATO_RULES_VERSION whenever the text changes so
// existing signatures stay tied to the exact version the guest agreed to.
export const SALATO_RULES_VERSION = 2

export type HouseRule = { id: string; title: string; body: string }

// Framing text from the printed card. Shown above (intro) and below (important) the rule cards on
// the verification form and in the emailed record. Not part of the per-rule initialing.
export const SALATO_RULES_INTRO =
  'Salato is a private residential community, not a hotel. Residents are responsible for the conduct of their household members, tenants and guests.'
export const SALATO_RULES_IMPORTANT =
  'Violations may result in warnings, cleaning or damage charges, loss of amenity privileges, or other action permitted by the governing documents. Report active disturbances to the Front Desk immediately.'

// Each rule's body holds its bullet lines separated by newlines; every surface renders them as a
// bulleted list. Titles carry NO leading number — the form/PDF number them from their position.
export const SALATO_RULES: HouseRule[] = [
  {
    id: 'quiet-hours',
    title: 'Quiet Hours & Balcony Noise',
    body:
      'Quiet hours are 9:00 p.m. to 10:00 a.m.\n' +
      'Music and amplified sound are not permitted on balconies or patios during quiet hours.\n' +
      'Shouting, loud singing and conversations must not be audible from neighboring residences.\n' +
      'Noise must remain reasonable at all times, even outside quiet hours.',
  },
  {
    id: 'proper-attire',
    title: 'Proper Attire',
    body:
      'Shirts or appropriate tops, bottoms and footwear are required in indoor common areas.\n' +
      "Swimwear must be covered in the lobby, hallways, elevators and Owners' Lounge.\n" +
      'Wet swimwear and bare feet are not permitted in indoor common areas.\n' +
      'Proper athletic clothing and closed-toe shoes are required in the fitness center.',
  },
  {
    id: 'clean-up',
    title: 'Clean Up After Yourself',
    body:
      'Remove all towels, trash, food, beverage containers and personal belongings when leaving.\n' +
      'Return chairs, tables and other furniture to their designated locations.\n' +
      'Do not leave wet towels on loungers or cups and beverages in amenity areas.\n' +
      'Clean spills immediately and report any damage or unsafe condition to staff.',
  },
  {
    id: 'pool-shared',
    title: 'Pool & Shared Areas',
    body:
      'The pool and pool deck are open from sunrise to sunset.\n' +
      'Glass containers, smoking, vaping, rough play and disruptive music are prohibited.\n' +
      'Common areas must remain clean, quiet and unobstructed.\n' +
      'Furniture, equipment and property items may not be moved, damaged or misused.',
  },
]

// Rules can be edited by the team (Rules tab on the Salato board); the active set is stored here.
export const SALATO_RULES_KEY = 'salato_rules'

// Clean + de-dupe a rules array coming from the editor / storage into safe HouseRule[].
export function sanitizeRules(input: any): HouseRule[] {
  const arr = Array.isArray(input) ? input : []
  const out: HouseRule[] = []
  const seen: Record<string, boolean> = {}
  for (let i = 0; i < arr.length && out.length < 50; i++) {
    const r = arr[i] || {}
    const title = String(r.title == null ? '' : r.title).trim().slice(0, 200)
    const body = String(r.body == null ? '' : r.body).trim().slice(0, 2000)
    if (!title && !body) continue
    let id = String(r.id == null ? '' : r.id).trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) id = 'rule-' + (i + 1)
    while (seen[id]) id = id + '-x'
    seen[id] = true
    out.push({ id, title: title || 'Rule', body })
  }
  return out
}

// Active rule set: the team's custom rules (app_settings) if present & valid, else the defaults above.
export async function loadSalatoRules(db: any): Promise<{ rules: HouseRule[]; version: number; custom: boolean }> {
  try {
    const { data } = await db.from('app_settings').select('value').eq('key', SALATO_RULES_KEY).limit(1)
    const row: any = Array.isArray(data) ? data[0] : null
    if (row && row.value) {
      const j = JSON.parse(row.value)
      const rules = sanitizeRules(j && j.rules)
      if (rules.length) return { rules, version: Number(j && j.version) || SALATO_RULES_VERSION, custom: true }
    }
  } catch {}
  return { rules: SALATO_RULES, version: SALATO_RULES_VERSION, custom: false }
}
