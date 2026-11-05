// Eve's memory, exposed so Jon can READ AND DELETE everything she believes.
//
// This route is not optional polish. An agent that learns silently is a liability: if she picks up
// something wrong on Tuesday you need to find it and kill it on Wednesday, not discover it three
// weeks later inside a message to an owner. Every row she stores is visible and removable here.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveMemory, normKind, normScope, normWeight, MEMORY_KINDS, personSource, STAFF_MAX_WEIGHT } from '@/lib/eve/memory'
import { isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { eveGate } from '../../agent/route'
import { teacherFor, identityOfAccess, teacherSource, type Teacher } from '@/lib/eve/teachers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const sp = new URL(req.url).searchParams
  const db = supabaseAdmin()
  /* WHAT EVE LEARNED (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach
     Eve"). ?recent=<days> → the memories created or changed in that window, newest first, each with
     `canEdit` for the signed-in person; &conversationId=<id> narrows to what one conversation taught. */
  if (sp.get('recent')) {
    const days = Math.min(90, Math.max(1, Number(sp.get('recent')) || 7))
    const since = new Date(Date.now() - days * 864e5).toISOString()
    const actor = String(gate.access.email || '')
    const me = await teacherFor(identityOfAccess(gate.access as any)).catch(() => null)
    let rq: any = db.from('eve_memory').select('id,kind,text,why,scope,weight,source,created_by,evidence,created_at,updated_at,superseded_by,expires_on')
      .is('superseded_by', null).gte('updated_at', since).order('updated_at', { ascending: false }).limit(300)
    const cid = sp.get('conversationId')
    if (cid) rq = rq.eq('evidence->>conversationId', cid)
    const { data, error } = await rq
    if (error) return NextResponse.json({ ok: false, needsMigration: true, memories: [] })
    const today = new Date().toISOString().slice(0, 10)
    const rows = ((data as any[]) || []).filter(r => !r.expires_on || String(r.expires_on) >= today)
      .filter(r => ['jon', 'staff', 'telegram', 'eve', 'slack'].includes(String(r.source)))
      .map(r => ({ ...r, teacher: r.source === 'jon' ? 'Jon' : (r.evidence?.teacher || r.created_by || r.source), canEdit: mayTouch(r, actor, me) }))
    return NextResponse.json({ ok: true, days, me: { email: actor, teacher: me?.teacher ? me.tier : null, maxWeight: me?.teacher ? me.maxWeight : STAFF_MAX_WEIGHT, isJon: isSuperadmin(actor) }, memories: rows })
  }
  let q = db.from('eve_memory').select('*').order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(400)
  if (sp.get('kind')) q = q.eq('kind', normKind(sp.get('kind')))
  if (sp.get('scope')) q = q.eq('scope', normScope(sp.get('scope')))
  if (sp.get('include_superseded') !== '1') q = q.is('superseded_by', null)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, needsMigration: true, error: 'eve_memory not found — run migration 045.', memories: [] })
  const rows = data || []
  const byKind: Record<string, number> = {}
  for (const r of rows) byKind[(r as any).kind] = (byKind[(r as any).kind] || 0) + 1
  return NextResponse.json({ ok: true, kinds: MEMORY_KINDS, counts: byKind, total: rows.length, memories: rows })
}

/* WHO MAY CHANGE A TAUGHT ROW (Jon, 2026-11-05: "She can learn from any CCS agent, she can also learn
   from Roberto, Karla & Bernadette"). Jon's rows stay Jon's (below). A row a person taught (source
   'staff') above your own ceiling is only yours to change if you wrote it — so a CCS agent cannot
   rewrite Karla's weight-8 rule, and Karla cannot rewrite Jon's. Everything else is as before. */
