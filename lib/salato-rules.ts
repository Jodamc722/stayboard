// Salato house rules shown on the iPad check-in / verification flow. The guest initials each
// rule and signs at the end; the signed set + version are stored with the verification record.
// DRAFT — Jon to review/edit wording. Bump SALATO_RULES_VERSION whenever the text changes so
// existing signatures stay tied to the exact version the guest agreed to.
export const SALATO_RULES_VERSION = 1

export type HouseRule = { id: string; title: string; body: string }

export const SALATO_RULES: HouseRule[] = [
  { id: 'occupancy', title: 'Registered guests & occupancy', body: 'Only the guests on the reservation may stay overnight. The maximum occupancy for the unit may not be exceeded at any time. Please let the front desk know if this changes.' },
  { id: 'no-parties', title: 'No parties or events', body: 'Parties, events, and gatherings beyond the registered guests are not permitted. Violations may result in immediate removal without refund and additional charges.' },
  { id: 'quiet-hours', title: 'Quiet hours (10:00 PM – 8:00 AM)', body: 'Please keep noise to a respectful level at all times, and especially during quiet hours. This is a residential building and noise complaints may result in fines or removal.' },
  { id: 'no-smoking', title: 'No smoking', body: 'Smoking or vaping of any kind is prohibited inside the unit and on balconies. A cleaning/remediation fee of up to $500 applies to violations.' },
  { id: 'building-rules', title: 'Building & amenity rules', body: 'I agree to follow all building rules, including for elevators, pool, gym, and common areas, and to treat neighbors, staff, and security with respect.' },
  { id: 'parking', title: 'Parking', body: 'Park only in your assigned spot or as directed by the front desk. Unauthorized vehicles may be towed at the owner’s expense.' },
  { id: 'no-pets', title: 'Pets', body: 'Pets are not permitted unless approved in writing before arrival. Service animals are welcome as required by law.' },
  { id: 'damage', title: 'Damage & responsibility', body: 'I am responsible for any damage, loss, or extraordinary cleaning caused during my stay and authorize reasonable charges for such costs to the payment method on file.' },
  { id: 'keys-access', title: 'Keys, fobs & access', body: 'I will safeguard all keys, fobs, and access codes and not share them. Lost keys/fobs or lockout assistance may incur a fee.' },
  { id: 'checkout', title: 'Check-out', body: 'Check-out is by the time stated on my reservation. Late check-out must be approved in advance and may incur a fee. Please leave the unit secured.' },
  { id: 'id-consent', title: 'ID & identity verification', body: 'I consent to providing a valid government-issued photo ID and a photo of myself for identity verification, and confirm the ID is mine and I am the guest of record.' },
  { id: 'accuracy', title: 'Accuracy & agreement', body: 'I confirm the information I have provided is accurate, I am at least 18 years old (or the local age of majority), and I agree to these house rules for the duration of my stay.' },
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
