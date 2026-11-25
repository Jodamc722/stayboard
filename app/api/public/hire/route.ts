// THE NEW HIRE FORM — public (no login: the code in the link is the key; lib/hire).
//   GET  ?code=   is this link the current one
//   POST { code, name, email, phone, track, market, lang, startDate, emergencyName, emergencyPhone, note }
// Nothing here creates a person or sends anything: it only adds a line for a manager to approve.
import { NextRequest, NextResponse } from 'next/server'
import { hireCodeValid, submitHire } from '@/lib/hire'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = String(new URL(req.url).searchParams.get('code') || '')
  try { return NextResponse.json({ ok: true, valid: !!code && (await hireCodeValid(code)) }) } catch { return NextResponse.json({ ok: false, valid: false }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  try {
    const r = await submitHire(String(body?.code || ''), body)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: { field: 'form', en: 'That did not send. Please try again.', es: 'No se envió. Inténtalo de nuevo.' } }, { status: 500 })
  }
}
