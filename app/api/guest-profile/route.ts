// GUEST UNDERSTANDING — read and write (Jon, 2026-10-14).
//
// GET  ?reservation=<id>   → this stay's log, the person's profile, the tags, the repeat count,
//                            the brief as the field team would see it, and which Breezeway tasks
//                            would carry it
// POST { reservationId, data }            → save what somebody typed (marked 'said', not 'read')
// POST { action:'push', reservationId }   → send the brief to those tasks now
//
// WHY TYPED FIELDS OUTRANK READ ONES. The model read a transcript; the person was on the call. So
// anything saved here is stamped 'said', and lib/guest-store refuses to let a later call overwrite
// it. Getting this backwards means a crackly line quietly deletes what somebody knew.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestViewFor, recordUnderstanding } from '@/lib/guest-store'
import { cleanUnderstanding, shortBrief, UNDERSTANDING_FIELDS, guestKey, type Understanding } from '@/lib/guest-profile'
import { targetTasks, pushGuestBriefs } from '@/lib/guest-brief-push'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('reservations', 'view')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('reservation') || '').trim()
  if (!id) return NextResponse.json({ error: 'reservation required' }, { status: 400 })

  const view = await guestViewFor(id)
  if (!view) return NextResponse.json({ error: 'No such reservation.' }, { status: 404 })

  const db = supabaseAdmin()
  const { data: res } = await db.from('guesty_reservations')
    .select('id,guest_name,listing_id,listing_name,check_in,check_out').eq('id', id).maybeSingle()

  // What the field team would read. Shown here so nobody has to open Breezeway to find out what we
  // told them — a brief you cannot see is a brief you cannot correct.
  const merged: Understanding = { ...(view.profile?.data || {}), ...view.stay }
  const brief = shortBrief({ name: res?.guest_name, u: merged, stays: view.stays, checkIn: res?.check_in })
  const targets = res?.listing_id && res?.check_in ? await targetTasks(String(res.listing_id), String(res.check_in)).catch(() => []) : []
  const { data: pushed } = await db.from('guest_brief_pushes').select('bz_task_id,pushed_at').eq('reservation_id', id)

  return NextResponse.json({
    ok: true,
    key: view.key,
    stay: view.stay,
    source: view.source,
    profile: view.profile,
    tags: view.profile?.tags || [],
    stays: view.stays,
    repeat: view.repeat,
    brief,
    targets,
    pushed: pushed || [],
    fields: UNDERSTANDING_FIELDS,
  })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('reservations', 'edit')
  if (!g.ok) return g.res
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.reservationId || '').trim()
  if (!id) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })

  if (String(body?.action || '') === 'push') {
    const rep = await pushGuestBriefs({ reservationId: id, deadline: Date.now() + 45_000 })
    if (!rep.pushed && rep.errors.length) return NextResponse.json({ ok: false, error: rep.errors[0], report: rep }, { status: 502 })
    return NextResponse.json({ ok: true, report: rep })
  }

  const db = supabaseAdmin()
  const { data: res } = await db.from('guesty_reservations')
    .select('id,guest_id,guest_name,guest_phone,listing_id,check_in').eq('id', id).maybeSingle()
  if (!res) return NextResponse.json({ error: 'No such reservation.' }, { status: 404 })
  const key = guestKey(res)
  if (!key) return NextResponse.json({ error: 'This booking has no name, phone or guest id to hang a profile on.' }, { status: 400 })

  // Everything typed here was heard from the guest, not inferred — stamped so the next call
  // cannot quietly overwrite it.
  const u = cleanUnderstanding(body?.data)
  const heard: Record<string, 'said' | 'read'> = {}
  for (const k of Object.keys(u)) if (k !== 'heard' && k !== 'updatedAt') heard[k] = 'said'
  u.heard = heard

  const r = await recordUnderstanding({
    reservationId: id, guestKey: key, listingId: res.listing_id, checkIn: res.check_in,
    u, source: 'manual', byEmail: g.access.email || null,
  })
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 500 })

  const view = await guestViewFor(id)
  return NextResponse.json({ ok: true, stay: r.understanding, profile: view?.profile || null, tags: view?.profile?.tags || [], stays: view?.stays || 0 })
}
