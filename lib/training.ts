// TRAINING (Jon, 2026-10-26): "a training tab — how-to videos for the team, a video + FAQ library
// we can assign to team."
//
// Three facts, three tables (migration 161):
//   • ITEMS — a video, an FAQ or a doc, each with an English and a Spanish side. A video is a file
//     in the private `training` bucket (signed six-hour URLs on read) or an outside link.
//   • PEOPLE — everyone training can be assigned to. A Lighthouse user (key = email) sees it on the
//     Training page and in the bell; a field person with no login (key = crew:<name>) gets a PERSONAL
//     LINK, /learn/<code>, that lists their training on a phone with no password. The code is the
//     capability, like /walk, /count and /lot.
//   • ASSIGNMENTS — who must watch what, by when, and when they finished. Finishing from the link,
//     from the app, or marked by a manager are all recorded, with the language they used.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getStaff } from './staffing'
import { notify } from './notify'

export type Lang = 'en' | 'es'
export type ItemKind = 'video' | 'faq' | 'doc'
export type TrainingItem = {
  id: string; kind: ItemKind; status: 'active' | 'archived'
  title: { en: string; es: string | null }
  summary: { en: string | null; es: string | null }
  body: { en: string | null; es: string | null }
  videoPath: { en: string | null; es: string | null }
  videoUrl: { en: string | null; es: string | null }
  durationSec: number | null
  tags: string[]; audience: string[]; required: boolean; sortOrder: number
  createdBy: string | null; createdAt: string; updatedAt: string
}
export type Person = { key: string; name: string; email: string | null; lang: Lang; code: string; dept: string | null; market: string | null; createdAt: string }
export type Assignment = {
  id: string; itemId: string; personKey: string; assignedBy: string | null; assignedAt: string; dueOn: string | null
  completedAt: string | null; completedLang: string | null; completedVia: string | null
}
/** A person who could be assigned training: a Lighthouse user or a field person from the staff roster. */
export type Candidate = { key: string; name: string; email: string | null; dept: string | null; market: string | null; source: 'user' | 'staff' }

export const BUCKET = 'training'
const SIGN_TTL = 6 * 60 * 60
export const TAGS = ['breezeway', 'housekeeping', 'maintenance', 'inspection', 'ccs', 'office', 'safety', 'lighthouse'] as const
export const AUDIENCES = ['housekeeping', 'maintenance', 'inspection', 'supervision', 'ccs', 'office'] as const

const str = (v: any) => (v == null ? '' : String(v))
const clean = (v: any, max: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, max) || null
const cleanMulti = (v: any, max: number) => str(v).replace(/\r/g, '').trim().slice(0, max) || null
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const isYmd = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
const ymdET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const slug = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const newCode = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 12; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}
const list = (v: any, allowed: readonly string[]) => Array.isArray(v) ? Array.from(new Set(v.map((x: any) => String(x || '').toLowerCase().trim()).filter((x: string) => allowed.indexOf(x) >= 0))) : []
const isHttp = (u: string | null) => !!u && /^https?:\/\//i.test(u)

const itemOf = (r: any): TrainingItem => ({
  id: str(r.id), kind: (r.kind || 'video') as ItemKind, status: r.status === 'archived' ? 'archived' : 'active',
  title: { en: str(r.title_en), es: r.title_es ?? null },
  summary: { en: r.summary_en ?? null, es: r.summary_es ?? null },
  body: { en: r.body_en ?? null, es: r.body_es ?? null },
  videoPath: { en: r.video_path_en ?? null, es: r.video_path_es ?? null },
  videoUrl: { en: r.video_url_en ?? null, es: r.video_url_es ?? null },
  durationSec: r.duration_sec == null ? null : num(r.duration_sec),
  tags: Array.isArray(r.tags) ? r.tags.map(String) : [], audience: Array.isArray(r.audience) ? r.audience.map(String) : [],
  required: r.required === true, sortOrder: num(r.sort_order) || 100,
  createdBy: r.created_by ?? null, createdAt: str(r.created_at), updatedAt: str(r.updated_at),
})
const personOf = (r: any): Person => ({ key: str(r.key), name: str(r.name), email: r.email ?? null, lang: r.lang === 'es' ? 'es' : 'en', code: str(r.code), dept: r.dept ?? null, market: r.market ?? null, createdAt: str(r.created_at) })
const assignmentOf = (r: any): Assignment => ({
  id: str(r.id), itemId: str(r.item_id), personKey: str(r.person_key), assignedBy: r.assigned_by ?? null, assignedAt: str(r.assigned_at), dueOn: r.due_on ?? null,
  completedAt: r.completed_at ?? null, completedLang: r.completed_lang ?? null, completedVia: r.completed_via ?? null,
})

