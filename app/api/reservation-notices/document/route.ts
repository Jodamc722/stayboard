// THE DOCUMENT STORE — where a generated registration form is kept.
//
// StayBoard keeps its own documents rather than writing into the onboarding app's Vault, so a form
// filed here is never confused with one filed there. The notice row records `doc_path`/`doc_name`,
// which is what tells anyone looking WHERE that booking's form actually lives.
//
// PRIVATE BUCKET, SIGNED URLS. The form carries a guest's name, phone and email; the app's photo
// buckets are public, and copying that pattern here would put guest PII behind a guessable URL.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BUCKET = 'reservation-docs'
const TABLE = 'reservation_notices'
const MAX_BYTES = 6 * 1024 * 1024
const URL_TTL = 600

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  // public:false — see the header note. A signed URL is minted per request instead.
  const { error } = await sb.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function safeName(s: string): string {
  // Last-resort name only — the caller sends one built from the property's docName template.
  return str(s).replace(/[^\w .\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    || 'Transient Guest-Occupant Registration Form.pdf'
}

/** POST — file a generated form against a notice. Body: { id, pdfBase64, name }. */
export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({} as any))
  const id = str(b.id).trim()
  const name = safeName(b.name)
  const b64 = str(b.pdfBase64)
  if (!id) return NextResponse.json({ ok: false, error: 'Which notice?' }, { status: 400 })
  if (!b64) return NextResponse.json({ ok: false, error: 'No document was sent.' }, { status: 400 })

  let bytes: Buffer
  try { bytes = Buffer.from(b64, 'base64') } catch { return NextResponse.json({ ok: false, error: 'Could not read the document.' }, { status: 400 }) }
  if (!bytes.length) return NextResponse.json({ ok: false, error: 'The document was empty.' }, { status: 400 })
  if (bytes.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That document is too large.' }, { status: 400 })
  // A truncated upload that still "succeeds" is worse than a failure — it gets attached to an email
  // and reaches a building as a broken file. Check it really is a PDF before storing it.
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ ok: false, error: 'That file is not a PDF.' }, { status: 400 })
  }

  const db = supabaseAdmin()
  try {
    const { data: notice, error: findErr } = await db.from(TABLE).select('id, doc_path').eq('id', id).is('deleted_at', null).single()
    if (findErr || !notice) return NextResponse.json({ ok: false, error: 'That notice no longer exists.' }, { status: 404 })

    await ensureBucket(db)
    // Regenerating overwrites in place: one notice keeps one document, so an edited booking can
    // never leave a stale form behind for someone to attach by mistake.
    const path = (notice as any).doc_path || ('reservations/' + id + '.pdf')
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true })
    if (up.error) return NextResponse.json({ ok: false, error: 'Could not store the document: ' + up.error.message }, { status: 500 })

    const { error: updErr } = await db.from(TABLE).update({ doc_path: path, doc_name: name, updated_at: new Date().toISOString() }).eq('id', id)
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })

    const signed = await db.storage.from(BUCKET).createSignedUrl(path, URL_TTL)
    return NextResponse.json({ ok: true, path, name, url: signed.data?.signedUrl || null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

/** GET ?id= — a fresh signed link to a filed form. Links expire, so they are minted on demand. */
export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = str(req.nextUrl.searchParams.get('id')).trim()
  if (!id) return NextResponse.json({ ok: false, error: 'Which notice?' }, { status: 400 })
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from(TABLE).select('doc_path, doc_name').eq('id', id).is('deleted_at', null).single()
    if (error || !data || !(data as any).doc_path) {
      return NextResponse.json({ ok: false, error: 'No document filed for this notice yet.' }, { status: 404 })
    }
    const signed = await db.storage.from(BUCKET).createSignedUrl((data as any).doc_path, URL_TTL)
    if (signed.error) return NextResponse.json({ ok: false, error: signed.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, url: signed.data?.signedUrl || null, name: (data as any).doc_name || null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
