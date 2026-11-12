// THE PROJECTIONS LIBRARY'S FILES (Jon, 2026-11-12: "we should have an upload section and add projections to
// that, and allow Nick to build and reference it all"). Every projection sheet, deck or PDF the team has is
// uploaded once, kept, and filed under a building (or left unfiled until someone files it). From a filed file
// the library can build the building's unit types (the reader, /api/sales/read), and anyone can open the
// original again. Server-only. Files in the private storage bucket 'sales-files'; the list in app_settings.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSettingFresh, setSetting } from './app-settings'

const BUCKET = 'sales-files'
const KEY = 'projection_files'
const TTL = 60 * 60 * 6
export type ProjFile = { id: string; path: string; name: string; size: number; type: string; buildingId: string; planId?: string; note: string; by: string; at: string }
export type ProjFileOut = ProjFile & { url: string }

async function ensureBucket() {
  const sb = supabaseAdmin()
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}
const clean = (list: any): ProjFile[] => (Array.isArray(list) ? list : []).filter((f: any) => f && f.id && f.path).map((f: any) => ({
  id: String(f.id), path: String(f.path), name: String(f.name || 'File').slice(0, 200), size: Number(f.size) || 0, type: String(f.type || ''), buildingId: String(f.buildingId || ''),
  ...(f.planId ? { planId: String(f.planId) } : {}), note: String(f.note || '').slice(0, 500), by: String(f.by || ''), at: String(f.at || ''),
}))
async function readAll(): Promise<ProjFile[]> { return clean(await getSettingFresh<any>(KEY, [])) }
async function writeAll(list: ProjFile[], by: string | null) { const w = await setSetting(KEY, list, by); if (!w.ok) throw new Error(w.error || 'Could not save the file list.') }

export async function listFiles(buildingId?: string): Promise<ProjFileOut[]> {
  const all = (await readAll()).filter(f => buildingId == null || f.buildingId === buildingId).sort((a, b) => b.at.localeCompare(a.at))
  if (!all.length) return []
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(all.map(f => f.path), TTL)
  const url: Record<string, string> = {}
  ;(data || []).forEach((x: any) => { if (x?.path && x?.signedUrl) url[x.path] = x.signedUrl })
  return all.map(f => ({ ...f, url: url[f.path] || '' }))
}

export async function signUpload(name: string): Promise<{ path: string; signedUrl: string }> {
  await ensureBucket()
  const safe = String(name || 'file').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-90) || 'file'
  const path = `projections/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${safe}`
  const r = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path)
  if (r.error || !r.data) throw new Error('signed upload: ' + (r.error?.message || 'no url'))
  return { path, signedUrl: r.data.signedUrl }
}

export async function addFile(m: { path: string; name: string; size: number; type: string; buildingId?: string; note?: string }, by: string): Promise<ProjFile> {
  if (!/^projections\/[\w.\- ]+$/.test(m.path)) throw new Error('bad path')
  const f: ProjFile = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path: m.path, name: String(m.name || 'File').slice(0, 200), size: Number(m.size) || 0, type: String(m.type || '').slice(0, 100), buildingId: String(m.buildingId || ''), note: String(m.note || '').slice(0, 500), by, at: new Date().toISOString() }
  await writeAll([f, ...(await readAll())].slice(0, 2000), by)
  return f
}

export async function updateFile(id: string, p: { buildingId?: string; planId?: string; note?: string; name?: string }, by: string): Promise<void> {
  const all = await readAll()
  const i = all.findIndex(f => f.id === id); if (i < 0) throw new Error('No such file.')
  all[i] = { ...all[i], ...(p.buildingId != null ? { buildingId: String(p.buildingId) } : {}), ...(p.planId != null ? { planId: String(p.planId) } : {}), ...(p.note != null ? { note: String(p.note).slice(0, 500) } : {}), ...(p.name ? { name: String(p.name).slice(0, 200) } : {}) }
  await writeAll(all, by)
}

export async function deleteFile(id: string, by: string): Promise<void> {
  const all = await readAll()
  const f = all.find(x => x.id === id); if (!f) return
  await supabaseAdmin().storage.from(BUCKET).remove([f.path]).catch(() => null)
  await writeAll(all.filter(x => x.id !== id), by)
}

/** How many files each building has (for the list of buildings). */
export async function fileCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const f of await readAll()) out[f.buildingId || ''] = (out[f.buildingId || ''] || 0) + 1
  return out
}
