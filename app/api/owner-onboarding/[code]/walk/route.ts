// The unit walkthrough for one onboarding, the team's side:
//   POST { action: 'link' }            → makes the walkthrough link if there is none yet
//   POST { action: 'send', to?: [] }   → emails the walkthrough request (to the people in settings unless `to` is given)
//   POST { action: 'reopen' }          → a finished walkthrough can be counted again
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, ensureWalk, itemsFor } from '@/lib/owner-onboard-server'
import { sendWalkRequest } from '@/lib/owner-onboard-mail'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  if (!r.home) return NextResponse.json({ ok: false, error: 'Fill in the home first: the count sheet is built from it.' }, { status: 400 })
  const b = await req.json().catch(() => ({} as any))
  const by = String(g.access.email || '')
  const w = ensureWalk(r)
  let note = '', error = ''
  if (b.action === 'send') {
    const s = await sendWalkRequest(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, Array.isArray(b.to) ? b.to : [], by)
    if (s.ok) { w.sentAt = new Date().toISOString(); w.sentTo = s.to; note = 'Walkthrough request sent to ' + s.to.join(', ') + '.' } else error = s.error || 'Not sent.'
  } else if (b.action === 'reopen') { delete w.doneAt; note = 'The walkthrough is open again.' }
  else if (b.action !== 'link') return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  await saveRecord(r, by || null)
  return NextResponse.json({ ok: !error, error: error || undefined, note, record: teamView(r), items: await itemsFor(r) }, { status: error ? 502 : 200 })
}
