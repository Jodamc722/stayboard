// HK DAMAGE REPORTS — the queue on the Claims board (lib/hk-damage).
// GET                         → { reports, lastScanAt, lastError, closeReasons }
// GET ?units=1                → { units } for fixing a unit match
// GET ?stays=<listingId>&day= → recent stays at that unit, to pick the responsible guest
// POST { action:'scan', days? }               read the channel now
// POST { action:'claim', id, reservationId? } Autofill claim: a draft claim with the stay, the items
//                                             and the photos (or the items added to that stay's
//                                             open claim if it already has one)
// POST { action:'close', id, reason }         Not claimable
// POST { action:'reopen', id }
// POST { action:'match', id, listingId?, reservationId? }  fix the unit or the guest before autofill
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bustDay } from '@/lib/bust'
import { readHk, writeHk, scanHk, stayFor, stayOf, CLOSE_REASONS, type HkReport } from '@/lib/hk-damage'
import { createClaimFromReservation, loadClaimPolicy } from '@/lib/claim-create'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))
const etDay = (iso: string) => new Date(Date.parse(iso) - 4 * 3600000).toISOString().slice(0, 10)

async function units(db: any) {
  const { data } = await db.from('guesty_listings').select('id,nickname,title,active:raw->>active').limit(1000)
  return ((data || []) as any[]).filter(l => String(l.active) !== 'false').map(l => ({ id: str(l.id), name: str(l.nickname || l.title) })).sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  if (sp.get('units')) return NextResponse.json({ ok: true, units: await units(db) })
  const stays = sp.get('stays')
  if (stays) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('day'))) ? str(sp.get('day')) : new Date().toISOString().slice(0, 10)
    const from = new Date(Date.parse(day + 'T12:00:00Z') - 21 * 86400000).toISOString().slice(0, 10)
    const { data } = await db.from('guesty_reservations').select('id,guest_name,check_in,check_out,status,source,confirmation_code')
      .eq('listing_id', stays).gte('check_out', from).lte('check_in', day + 'T23:59:59').order('check_out', { ascending: false }).limit(12)
    const pol = await loadClaimPolicy()
    return NextResponse.json({ ok: true, stays: ((data || []) as any[]).filter(r => !/cancel|declin|expired|inquiry/i.test(str(r.status))).map(r => stayOf(r, pol)) })
  }
  const s = await readHk()
  const open = s.reports.filter(r => r.status === 'new')
  const done = s.reports.filter(r => r.status !== 'new').slice(0, 40)
  return NextResponse.json({ ok: true, reports: [...open, ...done], lastScanAt: s.lastScanAt, lastError: s.lastError, closeReasons: CLOSE_REASONS })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('claims', 'edit')
  if (!gate.ok) return gate.res
  const by = gate.access.email || null
  const db = supabaseAdmin()
  const b = await req.json().catch(() => ({} as any))
  const action = str(b?.action)
  const deny = (m: string, st = 400) => NextResponse.json({ ok: false, error: m }, { status: st })

  if (action === 'scan') {
    const r = await scanHk({ days: Number(b?.days) > 0 ? Math.min(30, Number(b.days)) : undefined })
    return NextResponse.json({ ok: r.ok, added: r.added.length, error: r.error })
  }

  const s = await readHk()
  const rep = s.reports.find(r => r.id === str(b?.id))
  if (!rep) return deny('That report is gone.', 404)
  const now = new Date().toISOString()
  const save = async (r: HkReport) => { const w = await writeHk(s, by); if (!w.ok) return deny('Could not save: ' + w.error, 500); return NextResponse.json({ ok: true, report: r }) }

  if (action === 'close') {
    rep.status = 'closed'; rep.closedReason = str(b?.reason).slice(0, 120) || 'Not claimable'; rep.handledBy = by; rep.handledAt = now
    return save(rep)
  }
  if (action === 'reopen') {
    rep.status = 'new'; rep.closedReason = null; rep.claimId = null; rep.handledBy = null; rep.handledAt = null
    return save(rep)
  }
  if (action === 'match') {
    const all = await units(db)
    if (b?.listingId) {
      const l = all.find(u => u.id === str(b.listingId))
      if (!l) return deny('Pick a unit.')
      rep.listingId = l.id; rep.unit = l.name
      rep.stay = await stayFor(db, l.id, l.name, etDay(rep.postedAt), all).catch(() => null)
    }
    if (b?.reservationId) {
      const { data } = await db.from('guesty_reservations').select('id,guest_name,check_in,check_out,status,source,confirmation_code').eq('id', str(b.reservationId)).limit(1)
      if (!data || !data[0]) return deny('That stay is not in the mirror.')
      rep.stay = stayOf(data[0], await loadClaimPolicy())
    }
    return save(rep)
  }
  if (action === 'claim') {
    const resId = str(b?.reservationId) || rep.stay?.reservationId || ''
    if (!resId) return deny('Pick the stay this is against first — no guest checked out of that unit in the three days before the report.')
    // One claim per stay: a second report about the same guest adds to the claim already open.
    let claimId = ''
    let existing = false
    try {
      const { data } = await db.from('claims').select('id').eq('reservation_id', resId).is('deleted_at', null).not('stage', 'eq', 'closed').limit(1)
      if (data && data[0]) { claimId = str(data[0].id); existing = true }
    } catch { /* make a new one */ }
    const posted = new Date(rep.postedAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const evidence = `From #vr-hkdamagereports — ${rep.author}, ${posted}:\n${rep.text || '(photos only)'}${rep.permalink ? '\n' + rep.permalink : ''}`
    if (!claimId) {
      const made = await createClaimFromReservation(db, resId, {
        by, discoveredOn: etDay(rep.postedAt), summary: rep.summary, extraNotes: evidence,
        historyNote: { action: 'autofilled from HK damage report', to: rep.id },
      })
      if (!made.ok) return deny(made.error, made.status)
      claimId = made.id
    } else {
      try {
        const { data: c } = await db.from('claims').select('notes,history').eq('id', claimId).maybeSingle()
        await db.from('claims').update({
          notes: [str(c?.notes), evidence].filter(Boolean).join('\n\n'),
          history: [...(Array.isArray(c?.history) ? c.history : []), { at: now, by: by || 'team', action: 'added HK damage report', to: rep.id }],
          updated_at: now,
        }).eq('id', claimId)
      } catch { /* the items still go on */ }
    }
    // The items: one row per thing found, the count in the description, the report's photos on each
    // (the channel wants evidence per item — remove the ones that don't belong). Cost, age and
    // condition are left for a person: they are what the channel checks hardest.
    const { data: last } = await db.from('claim_items').select('position').eq('claim_id', claimId).order('position', { ascending: false }).limit(1)
    let pos = Number(last?.[0]?.position ?? -1) + 1
    const items = rep.items.length ? rep.items : [{ description: rep.summary || 'Damage found by housekeeping', qty: 1 }]
    const rows = items.map(it => ({ claim_id: claimId, position: pos++, description: (it.qty > 1 ? it.qty + ' × ' : '') + it.description, photo_urls: rep.photos }))
    const ins = await db.from('claim_items').insert(rows)
    rep.status = 'claimed'; rep.claimId = claimId; rep.handledBy = by; rep.handledAt = now
    const w = await writeHk(s, by)
    if (!w.ok) return deny('The claim was made but the report could not be marked: ' + w.error, 500)
    bustDay()
    return NextResponse.json({ ok: true, claimId, existing, itemsError: ins.error ? ins.error.message : null })
  }
  return deny('Unknown action.')
}
