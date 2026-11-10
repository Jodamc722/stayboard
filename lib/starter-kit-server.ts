// STARTER KIT LINKS — storage (see lib/starter-kit.ts for what a kit is).
//
// No migration: the links live in app_settings under `starter_kits`, one JSON map keyed by code, the
// same way the linen quotes do. Volume is a handful of prospects a week. Every write is a fresh
// read-modify-write of the whole map; the last writer wins, which for one client editing one link
// at a time is the right answer. Revoked links stay in the map (the team keeps the history) and
// answer 404 to the client.
import 'server-only'
import { randomBytes } from 'crypto'
import { getSettingFresh, setSetting } from './app-settings'
import {
  KIT_CODE, EMPTY_SELECTION, normSize, normSelection, kitTotals,
  type KitLink, type KitPublic, type KitSelection,
} from './starter-kit'

export const STARTER_KITS_KEY = 'starter_kits'
const MAX_LINKS = 1000
const str = (v: any, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const money = (v: any) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }

function normLink(code: string, r: any): KitLink | null {
  if (!KIT_CODE.test(code) || !r || typeof r !== 'object') return null
  const sub = r.submitted && typeof r.submitted === 'object' ? r.submitted : null
  return {
    code, client: str(r.client, 120), property: str(r.property, 160), message: str(r.message, 1200),
    size: normSize(r.size), sizeLocked: !!r.sizeLocked, setupFee: money(r.setupFee),
    preparedBy: str(r.preparedBy, 120), createdAt: str(r.createdAt, 40), revokedAt: r.revokedAt ? str(r.revokedAt, 40) : null,
    views: Number.isFinite(+r.views) ? +r.views : 0, lastView: r.lastView ? str(r.lastView, 40) : null,
    selection: normSelection(r.selection), savedAt: r.savedAt ? str(r.savedAt, 40) : null,
    submitted: sub ? { name: str(sub.name, 120), email: str(sub.email, 160), note: str(sub.note, 2000), at: str(sub.at, 40), total: Number(sub.total) || 0, items: Number(sub.items) || 0 } : null,
  }
}

async function readAll(): Promise<Record<string, KitLink>> {
  const raw = await getSettingFresh<any>(STARTER_KITS_KEY, {})
  const out: Record<string, KitLink> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) { const l = normLink(k, v); if (l) out[k] = l }
  return out
}
const writeAll = (all: Record<string, KitLink>, who: string | null) => setSetting(STARTER_KITS_KEY, all, who)

export async function listKits(): Promise<KitLink[]> {
  return Object.values(await readAll()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export async function createKit(input: any, who: string): Promise<{ ok: true; link: KitLink } | { ok: false; error: string }> {
  const client = str(input?.client, 120)
  if (!client) return { ok: false, error: 'Who is this for? Add the client or owner name.' }
  const all = await readAll()
  if (Object.keys(all).length >= MAX_LINKS) return { ok: false, error: 'Too many starter kit links. Turn some old ones off first.' }
  const code = randomBytes(10).toString('hex')
  const link: KitLink = {
    code, client, property: str(input?.property, 160), message: str(input?.message, 1200),
    size: normSize(input?.size), sizeLocked: !!input?.sizeLocked, setupFee: money(input?.setupFee),
    preparedBy: str(input?.preparedBy, 120) || who.split('@')[0], createdAt: new Date().toISOString(), revokedAt: null,
    views: 0, lastView: null, selection: { ...EMPTY_SELECTION }, savedAt: null, submitted: null,
  }
  all[code] = link
  const w = await writeAll(all, who)
  return w.ok ? { ok: true, link } : { ok: false, error: w.error || 'That did not save.' }
}

/** Team edits: the size, the wording, the setup fee, or turning the link off / back on. */
export async function updateKit(code: string, patch: any, who: string): Promise<{ ok: boolean; error?: string }> {
  const all = await readAll()
  const l = all[code]
  if (!l) return { ok: false, error: 'not found' }
  if (patch.client !== undefined) { const c = str(patch.client, 120); if (c) l.client = c }
  if (patch.property !== undefined) l.property = str(patch.property, 160)
  if (patch.message !== undefined) l.message = str(patch.message, 1200)
  if (patch.preparedBy !== undefined) l.preparedBy = str(patch.preparedBy, 120)
  if (patch.size !== undefined) l.size = normSize(patch.size)
  if (patch.sizeLocked !== undefined) l.sizeLocked = !!patch.sizeLocked
  if (patch.setupFee !== undefined) l.setupFee = money(patch.setupFee)
  if (patch.revoke === true) l.revokedAt = new Date().toISOString()
  if (patch.revoke === false) l.revokedAt = null
  return writeAll(all, who)
}

const publicShape = (l: KitLink): KitPublic => {
  const { views, lastView, revokedAt, ...rest } = l
  return rest
}

/** The client's read. Counts the open (a page load, not every refresh of the data). */
export async function openKit(code: string, countView: boolean): Promise<KitPublic | null> {
  if (!KIT_CODE.test(code)) return null
  const all = await readAll()
  const l = all[code]
  if (!l || l.revokedAt) return null
  if (countView) { l.views++; l.lastView = new Date().toISOString(); await writeAll(all, null).catch(() => null) }
  return publicShape(l)
}

/** The client saves as they go; `submit` stamps it as sent to Stay, with their name. */
export async function saveKit(code: string, body: any): Promise<{ ok: true; kit: KitPublic } | { ok: false; error: string; status: number }> {
  if (!KIT_CODE.test(code)) return { ok: false, error: 'not found', status: 404 }
  const all = await readAll()
  const l = all[code]
  if (!l || l.revokedAt) return { ok: false, error: 'not found', status: 404 }
  const selection: KitSelection = normSelection(body?.selection)
  l.selection = selection
  if (!l.sizeLocked && body?.size) l.size = normSize(body.size)
  l.savedAt = new Date().toISOString()
  if (body?.submit) {
    const name = str(body?.name, 120)
    if (!name) return { ok: false, error: 'Add your name so we know who sent it.', status: 400 }
    const email = str(body?.email, 160)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'That email address does not look right.', status: 400 }
    const t = kitTotals(l.size, selection)
    l.submitted = { name, email, note: str(body?.note, 2000), at: l.savedAt, total: t.total, items: t.items }
  }
  const w = await writeAll(all, null)
  if (!w.ok) return { ok: false, error: 'That did not save. Try again in a moment.', status: 502 }
  return { ok: true, kit: publicShape(l) }
}
