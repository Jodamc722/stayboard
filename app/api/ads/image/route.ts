// AD STUDIO — AI IMAGES (2026-11-12). Jon, on the Ultra and Art Basel ads: "we should have more imagery generations
// to highlight the events, things going on there, promotions of it and highlight book with us". He chose AI images
// plus stock for the event and the things to do, and our own listing photos for the Book part.
//
//   POST { prompt, shape: 'portrait'|'square'|'landscape', n?: 1–4, sceneIndex? }
//        → { ok, images: [{ url, view, thumb, width, height, caption, source: 'ai', license, credit, link }], costUsd }
//        The images are OpenAI gpt-image-1 at medium quality. Each is saved in the Ad Studio bucket
//        (lib/ad-studio saveAiImage) and handed back as a same-origin URL, usable exactly like a stock hit.
//   GET  ?path=ai/<yyyymm>/<id>.jpg → the image bytes (private bucket; the URL never expires, unlike a signed one).
//
// THE KEY is process.env.OPENAI_API_KEY — never taken from the request. Without it: 503 with the sentence the editor
// shows ("Add OPENAI_API_KEY in Vercel to turn on AI images"), and the editor falls back to stock. Nothing breaks.
//
// THE PROMPT is always rebuilt here by lib/ad-image-prompt buildImagePrompt — photorealistic, Miami light, and the
// rules: no logos, trademarks, event branding, text, real people or real artworks; names scrubbed to generic words.
//
// THE COST: budgetBlock('ad-image') is asked first (the same daily / monthly / hourly caps as every AI call — 'ad-image'
// is on the INTERACTIVE list in lib/ai-budget-rules). Every call, good or failed, writes one ai_usage row under task
// 'ad-image' so it shows in Settings → AI models and counts toward the caps. The dollars are priced from the usage
// OpenAI returns; when it returns none, a fixed estimate per image is logged instead (lib/ad-image-prompt
// IMAGE_PRICE_EST — medium, ~$0.042 square, ~$0.063 portrait/landscape). recordUsage in lib/ai-usage is not used
// because it prices by Anthropic model tier, which would mis-price an image.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { budgetBlock, bustBudgetCache } from '@/lib/ai-budget'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveAiImage, readAiImage, AI_IMAGE_PATH } from '@/lib/ad-studio'
import { buildImagePrompt, imageCostUsd, IMAGE_MODEL, IMAGE_QUALITY, IMAGE_SIZE, IMAGE_WH, AI_LICENSE, AI_KEY_MISSING, type ImageShape, type ImageUsage } from '@/lib/ad-image-prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const SHAPES: ImageShape[] = ['portrait', 'square', 'landscape']

