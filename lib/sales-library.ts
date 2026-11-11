// THE BUILDING PROJECTIONS LIBRARY (Jon, 2026-11-11: "a section where we can add our projections for
// units… outside of the magazine, like a database. From there, when creating a new sales magazine, we
// should be able to select the building we want to compare this new magazine to").
//
// One entry per building: its comparable set and every floor plan's projection (a SalesCma, the same
// shape a deck carries in content.cma). A new deck starts from a copy of an entry, so tuning one
// deck for one owner never changes the library, and updating the library never rewrites a deck that
// has already gone out. A deck's pages can be saved back to the library on purpose (Save to library).
//
// Stored as one app_settings row ('sales_buildings'), read fresh before every write. The Rider is
// seeded the first time the library is read empty.
import 'server-only'
import { getSetting, getSettingFresh, setSetting } from './app-settings'
import { normalizeCma, riderTemplate, newId, type SalesCma } from './sales-cma'

export const SALES_LIBRARY_KEY = 'sales_buildings'
export type LibraryBuilding = { id: string; name: string; area: string; website?: string; address?: string; note?: string; photo?: string; cma: SalesCma; updatedAt: string; updatedBy?: string | null }
/** The list view: no comps or plans, just enough to choose from. */
export type LibrarySummary = Omit<LibraryBuilding, 'cma'> & { plans: number; comps: number; range: [number, number] | null }

function clean(list: any): LibraryBuilding[] {
  return (Array.isArray(list) ? list : []).map((e: any) => {
    const cma = normalizeCma(e?.cma)
    if (!cma || !e?.id) return null
    return { id: String(e.id), name: String(e.name || cma.building || 'Building').trim(), area: String(e.area || cma.area || '').trim(), website: e.website ? String(e.website) : undefined, note: e.note ? String(e.note) : undefined, photo: e.photo ? String(e.photo) : undefined, address: e.address ? String(e.address) : undefined, cma, updatedAt: String(e.updatedAt || ''), updatedBy: e.updatedBy || null }
  }).filter(Boolean) as LibraryBuilding[]
}

export async function readLibrary(fresh = false): Promise<LibraryBuilding[]> {
  const raw = await (fresh ? getSettingFresh : getSetting)<any>(SALES_LIBRARY_KEY, null)
  if (raw && Array.isArray(raw.buildings)) return clean(raw.buildings)
  // First read: The Rider, so the library is never empty and shows what an entry looks like.
  const rider = riderTemplate()
  return [{ id: 'rider', name: rider.building, area: rider.area, photo: '/deck-img/miami-skyline.jpg', cma: rider, updatedAt: new Date().toISOString(), updatedBy: null }]
}

export function summarize(e: LibraryBuilding): LibrarySummary {
  const { cma, ...rest } = e
  const lows = cma.comps.map(c => c.lo).filter(n => n > 0), highs = cma.comps.map(c => c.hi).filter(n => n > 0)
  return { ...rest, plans: cma.plans.length, comps: cma.comps.length, range: lows.length && highs.length ? [Math.min(...lows), Math.max(...highs)] : null }
}

export async function getBuilding(id: string): Promise<LibraryBuilding | null> {
  return (await readLibrary()).find(e => e.id === id) || null
}

/** Add or update one entry. With no id, an entry with the same building name is updated instead of duplicated. */
export async function saveBuilding(input: { id?: string; name?: string; area?: string; website?: string; address?: string; note?: string; photo?: string; cma: any }, by?: string | null): Promise<{ ok: boolean; entry?: LibraryBuilding; error?: string }> {
  const cma = normalizeCma(input.cma)
  if (!cma) return { ok: false, error: 'Those building pages could not be read.' }
  const list = await readLibrary(true)
  const name = String(input.name || cma.building || '').trim()
  if (!name) return { ok: false, error: 'Name the building.' }
  let i = input.id ? list.findIndex(e => e.id === input.id) : -1
  if (i < 0 && !input.id) i = list.findIndex(e => e.name.toLowerCase() === name.toLowerCase())
  const prev = i >= 0 ? list[i] : null
  const entry: LibraryBuilding = {
    id: prev?.id || input.id || newId(), name, area: String(input.area ?? prev?.area ?? cma.area ?? '').trim(),
    website: input.website !== undefined ? String(input.website).trim() || undefined : prev?.website,
    note: input.note !== undefined ? String(input.note).trim() || undefined : prev?.note,
    address: input.address !== undefined ? String(input.address).trim() || undefined : prev?.address,
    photo: input.photo !== undefined ? String(input.photo).trim() || undefined : prev?.photo,
    cma: { ...cma, building: cma.building || name }, updatedAt: new Date().toISOString(), updatedBy: by || null,
  }
  if (i >= 0) list[i] = entry; else list.push(entry)
  const w = await setSetting(SALES_LIBRARY_KEY, { buildings: list }, by)
  return w.ok ? { ok: true, entry } : { ok: false, error: w.error }
}

export async function deleteBuilding(id: string, by?: string | null): Promise<{ ok: boolean; error?: string }> {
  const list = await readLibrary(true)
  const next = list.filter(e => e.id !== id)
  if (next.length === list.length) return { ok: false, error: 'Not in the library.' }
  return setSetting(SALES_LIBRARY_KEY, { buildings: next }, by)
}
