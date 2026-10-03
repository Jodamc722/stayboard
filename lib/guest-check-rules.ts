// THE EDITED RULES (server). app_settings 'guest_check_rules' holds an admin's overrides per
// channel; anything not set falls back to DEFAULT_CHECK_RULES. Read on every guest-checks call.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { CHANNELS, DEFAULT_CHECK_RULES, type Channel, type ChannelRule } from './welcome-call-guide'

export const RULES_KEY = 'guest_check_rules'

export async function loadGuestCheckRules(): Promise<Record<Channel, ChannelRule>> {
  const saved = await getSetting<any>(RULES_KEY, null)
  const out = {} as Record<Channel, ChannelRule>
  for (const ch of CHANNELS) out[ch] = { ...DEFAULT_CHECK_RULES[ch], ...((saved && typeof saved === 'object' && saved[ch] && typeof saved[ch] === 'object') ? saved[ch] : {}) }
  return out
}

export async function saveGuestCheckRules(patch: any, by: string): Promise<{ ok: boolean; error?: string }> {
  const cur = await loadGuestCheckRules()
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