// ---------------------------------------------------------------- storage
export async function ensureBucket(): Promise<void> {
  const sb = supabaseAdmin()
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 200 * 1024 * 1024 })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

/** A signed upload the browser PUTs the file to directly — a video is far past what a Vercel route may carry. */
export async function signUpload(itemId: string, lang: Lang, filename: string): Promise<{ ok: true; path: string; token: string; signedUrl: string } | { ok: false; error: string }> {
  await ensureBucket()
  const ext = (String(filename || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'mp4').toLowerCase()
  if (['mp4', 'm4v', 'mov', 'webm'].indexOf(ext) < 0) return { ok: false, error: 'Upload an .mp4, .mov or .webm video.' }
  const path = `items/${itemId}/${lang}-${Date.now().toString(36)}.${ext}`
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'signed upload: ' + (error?.message || 'no url') }
  return { ok: true, path, token: data.token, signedUrl: data.signedUrl }
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const keyed = Array.from(new Set(paths.filter(Boolean)))
  if (!keyed.length) return {}
  try {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(keyed, SIGN_TTL)
    if (error || !Array.isArray(data)) return {}
    const out: Record<string, string> = {}
    for (const d of data as any[]) if (d?.path && d?.signedUrl) out[d.path] = d.signedUrl
    return out
  } catch { return {} }
}

/** The URL a player can open for each side of each item: the signed file when there is one, else the outside link. */
export async function playableUrls(items: TrainingItem[]): Promise<Record<string, { en: string | null; es: string | null }>> {
  const signed = await signPaths(items.flatMap(i => [i.videoPath.en, i.videoPath.es]).filter(Boolean) as string[])
  const out: Record<string, { en: string | null; es: string | null }> = {}
  for (const i of items) {
    out[i.id] = {
      en: (i.videoPath.en && signed[i.videoPath.en]) || (isHttp(i.videoUrl.en) ? i.videoUrl.en : null),
      es: (i.videoPath.es && signed[i.videoPath.es]) || (isHttp(i.videoUrl.es) ? i.videoUrl.es : null),
    }
  }
  return out
}

// ---------------------------------------------------------------- items
export async function listItems(includeArchived = false): Promise<TrainingItem[]> {
  let q = supabaseAdmin().from('training_items').select('*').order('sort_order').order('created_at')
  if (!includeArchived) q = q.eq('status', 'active')
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).map(itemOf)
}
export async function itemById(id: string): Promise<TrainingItem | null> {
  const { data } = await supabaseAdmin().from('training_items').select('*').eq('id', id).maybeSingle()
  return data ? itemOf(data) : null
}

