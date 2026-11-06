// GUIDEBOOK FACTS FROM GUESTY (Jon, 2026-11-06: "for guidebooks, if the custom fields are filled out
// it should pull that from Guesty when clicking bulk build — trash, the parking etc").
//
// Every listing-level Guesty custom field that has a value is read off the listing mirror
// (guesty_listings.raw.customFields = [{ fieldId, value }]), named through the custom-field mirror
// (guesty_custom_fields), and sorted into the guidebook's own question keys by its NAME — so a field
// Jon adds later called "Parking", "Trash", "Wi-Fi", "Pool hours" or "Checkout" lands in the right
// section with no code change. Guesty's own public description fills gaps last (access → entry,
// transit → getting around, house rules → building rules).
//
// NEVER PULLED: codes of any kind (a guidebook is printed and shared, and Salato/Botanica codes are
// per stay), and the internal fields (Asana/Breezeway links, cleaning time, channel ids, inspection
// and filter dates, call notes, flags, the guidebook link itself).
import 'server-only'

export type GuideKey = 'entry' | 'parking' | 'trash' | 'quietHours' | 'gettingAround' | 'thermostat' | 'appliances' | 'addons' | 'checkoutKey' | 'wifi' | 'houseFacts'
export type GuideFacts = { facts: Partial<Record<GuideKey, string>>; sources: Partial<Record<GuideKey, string[]>> }

const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))

const INTERNAL = /code|asana|breezeway|cleaning time|\bid\b|inspection|filter|guidebook|order form|talkroute|notes?\b|verified|sensitive|booking call|email sent|added to app|welcome call|confirmation|plate|\bvip\b|glitch|unit number|qr/i
const RULES: [GuideKey, RegExp][] = [
  ['houseFacts', /pre-?arrival|amenit|faq/i],
  ['parking', /parking|garage|valet/i],
  ['trash', /trash|garbage|recycl|chute|disposal/i],
  ['wifi', /wi-?fi|internet|network/i],
  ['checkoutKey', /check-?out/i],
  ['entry', /entry|access|arrival|lobby|elevator|check-?in/i],
  ['quietHours', /rule|quiet|pool|gym|hours/i],
  ['gettingAround', /transit|getting around|rideshare|uber|shuttle|transport/i],
  ['thermostat', /thermostat|\bac\b|a\/c|air con/i],
  ['appliances', /appliance|kitchen|washer|dryer|laundry/i],
  ['addons', /add-?on|extra service|upsell/i],
]

function keyFor(name: string): GuideKey | null {
  if (!name || INTERNAL.test(name)) return null
  for (const [k, re] of RULES) if (re.test(name)) return k
  return 'houseFacts'   // FAQ, amenities messages and anything else guest-facing — given to the writer as facts
}

function valueText(v: any): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return ''
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(', ')
  if (typeof v === 'object') return str(v.value ?? v.label ?? '')
  return str(v).trim()
}

export async function guideFactsFor(db: any, listingIds: string[]): Promise<Record<string, GuideFacts>> {
  const out: Record<string, GuideFacts> = {}
  if (!listingIds.length) return out
  const [{ data: defs }, { data: rows }] = await Promise.all([
    db.from('guesty_custom_fields').select('id, name, target'),
    db.from('guesty_listings').select('id, cf:raw->customFields, pub:raw->publicDescription').in('id', listingIds.slice(0, 300)),
  ])
  const names: Record<string, string> = {}
  for (const d of (defs || []) as any[]) {
    if (d.target && String(d.target) !== 'listing') continue
    names[str(d.id)] = str(d.name)
  }
  for (const r of (rows || []) as any[]) {
    const g: GuideFacts = { facts: {}, sources: {} }
    const add = (k: GuideKey, label: string, text: string) => {
      if (!text) return
      const prev = g.facts[k]
      g.facts[k] = prev ? (k === 'houseFacts' || k === 'quietHours' ? prev + '\n' + (k === 'houseFacts' ? label + ': ' : '') + text : prev) : (k === 'houseFacts' ? label + ': ' + text : text)
      ;(g.sources[k] = g.sources[k] || []).push(label)
    }
    for (const c of (Array.isArray(r.cf) ? r.cf : []) as any[]) {
      const id = str(c?.fieldId || c?._id || c?.id)
      const name = names[id]
      if (!name) continue
      const k = keyFor(name)
      if (!k) continue
      add(k, name, valueText(c?.value).slice(0, 1500))
    }
    // Guesty's own listing text fills only what the custom fields left empty.
    const pub = r.pub || {}
    const gap = (k: GuideKey, label: string, v: any) => { if (!g.facts[k]) add(k, label, str(v).trim().slice(0, 1500)) }
    gap('entry', 'Guesty: Guest access', pub.access)
    gap('gettingAround', 'Guesty: Getting around', pub.transit)
    gap('quietHours', 'Guesty: House rules', pub.houseRules)
    out[str(r.id)] = g
  }
  return out
}
