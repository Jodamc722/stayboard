// THE EDITED RULES (server). app_settings 'guest_check_rules' holds an admin's overrides per
// channel; anything not set falls back to DEFAULT_CHECK_RULES. Read on every guest-checks call.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { CHANNELS, DEFAULT_CHECK_RULES, DEFAULT_BUILDING_AMOUNTS, type Channel, type ChannelRule, type BuildingAmounts } from './welcome-call-guide'

export const RULES_KEY = 'guest_check_rules'

export async function loadGuestCheckRules(): Promise<Record<Channel, ChannelRule>> {
  const saved = await getSetting<any>(RULES_KEY, null)
  const out = {} as Record<Channel, ChannelRule>
  for (const ch of CHANNELS) out[ch] = { ...DEFAULT_CHECK_RULES[ch], ...((saved && typeof saved === 'object' && saved[ch] && typeof saved[ch] === 'object') ? saved[ch] : {}) }
  return out
}
/** Building → deposit amount; beats the channel amount. Saved under the same key as `_buildings`. */
export async function loadBuildingAmounts(): Promise<BuildingAmounts> {
  const saved = await getSetting<any>(RULES_KEY, null)
  const b = saved && typeof saved === 'object' && saved._buildings && typeof saved._buildings === 'object' ? saved._buildings : null
  if (!b) return { ...DEFAULT_BUILDING_AMOUNTS }
  const out: BuildingAmounts = {}
  for (const k of Object.keys(b)) { const n = Math.round(Number(b[k]) || 0); if (k.trim() && n > 0) out[k.trim()] = n }
  return out
}
/** The amount for one stay: the building's override when its name (or the Salato set) matches, else the channel's. */
export function depositAmountFor(rule: ChannelRule, building: string | null | undefined, isSalato: boolean, amounts: BuildingAmounts): number {
  const b = String(building || '').trim().toLowerCase()
  for (const k of Object.keys(amounts)) {
    const kk = k.toLowerCase()
    if (kk === 'salato' && isSalato) return amounts[k]
    if (b && (b === kk || b.startsWith(kk) || kk.startsWith(b))) return amounts[k]
  }
  return rule.depositAmount
}

export async function saveGuestCheckRules(patch: any, by: string): Promise<{ ok: boolean; error?: string }> {
  const cur: any = await loadGuestCheckRules()
  cur._buildings = await loadBuildingAmounts()
  if (patch && typeof patch === 'object' && patch._buildings && typeof patch._buildings === 'object') {
    const nb: BuildingAmounts = {}
    for (const k of Object.keys(patch._buildings)) { const n = Math.round(Number(patch._buildings[k]) || 0); if (String(k).trim() && n > 0) nb[String(k).trim().slice(0, 60)] = n }
    cur._buildings = nb
  }
  for (const ch of CHANNELS) {
    const p = patch && typeof patch === 'object' ? patch[ch] : null
    if (!p || typeof p !== 'object') continue
    const r = cur[ch]
    if (typeof p.verify === 'boolean') r.verify = p.verify
    if (typeof p.deposit === 'boolean') r.deposit = p.deposit
    if (p.depositAmount !== undefined) r.depositAmount = Math.max(0, Math.round(Number(p.depositAmount) || 0))
    if (typeof p.depositMethod === 'string' && ['guesty_hold', 'card_link', 'ota', 'cash', 'other', ''].includes(p.depositMethod)) r.depositMethod = p.depositMethod
    if (p.releaseDays !== undefined) r.releaseDays = Math.max(0, Math.min(60, Math.round(Number(p.releaseDays) || 0)))
    if (typeof p.merchantOfRecord === 'boolean') r.merchantOfRecord = p.merchantOfRecord
    if (typeof p.note === 'string') r.note = p.note.trim().slice(0, 300)
  }
  return setSetting(RULES_KEY, cur, by)
}
