// Eve's auto-learning pass. Mines recent GUEST MESSAGES + REVIEWS into structured knowledge
// (top FAQs guests ask, recurring complaint categories per building) and upserts them into
// eve_knowledge so Eve can recall + act on them. Rate-limit aware; safe to run on a schedule.
// Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function djb2(x: string) { let h = 5381; for (let i = 0; i < x.length; i++) h = ((h * 33) + x.charCodeAt(i)) >>> 0; return h }
function parseJson(raw: string): any | null {
  if (!raw) return null
  const t = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = t(raw) || t(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = t(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

export async function POST(req: NextRequest) {
  // Auth: allow the Vercel cron (CRON_SECRET bearer) OR a logged-in user.
  const authHeader = req.headers.get('authorization') || ''
  const cronOk = !!process.env.CRON_SECRET && authHeader === ('Bearer ' + process.env.CRON_SECRET)
  if (!cronOk) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })

  const days = Math.min(120, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 60))
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()
  const sb = supabaseAdmin()

  // Listing -> building for tagging.
  const meta: Record<string, string> = {}
  try {
    const { data } = await sb.from('guesty_listings').select('id, building')
    for (const l of (data || [])) meta[String((l as any).id)] = rollupBuilding((l as any).building)
  } catch { /* ignore */ }

  // Pull recent GUEST messages + low/negative reviews as the learning corpus.
  const [{ data: msgs }, { data: revs }, { data: sent }] = await Promise.all([
    sb.from('guesty_messages').select('body, sender').gte('sent_at', cutoff).limit(1200),
    sb.from('guesty_reviews').select('content, rating, listing_id').eq('excluded_from_score', false).gte('created_at', cutoff).limit(800),
    sb.from('guesty_conversation_sentiment').select('top_issue, listing_id, dissatisfied').gte('last_message_at', cutoff).limit(800),
  ])
  const guestMsgs = (msgs || []).filter((m: any) => /guest|inbound/i.test(str(m.sender))).map((m: any) => str(m.body).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 400)
  const reviewText = (revs || []).map((r: any) => `(${r.rating}) ${str(r.content).replace(/\s+/g, ' ').trim()}`).filter((x: any) => x.length > 6).slice(0, 300)
  // Pre-tally complaint categories from the sentiment top_issue + building (cheap, deterministic).
  const issueByBuilding: Record<string, number> = {}
  for (const s of (sent || [])) {
    if (!(s as any).dissatisfied || !(s as any).top_issue) continue
    const b = meta[String((s as any).listing_id)] || 'Unknown'
    const k = `${str((s as any).top_issue).toLowerCase().slice(0, 40)}@@${b}`
    issueByBuilding[k] = (issueByBuilding[k] || 0) + 1
  }

  if (guestMsgs.length === 0 && reviewText.length === 0) {
    return NextResponse.json({ ok: true, note: 'No recent guest messages or reviews to learn from yet.', learned: 0 })
  }

  const SYSTEM = `You analyze a short-term-rental manager's recent GUEST MESSAGES and REVIEWS to extract reusable operational knowledge. Return STRICT minified JSON only:
{"faqs":[{"q":"the question guests repeatedly ask, generalized","count":<approx how many asked>,"fix":"what to add to listings/auto-messages to pre-empt it"}],
"complaints":[{"category":"short issue label e.g. 'cleanliness','AC/heat','check-in/access','noise','wifi','parking'","count":<approx>,"note":"1 sentence on the pattern"}]}
Generalize (don't repeat one guest's wording). Max 12 faqs, max 10 complaints. Base counts on what you actually see.`
  const USER = `GUEST MESSAGES (sample):\n${guestMsgs.slice(0, 220).map(m => '- ' + m.slice(0, 200)).join('\n')}\n\nREVIEWS (rating in parens):\n${reviewText.slice(0, 160).map(m => '- ' + m.slice(0, 220)).join('\n')}`.slice(0, 14000)

  let parsed: any = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (r.ok) parsed = parseJson(Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : '')
  } catch { /* fall through */ }

  const rows: any[] = []
  const nowIso = new Date().toISOString()
  for (const f of (parsed?.faqs || [])) {
    const q = str(f?.q).trim(); if (!q) continue
    rows.push({ id: `faq_${djb2(q.toLowerCase())}`, type: 'faq', scope: 'portfolio', title: q.slice(0, 200), content: str(f?.fix).slice(0, 600), evidence_count: Math.max(1, Number(f?.count) || 1), updated_at: nowIso })
  }
  for (const c of (parsed?.complaints || [])) {
    const cat = str(c?.category).trim(); if (!cat) continue
    rows.push({ id: `complaint_${djb2(cat.toLowerCase())}`, type: 'complaint', scope: 'portfolio', title: cat.slice(0, 120), content: str(c?.note).slice(0, 400), evidence_count: Math.max(1, Number(c?.count) || 1), updated_at: nowIso })
  }
  // Per-building complaint tallies from sentiment (deterministic, complements the AI pass).
  for (const [k, n] of Object.entries(issueByBuilding)) {
    const [issue, b] = k.split('@@')
    rows.push({ id: `complaint_${djb2(k)}`, type: 'complaint', scope: `building:${b}`, title: `${issue} (${b})`.slice(0, 120), content: `${n} dissatisfied guest thread(s) about "${issue}" in ${b} (last ${days}d).`, evidence_count: n, updated_at: nowIso })
  }

  let learned = 0
  if (rows.length) {
    const { error } = await sb.from('eve_knowledge').upsert(rows, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: `eve_knowledge upsert: ${error.message}. Run migration 008.` }, { status: 200 })
    learned = rows.length
  }
  return NextResponse.json({ ok: true, learned, faqs: (parsed?.faqs || []).length, complaints: rows.filter(r => r.type === 'complaint').length, windowDays: days })
}
export const GET = POST
