// THE UNIT AT A GLANCE, BESIDE THE THREAD (Jon, 2026-11-12: "have property related details there in that right side.
// Wi-Fi details, Wi-Fi codes, et cetera, should be easily accessible. You should be able to copy and send").
//
// What a guest asks for most, from the Guesty listing (the same source as the FAQ desk's Facts, app/api/faq):
// address, check-in / check-out, Wi-Fi network and password, parking, trash day, how to get in (text), the house
// manual and rules, and the listing's custom fields by their names. Door codes are NOT here — they keep their own
// reveal-and-log step on the booking card (lib/inbox-stay-extras); any field that is or holds a code is dropped.
import 'server-only'
import { DOOR_CODE_FIELD_ID, RES_CODE_FIELD, isCodeFact, scrubStoredText } from './eve/redact'

export type PropFact = { key: string; label: string; value: string; long?: boolean }
export type PropertyFacts = { listingId: string; name: string; building: string; wifi: { network: string; password: string } | null; facts: PropFact[]; more: PropFact[] }

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clean = (v: any) => str(v).replace(/\r/g, '').trim()

export async function loadPropertyFacts(db: any, listingId: string): Promise<PropertyFacts | null> {
  const [{ data: l }, { data: defs }] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,raw').eq('id', listingId).maybeSingle(),
    db.from('guesty_custom_fields').select('id,name,slug'),
  ])
  if (!l) return null
  const raw: any = l.raw || {}
  const facts: PropFact[] = []
  const more: PropFact[] = []
  const add = (list: PropFact[], key: string, label: string, v: any, long = false) => { const s = clean(v); if (s) list.push({ key, label, value: long ? scrubStoredText(s) : s, long }) }

  const a = raw.address
  add(facts, 'address', 'Address', a ? (typeof a === 'string' ? a : (a.full || [a.street, a.city, a.state, a.zipcode].filter(Boolean).join(', '))) : '')
  add(facts, 'checkin', 'Check-in', raw.defaultCheckInTime)
  add(facts, 'checkout', 'Check-out', raw.defaultCheckOutTime)
  add(facts, 'parking', 'Parking', raw.parkingInstructions || raw.publicDescription?.parking, true)
  add(facts, 'trash', 'Trash day', raw.trashCollectedOn)
  const layout = [raw.bedrooms != null ? raw.bedrooms + ' BR' : '', raw.bathrooms != null ? raw.bathrooms + ' BA' : '', raw.accommodates != null ? 'sleeps ' + raw.accommodates : ''].filter(Boolean).join(' · ')
  add(facts, 'layout', 'Layout', layout)
  add(more, 'access', 'How to get in', raw.publicDescription?.access, true)
  add(more, 'manual', 'House manual', raw.houseManual || raw.publicDescription?.houseRules, true)
  add(more, 'rules', 'House rules', raw.additionalRules, true)

  // Custom fields by name; nothing that is, or carries, a code.
  const names: Record<string, { name: string; slug: string }> = {}
  for (const d of (defs as any[]) || []) names[str(d.id)] = { name: str(d.name), slug: str(d.slug) }
  for (const it of Array.isArray(raw.customFields) ? raw.customFields : []) {
    const fid = str(it?.fieldId || it?.field_id || it?.field?._id || it?.field?.id || it?._id)
    const def = names[fid]
    if (!def?.name) continue
    let v: any = it?.value
    if (v == null || v === '' || v === false) continue
    if (typeof v === 'object') { try { v = JSON.stringify(v) } catch { continue } }
    if (fid === DOOR_CODE_FIELD_ID || fid === RES_CODE_FIELD || isCodeFact([def.name, def.slug], v) || /door|lock|code|alarm|safe/i.test(def.name)) continue
    if (/wi-?fi/i.test(def.name)) continue  // the Wi-Fi block shows it
    add(more, 'cf:' + fid, def.name.slice(0, 60), scrubStoredText(str(v)).slice(0, 600), str(v).length > 80)
  }

  const network = clean(raw.wifiName), password = clean(raw.wifiPassword)
  return { listingId: str(l.id), name: str(l.nickname || l.title), building: str(l.building), wifi: network || password ? { network, password } : null, facts, more }
}
