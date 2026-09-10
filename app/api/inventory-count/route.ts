// THE DESK SIDE of counting: the link itself, and the record of who counted what.
//   GET                     the link (minting one if none exists) + recent counts
//   PUT { passcode }        set or clear the passcode
//   PUT { rotate: true }    new code — the old link stops working
//   PUT { label }           rename it
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { newCountCode, recentCounts, type CountLink } from '@/lib/inventory-count'
import { getGuestOrdersCfg } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'

/** One live link, minted on first look. Nobody should have to decide to "create" it. */
async function currentLink(actor: string): Promise<CountLink> {
  const db = supabaseAdmin()
  const { data } = await db.from('inventory_count_links').select('*').is('revoked_at', null).order('created_at', { ascending: false }).limit(1)
  const found = (data || [])[0] as CountLink | undefined
  if (found) return found
  const row = { code: newCountCode(), label: 'Stock count', created_by: actor }
  const { data: made } = await db.from('inventory_count_links').insert(row).select('*').limit(1)
  return (made || [])[0] as CountLink
}

export async function GET() {
  const gate = await requireLevel('guest-orders', 'view')
  if (!gate.ok) return gate.res
  const [link, counts, cfg] = await Promise.all([currentLink(gate.access.email || 'staff'), recentCounts(20), getGuestOrdersCfg()])
  const base = (cfg.publicBase || '').replace(/\/+$/, '')
  return NextResponse.json({ ok: true, link: { ...link, url: base + '/count/' + link.code }, counts })
}

export async function PUT(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const db = supabaseAdmin()
  const actor = gate.access.email || 'staff'
  const link = await currentLink(actor)

  if (body?.rotate === true) {
    // Revoke rather than delete: the counts already taken keep pointing at a link that existed.
    await db.from('inventory_count_links').update({ revoked_at: new Date().toISOString() }).eq('code', link.code)
    const { data } = await db.from('inventory_count_links').insert({ code: newCountCode(), label: link.label, passcode: link.passcode, created_by: actor }).select('*').limit(1)
    const next = (data || [])[0] as CountLink
    const cfg = await getGuestOrdersCfg()
    return NextResponse.json({ ok: true, link: { ...next, url: (cfg.publicBase || '').replace(/\/+$/, '') + '/count/' + next.code } })
  }

  const patch: Record<string, any> = {}
  if (body?.label !== undefined) patch.label = String(body.label || '').trim().slice(0, 60) || 'Stock count'
  if (body?.passcode !== undefined) { const p = String(body.passcode || '').trim().slice(0, 40); patch.passcode = p || null }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'nothing to change' }, { status: 400 })
  const { error } = await db.from('inventory_count_links').update(patch).eq('code', link.code)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  const cfg = await getGuestOrdersCfg()
  return NextResponse.json({ ok: true, link: { ...link, ...patch, url: (cfg.publicBase || '').replace(/\/+$/, '') + '/count/' + link.code } })
}
