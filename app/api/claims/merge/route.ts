// MERGE CLAIMS (Jon, 2026-11-06: "for claims should be able to combine them too — meaning merge,
// sometimes it's multiple items"). Two or more claims become ONE: the claim you keep gets every
// item from the others (photos, receipts, costs and all, appended in order), the summaries and notes
// are joined, the asked amount is re-added, and the claims folded in are soft-deleted with a
// "merged into" line in their history so the trail survives. HK damage reports that pointed at a
// folded claim are re-pointed at the kept one.
//
// POST { keepId, mergeIds: string[] }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { bustDay } from '@/lib/bust'
import { claimTitle, itemsTotal, num, type Claim, type ClaimItem } from '@/lib/claims'
import { readHk, writeHk } from '@/lib/hk-damage'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))

export async function POST(req: NextRequest) {
  const gate = await requireLevel('claims', 'edit')
  if (!gate.ok) return gate.res
  const me = str(gate.access.email).toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  const keepId = str(b.keepId).trim()
  const mergeIds: string[] = Array.from(new Set<string>((Array.isArray(b.mergeIds) ? b.mergeIds : []).map(str).filter((x: string) => x && x !== keepId)))
  if (!keepId || !mergeIds.length) return NextResponse.json({ ok: false, error: 'Pick the claim to keep and at least one to merge into it.' }, { status: 400 })

  const db = supabaseAdmin()
  try {
    const { data: rows, error } = await db.from('claims').select('*').in('id', [keepId, ...mergeIds]).is('deleted_at', null)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const byId: Record<string, Claim & Record<string, any>> = {}
    for (const r of (rows || []) as any[]) byId[str(r.id)] = r
    const keep = byId[keepId]
    if (!keep) return NextResponse.json({ ok: false, error: 'The claim to keep was not found.' }, { status: 404 })
    const folded = mergeIds.map(id => byId[id]).filter(Boolean)
    if (!folded.length) return NextResponse.json({ ok: false, error: 'None of the claims to merge were found.' }, { status: 404 })
    if (keep.stage === 'closed' || folded.some(c => c.stage === 'closed')) {
      return NextResponse.json({ ok: false, error: 'A closed claim cannot be merged — reopen it first.' }, { status: 409 })
    }

    const { data: allItems } = await db.from('claim_items').select('*').in('claim_id', [keepId, ...folded.map(c => str(c.id))]).order('position', { ascending: true })
    const items = (allItems || []) as (ClaimItem & { claim_id: string })[]
    const keepItems = items.filter(i => str(i.claim_id) === keepId)
    let pos = keepItems.reduce((m, i) => Math.max(m, Number(i.position) || 0), -1) + 1

    // Move items: one update per folded claim keeps the order each claim had.
    for (const c of folded) {
      const mine = items.filter(i => str(i.claim_id) === str(c.id))
      for (const it of mine) {
        const u = await db.from('claim_items').update({ claim_id: keepId, position: pos++, updated_at: new Date().toISOString() }).eq('id', str(it.id))
        if (u.error) return NextResponse.json({ ok: false, error: 'Moving items failed: ' + u.error.message }, { status: 500 })
      }
    }

    // Money and words. The asked amount: the sum of what each claim asked (or its items), so a
    // hand-typed total on any of them is not lost. Amount paid adds up the same way when set.
    const askOf = (c: any) => num(c.amount_sought) ?? itemsTotal(items.filter(i => str(i.claim_id) === str(c.id)))
    const sought = [keep, ...folded].reduce((t, c) => t + (askOf(c) || 0), 0)
    const paidVals = [keep, ...folded].map(c => num(c.amount_paid)).filter(v => v != null) as number[]
    const join = (field: 'summary' | 'notes') => [keep, ...folded].map(c => str(c[field]).trim()).filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join('\n\n') || null
    const otherRes = folded.filter(c => str(c.reservation_id) && str(c.reservation_id) !== str(keep.reservation_id))
    const mergedLine = 'Merged in ' + new Date().toISOString().slice(0, 10) + ' by ' + me + ': ' + folded.map(c => claimTitle(c) + (c.confirmation_code ? ' (' + c.confirmation_code + ')' : '')).join('; ')
      + (otherRes.length ? ' — note: ' + otherRes.length + ' from a different reservation' : '')
    const hist = Array.isArray(keep.history) ? keep.history.slice(-99) : []
    hist.push({ at: new Date().toISOString(), by: me, action: 'merge', merged: folded.map(c => str(c.id)) })
    const patch: Record<string, any> = {
      amount_sought: Math.round(sought * 100) / 100,
      summary: join('summary'),
      notes: [join('notes'), mergedLine].filter(Boolean).join('\n\n'),
      updated_at: new Date().toISOString(),
      history: hist,
    }
    if (paidVals.length) patch.amount_paid = Math.round(paidVals.reduce((t, v) => t + v, 0) * 100) / 100
    for (const f of ['guest_called', 'police_report'] as const) if ([keep, ...folded].some(c => c[f] === true)) patch[f] = true
    const up = await db.from('claims').update(patch).eq('id', keepId)
    if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 })

    // Fold the others away — soft delete, with where they went.
    for (const c of folded) {
      const h = Array.isArray(c.history) ? c.history.slice(-99) : []
      h.push({ at: new Date().toISOString(), by: me, action: 'merged_into', to: keepId })
      await db.from('claims').update({ deleted_at: new Date().toISOString(), history: h, notes: [str(c.notes).trim(), 'Merged into ' + claimTitle(keep) + ' (' + keepId + ')'].filter(Boolean).join('\n\n') }).eq('id', str(c.id))
    }

    // HK damage reports that opened a folded claim now point at the kept one.
    try {
      const s = await readHk()
      const gone = new Set(folded.map(c => str(c.id)))
      let n = 0
      for (const r of s.reports) if (r.claimId && gone.has(r.claimId)) { r.claimId = keepId; n++ }
      if (n) await writeHk(s, me)
    } catch { /* best effort */ }

    bustDay()
    return NextResponse.json({ ok: true, id: keepId, merged: folded.length, items: items.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
