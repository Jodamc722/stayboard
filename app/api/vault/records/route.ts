// VAULT RECORDS — the verification paper trail, in one place (Jon, 2026-08-22: "All verification
// should live here: completed by Salato, incident reports (we will build), Elser reservation
// emails, etc").
//
// These are FEEDS, not copies: Salato verifications live in their own private bucket and
// app_settings records; Elser registration forms live in the reservation-docs bucket, filed by
// the front-desk pipeline. The vault lists them read-only and mints short-lived signed links on
// demand — nothing is duplicated, so the vault can never drift out of date.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TTL = 60 * 10 // signed links live 10 minutes
const str = (v: any, m = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, m)

export async function GET(req: NextRequest) {
  const gate = await requireLevel('vault', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  const wantUrl = str(sp.get('sign'), 400)          // ?sign=<bucket>:<path> mints one signed link
  if (wantUrl) {
    const i = wantUrl.indexOf(':')
    const bucket = wantUrl.slice(0, i), path = wantUrl.slice(i + 1)
    if (['salato-verify', 'reservation-docs'].indexOf(bucket) < 0 || !path) {
      return NextResponse.json({ ok: false, error: 'bad ref' }, { status: 400 })
    }
    const s = await db.storage.from(bucket).createSignedUrl(path, TTL)
    if (!s.data?.signedUrl) return NextResponse.json({ ok: false, error: s.error?.message || 'could not sign' }, { status: 500 })
    return NextResponse.json({ ok: true, url: s.data.signedUrl })
  }

  try {
    // ---- Salato guest verifications: app_settings rows keyed sv:<reservationId> ----
    const { data: svRows } = await db.from('app_settings')
      .select('key,value,updated_at').like('key', 'sv:%')
      .order('updated_at', { ascending: false }).limit(400)
    const salato = ((svRows || []) as any[]).map(r => {
      let v: any = {}
      try { v = JSON.parse(String(r.value || '{}')) } catch { v = {} }
      const files: { label: string; ref: string }[] = []
      for (const [k, label] of [['idPath', 'ID'], ['selfiePath', 'Selfie'], ['signaturePath', 'Signature']] as const) {
        if (v[k]) files.push({ label, ref: 'salato-verify:' + String(v[k]) })
      }
      return {
        id: String(r.key).slice(3),
        guest: str(v.fullName || v.guestFirst || ''),
        unit: str(v.unit || ''),
        status: str(v.status || (files.length ? 'verified' : 'pending'), 30),
        at: str(v.signedAt || r.updated_at, 40),
        files,
      }
    }).filter(x => x.files.length)

    // ---- Elser registration forms: filed by the front-desk notice pipeline ----
    const { data: nRows } = await db.from('reservation_notices')
      .select('id,guest_name,unit_no,property_id,confirmation_code,arrival_date,doc_path,doc_name,sent_at,updated_at')
      .not('doc_path', 'is', null)
      .order('updated_at', { ascending: false }).limit(400)
    const forms = ((nRows || []) as any[]).map(r => ({
      id: String(r.id),
      guest: str(r.guest_name),
      unit: str(r.unit_no),
      property: str(r.property_id),
      confirmation: str(r.confirmation_code, 40),
      arrival: str(r.arrival_date, 12),
      name: str(r.doc_name || 'Registration form'),
      sentAt: r.sent_at || null,
      ref: 'reservation-docs:' + String(r.doc_path),
    }))

    return NextResponse.json({
      ok: true, salato, forms,
      // Incident reports get their shelf now so the flow has a home the day it ships.
      incidents: [],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
