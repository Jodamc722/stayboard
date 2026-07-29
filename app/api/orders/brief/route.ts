// OWNER BRIEF - the persuasion layer for the owner review sheet (session-auth).
//
// A price alone loses the argument. One AI pass fills, per order line: WHY it is recommended, three
// PRICE OPTIONS (like-for-like / upgrade / repair-only) so the owner is choosing rather than being
// told, and IF WE DO NOTHING - the consequence and its likely cost, which is the number nobody ever
// puts in front of an owner ($40 office mat versus $1,400 to refinish the floor).
//
// Everything it writes is an estimate and the desk can overwrite any of it by hand. It only ever
// fills lines that have no brief yet, unless force=1.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYS = [
  'You brief property OWNERS on furnishing, appliance and maintenance purchases for short-term rental units in South Florida.',
  'For each item return:',
  'why: one plain sentence on why it is recommended now. No hype, no blame, no unit numbers.',
  'options: 2 or 3 price choices, each {key,label,price,note}. key must be one of like, upgrade, repair.',
  '  like = like-for-like replacement at a mid-range price. upgrade = a better-wearing or better-looking option guests notice.',
  '  repair = repair or refurbish instead of buying, ONLY when that is genuinely possible for this item; omit it otherwise.',
  '  price = whole USD for ONE unit of the item, never multiplied by quantity.',
  'doNothing: {text, cost} - what happens if this is not done, and cost = the likely whole-USD cost of that consequence',
  '  (a bigger repair, a refund, a lost night). If there is no credible downstream cost, set cost to 0 and keep text factual.',
  'Be conservative and realistic. Never invent a guest complaint that is not in the note.',
  'STRICT JSON ONLY, no markdown: {"briefs":[{"id":"","why":"","options":[{"key":"","label":"","price":0,"note":""}],"doNothing":{"text":"","cost":0}}]}',
].join(' ')

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const scope = String(body.scope || 'all')
  const force = !!body.force
  const db = supabaseAdmin()

  let listingIds: string[] | null = null
  if (scope.startsWith('u:')) listingIds = [scope.slice(2)]
  else if (scope.startsWith('b:')) {
    const { data: ls } = await db.from('guesty_listings').select('id').eq('building', scope.slice(2)).limit(300)
    listingIds = (ls || []).map((x: any) => String(x.id))
    if (!listingIds.length) return NextResponse.json({ ok: true, briefed: 0, note: 'no listings in building' })
  } else if (scope.startsWith('m:')) {
    listingIds = scope.slice(2).split(',').map((x: string) => x.trim()).filter(Boolean).slice(0, 300)
    if (!listingIds.length) return NextResponse.json({ ok: true, briefed: 0, note: 'empty scope' })
  }

  let q = db.from('audit_items').select('id,title,note,room,qty,kind,severity,details').in('kind', ['replace', 'add']).in('status', ['open', 'approved']).limit(500)
  if (listingIds) q = q.in('listing_id', listingIds)
  const { data: rows } = await q
  const need = (rows || []).filter((x: any) => {
    if (!x.title) return false
    if (force) return true
    const d = x.details || {}
    return !d.why || !Array.isArray(d.options) || !d.options.length
  }).slice(0, 40)
  if (!need.length) return NextResponse.json({ ok: true, briefed: 0, note: 'every line already briefed' })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'no ai key' }, { status: 503 })

  const payload = need.map((x: any) => ({
    id: String(x.id),
    title: String(x.title || ''),
    note: String(x.note || '').slice(0, 220),
    room: String(x.room || ''),
    qty: Math.max(1, Number(x.qty) || 1),
    kind: String(x.kind),
    urgent: String(x.severity || '') === 'high',
    currentEstimate: Number((x.details || {}).est) > 0 ? Math.round(Number((x.details || {}).est)) : null,
  }))

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 8000, system: SYS, messages: [{ role: 'user', content: 'Items: ' + JSON.stringify(payload) }] }),
    })
    const j = await r.json()
    const text = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    const briefs = parsed && Array.isArray(parsed.briefs) ? parsed.briefs : []
    const byId: Record<string, any> = {}
    for (const x of need) byId[String(x.id)] = x

    const OK_KEYS = ['like', 'upgrade', 'repair']
    let n = 0
    for (const b of briefs) {
      const it = byId[String(b && b.id)]
      if (!it) continue
      const d: any = (it.details && typeof it.details === 'object') ? { ...it.details } : {}
      const why = String((b && b.why) || '').slice(0, 400)
      const opts: any[] = []
      for (const o of (Array.isArray(b.options) ? b.options : []).slice(0, 3)) {
        const k = String((o && o.key) || '')
        const price = Math.round(Number(o && o.price))
        if (OK_KEYS.indexOf(k) < 0) continue
        if (!Number.isFinite(price) || price <= 0 || price > 100000) continue
        opts.push({ key: k, label: String(o.label || k).slice(0, 80), price, note: String(o.note || '').slice(0, 240) })
      }
      const dnText = String((b && b.doNothing && b.doNothing.text) || '').slice(0, 400)
      const dnCostRaw = Math.round(Number(b && b.doNothing && b.doNothing.cost))
      const dnCost = Number.isFinite(dnCostRaw) && dnCostRaw > 0 && dnCostRaw <= 1000000 ? dnCostRaw : null
      if (!why && !opts.length && !dnText) continue

      if (why) d.why = why
      if (opts.length) d.options = opts
      if (dnText) d.doNothing = { text: dnText, cost: dnCost }
      // Keep the headline estimate and the like-for-like option in step, but never overwrite a
      // price a human already set.
      if (!(Number(d.est) > 0) && opts.length) {
        const like = opts.filter((o: any) => o.key === 'like')[0] || opts[0]
        if (like && like.price) d.est = like.price
      }
      await db.from('audit_items').update({ details: d, updated_at: new Date().toISOString() }).eq('id', it.id)
      n++
    }
    return NextResponse.json({ ok: true, briefed: n, considered: need.length })
  } catch { return NextResponse.json({ error: 'brief failed' }, { status: 500 }) }
}
