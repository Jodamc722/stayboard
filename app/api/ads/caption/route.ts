// AD STUDIO — the post caption (Jon, 2026-11-10: "we should make cool photos, captions and ads, not only video but
// photo for our Facebook or IG"). POST { project, channel: 'instagram' | 'facebook' } → three captions to pick from,
// written from what the piece actually says, under the same house rules as the ads. Nothing is saved here.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { askJson } from '@/lib/ad-json'
import { normalize } from '@/lib/ad-studio'
import { HOUSE_FACTS, GUEST_FACTS } from '@/lib/ad-engine'
import { MOMENTS } from '@/lib/marketing-calendar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'No Anthropic key configured.' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const p = normalize(b?.project || {})
  const ch = b?.channel === 'facebook' ? 'facebook' : 'instagram'
  const owners = p.audience !== 'guests'
  const moment = MOMENTS.find(m => m.key === (p as any).moment)
  const piece = p.scenes.map((s, i) => `${i + 1}. ${s.head.replace(/\*\*/g, '')}${s.sub ? ' — ' + s.sub : ''}${s.items.filter(Boolean).length ? ' [' + s.items.filter(Boolean).join(' / ') + ']' : ''}${s.vo ? ' (voice: ' + s.vo + ')' : ''}`).join('\n')
  const prompt = `You write social captions for Stay Hospitality's ${ch === 'instagram' ? 'Instagram' : 'Facebook'} page.
WHO IT IS FOR: ${owners ? 'property OWNERS (people who own a condo or home in South Florida and might hand it to us to manage)' : 'GUESTS planning a stay in South Florida'}.
${moment ? 'THE MOMENT: ' + moment.name + '.' : ''}
THE PIECE THE CAPTION GOES WITH (a ${p.kind === 'flyer' ? 'single designed photo' : p.kind === 'post' ? 'short animated post' : 'video'}):
${piece}

FACTS YOU MAY USE (nothing else — no invented numbers, places or offers):
${owners ? HOUSE_FACTS : GUEST_FACTS}

RULES:
- ${owners ? 'Owners: say "listings", never "homes", for any count. No fee or revenue percentages or figures. End with a call to talk to Nick Carline — 651-200-8283.' : 'Guests: no prices, no discounts that do not exist. End with booking direct at stay-hospitality.com (link in bio on Instagram).'}
- Never write "Salato" or "Pompano Beach".
- ${ch === 'instagram' ? 'Instagram: a first line that stops the scroll (it is all most people read), then 2–4 short lines with line breaks, at most 3 emoji, then a blank line and 6–10 relevant hashtags (local and seasonal, e.g. #MiamiVacation #FortLauderdale' + (owners ? ' #MiamiRealEstate #ShortTermRental' : '') + ').' : 'Facebook: a warm first line, 2–4 short sentences, at most 2 emoji, at most 3 hashtags, a clear call to action.'}
- Sound like a premium local hospitality brand: specific, warm, confident. No clichés like "nestled", "oasis", "look no further".

Write THREE different captions: one short and punchy, one that tells a little story, one that leads with the strongest reason to act. Reply with ONLY:
{"options": [{"label": "Short", "text": "..."}, {"label": "Story", "text": "..."}, {"label": "Bold", "text": "..."}]}`
  const a = await askJson(key, prompt, { maxTokens: 1400, temperature: 0.8 })
  if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: 502 })
  const options = (Array.isArray(a.json?.options) ? a.json.options : []).slice(0, 3)
    .map((o: any) => ({ label: String(o?.label || '').slice(0, 20), text: String(o?.text || '').replace(/Salato|Pompano Beach/gi, '').slice(0, 2200) }))
    .filter((o: any) => o.text.trim())
  return NextResponse.json({ ok: true, options })
}
