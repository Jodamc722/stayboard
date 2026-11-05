// Share Links → parking link → Daily email (lib/parking-vendor-email). The passcode never comes
// back out: GET says whether one is saved and its last two characters.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getVendorEmailCfg, saveVendorEmailCfg, runVendorEmail } from '@/lib/parking-vendor-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const pub = (c: Awaited<ReturnType<typeof getVendorEmailCfg>>) => ({
  enabled: c.enabled, code: c.code, to: c.to, hour: c.hour, lastDaily: c.lastDaily, lastSentAt: c.lastSentAt,
  hasPasscode: !!c.passcode, hint: c.passcode ? c.passcode.slice(-2) : null,
})

export async function GET() {
  const gate = await requireLevel('share-links', 'view')
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, cfg: pub(await getVendorEmailCfg()) })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('share-links', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const by = String((gate as any).access?.email || (gate as any).access?.user?.email || 'hub')
  if (b?.action === 'send-now') {
    const r = await runVendorEmail({ force: 'daily' })
    if (r.error || !r.sent) return NextResponse.json({ ok: false, error: r.error || 'Not sent: ' + (r.skipped || 'unknown') }, { status: 400 })
    return NextResponse.json({ ok: true, sent: r.sent, cfg: pub(await getVendorEmailCfg()) })
  }
  const r = await saveVendorEmailCfg({ code: b?.code, to: b?.to, passcode: b?.passcode, hour: b?.hour, enabled: b?.enabled }, by)
  if (!r.ok || !r.cfg) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, cfg: pub(r.cfg) })
}
