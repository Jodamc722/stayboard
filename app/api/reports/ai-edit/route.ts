// AI section editing for owner reports (P7). POST { reportId, sectionKey, section, prompt, fileUrls? }
// -> rewrites ONE section's JSON per the user's instruction, optionally reading uploaded PDFs/images
// (e.g. a vendor report to fold into Recent Work). Returns { ok, section } — the client patches it
// into local state and the user saves normally. Same voice + safety rules as generate.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-opus-4-8'
const DOC_MODEL = 'claude-sonnet-4-6'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function anthropic(payload: any): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    return Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : null
  } catch { return null }
}

function parseJson(text: string | null): any | null {
  if (!text) return null
  const m = text.match(/[\{\[][\s\S]*[\}\]]/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

async function fetchDocBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    const ct = str(r.headers.get('content-type'))
    if (ct.indexOf('image/') === 0) {
      return { type: 'image', source: { type: 'base64', media_type: ct.split(';')[0], data: buf.toString('base64') } }
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const sectionKey = str(body?.sectionKey).slice(0, 30)
  const prompt = str(body?.prompt).slice(0, 2000)
  const section = body?.section
  if (!sectionKey || !prompt || section == null || typeof section !== 'object') {
    return NextResponse.json({ error: 'sectionKey + section + prompt required' }, { status: 400 })
  }
  const fileUrls: string[] = Array.isArray(body?.fileUrls) ? body.fileUrls.filter((u: any) => typeof u === 'string' && u).slice(0, 4) : []
  const blocks: any[] = []
  for (const u of fileUrls) {
    const b = await fetchDocBlock(u)
    if (b) blocks.push(b)
  }

  const sys = 'You edit one section of an owner-facing performance report for Stay Hospitality, a Florida short-term-rental operator. '
    + 'Voice: data-forward, confident, zero fluff, short declarative sentences. Never admit fault or liability, never mention pests/bed bugs/security incidents, never disparage a guest. '
    + 'You are given the section as JSON. Apply the instruction and return ONLY the updated JSON for that section - EXACTLY the same shape and keys as the input (arrays may gain or lose items of the same item-shape). No markdown, no commentary, STRICT JSON only.'
  const text = 'Report section "' + sectionKey + '" current JSON:\n' + JSON.stringify(section)
    + '\n\nInstruction from the team: ' + prompt
    + (blocks.length ? '\n\nAttached document(s) are provided - fold their relevant content into the section per the instruction, keeping the same JSON shape.' : '')
    + '\n\nReturn the full updated section JSON only.'
  const out = await anthropic({
    model: blocks.length ? DOC_MODEL : MODEL,
    max_tokens: 4000,
    system: sys,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }],
  })
  const j = parseJson(out)
  if (!j || typeof j !== 'object') {
    return NextResponse.json({ error: 'AI could not produce a valid edit - try rephrasing.' }, { status: 422 })
  }
  return NextResponse.json({ ok: true, section: j })
}
