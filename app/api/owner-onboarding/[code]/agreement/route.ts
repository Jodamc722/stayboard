// The signed management agreement for one onboarding (lib/owner-onboard-files).
//   POST { sign: <file name> }               → a signed upload URL (the browser PUTs the file)
//   POST { meta: { path, name, size } }      → record it on the onboarding
//   GET                                      → a short-lived link to open it
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { signAgreementUpload, pathOk, fileUrl } from '@/lib/owner-onboard-files'

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r?.agreement) return NextResponse.json({ ok: false, error: 'No agreement yet.' }, { status: 404 })
  return NextResponse.json({ ok: true, url: await fileUrl(r.agreement.path), name: r.agreement.name })
}
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  try {
    if (b?.sign) return NextResponse.json({ ok: true, ...(await signAgreementUpload(r.code, String(b.sign))) })
    if (b?.meta && pathOk(r.code, String(b.meta.path || ''))) {
      r.agreement = { path: String(b.meta.path), name: String(b.meta.name || 'Agreement').slice(0, 160), size: Number(b.meta.size) || 0, at: new Date().toISOString(), by: String(g.access.email || '') }
      const w = await saveRecord(r, g.access.email || null)
      return w.ok ? NextResponse.json({ ok: true, agreement: r.agreement }) : NextResponse.json(w, { status: 500 })
    }
    return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
