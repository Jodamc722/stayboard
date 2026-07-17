// AI product options for an order line - suggests 2-3 concrete products for a Replace/Add need
// and returns retailer SEARCH links (Amazon / Wayfair). No key or AI failure -> plain search links.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function searchUrl(store: string, q: string) {
  const e = encodeURIComponent(q)
  if (store === 'wayfair') return 'https://www.wayfair.com/keyword.php?keyword=' + e
  return 'https://www.amazon.com/s?k=' + e
}

export async function POST(req: NextRequest) {
  try { const supabase = createClient(); const { data } = await supabase.auth.getUser(); if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 }) } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const body = await req.json().catch(() => ({} as any))
  const title = String(body.title || '').slice(0, 160)
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const note = String(body.note || '').slice(0, 300)
  const qty = Math.max(1, Number(body.qty) || 1)
  const fallback = [
    { name: title, why: 'Amazon search', url: searchUrl('amazon', title) },
    { name: title, why: 'Wayfair search', url: searchUrl('wayfair', title) },
  ]
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, options: fallback })
  try {
    const SYS = 'You suggest products for a short-term rental property manager restocking units. Given a need, return 2-3 concrete product suggestions a manager could buy today - durable, mid-range, guest-proof picks (not luxury, not bottom-tier). Each option: name (specific product or product type incl. brand when it matters, max 8 words), why (max 8 words - the reason this pick), searchTerm (the exact retailer search phrase), store (amazon or wayfair - wayfair only for furniture). STRICT JSON ONLY, no markdown: {"options":[{"name":"","why":"","searchTerm":"","store":""}]}'
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 700, system: SYS, messages: [{ role: 'user', content: 'Need: ' + title + (note ? '. Detail: ' + note : '') + '. Quantity: ' + qty }] }) })
    const j = await r.json()
    const text = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    const options = (parsed && Array.isArray(parsed.options) ? parsed.options : []).slice(0, 3).map((o: any) => ({ name: String(o.name || '').slice(0, 120), why: String(o.why || '').slice(0, 120), url: searchUrl(String(o.store || 'amazon'), String(o.searchTerm || o.name || title).slice(0, 160)) })).filter((o: any) => o.name)
    return NextResponse.json({ ok: true, options: options.length ? options : fallback })
  } catch { return NextResponse.json({ ok: true, options: fallback }) }
}
