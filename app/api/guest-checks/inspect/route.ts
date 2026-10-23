// ADMIN DIAGNOSTIC — where does Guesty keep a booking's ID, selfie and deposit? (Jon, 2026-10-23:
// "audit and ensure that the connection really understands the process … collected the ID, the
// selfie, and the $350 deposit … pull in those details from the folio and the photos of the IDs").
// GET ?id=<reservationId> → every key path on the stored row, the live reservation, the live guest
// and the guest's documents that looks like verification, identity, documents or deposits — values
// shortened, never card numbers. Read-only.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestyGet } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HIT = /verif|ident|document|passport|licen[cs]e|selfie|screen|kyc|deposit|secur|hold|photo|image|picture|upload|file|attach|risk|guarantee|damage/i
const SKIP = /card|cvv|cvc|pan\b|number|iban|account/i

function scan(o: any, path = '', out: { path: string; value: string }[] = [], depth = 0): typeof out {
  if (o == null || depth > 7 || out.length > 300) return out
  if (Array.isArray(o)) { o.slice(0, 15).forEach((v, i) => scan(v, path + '[' + i + ']', out, depth + 1)); return out }
  if (typeof o !== 'object') return out
  for (const k of Object.keys(o)) {
    const p = path ? path + '.' + k : k
    const v = o[k]
    if (HIT.test(k) && !SKIP.test(k)) {
      const val = v == null ? String(v) : typeof v === 'object' ? JSON.stringify(v).slice(0, 400) : String(v).slice(0, 200)
      out.push({ path: p, value: val })
    }
    if (v && typeof v === 'object') scan(v, p, out, depth + 1)
  }
  return out
}

export async function GET(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  if (g.access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 })
  const id = String(req.nextUrl.searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
  const out: any = { ok: true, id }
  try {
    const { data } = await supabaseAdmin().from('guesty_reservations').select('raw').eq('id', id).maybeSingle()
    const raw = (data as any)?.raw || null
    out.storedKeys = raw ? Object.keys(raw) : null
    out.stored = raw ? scan(raw) : null
  } catch (e: any) { out.storedError = String(e?.message || e).slice(0, 200) }
  let guestId = ''
  try {
    const live: any = await guestyGet('/reservations/' + encodeURIComponent(id))
    out.liveKeys = Object.keys(live || {})
    out.live = scan(live)
    guestId = String(live?.guestId || live?.guest?._id || '')
  } catch (e: any) { out.liveError = String(e?.message || e).slice(0, 200) }
  if (guestId) {
    out.guestId = guestId
    for (const [k, path] of [
      ['guest', '/guests-crud/' + guestId],
      ['guestDocs', '/guests-crud/' + guestId + '/documents'],
      ['guestVerification', '/guests/' + guestId + '/verification'],
      ['resVerification', '/reservations/' + encodeURIComponent(id) + '/guest-verification'],
    ] as [string, string][]) {
      try { const v: any = await guestyGet(path); out[k + 'Keys'] = v && typeof v === 'object' ? Object.keys(v) : typeof v; out[k] = scan(v) } catch (e: any) { out[k + 'Error'] = String(e?.message || e).slice(0, 160) }
    }
  }
  return NextResponse.json(out)
}