export type ItemInput = {
  kind?: string; titleEn?: string; titleEs?: string; summaryEn?: string; summaryEs?: string; bodyEn?: string; bodyEs?: string
  videoUrlEn?: string; videoUrlEs?: string; durationSec?: number | null; tags?: string[]; audience?: string[]; required?: boolean; sortOrder?: number
}
function itemPatch(inp: ItemInput): Record<string, any> {
  const p: Record<string, any> = {}
  if (inp.kind != null) p.kind = ['video', 'faq', 'doc'].indexOf(String(inp.kind)) >= 0 ? String(inp.kind) : 'video'
  if (inp.titleEn != null) p.title_en = clean(inp.titleEn, 160)
  if (inp.titleEs != null) p.title_es = clean(inp.titleEs, 160)
  if (inp.summaryEn != null) p.summary_en = clean(inp.summaryEn, 400)
  if (inp.summaryEs != null) p.summary_es = clean(inp.summaryEs, 400)
  if (inp.bodyEn != null) p.body_en = cleanMulti(inp.bodyEn, 12000)
  if (inp.bodyEs != null) p.body_es = cleanMulti(inp.bodyEs, 12000)
  if (inp.videoUrlEn != null) p.video_url_en = isHttp(clean(inp.videoUrlEn, 600)) ? clean(inp.videoUrlEn, 600) : null
  if (inp.videoUrlEs != null) p.video_url_es = isHttp(clean(inp.videoUrlEs, 600)) ? clean(inp.videoUrlEs, 600) : null
  if (inp.durationSec !== undefined) p.duration_sec = inp.durationSec == null ? null : Math.max(0, Math.round(num(inp.durationSec)))
  if (inp.tags != null) p.tags = list(inp.tags, TAGS)
  if (inp.audience != null) p.audience = list(inp.audience, AUDIENCES)
  if (inp.required != null) p.required = inp.required === true
  if (inp.sortOrder != null) p.sort_order = Math.max(0, Math.round(num(inp.sortOrder))) || 100
  return p
}
export async function createItem(inp: ItemInput, by: string): Promise<{ ok: true; item: TrainingItem } | { ok: false; error: string }> {
  const p = itemPatch(inp)
  if (!p.title_en) return { ok: false, error: 'Give it a title (English).' }
  const { data, error } = await supabaseAdmin().from('training_items').insert({ ...p, created_by: by }).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' }
  return { ok: true, item: itemOf(data) }
}
export async function updateItem(id: string, inp: ItemInput & { videoPathEn?: string | null; videoPathEs?: string | null; status?: string }, _by: string): Promise<{ ok: true; item: TrainingItem } | { ok: false; error: string }> {
  const p = itemPatch(inp)
  if (inp.videoPathEn !== undefined) p.video_path_en = inp.videoPathEn || null
  if (inp.videoPathEs !== undefined) p.video_path_es = inp.videoPathEs || null
  if (inp.status != null) p.status = inp.status === 'archived' ? 'archived' : 'active'
  if ('title_en' in p && !p.title_en) return { ok: false, error: 'A title is required.' }
  p.updated_at = new Date().toISOString()
  const { data, error } = await supabaseAdmin().from('training_items').update(p).eq('id', id).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'update failed' }
  return { ok: true, item: itemOf(data) }
}
/** A replaced video file is removed from storage so the bucket does not keep every take. */
export async function removeFile(path: string | null): Promise<void> {
  if (!path) return
  try { await supabaseAdmin().storage.from(BUCKET).remove([path]) } catch { /* best effort */ }
}

// ---------------------------------------------------------------- people
export async function listPeople(): Promise<Person[]> {
  const { data, error } = await supabaseAdmin().from('training_people').select('*').order('name')
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).map(personOf)
}
export async function personByCode(code: string): Promise<Person | null> {
  const c = String(code || '').trim().toLowerCase()
  if (!c) return null
  const { data } = await supabaseAdmin().from('training_people').select('*').eq('code', c).maybeSingle()
  return data ? personOf(data) : null
}
export async function personByKey(key: string): Promise<Person | null> {
  const { data } = await supabaseAdmin().from('training_people').select('*').eq('key', key).maybeSingle()
  return data ? personOf(data) : null
}

