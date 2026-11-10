// LEADS FROM THE FREE NEED LIST (Jon, 2026-11-10: "one link we can add to our website that asks for
// their email before they can download the Excel… SEO, owner acquisition"). /kit/plan asks for an email
// (name and phone optional) before the Excel; each one is kept here with what they planned, and the team
// sees them on Onboarding → Starter kits. No migration: app_settings `need_list_leads`, newest first,
// capped. A repeat from the same email within ten minutes updates the last entry instead of adding one.
import 'server-only'
import { getSettingFresh, setSetting } from './app-settings'

export const NEED_LIST_LEADS_KEY = 'need_list_leads'
const MAX = 3000
export type NeedLead = { at: string; email: string; name: string; phone: string; homes: string; units: number; owner: string; source: string; downloads: number }
const str = (v: any, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

export async function listLeads(limit = 500): Promise<NeedLead[]> {
  const raw = await getSettingFresh<any>(NEED_LIST_LEADS_KEY, [])
  return (Array.isArray(raw) ? raw : []).slice(0, limit)
}

export async function addLead(input: any): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = str(input?.email, 200).toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' }
  const lead: NeedLead = {
    at: new Date().toISOString(), email, name: str(input?.name, 120), phone: str(input?.phone, 40).replace(/[^\d+()\-. ]/g, ''),
    homes: str(input?.homes, 600), units: Math.max(1, Math.min(200, Math.round(Number(input?.units) || 1))),
    owner: str(input?.owner, 60), source: str(input?.source, 200), downloads: 1,
  }
  const all: NeedLead[] = await listLeads(MAX)
  const recent = all.findIndex(l => l.email === email && Date.now() - new Date(l.at).getTime() < 10 * 60_000)
  if (recent >= 0) { all[recent] = { ...all[recent], ...lead, name: lead.name || all[recent].name, phone: lead.phone || all[recent].phone, downloads: (all[recent].downloads || 1) + 1 } }
  else all.unshift(lead)
  const w = await setSetting(NEED_LIST_LEADS_KEY, all.slice(0, MAX), null)
  return w.ok ? { ok: true } : { ok: false, error: 'That did not go through. Try again in a moment.' }
}
