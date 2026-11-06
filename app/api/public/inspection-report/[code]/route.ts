// HER INSPECTION REPORT, NO LOGIN (Jon, 2026-11-06: "Personal link shared by supervisor or managers").
// /ir/<code> is the link a housekeeper opens on her phone: her last five inspections summarised, in
// her language. The code is the capability; nothing here can reach another report or person.
//
//   GET [?preview=1]                  the report (a view is counted unless it is the manager's preview)
//   POST { action: 'lang', lang }     she switched EN/ES — remembered on her training person
import { NextRequest, NextResponse } from 'next/server'
import { publicReport, recordView } from '@/lib/inspection-reports'
import { personByKey, updatePerson } from '@/lib/training'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status, headers: { 'X-Robots-Tag': 'noindex, nofollow' } })

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const r = await publicReport(params.code)
    if (!r) return bad('This report link is not valid.', 404)
    if (new URL(req.url).searchParams.get('preview') !== '1') await recordView(params.code)
    return NextResponse.json({ ok: true, ...r }, { headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  if (String(body?.action || '') !== 'lang') return bad('Unknown action.')
  try {
    const c = String(params.code || '').trim().toLowerCase()
    const { data } = await supabaseAdmin().from('inspection_reports').select('person_key').eq('code', c).maybeSingle()
    if (!data) return bad('This report link is not valid.', 404)
    const key = String((data as any).person_key || '')
    if (await personByKey(key)) await updatePerson(key, { lang: String(body.lang) === 'en' ? 'en' : 'es' })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
