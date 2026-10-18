// The "Tap to confirm they have everything" link in the owner-arrival Slack post. The link carries an
// HMAC of the reservation id, so only a link Lighthouse wrote works; the page asks who is confirming
// (one tap on a name, or type it) so the 3:45 reminder can say who did.
import { NextRequest, NextResponse } from 'next/server'
import { confirmToken, confirmOwnerArrival, ownerArrivalsToday } from '@/lib/owner-arrival-check'
import { safeEqual } from '@/lib/signing'

export const dynamic = 'force-dynamic'
const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const page = (inner: string) => new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner arrival</title>
<style>body{font:15px/1.45 -apple-system,system-ui,sans-serif;background:#f7f5f0;color:#1c1b19;margin:0;padding:24px}main{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e7e2d8;border-radius:16px;padding:20px}h1{font-size:18px;margin:0 0 8px}input{width:100%;box-sizing:border-box;height:42px;border:1px solid #ddd;border-radius:10px;padding:0 12px;font-size:15px;margin:10px 0}button{height:42px;width:100%;border:0;border-radius:10px;background:#1c1b19;color:#fff;font-weight:600;font-size:15px}.muted{color:#6b6760;font-size:13px}</style></head><body><main>${inner}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })

function check(req: NextRequest, r: string, t: string): boolean { return !!r && !!t && safeEqual(t, confirmToken(r)) }

export async function GET(req: NextRequest) {
  const r = req.nextUrl.searchParams.get('r') || '', t = req.nextUrl.searchParams.get('t') || ''
  if (!check(req, r, t)) return page('<h1>This link is not valid</h1><p class="muted">Use the link from the Slack post.</p>')
  const o = (await ownerArrivalsToday().catch(() => [])).find(x => x.reservationId === r)
  const what = o ? `<b>${esc(o.unit)}</b> — ${esc(o.owner)}, arriving ${esc(o.checkInTime || '4:00 PM')}` : 'This owner stay'
  if (o?.confirmed) return page(`<h1>Already confirmed</h1><p>${what}</p><p class="muted">by ${esc(o.confirmed.by)}</p>`)
  return page(`<h1>Owner has everything?</h1><p>${what}</p><p class="muted">Door code, wifi, parking and check-in time sent, and the unit ready.</p>
<form method="post"><input name="by" placeholder="Your name" required autocomplete="name"><button>Confirm</button></form>`)
}

export async function POST(req: NextRequest) {
  const r = req.nextUrl.searchParams.get('r') || '', t = req.nextUrl.searchParams.get('t') || ''
  if (!check(req, r, t)) return page('<h1>This link is not valid</h1>')
  const form = await req.formData().catch(() => null)
  const by = String(form?.get('by') || '').trim().slice(0, 60) || 'someone'
  await confirmOwnerArrival(r, by)
  return page(`<h1>Confirmed — thank you, ${esc(by)}</h1><p class="muted">The 3:45pm reminder will skip this owner.</p>`)
}
