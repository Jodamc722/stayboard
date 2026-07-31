// SHARE A REVIEW. Jon: "push to Breezeway, or draft a message I can share with people."
// Breezeway already has a route (add-task). This is the other half: getting the words out to a
// human — the field team in Slack, or the owner of the unit — without anyone having to write it.
//
// Slack posting happens SERVER side because the webhook is a secret. If it is not configured the
// route says so plainly and the UI falls back to copy, which always works.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// WHO IS THE OWNER OF THIS UNIT, AND WHERE DOES MAIL GO? Guesty already syncs owner email into
// guesty_owners.listing_ids, so the Email button can address itself instead of being retyped.
export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const listingId = str(req.nextUrl.searchParams.get('listingId'))
  if (!listingId) return NextResponse.json({ ok: true, owner: null })
  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const { data } = await supabaseAdmin().from('guesty_owners')
      .select('full_name,email,listing_ids').contains('listing_ids', [listingId]).limit(1)
    const o = ((data || []) as any[])[0]
    return NextResponse.json({ ok: true, owner: o ? { name: str(o.full_name) || null, email: str(o.email) || null } : null })
  } catch { return NextResponse.json({ ok: true, owner: null }) }
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const text = str(b.text).trim()
  if (!text) return NextResponse.json({ ok: false, error: 'Nothing to send' }, { status: 400 })

  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return NextResponse.json({
    ok: false, needsWebhook: true,
    error: 'Slack is not connected yet — set SLACK_WEBHOOK_URL in Vercel. Copy the message for now.',
  })
  try {
    const who = str((access.profile || {}).name) || str(access.email) || 'Lighthouse'
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text + '\n\n_Shared from Lighthouse by ' + who + '_' }),
    })
    if (!r.ok) return NextResponse.json({ ok: false, error: 'Slack rejected it (' + r.status + ')' }, { status: 502 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