/** One ledger row for an image call (see the header). Never throws; never waits more than 2.5s. */
async function logSpend(row: { usd: number; estimated: boolean; usage?: ImageUsage | null; ms: number; ok: boolean; status: number; n: number }) {
  try {
    const insert = supabaseAdmin().from('ai_usage').insert({
      task: 'ad-image',
      model: IMAGE_MODEL,
      input_tokens: Number(row.usage?.input_tokens) || 0,
      output_tokens: Number(row.usage?.output_tokens) || 0,
      cache_read: 0,
      cache_write: 0,
      cost_usd: Number(row.usd.toFixed(6)),
      ms: row.ms,
      ok: row.ok,
      status: row.status,
      // the drill-down shows whether the dollars are OpenAI's usage or the fixed per-image estimate
      stop_reason: row.ok ? (row.estimated ? `est:${row.n}img` : `usage:${row.n}img`) : 'failed',
      route: 'app/api/ads/image',
    })
    await Promise.race([insert, new Promise(res => setTimeout(res, 2500))])
    bustBudgetCache()
  } catch { /* the ledger is best-effort */ }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ ok: false, noKey: true, error: AI_KEY_MISSING }, { status: 503 })
  const b = await req.json().catch(() => ({} as any))
  const prompt = String(b?.prompt || '').trim().slice(0, 1500)
  if (prompt.length < 8) return NextResponse.json({ ok: false, error: 'Describe the picture first — the place, the light, the mood.' }, { status: 400 })
  const shape: ImageShape = SHAPES.indexOf(b?.shape) >= 0 ? b.shape : 'portrait'
  const n = Math.max(1, Math.min(4, Math.round(Number(b?.n) || 1)))
  const blocked = await budgetBlock('ad-image')
  if (blocked) return NextResponse.json({ ok: false, budget: true, error: blocked + ' An admin can raise it in Settings → AI models.' }, { status: 429 })

  const full = buildImagePrompt(prompt, shape)
  const t0 = Date.now()
  let r: Response
  try {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt: full, n, size: IMAGE_SIZE[shape], quality: IMAGE_QUALITY, output_format: 'jpeg', output_compression: 90, moderation: 'auto' }),
      signal: AbortSignal.timeout(170_000),
    })
  } catch (e: any) {
    await logSpend({ usd: 0, estimated: true, ms: Date.now() - t0, ok: false, status: 0, n })
    return NextResponse.json({ ok: false, error: 'The image service did not answer (' + String(e?.message || e).slice(0, 80) + '). Try again, or use stock for now.' }, { status: 504 })
  }
  const d: any = await r.json().catch(() => null)
  const ms = Date.now() - t0
  if (!r.ok) {
    await logSpend({ usd: 0, estimated: true, ms, ok: false, status: r.status, n })
    const msg = String(d?.error?.message || '').slice(0, 200)
    const code = String(d?.error?.code || '')
    const error = r.status === 401 ? 'OpenAI refused the key. Check OPENAI_API_KEY in Vercel.'
      : code === 'moderation_blocked' || /safety|moderation/i.test(msg) ? 'The image service turned this one down (its safety filter). Reword it — describe the place, the light and the mood, not people or brands.'
      : r.status === 429 ? 'OpenAI is rate-limiting this account or it is out of credit. Give it a minute, or use stock for now.' + (msg ? ' (' + msg + ')' : '')
      : r.status === 403 ? 'This OpenAI account cannot use ' + IMAGE_MODEL + ' yet (organisation verification may be needed on platform.openai.com).'
      : 'The image service said ' + r.status + (msg ? ': ' + msg : '') + '.'
    return NextResponse.json({ ok: false, error }, { status: 502 })
  }
  const list: any[] = Array.isArray(d?.data) ? d.data : []
  const cost = imageCostUsd(shape, list.length || n, d?.usage || null)
  await logSpend({ usd: cost.usd, estimated: cost.estimated, usage: d?.usage || null, ms, ok: true, status: r.status, n: list.length || n })
  const [w, h] = IMAGE_WH[shape]
  const images: { url: string; view: string; thumb: string; width: number; height: number; caption: string; source: 'ai'; license: string; credit: string; link: string }[] = []
  for (const it of list) {
    const b64 = String(it?.b64_json || '')
    if (!b64) continue
    try {
      const path = await saveAiImage(Buffer.from(b64, 'base64'), 'jpg', { prompt, sent: full, shape, model: IMAGE_MODEL, quality: IMAGE_QUALITY, by: String(g.access.email || ''), usdEach: cost.usd / Math.max(1, list.length), estimated: cost.estimated, sceneIndex: Number.isFinite(Number(b?.sceneIndex)) ? Number(b.sceneIndex) : null })
      const url = '/api/ads/image?path=' + encodeURIComponent(path)
      images.push({ url, view: url, thumb: url, width: w, height: h, caption: prompt, source: 'ai', license: AI_LICENSE, credit: 'OpenAI ' + IMAGE_MODEL, link: '' })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
    }
  }
  if (!images.length) return NextResponse.json({ ok: false, error: 'The image service answered with no picture. Try again.' }, { status: 502 })
  return NextResponse.json({ ok: true, images, costUsd: Math.round(cost.usd * 1000) / 1000, estimated: cost.estimated, sceneIndex: b?.sceneIndex ?? null })
}

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  const path = String(req.nextUrl.searchParams.get('path') || '')
  if (!AI_IMAGE_PATH.test(path)) return NextResponse.json({ ok: false, error: 'Not an Ad Studio image.' }, { status: 400 })
  const f = await readAiImage(path)
  if (!f) return NextResponse.json({ ok: false, error: 'Image not found.' }, { status: 404 })
  return new NextResponse(f.bytes, { headers: { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=31536000, immutable' } })
}
