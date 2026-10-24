// THE GUESTY CHECK-IN FORM (Jon, 2026-10-24: "it should scan check-in form and messages").
//
// Our guests are sent Guesty's Guest App check-in form (guest-app.guesty.com) — the texts and emails
// that chase "you have not signed your check-in form yet" point there. Guesty's Open API exposes the
// completed form as a SUMMARY FILE: GET /guest-app-api/guest-app-runtime/{reservationId}/module/
// check_in/summary → a link (valid one hour) and a filename; 404 = the guest has not completed it.
//
// So: a booking's form is checked and the answer remembered in app_settings `cif_state`
// ({ [reservationId]: { found, at, filename } }) — found once is found for good; not found is
// re-asked after a few hours. The link itself is never stored: viewing asks Guesty for a fresh one.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestyGet } from '@/lib/guesty'
import { createHash } from 'crypto'

// v2 (2026-10-24): v1 counted any answer as a completed form; only a summary FILE counts now.
export const CIF_KEY = 'cif_state_v5'
export const CIF_RECHECK_HOURS = 3
export type CifState = Record<string, { found: boolean; at: string; filename?: string | null; checkOut?: string | null; photos?: number }>

const str = (v: any) => (v == null ? '' : String(v))

export async function readCif(): Promise<CifState> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', CIF_KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (o && typeof o === 'object') return o as CifState
  } catch { /* first run */ }
  return {}
}

async function writeCif(s: CifState): Promise<void> {
  const cutoff = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10)
  for (const [k, v] of Object.entries(s)) if (v?.checkOut && v.checkOut < cutoff) delete s[k]
  await supabaseAdmin().from('app_settings').upsert({ key: CIF_KEY, value: JSON.stringify(s), updated_by: 'guest-cif', updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

/** Ask Guesty for the completed form. found=false on a 404 (not completed); throws on anything else. */
export async function cifSummary(reservationId: string): Promise<{ found: boolean; url: string | null; filename: string | null; shape?: string }> {
  try {
    const v: any = await guestyGet('/guest-app-api/guest-app-runtime/' + encodeURIComponent(reservationId) + '/module/check_in/summary')
    const d = v?.data && typeof v.data === 'object' ? v.data : v
    const url = str(d?.url || d?.fileUrl || d?.link || d?.summaryUrl) || null
    // A completed form is a FILE. An answer with no link (an empty or unfinished form) is not one.
    const shape = d && typeof d === 'object' ? JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? (/^https?:/.test(v) ? '<url>' : v.slice(0, 60)) : typeof v]))).slice(0, 400) : typeof d
    return { found: !!url, url, filename: str(d?.filename || d?.fileName || d?.name) || null, shape }
  } catch (e: any) {
    if (/\b404\b|not ?found/i.test(String(e?.message || e))) return { found: false, url: null, filename: null }
    throw e
  }
}

/**
 * THE PHOTOS INSIDE THE FORM. The summary PDF embeds what the guest uploaded — the ID and the selfie —
 * as JPEG streams (/DCTDecode); the form's own artwork (header, logo, signature box) is not JPEG.
 * A DCT stream's bytes ARE the JPEG file, so they are cut out as-is: no PDF library, no re-encoding.
 */
/** Width × height off a JPEG's frame header (SOF0–SOF15, not DHT/JPG/DAC). */
export function jpegSize(b: Buffer): { w: number; h: number } | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

/**
 * The form's own artwork, which is a JPEG too: the STAY logo at the top of every form (the same bytes
 * in every booking's PDF — first 16 hex of its SHA-256 below, seen 2026-10-24). Plus any banner shape.
 */
const ARTWORK = new Set(['46682246455cc98b'])
const isArtwork = (j: Buffer) => {
  if (ARTWORK.has(createHash('sha256').update(j).digest('hex').slice(0, 16))) return true
  const d = jpegSize(j); return !!d && d.h > 0 && (d.w / d.h > 2.2 || d.h / d.w > 3)
}

export function extractJpegs(buf: Buffer): Buffer[] {
  const t = buf.toString('latin1')
  const out: Buffer[] = []
  const re = /\/Filter\s*(?:\[\s*)?\/DCTDecode/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) && out.length < 12) {
    const st = t.indexOf('stream', m.index)
    if (st < 0) break
    let a = st + 6
    if (t[a] === '\r') a++
    if (t[a] === '\n') a++
    const e = t.indexOf('endstream', a)
    if (e < 0) break
    let z = e
    while (z > a && (t[z - 1] === '\n' || t[z - 1] === '\r')) z--
    const jpg = buf.subarray(a, z)
    if (jpg.length > 2000 && jpg[0] === 0xff && jpg[1] === 0xd8 && !isArtwork(jpg)) out.push(Buffer.from(jpg))
    re.lastIndex = e
  }
  return out
}

/** The completed form's PDF and the photos in it. null = no completed form. */
export async function cifFetch(reservationId: string): Promise<{ pdf: Buffer; jpegs: Buffer[]; filename: string | null } | null> {
  const s = await cifSummary(reservationId)
  if (!s.found || !s.url) return null
  const r = await fetch(s.url, { cache: 'no-store' })
  if (!r.ok) throw new Error('Guesty would not hand over the form (' + r.status + ').')
  const pdf = Buffer.from(await r.arrayBuffer())
  return { pdf, jpegs: extractJpegs(pdf), filename: s.filename }
}

/** Check up to `max` bookings' forms (skipping ones found, or asked recently) and remember the answers. */
export async function sweepCif(ids: { id: string; checkOut?: string | null }[], max = 8): Promise<{ checked: number; found: number; errors: number }> {
  const s = await readCif()
  const fresh = Date.now() - CIF_RECHECK_HOURS * 3600_000
  const todo = ids.filter(x => { const v = s[x.id]; return !v || (!v.found && Date.parse(v.at) < fresh) }).slice(0, max)
  let found = 0, errors = 0
  for (const x of todo) {
    try {
      const f = await cifFetch(x.id)
      s[x.id] = { found: !!f, at: new Date().toISOString(), filename: f?.filename || null, checkOut: x.checkOut || null, photos: f ? f.jpegs.length : 0 }
      if (f) found++
    } catch { errors++ }
  }
  if (todo.length) await writeCif(s)
  return { checked: todo.length - errors, found, errors }
}
