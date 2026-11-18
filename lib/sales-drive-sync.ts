// NEW PROJECTIONS, PULLED FROM THE DRIVE FOLDER (Jon, 2026-11-18: "can we access a drive folder and pull any new
// projections and add to the projection library automatically").
//
// The sales team keeps its projections in one Drive folder, a subfolder per building, a PDF per unit
// ("2BR - Elser 3318.pdf"). That folder was typed into the library once, by hand (lib/sales-library-seed, Nov 12).
// This keeps the library up with it: once an hour it lists the folder, and any file it has not seen is read
// (lib/sales-read, the same reader the library's upload uses) and added to its building as one unit type.
//
// THE RULES
//   - NOT APPROVED UNTIL SOMEONE SAYS SO. Everything it adds is marked "Not approved yet" and kept out of the
//     public calculator; a building it creates is out of the calculator too. Approving is still a person's click.
//   - INTERNAL FILES STAY OUT. A file with "internal" in its name (the Icon 2510 four scenarios) is never read.
//   - NOTHING TWICE. A file is remembered by its Drive id and its modified time. What was in the folder when the
//     library was seeded is taken as already there. A file edited later updates the unit type it made.
//   - IT NEVER REMOVES. A file deleted from Drive leaves its unit type in the library.
//   - A FEW A RUN. Reading a PDF takes a model call, so a run reads at most a handful and picks up the rest next hour.
//
// It reads as jon@ (the mailbox that gave Lighthouse read-only Drive consent: lib/google-read). State and the
// last runs live in one app_settings row.
import 'server-only'
import { getSettingFresh, setSetting } from './app-settings'
import { accessTokenFor } from './gmail-send'
import { getGoogleReadGrant } from './google-read'
import { readFile, type ReadPlan } from './sales-read'
import { readLibrary, saveBuilding, type LibraryBuilding } from './sales-library'
import { blankCma, newId, type PacketPlan } from './sales-cma'

export const DRIVE_SYNC_KEY = 'sales_drive_sync'
/** Nick's "Stay Rental Projections by Building and Unit Type" folder. */
export const DEFAULT_FOLDER = '1SqqBzOareHyhmjYvMXweFBvKuLirngbg'
/** Everything in the folder up to here went into the library by hand (the Nov 12 seed). */
const SEEDED_UNTIL = '2026-11-13T00:00:00Z'
const PER_RUN = 4
const FOLDER = 'application/vnd.google-apps.folder'

export type DriveSeen = { modified: string; at: string; name: string; result: 'seeded' | 'added' | 'updated' | 'skipped' | 'failed'; note?: string; buildingId?: string; planId?: string }
export type DriveSyncState = {
  folderId: string; on: boolean
  seen: Record<string, DriveSeen>
  lastRun?: { at: string; ok: boolean; error?: string; listed: number; added: number; updated: number; failed: number; left: number }
  /** The newest things it did, newest first. */
  log: { at: string; name: string; building: string; result: DriveSeen['result']; note?: string; url?: string }[]
}
type DFile = { id: string; name: string; mimeType: string; modifiedTime: string; createdTime?: string; webViewLink?: string; size?: string; folder: string }

export async function readDriveSync(): Promise<DriveSyncState> {
  const v = await getSettingFresh<any>(DRIVE_SYNC_KEY, null)
  return { folderId: String(v?.folderId || DEFAULT_FOLDER), on: v?.on !== false, seen: v?.seen && typeof v.seen === 'object' ? v.seen : {}, lastRun: v?.lastRun || undefined, log: Array.isArray(v?.log) ? v.log.slice(0, 40) : [] }
}
/** A Drive folder link or a bare id, as an id. */
export function folderIdOf(v: string): string {
  const s = String(v || '').trim()
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  return m ? m[1] : /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : ''
}
export async function saveDriveSyncSettings(p: { folder?: string; on?: boolean }, by: string | null): Promise<{ ok: boolean; error?: string; state?: DriveSyncState }> {
  const st = await readDriveSync()
  if (p.folder !== undefined) { const id = folderIdOf(p.folder); if (!id) return { ok: false, error: 'That does not look like a Drive folder link.' }; st.folderId = id }
  if (p.on !== undefined) st.on = !!p.on
  const w = await setSetting(DRIVE_SYNC_KEY, st, by)
  return w.ok ? { ok: true, state: st } : { ok: false, error: w.error }
}