/** Everyone training can go to: active Lighthouse users and the active staff roster, deduped by email/name. */
export async function candidates(): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()
  try {
    const { data } = await supabaseAdmin().from('app_users').select('email,status,profile,role').eq('status', 'active')
    for (const u of ((data || []) as any[])) {
      const email = String(u.email || '').toLowerCase().trim()
      if (!email || seen.has(email)) continue
      seen.add(email)
      const name = String(u.profile?.name || u.profile?.full_name || email.split('@')[0]).trim()
      out.push({ key: email, name, email, dept: 'office', market: null, source: 'user' })
    }
  } catch { /* the roster still answers */ }
  try {
    const staff = await getStaff(false)
    for (const s of staff) {
      const name = String(s.name || '').trim()
      if (!name) continue
      const k = 'crew:' + slug(name)
      if (seen.has(k) || out.some(c => c.name.toLowerCase() === name.toLowerCase())) continue
      seen.add(k)
      out.push({ key: k, name, email: null, dept: s.dept || null, market: s.area || null, source: 'staff' })
    }
  } catch { /* fail-open */ }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Make sure a person row (and so a personal link) exists for a candidate; returns it. */
export async function ensurePerson(c: { key: string; name: string; email?: string | null; dept?: string | null; market?: string | null; lang?: Lang }): Promise<Person> {
  const key = String(c.key || '').toLowerCase().trim()
  const have = await personByKey(key)
  if (have) return have
  const row = { key, name: clean(c.name, 80) || key, email: c.email ? String(c.email).toLowerCase() : null, lang: c.lang === 'es' ? 'es' : 'en', code: newCode(), dept: c.dept || null, market: c.market || null }
  const { data, error } = await supabaseAdmin().from('training_people').insert(row).select('*').single()
  if (error || !data) {
    const again = await personByKey(key)
    if (again) return again
    throw new Error(error?.message || 'could not create the person')
  }
  return personOf(data)
}
export async function updatePerson(key: string, patch: { lang?: Lang; name?: string; email?: string | null; newCode?: boolean }): Promise<Person | null> {
  const p: Record<string, any> = {}
  if (patch.lang) p.lang = patch.lang === 'es' ? 'es' : 'en'
  if (patch.name != null) p.name = clean(patch.name, 80)
  if (patch.email !== undefined) p.email = patch.email ? String(patch.email).toLowerCase() : null
  if (patch.newCode) p.code = newCode()
  if (!Object.keys(p).length) return personByKey(key)
  const { data } = await supabaseAdmin().from('training_people').update(p).eq('key', key).select('*').single()
  return data ? personOf(data) : null
}

