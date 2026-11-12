// Owner onboarding (lib/owner-onboard): storage and the item list. Server-only.
// Each link is its own app_settings row ('oo:<code>'), with a small index row ('oo_index') for the list, so
// one owner's saves never rewrite another's.
import 'server-only'
import { getSettingFresh, setSetting, getSetting } from './app-settings'
import { needList, NEED_ROOMS } from './need-list'
import type { KitSize } from './starter-kit'
import { normLinenStandard, linenQuote, LINEN_STANDARD_KEY, SOFA_BED, type LinenUnit } from './linens'
import { OO_PREFIX, OO_INDEX, cleanHome, DEFAULT_GM, DEFAULT_SALES, freshSteps, stageOf, type OORecord, type OOIndexRow, type OOItem, type OOHome, type OOCustom } from './owner-onboard'

const newCode = () => { const c: any = (globalThis as any).crypto; return String(c?.randomUUID ? c.randomUUID() : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 14) }
export const validCode = (code: string) => /^[0-9a-f]{10,32}$/i.test(String(code || ''))

export async function readRecord(code: string): Promise<OORecord | null> {
  if (!validCode(code)) return null
  const r = await getSettingFresh<any>(OO_PREFIX + code, null)
  return r && r.code === code ? (r as OORecord) : null
}

/** Every item this home needs, supplies then linen, each with a stable key for the owner's tick. */
export async function itemsFor(h: OOHome, o: { supplies: boolean; linen: boolean }): Promise<OOItem[]> {
  const out: OOItem[] = []
  if (o.supplies) {
    const z: KitSize = { bedrooms: Math.max(1, h.bedrooms), bathrooms: Math.max(1, Math.ceil(h.bathrooms)), guests: h.guests, kitchen: h.kitchen, appliances: { ...h.appliances } }
    const order = NEED_ROOMS as readonly string[]
    const rows = needList(z).map(l => ({ key: 's:' + l.item.key, name: l.item.name, group: l.item.room, qty: l.count, tier: (l.tier === 'optional' ? 'optional' : l.tier) as OOItem['tier'] }))
    rows.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group))
    out.push(...rows)
  }
  if (o.linen) {
    const standard = normLinenStandard(await getSetting<any>(LINEN_STANDARD_KEY, null))
    const beds: Record<string, number> = {}
    for (const [k, v] of Object.entries(h.beds)) { if (!v) continue; if (k === 'Bunk') beds.Twin = (beds.Twin || 0) + v * 2; else beds[k] = (beds[k] || 0) + v }
    if (h.sleeper) beds[SOFA_BED] = (beds[SOFA_BED] || 0) + 1
    const unit: LinenUnit = { id: 'owner', name: 'Home', bedrooms: Math.max(1, h.bedrooms), bathrooms: h.bathrooms, guests: h.guests, kitchens: h.kitchen ? 1 : 0, beds, bedsSource: 'manual' }
    for (const r of linenQuote(standard, [unit], 'mid').rows) out.push({ key: 'l:' + r.name + (r.size ? '|' + r.size : ''), name: r.name, size: r.size || undefined, group: 'Linen · ' + r.group, qty: r.qty, tier: 'must', linen: true })
  }
  return out
}

function indexRow(r: OORecord, items: OOItem[] | null): OOIndexRow {
  const keys = items ? new Set(items.map(i => i.key)) : null
  const marks = Object.entries(r.marks).filter(([k]) => !keys || keys.has(k))
  return { code: r.code, ownerName: r.custom.ownerName, property: r.attach.property, unitLabel: r.attach.unitLabel, listingId: r.attach.listingId, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy,
    stage: stageOf(r), submitted: !!r.submittedAt, have: marks.filter(([, m]) => m === 'have').length, need: marks.filter(([, m]) => m === 'need').length, ...(r.archived ? { archived: true } : {}) }
}
async function writeIndex(row: OOIndexRow, by: string | null) {
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  const list = (Array.isArray(idx) ? idx : []).filter(x => x && x.code !== row.code)
  await setSetting(OO_INDEX, [row, ...list].slice(0, 3000), by)
}
export async function listRecords(): Promise<OOIndexRow[]> {
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  return (Array.isArray(idx) ? idx : []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export async function saveRecord(r: OORecord, by: string | null): Promise<{ ok: boolean; error?: string }> {
  r.updatedAt = new Date().toISOString()
  const w = await setSetting(OO_PREFIX + r.code, r, by)
  if (!w.ok) return w
  const items = r.home ? await itemsFor(r.home, { supplies: r.custom.askSupplies, linen: r.custom.askLinen }).catch(() => null) : null
  await writeIndex(indexRow(r, items), by).catch(() => null)
  return { ok: true }
}

const str = (v: any, n: number, d = '') => (typeof v === 'string' ? v.trim().slice(0, n) : d)
const person = (v: any, d: OOCustom['gm']) => ({ name: str(v?.name, 80, d.name), role: str(v?.role, 80, d.role), phone: str(v?.phone, 40, d.phone), email: str(v?.email, 120, d.email), photo: str(v?.photo, 300, d.photo) })
export function cleanCustom(v: any, prev?: OOCustom): OOCustom {
  const p = prev
  const gm = person(v?.gm ?? p?.gm, p?.gm || DEFAULT_GM), sales = person(v?.sales ?? p?.sales, p?.sales || DEFAULT_SALES)
  return {
    ownerName: str(v?.ownerName, 120, p?.ownerName || ''), ownerEmail: str(v?.ownerEmail, 160, p?.ownerEmail || ''), ownerPhone: str(v?.ownerPhone, 40, p?.ownerPhone || ''),
    greeting: str(v?.greeting, 800, p?.greeting || ''),
    contact: person(v?.contact ?? p?.contact, p?.contact || gm),
    from: v?.from === 'gm' || v?.from === 'sales' ? v.from : p?.from || 'sales', gm, sales,
    askHome: v?.askHome != null ? !!v.askHome : p ? p.askHome : true,
    askSupplies: v?.askSupplies != null ? !!v.askSupplies : p ? p.askSupplies : true,
    askLinen: v?.askLinen != null ? !!v.askLinen : p ? p.askLinen : true,
    askPayout: v?.askPayout != null ? !!v.askPayout : p ? p.askPayout !== false : true,
  }
}

export async function createRecord(v: any, by: string): Promise<OORecord> {
  const now = new Date().toISOString()
  const r: OORecord = {
    code: newCode(), createdAt: now, createdBy: by, updatedAt: now,
    custom: cleanCustom(v?.custom),
    attach: { property: str(v?.attach?.property, 120), listingId: str(v?.attach?.listingId, 60), unitLabel: str(v?.attach?.unitLabel, 60) },
    // the team can start the home for the owner (Jon: "Nick can fill out some of the information")
    home: v?.home ? cleanHome(v.home) : null,
    marks: {}, ownerNotes: '', teamNotes: str(v?.teamNotes, 4000), steps: freshSteps(), call: { at: '', link: '', note: '' }, submittedAt: '',
  }
  const w = await saveRecord(r, by)
  if (!w.ok) throw new Error(w.error || 'Could not save.')
  return r
}