function mayTouch(row: any, actor: string, me: Teacher | null): boolean {
  if (isSuperadmin(actor)) return true
  if (String(row?.source || '') === 'jon') return false
  if (String(row?.source || '') !== 'staff') return true
  if (String(row?.created_by || '').toLowerCase() === actor.toLowerCase()) return true
  const cap = me?.teacher ? me.maxWeight : STAFF_MAX_WEIGHT
  return Number(row?.weight || 0) <= cap
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const body = await req.json().catch(() => ({} as any))
  const db = supabaseAdmin()
  const actor = String(gate.access.email || '')
  const owner = isSuperadmin(actor)

  // JON'S WORDS ARE JON'S TO CHANGE (Jon, 2026-09-23 review). Any Eve user could delete or rewrite
  // a memory Jon wrote, or supersede it with their own. A row with source 'jon' can now only be
  // deleted, edited or superseded by the superadmin; everyone else gets a 403 and can raise it
  // with him instead.
  const jonOwned = async (id: string): Promise<boolean> => {
    if (owner || !id) return false
    const { data } = await db.from('eve_memory').select('source').eq('id', id).maybeSingle()
    return String((data as any)?.source || '') === 'jon'
  }
  const forbidden = () => NextResponse.json({ error: 'Only Jon can change or remove something Jon taught her.' }, { status: 403 })
  const me = await teacherFor(identityOfAccess(gate.access as any)).catch(() => null)
  const rowOf = async (id: string): Promise<any | null> => {
    if (!id) return null
    const { data } = await db.from('eve_memory').select('id,kind,text,why,scope,weight,source,created_by,evidence,superseded_by').eq('id', id).maybeSingle()
    return data || null
  }
  const tooHigh = () => NextResponse.json({ error: 'A colleague taught that at a higher weight than yours — ask them or Jon to change it.' }, { status: 403 })
  // Settle the "should I treat that as a rule?" question a suggestion raised, either way.
  const settleQuestion = async (memoryId: string, status: 'answered' | 'dismissed', answer?: string) => {
    try {
      await db.from('eve_questions').update({ status, answer: answer ? answer.slice(0, 2000) : null, answered_by: actor, answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('status', 'open').contains('evidence', { memory_ids: [memoryId] })
    } catch { /* the question expires on its own */ }
  }

  /* CONFIRM A SUGGESTION (2026-11-05). A non-teacher's "always / never" is kept as a suggestion; a
     teacher confirming it files it as a rule at the teacher's weight, superseding the suggestion. */
  if (body?.op === 'confirm') {
    const id = String(body?.id || '')
    if (!me?.teacher) return NextResponse.json({ error: 'Only a teacher (Jon, Roberto, Karla, Bernadette or the CCS team) can confirm a suggestion.' }, { status: 403 })
    const row = await rowOf(id)
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (row.source === 'jon' && !owner) return forbidden()
    const t = teacherSource(me, 8)
    const kind = normKind(body?.kind || row.evidence?.proposedKind || 'rule')
    const res = await saveMemory({
      text: String(body?.text || row.text), kind, scope: body?.scope || row.scope, weight: t.weight, maxWeight: t.maxWeight, source: t.source,
      why: `Confirmed by ${me.label || actor} on ${new Date().toISOString().slice(0, 10)}${row.why ? ' — ' + String(row.why).slice(0, 200) : ''}`,
      evidence: { confirmedFrom: id, teacher: me.label || actor, chatId: row.evidence?.chatId || null, conversationId: row.evidence?.conversationId || null },
      created_by: actor, supersedes: id, confidence: 1,
    })
    if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
    await settleQuestion(id, 'answered', `Confirmed by ${actor} as a ${kind}.`)
    return NextResponse.json({ ok: true, id: res.id, kind, weight: t.weight, source: t.source })
  }

  /* DISMISS A SUGGESTION (2026-11-05): it is removed and its question closed. */
  if (body?.op === 'dismiss') {
    const id = String(body?.id || '')
    const row = await rowOf(id)
    if (!row) return NextResponse.json({ ok: true, dismissed: id })
    if (!mayTouch(row, actor, me)) return row.source === 'jon' ? forbidden() : tooHigh()
    if (!row.evidence?.autoCaptured && !me?.teacher && String(row.created_by || '').toLowerCase() !== actor.toLowerCase()) return NextResponse.json({ error: 'Only a suggestion can be dismissed here.' }, { status: 400 })
    const { error } = await db.from('eve_memory').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message.slice(0, 200) }, { status: 500 })
    await settleQuestion(id, 'dismissed')
    return NextResponse.json({ ok: true, dismissed: id })
  }

  /* "THIS IS WRONG" (2026-11-05): a correction that supersedes the memory she used. A rule Jon wrote
     is never superseded by someone else — the correction is kept beside it and Jon is asked. */
  if (body?.op === 'correct') {
    const id = String(body?.id || '')
    const text = String(body?.text || '').trim()
    if (text.length < 6) return NextResponse.json({ error: 'Say what is right — one sentence she can follow.' }, { status: 400 })
    const row = await rowOf(id)
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const blocked = !mayTouch(row, actor, me)
    const t = me ? teacherSource(me, 8) : { source: 'staff' as const, weight: STAFF_MAX_WEIGHT, maxWeight: STAFF_MAX_WEIGHT }
    const res = await saveMemory({
      text, kind: 'correction', scope: row.scope, weight: t.weight, maxWeight: t.maxWeight, source: t.source,
      why: `${me?.label || actor} said this was wrong: "${String(row.text).slice(0, 200)}"`,
      evidence: { corrects: id, teacher: me?.teacher ? (me.label || actor) : null, chatId: body?.chatId || null, conversationId: body?.conversationId || null, ...(blocked ? { disputes: id } : {}) },
      created_by: actor, supersedes: blocked ? null : id, confidence: 1,
    })
    if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
    if (blocked) {
      try {
        const { askQuestion } = await import('@/lib/eve/questions')
        await askQuestion({ question: `${actor} says this is wrong: "${String(row.text).slice(0, 240)}". They say: "${text.slice(0, 240)}". Which is right?`, why: 'The original is yours (or a heavier teacher\'s), so it stays until you decide.', scope: row.scope, kind: 'verify', source: 'eve', evidence: { memory_ids: [id, res.id] } })
      } catch { /* the correction is kept either way */ }
    }
    return NextResponse.json({ ok: true, id: res.id, superseded: !blocked, note: blocked ? 'Kept beside the original — its author decides which stands.' : undefined })
  }

  if (body?.op === 'delete') {
    const id = String(body?.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (await jonOwned(id)) return forbidden()
    { const row = await rowOf(id); if (row && !mayTouch(row, actor, me)) return tooHigh() }
    const { error } = await db.from('eve_memory').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message.slice(0, 200) }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: id })
  }

  if (body?.op === 'update') {
    const id = String(body?.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (await jonOwned(id)) return forbidden()
    { const row = await rowOf(id); if (row && !mayTouch(row, actor, me)) return tooHigh() }
    const patch: any = { updated_at: new Date().toISOString() }
    if (body.text != null) patch.text = String(body.text).slice(0, 1000)
    if (body.why != null) patch.why = String(body.why).slice(0, 500) || null
    if (body.kind != null) patch.kind = normKind(body.kind)
    if (body.scope != null) patch.scope = normScope(body.scope)
    // A colleague's edit cannot lift a memory above the staff ceiling (Jon, 2026-09-23 review).
    // A teacher's ceiling is their tier's (lib/eve/teachers.ts, 2026-11-05).
    if (body.weight != null) patch.weight = owner ? normWeight(body.weight) : Math.min(normWeight(body.weight), me?.teacher ? me.maxWeight : STAFF_MAX_WEIGHT)
    const { error } = await db.from('eve_memory').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message.slice(0, 200) }, { status: 500 })
    return NextResponse.json({ ok: true, updated: id })
  }

  // Default: a person teaching her something directly. Source 'jon' and a high default weight when
  // it is Jon, because a thing the owner typed on purpose outranks anything she inferred on her own.
  // Anyone else is filed as 'staff', capped at weight 6 (Jon, 2026-09-23 review).
  const supersedes = body?.supersedes ? String(body.supersedes) : null
  if (supersedes && await jonOwned(supersedes)) return forbidden()
  if (supersedes) { const row = await rowOf(supersedes); if (row && !mayTouch(row, actor, me)) return tooHigh() }
  // Teacher-aware (2026-11-05): a teacher writes at their tier's ceiling, anyone else as before.
  const who = me?.teacher ? teacherSource(me, body?.weight != null ? body.weight : 8) : { ...personSource(actor, body?.weight != null ? body.weight : 8), maxWeight: owner ? undefined : STAFF_MAX_WEIGHT }
  const res = await saveMemory({
    text: body?.text, kind: body?.kind, why: body?.why, scope: body?.scope,
    weight: who.weight, maxWeight: who.source === 'staff' ? who.maxWeight : undefined,
    source: who.source, created_by: actor, supersedes,
    evidence: me?.teacher && me.tier !== 'jon' ? { teacher: me.label || actor } : undefined,
  })
  if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, id: res.id })
}