// ---------------------------------------------------------------- assignments
export async function listAssignments(): Promise<Assignment[]> {
  const { data, error } = await supabaseAdmin().from('training_assignments').select('*').order('assigned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).map(assignmentOf)
}
export async function assignmentsFor(personKey: string): Promise<Assignment[]> {
  const { data } = await supabaseAdmin().from('training_assignments').select('*').eq('person_key', personKey).order('assigned_at', { ascending: false })
  return ((data || []) as any[]).map(assignmentOf)
}

/**
 * Assign items to people. Existing assignments are kept (their completion stands); new ones are
 * created. Lighthouse users get a bell item pointing at the Training page; a field person's row
 * carries their personal link for the manager to send.
 */
export async function assign(inp: { itemIds: string[]; people: { key: string; name: string; email?: string | null; dept?: string | null; market?: string | null; lang?: Lang }[]; dueOn?: string | null; by: string; byEmail?: string | null; notifyUsers?: boolean }): Promise<{ ok: true; created: number; people: Person[] } | { ok: false; error: string }> {
  const itemIds = Array.from(new Set((inp.itemIds || []).map(String).filter(Boolean)))
  if (!itemIds.length) return { ok: false, error: 'Pick at least one video or FAQ.' }
  if (!inp.people?.length) return { ok: false, error: 'Pick at least one person.' }
  const dueOn = isYmd(inp.dueOn) ? String(inp.dueOn) : null
  const items = (await listItems(true)).filter(i => itemIds.indexOf(i.id) >= 0)
  if (!items.length) return { ok: false, error: 'Those items do not exist any more.' }
  const people: Person[] = []
  for (const c of inp.people) people.push(await ensurePerson(c))
  const rows = []
  for (const p of people) for (const i of items) rows.push({ item_id: i.id, person_key: p.key, assigned_by: inp.by, due_on: dueOn })
  const { data, error } = await supabaseAdmin().from('training_assignments').upsert(rows, { onConflict: 'item_id,person_key', ignoreDuplicates: true }).select('id')
  if (error) return { ok: false, error: error.message }
  const created = Array.isArray(data) ? data.length : 0
  if (inp.notifyUsers !== false) {
    const emails = people.filter(p => p.email).map(p => String(p.email))
    if (emails.length) {
      const what = items.length === 1 ? `“${items[0].title.en}”` : `${items.length} training items`
      try { await notify(emails, { kind: 'training', title: `Training assigned: ${what}`, body: dueOn ? `Due ${dueOn}. Open Team → Training.` : 'Open Team → Training.', link: '/training', actor: inp.byEmail || undefined }) } catch { /* bell is best effort */ }
    }
  }
  return { ok: true, created, people }
}
export async function unassign(itemId: string, personKey: string): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin().from('training_assignments').delete().eq('item_id', itemId).eq('person_key', personKey)
  return { ok: !error }
}
export async function complete(itemId: string, personKey: string, lang: Lang, via: 'link' | 'app' | 'manager'): Promise<{ ok: true; assignment: Assignment | null } | { ok: false; error: string }> {
  const db = supabaseAdmin()
  const { data: have } = await db.from('training_assignments').select('*').eq('item_id', itemId).eq('person_key', personKey).maybeSingle()
  const now = new Date().toISOString()
  if (have) {
    if ((have as any).completed_at) return { ok: true, assignment: assignmentOf(have) }
    const { data, error } = await db.from('training_assignments').update({ completed_at: now, completed_lang: lang, completed_via: via }).eq('id', (have as any).id).select('*').single()
    if (error || !data) return { ok: false, error: error?.message || 'update failed' }
    return { ok: true, assignment: assignmentOf(data) }
  }
  // Watched without being assigned — record it as a finished assignment so the record is complete.
  const { data, error } = await db.from('training_assignments').insert({ item_id: itemId, person_key: personKey, assigned_by: null, completed_at: now, completed_lang: lang, completed_via: via }).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'insert failed' }
  return { ok: true, assignment: assignmentOf(data) }
}
export async function reopen(itemId: string, personKey: string): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin().from('training_assignments').update({ completed_at: null, completed_lang: null, completed_via: null }).eq('item_id', itemId).eq('person_key', personKey)
  return { ok: !error }
}
export async function recordView(itemId: string, personKey: string | null, lang: Lang): Promise<void> {
  try { await supabaseAdmin().from('training_views').insert({ item_id: itemId, person_key: personKey, lang }) } catch { /* trail only */ }
}

// ---------------------------------------------------------------- the person's page
export type PersonBundle = {
  person: { name: string; lang: Lang }
  items: (TrainingItem & { url: { en: string | null; es: string | null }; assignment: Assignment | null })[]
  today: string
}
/** What /learn/<code> shows: everything assigned to the person, newest first, plus every required item. */
export async function bundleForPerson(p: Person): Promise<PersonBundle> {
  const [items, assigned] = await Promise.all([listItems(false), assignmentsFor(p.key)])
  const byItem: Record<string, Assignment> = {}
  for (const a of assigned) byItem[a.itemId] = a
  const mine = items.filter(i => byItem[i.id] || i.required)
  const urls = await playableUrls(mine)
  const rows = mine.map(i => ({ ...i, url: urls[i.id] || { en: null, es: null }, assignment: byItem[i.id] || null }))
  rows.sort((a, b) => {
    const ad = a.assignment?.completedAt ? 1 : 0, bd = b.assignment?.completedAt ? 1 : 0
    if (ad !== bd) return ad - bd
    return (a.assignment?.dueOn || '9999').localeCompare(b.assignment?.dueOn || '9999') || a.sortOrder - b.sortOrder
  })
  return { person: { name: p.name, lang: p.lang }, items: rows, today: ymdET() }
}

export { ymdET }
