// WHAT EVE KNOWS — one place to SEE and CORRECT her knowledge (owner, 2026-11-10: "Eve should be
// better than anybody on the team when it comes to the knowledge base").
//
// GET                    the picker (every unit, building, owner, vendor, person, channel) + the coverage strip
// GET ?entity=<type:id>  one readable card: the facts she holds, the nightly knowledge card, the
//                        business-brain health line and repeat failures, SOP passages, open questions
// GET ?q=<topic>         a topic searched across memory, knowledge cards, documents and the guest FAQ
// GET ?list=units|buildings|unconfirmed|stale   what a coverage number is made of
// POST {op:'still_true', id}            a person checked it today (verified_at = now)
// POST {op:'retire', id, why?}          out of every prompt from today; never deleted
// POST {op:'tag', id, entity}           file a row you just taught under its entity (typed columns)
//
// Confirm, edit and "teach her" go through /api/eve/memory, unchanged. Gated exactly like that route
// (eveGate + a VR login); dollar figures are masked for anyone without the money permission and
// contact details / guests' words for anyone without guest access. Every read fails open
// (lib/eve/knowledge-browse.ts): a missing table is a note on the page, not an error page.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { canSeeMoney, isSuperadmin, type Access } from '@/lib/access'
import { teacherFor, identityOfAccess } from '@/lib/eve/teachers'
import { mayApprove } from '@/lib/eve/memory-confirm'
import { isPendingMemory } from '@/lib/eve/memory'
import { maskMoneyStrings, redactGuestPII } from '@/lib/eve/redact'
import {
  overview, entityCard, searchKnowledge, coverageList, markVerified, retireFact, tagFact, parseEntity, mayChange,
  type Viewer,
} from '@/lib/eve/knowledge-browse'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GUEST_LEVEL_KEYS = ['messages', 'reservations', 'guests']

async function viewerOf(access: Access): Promise<Viewer> {
  const email = String(access.email || '')
  const me = await teacherFor(identityOfAccess(access as any)).catch(() => null)
  const levels: Record<string, string> = (access as any)?.levels || {}
  const canGuests = isSuperadmin(email) || access.role === 'admin' || GUEST_LEVEL_KEYS.some(k => !!levels[k] && levels[k] !== 'off')
  return {
    email, me,
    canTeach: !!me?.teacher,
    canApprove: mayApprove(me),
    isOwner: isSuperadmin(email),
    canMoney: canSeeMoney(access),
    canGuests,
  }
}

const CONTACT_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g
function maskContacts<T>(value: T): T {
  const go = (v: any): any => {
    if (typeof v === 'string') return v.replace(CONTACT_RE, '(hidden)')
    if (Array.isArray(v)) return v.map(go)
    if (v && typeof v === 'object') { const o: Record<string, any> = {}; for (const k of Object.keys(v)) o[k] = go(v[k]); return o }
    return v
  }
  try { return go(value) as T } catch { return value }
}

/** Strip what this viewer may not see. Ids and keys never carry money or contact details. */
function shield<T>(body: T, v: Viewer): T {
  let out = body
  if (!v.canMoney) out = maskMoneyStrings(out)
  if (!v.canGuests) {
    out = redactGuestPII(out)
    out = maskContacts(out)
  }
  return out
}

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const viewer = await viewerOf(gate.access)
  const me = { canTeach: viewer.canTeach, canApprove: viewer.canApprove, isOwner: viewer.isOwner, canMoney: viewer.canMoney, canGuests: viewer.canGuests, teacher: viewer.me?.teacher ? viewer.me.tier : null }
  const sp = new URL(req.url).searchParams
  try {
    let body: any
    if (sp.get('q')) body = await searchKnowledge(String(sp.get('q') || ''), viewer)
    else if (sp.get('entity')) body = await entityCard(String(sp.get('entity') || ''), viewer)
    else if (sp.get('list')) body = await coverageList(String(sp.get('list') || ''), viewer)
    else body = await overview()
    return NextResponse.json(shield({ ...body, me }, viewer))
  } catch (e: any) {
    // Fail open: the page shows a quiet note instead of an error screen.
    return NextResponse.json({ ok: false, me, error: 'Could not read her knowledge just now.', detail: String(e?.message || e).slice(0, 160) })
  }
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const viewer = await viewerOf(gate.access)
  const body = await req.json().catch(() => ({} as any))
  const op = String(body?.op || '')
  const id = String(body?.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!viewer.canTeach) return NextResponse.json({ error: 'Only Jon or a teacher (Roberto, Karla, Bernadette or the CCS team) can change what she knows.' }, { status: 403 })

  // The same rule as /api/eve/memory: Jon's rows are Jon's, a heavier teacher's rows are theirs.
  const row = await (async () => {
    try { const { data } = await (supabaseAdmin() as any).from('eve_memory').select('id,source,weight,created_by,evidence').eq('id', id).maybeSingle(); return data || null } catch { return null }
  })()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (op === 'still_true') {
    const r = await markVerified(id, viewer.email)
    return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.status || 400 })
  }

  if (op === 'retire') {
    const overheard = isPendingMemory(row)
    // Retiring something she overheard is rejecting it — the owner and named teachers only, as in Confirm.
    if (overheard && !viewer.canApprove) return NextResponse.json({ error: 'Only Jon or a named teacher (Roberto, Karla, Bernadette) can reject what she overheard.' }, { status: 403 })
    if (!mayChange(row, viewer.email, viewer.me)) {
      return NextResponse.json({ error: String(row.source) === 'jon' ? 'Only Jon can change or remove something Jon taught her.' : 'A colleague taught that at a higher weight than yours — ask them or Jon to change it.' }, { status: 403 })
    }
    const r = await retireFact(id, viewer.email, body?.why ? String(body.why) : null)
    return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.status || 400 })
  }

  if (op === 'tag') {
    const ent = parseEntity(String(body?.entity || ''))
    if (!ent) return NextResponse.json({ error: 'entity required' }, { status: 400 })
    const r = await tagFact(id, viewer.email, ent.type, ent.id)
    return NextResponse.json(r.ok ? { ok: true, tagged: r.tagged } : { error: r.error }, { status: r.ok ? 200 : r.status || 400 })
  }

  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
