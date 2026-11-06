// ONE GUIDEBOOK, PAGE BY PAGE (Jon, 2026-11-06). The real guest guide in a phone frame, one review page
// at a time, with that page's flags beside it; tick each page, then Approve — which pushes the guest link
// to Guesty. Guest view, printable view and the magazine are one click away. components/GuidebookReview.
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { auditGuidebook, reviewOf, stageOf } from '@/lib/guidebook-audit'
import { guestUnitFull } from '@/lib/guest-unit'
import { rollupBuilding } from '@/lib/optimize-score'
import { GuidebookReview } from '@/components/GuidebookReview'

export const dynamic = 'force-dynamic'

export default async function ReviewOne({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const id = String(params.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const db = supabaseAdmin()
  const { data } = await db.from('guidebooks').select('id, listing_id, listing_name, title, status, sections, answers, updated_at').eq('id', id).limit(1)
  const gb: any = (data || [])[0]
  if (!gb) notFound()
  let listing: any = null
  if (gb.listing_id) { try { const { data: l } = await db.from('guesty_listings').select('id, nickname, title, building, unit').eq('id', gb.listing_id).limit(1); listing = (l || [])[0] || null } catch { /* none */ } }

  // Next in the queue: the next draft in the same building (by unit), else the next draft anywhere.
  let nextId = ''
  try {
    const { data: drafts } = await db.from('guidebooks').select('id, listing_id, status, listing_name').neq('status', 'live').neq('status', 'approved').order('listing_name').limit(500)
    const ids = Array.from(new Set((drafts || []).map((d: any) => d.listing_id).filter(Boolean)))
    const { data: ls } = ids.length ? await db.from('guesty_listings').select('id, nickname, building, unit').in('id', ids) : { data: [] as any[] }
    const lb: Record<string, any> = {}
    for (const l of (ls || [])) lb[(l as any).id] = l
    const me = rollupBuilding(String(listing?.building || ''))
    const label = (d: any) => guestUnitFull(lb[d.listing_id]) || String(d.listing_name || '')
    const pool = (drafts || []).filter((d: any) => d.id !== id)
    const same = pool.filter((d: any) => me && rollupBuilding(String(lb[d.listing_id]?.building || '')) === me).sort((a: any, b: any) => label(a).localeCompare(label(b), undefined, { numeric: true }))
    const mine = label({ listing_id: gb.listing_id, listing_name: gb.listing_name })
    nextId = (same.find((d: any) => label(d).localeCompare(mine, undefined, { numeric: true }) > 0) || same[0] || pool[0] || { id: '' }).id
  } catch { /* no next */ }

  const flags = auditGuidebook(gb, listing)
  return (
    <GuidebookReview
      id={gb.id}
      unit={guestUnitFull(listing) || ''}
      name={String(gb.listing_name || gb.title || '').split(/\s+\|\s+/)[0]}
      stage={stageOf(gb)}
      review={reviewOf(gb)}
      flags={flags}
      nextId={nextId}
    />
  )
}