const READER = 'jon@stay-hospitality.com'
async function drive(token: string, path: string, init?: RequestInit) {
  return fetch('https://www.googleapis.com/drive/v3/' + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init?.headers || {}) }, cache: 'no-store' })
}
/** Every file under the folder, two levels deep (the folder, then a subfolder per building). */
async function listFolder(token: string, folderId: string): Promise<DFile[]> {
  const out: DFile[] = []
  const walk = async (id: string, folder: string, depth: number) => {
    let page = ''
    do {
      const q = new URLSearchParams({ q: `'${id}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,size)', pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
      if (page) q.set('pageToken', page)
      const r = await drive(token, 'files?' + q.toString())
      const d: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'Google would not let Lighthouse read that folder. Reconnect Google with the read permission, and check jon@ can open the folder.' : r.status === 404 ? 'That Drive folder was not found. Check the link, and that jon@ can open it.' : 'Drive said: ' + String(d?.error?.message || r.status))
      for (const f of d.files || []) {
        if (f.mimeType === FOLDER) { if (depth < 2) await walk(f.id, f.name, depth + 1) }
        else out.push({ ...f, folder })
      }
      page = d.nextPageToken || ''
    } while (page && out.length < 2000)
  }
  await walk(folderId, '', 0)
  return out
}
const EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
}
const READABLE = /\.(pdf|xlsx|xlsm|csv|docx|png|jpe?g|webp)$/i
async function download(token: string, f: DFile): Promise<File> {
  const ex = EXPORT[f.mimeType]
  const r = await drive(token, 'files/' + f.id + (ex ? '/export?mimeType=' + encodeURIComponent(ex.mime) : '?alt=media&supportsAllDrives=true'))
  if (!r.ok) throw new Error('Could not download it from Drive (' + r.status + ').')
  const buf = await r.arrayBuffer()
  return new File([buf], ex ? f.name + '.' + ex.ext : f.name, { type: ex ? ex.mime : f.mimeType })
}

/** Why a file is left alone, or '' to read it. */
export function skipReason(f: { name: string; mimeType: string; size?: string }): string {
  if (/\binternal\b/i.test(f.name)) return 'Marked internal: never imported.'
  if (/^0+\s|start here|\bindex\b/i.test(f.name)) return 'An index, not a projection.'
  if (!EXPORT[f.mimeType] && !READABLE.test(f.name)) return 'Not a file type that can be read.'
  if (Number(f.size || 0) > 20 * 1024 * 1024) return 'Over 20MB.'
  return ''
}
const STOP = new Set(['the', 'residences', 'residence', 'tower', 'resort', 'condo', 'condos', 'iii', 'ii', 'at', 'and', 'by'])
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).join(' ')
/** The library building a folder or a name belongs to: the same words, give or take "The" and "Residences". */
export function matchBuilding<T extends { name: string }>(list: T[], name: string): T | null {
  const n = norm(name); if (!n) return null
  return list.find(b => norm(b.name) === n) || list.find(b => { const m = norm(b.name); return !!m && (m.includes(n) || n.includes(m)) && Math.min(m.length, n.length) >= 4 }) || null
}
/** "2BR - Elser 3318 and 3319.pdf" → the type, the units, and what is left as the place. */
export function parseFileName(name: string): { type: string; units: string[]; rest: string } {
  const base = String(name).replace(/\.[a-z0-9]{2,5}$/i, '').trim()
  const m = base.match(/^(studio|\d\s*br|\d\s*bed(?:room)?s?|penthouse|townhome|single-family[^-]*)\s*[-–—:]\s*(.+)$/i)
  const paren = base.match(/\((studio|\d\s*br)\)/i)
  const type = (m ? m[1] : paren ? paren[1] : '').trim().replace(/^studio$/i, 'Studio').replace(/(\d)\s*(br|bed(?:room)?s?)\b/i, '$1BR')
  const rest = (m ? m[2] : base).replace(/\([^)]*\)/g, ' ').trim()
  const units = Array.from(new Set((rest.match(/\b[A-Z]{0,2}\d{3,4}\b/g) || []))).slice(0, 8)
  return { type, units, rest: rest.replace(/\b[A-Z]{0,2}\d{3,4}\b/g, ' ').replace(/\band\b/gi, ' ').replace(/\s+/g, ' ').trim() }
}
const monthYear = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' }) : '')

function planFrom(f: DFile, p: ReadPlan, prev?: PacketPlan): PacketPlan {
  const fn = parseFileName(f.name)
  const type = fn.type || String(p.name || '').split(' · ')[0] || 'Unit'
  const lo = Math.round(Number(p.lo) || 0), hi = Math.round(Number(p.hi) || 0) || lo
  const adr = [p.nightlyLo, p.nightlyHi].map(n => Math.round(Number(n) || 0)).filter(Boolean)
  return {
    ...(prev || { id: newId(), price: '', rules: 'Short-term rentals allowed', compIds: [], baseId: 'none', scale: 1, less: 0, suites: 1 }),
    id: prev?.id || newId(),
    name: prev?.name || type + (fn.units.length ? ' · ' + fn.units.join(', ') : ''),
    sf: prev?.sf || String(p.sf || ''),
    occLo: Math.round(Number(p.occLo) || prev?.occLo || 70), occHi: Math.round(Number(p.occHi) || Number(p.occLo) || prev?.occHi || 75),
    how: prev?.how || 'Stay projection, from the projections folder on Drive.',
    override: { lo, hi },
    units: fn.units.length ? fn.units : prev?.units, prepared: monthYear(f.createdTime || f.modifiedTime),
    ...(adr.length ? { adr } : {}),
    notes: [`Imported from the Drive folder on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}. Check the figures against the file before approving.`, String(p.note || '').slice(0, 300)].filter(Boolean).join(' '),
    files: [{ name: f.name, url: f.webViewLink || 'https://drive.google.com/file/d/' + f.id + '/view' }],
    // never approved by a machine: a person approves it, and only then can it reach the public calculator
    status: 'pending', public: false,
  } as PacketPlan
}

export type DriveSyncResult = { ok: boolean; error?: string; listed: number; added: number; updated: number; failed: number; left: number; state?: DriveSyncState }
/** One pass: list the folder, read what is new, add it to the library as not approved. */
export async function runDriveSync(by: string | null, opts: { force?: boolean; retry?: boolean } = {}): Promise<DriveSyncResult> {
  const st = await readDriveSync()
  // "Try the failed ones again": forget them, so this pass reads them afresh
  if (opts.retry) for (const [id, s] of Object.entries(st.seen)) if (s.result === 'failed') delete st.seen[id]
  const none = { listed: 0, added: 0, updated: 0, failed: 0, left: 0 }
  const fail = async (error: string): Promise<DriveSyncResult> => { st.lastRun = { at: new Date().toISOString(), ok: false, error, ...none }; await setSetting(DRIVE_SYNC_KEY, st, by); return { ok: false, error, ...none, state: st } }
  if (!st.on && !opts.force) return { ok: true, ...none, state: st }
  const grant = await getGoogleReadGrant()
  if (!grant.granted || grant.scopes.indexOf('https://www.googleapis.com/auth/drive.readonly') < 0) return fail('Lighthouse does not have read access to Drive yet. Connect Google with the read permission.')
  const t = await accessTokenFor(grant.email || READER)
  if (!t.token) return fail(t.error || 'No Google connection.')
  let files: DFile[]
  try { files = await listFolder(t.token, st.folderId) } catch (e: any) { return fail(String(e?.message || e)) }

  const now = new Date().toISOString()
  const todo: DFile[] = []
  for (const f of files) {
    const s = st.seen[f.id]
    if (s && s.modified === f.modifiedTime) continue
    // what was already there when the library was typed in by hand
    if (!s && f.modifiedTime <= SEEDED_UNTIL && st.folderId === DEFAULT_FOLDER) { st.seen[f.id] = { modified: f.modifiedTime, at: now, name: f.name, result: 'seeded' }; continue }
    const why = skipReason(f)
    if (why) { st.seen[f.id] = { modified: f.modifiedTime, at: now, name: f.name, result: 'skipped', note: why }; continue }
    todo.push(f)
  }
  todo.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime))
  let added = 0, updated = 0, failed = 0
  for (const f of todo.slice(0, PER_RUN)) {
    const prevSeen = st.seen[f.id]
    const log = (result: DriveSeen['result'], building: string, note?: string, ids?: { buildingId?: string; planId?: string }) => {
      st.seen[f.id] = { modified: f.modifiedTime, at: new Date().toISOString(), name: f.name, result, note, buildingId: ids?.buildingId || prevSeen?.buildingId, planId: ids?.planId || prevSeen?.planId }
      st.log.unshift({ at: new Date().toISOString(), name: f.name, building, result, note, url: f.webViewLink })
    }
    try {
      const fn = parseFileName(f.name)
      const read = await readFile(await download(t.token, f), 'unit', f.name.replace(/\.[a-z0-9]{2,5}$/i, ''))
      const p = read.plans[0]
      if (!p || !(Number(p.lo) > 0)) { failed++; log('failed', f.folder, 'No yearly revenue figure could be read from it. Add it by hand from the file.'); continue }
      const list = await readLibrary(true)
      // its building: the subfolder it sits in; in a catch-all folder or loose, what the file itself says
      const catchAll = !f.folder || /^other\b/i.test(f.folder)
      const place = catchAll ? String(read.building || fn.rest || f.name) : f.folder
      let b: LibraryBuilding | null = (prevSeen?.buildingId ? list.find(x => x.id === prevSeen.buildingId) : null) || matchBuilding(list, place)
      const isNew = !b
      if (!b) { const cma = blankCma(place, String(read.area || '')); cma.uplift = { lo: 0, hi: 0, why: '' }; b = { id: newId(), name: place, area: String(read.area || ''), cma, updatedAt: now, calc: false } }
      const at = prevSeen?.planId ? b.cma.plans.findIndex(x => x.id === prevSeen.planId) : -1
      const plan = planFrom(f, p, at >= 0 ? b.cma.plans[at] : undefined)
      const plans = at >= 0 ? b.cma.plans.map((x, i) => (i === at ? plan : x)) : [...b.cma.plans, plan]
      const w = await saveBuilding({ id: b.id, name: b.name, area: b.area, ...(isNew ? { calc: false, note: 'Created from the Drive projections folder. Not approved yet.' } : {}), cma: { ...b.cma, plans } }, 'Drive projections folder')
      if (!w.ok) { failed++; log('failed', b.name, w.error || 'Could not save it to the library.'); continue }
      if (at >= 0) { updated++; log('updated', b.name, 'The file changed on Drive: figures re-read, back to not approved.', { buildingId: w.entry!.id, planId: plan.id }) }
      else { added++; log('added', b.name, isNew ? 'A new building in the library.' : undefined, { buildingId: w.entry!.id, planId: plan.id }) }
    } catch (e: any) { failed++; log('failed', f.folder, String(e?.message || e).slice(0, 200)) }
  }
  st.log = st.log.slice(0, 40)
  const left = Math.max(0, todo.length - PER_RUN)
  st.lastRun = { at: new Date().toISOString(), ok: true, listed: files.length, added, updated, failed, left }
  const w = await setSetting(DRIVE_SYNC_KEY, st, by)
  return { ok: w.ok, error: w.ok ? undefined : w.error, listed: files.length, added, updated, failed, left, state: st }
}
