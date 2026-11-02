// THE REPORT AUDIT (Jon, 2026-11-02: "needs to actually audit the report submitted and flag if
// nothing meaningful was added").
//
// For a task that bills an owner, read what the crew actually handed in: the checklist answers and
// their photos (GET /task/{id}/requirements), the task's own photos, and the comment thread. Then
// judge it plainly:
//
//   solid — at least one photo AND real words about the work
//   thin  — something is there, but no photos, or no real words ("done", "ok", "listo" are not words)
//   none  — nothing at all: no photos, no notes, no answered checklist
//
// The text the task was CREATED with (its title and description) is ours, not the crew's, so it
// never counts as the report. Comments Lighthouse posted itself don't count either.
//
// Results live in app_settings 'billing_evidence' ({ [taskId]: Evidence }), read fresh before every
// write so two checks never drop each other's rows, trimmed to the newest 6,000.
import 'server-only'
import { getSettingFresh, getSetting, setSetting } from './app-settings'
import { bzApi, retrieveBreezewayTask, listBreezewayComments } from './breezeway'

export const EVIDENCE_KEY = 'billing_evidence'
export type Evidence = {
  at: string
  photos: number
  answered: number
  items: number
  words: number
  comments: number
  verdict: 'solid' | 'thin' | 'none'
  why: string
  /** Up to three of the crew's own lines, for the reviewer to read without opening Breezeway. */
  said: string[]
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const URL_RE = /^https?:\/\//i
const photoCount = (v: any): number => {
  const arr = Array.isArray(v) ? v : v ? [v] : []
  return arr.filter((x: any) => URL_RE.test(typeof x === 'string' ? x : str(x?.url || x?.file_url || x?.image_url || x?.photo_url || x?.original_url || x?.src))).length
}
// Answers that carry no information on their own.
const FILLER = /^(yes|y|no|n|si|sí|ok|okay|done|complete|completed|finished|fixed|good|fine|na|n\/a|none|listo|hecho|terminado|bien|todo bien|check|checked|x|\.|-|\d+)$/i
const AUTOMATED = /lighthouse|automat|this task was (created|moved)|\[moved to/i

function meaningful(line: string, ignore: string[]): string | null {
  const t = str(line).replace(/\s+/g, ' ').trim()
  if (!t || FILLER.test(t.replace(/[.!]+$/, ''))) return null
  const low = t.toLowerCase()
  if (ignore.some(x => x && (low === x || (x.length > 20 && x.includes(low))))) return null
  return t
}

/** Read one task's report and judge it. */
export async function gatherEvidence(taskId: string, created: { name?: string | null; description?: string | null }, extraPhotos = 0): Promise<Evidence> {
  const ignore = [str(created.name).toLowerCase().trim(), str(created.description).toLowerCase().replace(/\s+/g, ' ').trim()]
  const [task, reqs, cmts] = await Promise.all([
    retrieveBreezewayTask(taskId).catch(() => null),
    bzApi('/task/' + encodeURIComponent(taskId) + '/requirements').catch(() => null),
    listBreezewayComments(taskId).catch(() => ({ ok: false, comments: [] as { body: string; at: string }[] })),
  ])
  const t: any = task && task.ok && task.data ? (task.data.task || task.data) : {}
  const rows: any[] = reqs && reqs.ok ? (Array.isArray(reqs.data) ? reqs.data : Array.isArray(reqs.data?.results) ? reqs.data.results : Array.isArray(reqs.data?.data) ? reqs.data.data : []) : []
  let photos = photoCount(t.photos) + photoCount(t.images) + extraPhotos
  let answered = 0
  const said: string[] = []
  for (const q of rows) {
    photos += photoCount(q?.photos)
    const resp = str(q?.response ?? q?.value ?? q?.answer).trim()
    const note = str(q?.note || q?.comment).trim()
    if (resp || note || photoCount(q?.photos)) answered++
    for (const x of [note, /^(yes|no|true|false)$/i.test(resp) ? '' : resp]) { const m = meaningful(x, ignore); if (m) said.push(m) }
  }
  for (const c of cmts.comments || []) {
    if (AUTOMATED.test(c.body)) continue
    const m = meaningful(c.body, ignore); if (m) said.push(m)
  }
  for (const k of ['notes', 'report_notes', 'completion_notes']) { const m = meaningful(str(t?.[k]), ignore); if (m) said.push(m) }
  const words = said.join(' ').split(/\s+/).filter(w => w.replace(/[^a-záéíóúñ]/gi, '').length > 1).length
  const hasWords = words >= 5
  // Photos are the proof for most jobs: two or more, or one with real words, is a report.
  const verdict: Evidence['verdict'] = photos >= 2 || (photos === 1 && hasWords) ? 'solid' : photos > 0 || hasWords || answered >= 3 ? 'thin' : 'none'
  const why = verdict === 'solid' ? photos + ' photo' + (photos === 1 ? '' : 's') + ', ' + words + ' words from the crew'
    : verdict === 'none' ? 'nothing added — no photos, no notes' + (rows.length ? ', no checklist answers' : '')
      : [photos ? photos + ' photo' + (photos === 1 ? '' : 's') : 'no photos', hasWords ? words + ' words' : words ? 'only ' + words + ' word' + (words === 1 ? '' : 's') + ' of notes' : 'no notes about the work'].join(', ')
  return { at: new Date().toISOString(), photos, answered, items: rows.length, words, comments: (cmts.comments || []).length, verdict, why, said: said.slice(0, 3).map(x => x.slice(0, 160)) }
}

export async function readEvidence(): Promise<Record<string, Evidence>> {
  const v = await getSetting<any>(EVIDENCE_KEY, null)
  return v && typeof v === 'object' && v.map && typeof v.map === 'object' ? v.map : {}
}

/** Merge new results in — read fresh, so a parallel check is never overwritten. */
export async function saveEvidence(add: Record<string, Evidence>, by: string): Promise<void> {
  if (!Object.keys(add).length) return
  const cur = await getSettingFresh<any>(EVIDENCE_KEY, null)
  const map: Record<string, Evidence> = { ...((cur && cur.map) || {}), ...add }
  const keys = Object.keys(map)
  if (keys.length > 6000) keys.sort((a, b) => str(map[b].at).localeCompare(str(map[a].at))).slice(6000).forEach(k => delete map[k])
  await setSetting(EVIDENCE_KEY, { map }, by)
}
