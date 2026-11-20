// AD STUDIO — 3D OBJECTS (Jon, 2026-11-20: "Also add some 3d generation to the mix to fit the look").
// POST { what, colors?: ["#RRGGBB", …] } → { ok, src, w, h, name, costUsd }
// One rendered 3D object on a transparent background (an ornament, a palm, a gift, a set of keys — whatever is
// asked for), in the piece's own colours, to place and animate like any other image. Made by OpenAI gpt-image-1 with
// a transparent background, trimmed to the object and kept in the studio's private bucket beside the other AI images
// (lib/ad-studio saveAiImage). The prompt is rebuilt here: one object, no text, no logos, no brands, no people.
// THE KEY is process.env.OPENAI_API_KEY, never from the request. THE COST passes the app's guard as 'ad-image' and Ad
// Studio's own monthly cap (lib/adx/budget counts 'ad-image'); every call writes one ai_usage row.
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireLevel } from '@/lib/access'
import { budgetBlock, bustBudgetCache } from '@/lib/ai-budget'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveAiImage } from '@/lib/ad-studio'
import { imageCostUsd, IMAGE_MODEL, IMAGE_QUALITY, AI_KEY_MISSING } from '@/lib/ad-image-prompt'
import { cleanText } from '@/lib/adx/composition'
import { propPrompt } from '@/lib/adx/prop'
import { adxBudgetBlock, adxSpend, bustAdxSpend } from '@/lib/adx/budget'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

async function logSpend(usd: number, estimated: boolean, ms: number, ok: boolean, status: number) {
  try {
    const insert = supabaseAdmin().from('ai_usage').insert({ task: 'ad-image', model: IMAGE_MODEL, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, cost_usd: Number(usd.toFixed(6)), ms, ok, status, stop_reason: ok ? (estimated ? 'est:3d' : 'usage:3d') : 'failed', route: 'app/api/adx/prop' })
    await Promise.race([insert, new Promise(res => setTimeout(res, 2500))])
    bustBudgetCache(); bustAdxSpend()
  } catch { /* the ledger is best-effort */ }
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ ok: false, noKey: true, error: AI_KEY_MISSING + ' (3D objects use the same key as AI images).' }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const what = cleanText(b?.what, 120)
  if (what.length < 3) return NextResponse.json({ ok: false, error: 'Say what the object is: an ornament, a palm tree, a set of keys.' }, { status: 400 })
  const cap = (await adxBudgetBlock()) || (await budgetBlock('ad-image'))
  if (cap) return NextResponse.json({ ok: false, capped: true, error: cap }, { status: 429 })
  const prompt = propPrompt(what, Array.isArray(b?.colors) ? b.colors.map((c: any) => String(c)) : [])
  const t0 = Date.now()
  let r: Response
  try {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size: '1024x1024', quality: IMAGE_QUALITY, background: 'transparent', output_format: 'png', moderation: 'auto' }),
      signal: AbortSignal.timeout(170_000),
    })
  } catch (e: any) {
    await logSpend(0, true, Date.now() - t0, false, 0)
    return NextResponse.json({ ok: false, error: 'The image service did not answer (' + String(e?.message || e).slice(0, 80) + '). Try again.' }, { status: 504 })
  }
  const d: any = await r.json().catch(() => null)
  const ms = Date.now() - t0
  if (!r.ok) {
    await logSpend(0, true, ms, false, r.status)
    const msg = String(d?.error?.message || '').slice(0, 200)
    const error = r.status === 401 ? 'OpenAI refused the key. Check OPENAI_API_KEY in Vercel.'
      : /safety|moderation/i.test(msg + String(d?.error?.code || '')) ? 'The image service turned this one down. Describe a plain object, not a person or a brand.'
      : r.status === 429 ? 'OpenAI is rate-limiting this account or it is out of credit. Give it a minute.' + (msg ? ' (' + msg + ')' : '')
      : 'The image service said ' + r.status + (msg ? ': ' + msg : '') + '.'
    return NextResponse.json({ ok: false, error }, { status: 502 })
  }
  const b64 = String(d?.data?.[0]?.b64_json || '')
  const cost = imageCostUsd('square', 1, d?.usage || null)
  await logSpend(cost.usd, cost.estimated, ms, !!b64, r.status)
  if (!b64) return NextResponse.json({ ok: false, error: 'The image service answered with no picture. Try again.' }, { status: 502 })
  try {
    // trimmed to the object, so its box in the piece hugs it
    const out = await sharp(Buffer.from(b64, 'base64')).trim({ threshold: 4 }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    const path = await saveAiImage(out.data, 'png', { kind: '3d', what, sent: prompt, model: IMAGE_MODEL, quality: IMAGE_QUALITY, by: String(g.access.email || ''), usd: cost.usd, estimated: cost.estimated })
    return NextResponse.json({ ok: true, src: '/api/ads/image?path=' + encodeURIComponent(path), w: out.info.width, h: out.info.height, name: what, costUsd: Math.round(cost.usd * 1000) / 1000, budget: await adxSpend(true) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
