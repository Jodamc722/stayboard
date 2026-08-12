// FF&E FIXES API — what needs doing, as opposed to what needs buying (Jon, 2026-08-12).
//
// GET  ?code=<unitCode>   public: the fixes already logged on that unit, for the walk form
// GET  (signed in)        the board: every fix, with the unit, the owner and the $350 verdict
// GET  ?people=1          who a fix can be assigned to
//
// POST {code, action:'add'}     public: log one from the walk form
// POST signed-in: update | assign | toOrder | notifyTeam
//
// THE $350 RULE lives in lib/ffe-catalog.ts and is applied in exactly one place per direction:
// `needsOwner()` here decides the flag, and `toOrder` is the only path that puts a fix in front of
// an owner. Nothing under the threshold can reach them by accident, because nothing under the
// threshold is allowed onto an order.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ffePortfolio } from '@/lib/ffe-portfolio'
import { unitCode, resolveCode, orderCode } from '@/lib/ffe-links'
import { needsOwner, FIX_OWNER_THRESHOLD } from '@/lib/ffe-catalog'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const str = (v: any) => (v == null ? '' : String(v))
const nowISO = () => new Date().toISOString()
const STATUSES = new Set(['open', 'doing', 'done', 'dropped'])

const isMissingTable = (msg: any) => /schema cache|does not exist/i.test(String(msg || ''))
const SETUP = 'FF&E fixes are not set up yet — migration 035 has not been run on the database.'
const fail = (msg: any) => isMissingTable(msg)
  ? NextResponse.json({ ok: false, setupRequired: true, error: SETUP }, { status: 503 })
  : NextResponse.json({ ok: false, error: String(msg) }, { status: 500 })

function costOf(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
const clean = (v: any, max: number) => { const s = str(v).trim(); return s ? s.slice(0, max) : null }

const decorate = (f: any, unitName?: string, building?: string, ownerName?: string) => ({
  ...f,
  unit_name: f.unit_name || unitName || null,
  building: f.building || building || null,
  ownerName: ownerName || null,
  needsOwner: needsOwner(f.est_cost),
})

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    // ---- PUBLIC: the fixes on one unit, for the walk form ----
    const code = str(sp.get('code')).trim()
    if (code) {
      const units = await ffePortfolio(db)
      const scope = resolveCode(code, { units: units.map(u => u.id), buildings: [], owners: [] })
      if (!scope) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
      const { data, error } = await db.from('ffe_fixes')
        .select('id,room,item_key,title,note,est_cost,status,photo_url,created_at')
        .eq('listing_id', scope.id).neq('status', 'dropped')
        .order('created_at', { ascending: false }).limit(200)
      if (error) return fail(error.message)
      return NextResponse.json({ ok: true, fixes: (data || []).map((f: any) => decorate(f)), threshold: FIX_OWNER_THRESHOLD })
    }

    const s = createClient()
    const { data: u } = await s.auth.getUser()
    if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // ---- who can own a fix ----
    if (sp.get('people')) {
      const { data } = await db.from('app_users').select('email,profile').eq('status', 'active').limit(300)
      return NextResponse.json({
        ok: true,
        people: ((data || []) as any[]).map(p => ({
          email: str(p.email),
          name: str((p.profile && (p.profile.name || p.profile.full_name)) || p.email).slice(0, 80),
        })).sort((a, b) => a.name.localeCompare(b.name)),
      })
    }

    // ---- THE BOARD ----
    const [{ data, error }, units] = await Promise.all([
      db.from('ffe_fixes').select('*').order('created_at', { ascending: false }).limit(3000),
      ffePortfolio(db),
    ])
    if (error) return fail(error.message)
    const byId = Object.fromEntries(units.map(x => [x.id, x]))
    const fixes = ((data || []) as any[]).map(f => {
      const un = byId[str(f.listing_id)]
      return decorate(f, un?.name, un?.building, un?.ownerName)
    })
    return NextResponse.json({
      ok: true,
      fixes,
      threshold: FIX_OWNER_THRESHOLD,
      totals: {
        open: fixes.filter(f => f.status === 'open').length,
        doing: fixes.filter(f => f.status === 'doing').length,
        done: fixes.filter(f => f.status === 'done').length,
        needOwner: fixes.filter(f => f.needsOwner && f.status !== 'done' && !f.order_id).length,
        value: fixes.filter(f => f.status !== 'done' && f.status !== 'dropped')
          .reduce((a, f) => a + (f.est_cost == null ? 0 : Number(f.est_cost)), 0),
      },
    })
  } catch (e: any) { return fail(e?.message || e) }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = str(body.action) || 'add'
  const now = nowISO()

  try {
    // ---- PUBLIC: logged from the walk form, on the unit's own capability link ----
    if (action === 'add' && str(body.code)) {
      const units = await ffePortfolio(db)
      const scope = resolveCode(str(body.code), { units: units.map(u => u.id), buildings: [], owners: [] })
      if (!scope) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
      const un = units.find(x => x.id === scope.id)
      const title = clean(body.title, 160)
      if (!title) return NextResponse.json({ ok: false, error: 'a short description is required' }, { status: 400 })
      const row = {
        listing_id: scope.id, unit_name: un?.name || null, building: un?.building || null,
        room: clean(body.room, 40), item_key: clean(body.itemKey, 40),
        title, note: clean(body.note, 1000), photo_url: clean(body.photoUrl, 500),
        est_cost: costOf(body.estCost), status: 'open',
        created_by: clean(body.by, 120), updated_at: now,
      }
      const r = await db.from('ffe_fixes').insert(row).select('id').limit(1)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, id: (r.data || [])[0]?.id || null })
    }

    // Everything below changes what the team is working on, so it is signed in and edit-gated.
    const gate = await requireLevel('ffe', 'edit')
    if (!gate.ok) return gate.res
    const who = gate.access.email || null

    if (action === 'update') {
      const id = str(body.id)
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const patch: any = { updated_at: now }
      if ('title' in body) patch.title = clean(body.title, 160)
      if ('note' in body) patch.note = clean(body.note, 1000)
      if ('estCost' in body) patch.est_cost = costOf(body.estCost)
      if ('room' in body) patch.room = clean(body.room, 40)
      if ('status' in body && STATUSES.has(str(body.status))) {
        patch.status = str(body.status)
        if (patch.status === 'done') { patch.done_at = now; patch.done_by = who }
        else { patch.done_at = null; patch.done_by = null }
      }
      const r = await db.from('ffe_fixes').update(patch).eq('id', id)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    if (action === 'assign') {
      const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 500) : [str(body.id)].filter(Boolean)
      const to = clean(body.assignedTo, 160)
      if (!ids.length) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const r = await db.from('ffe_fixes').update({ assigned_to: to, updated_at: now }).in('id', ids)
      if (r.error) return fail(r.error.message)
      // Tell the person, not just the database. An assignment nobody is told about is a note.
      if (to) {
        const { data: rows } = await db.from('ffe_fixes').select('title,unit_name').in('id', ids).limit(500)
        const titles = ((rows || []) as any[]).map(x => (x.unit_name ? x.unit_name + ' — ' : '') + x.title)
        await notify([to], {
          kind: 'ffe_fix', actor: who || undefined,
          title: ids.length === 1 ? 'FF&E fix assigned to you' : ids.length + ' FF&E fixes assigned to you',
          body: titles.slice(0, 4).join(' · ') + (titles.length > 4 ? ' …' : ''),
          link: '/ffe#fixes',
        }).catch(() => null)
      }
      return NextResponse.json({ ok: true, assigned: ids.length })
    }

    // ---- SEND THE LIST TO THE TEAM ----
    if (action === 'notifyTeam') {
      const to: string[] = Array.isArray(body.to) ? body.to.map(String).slice(0, 50) : []
      if (!to.length) return NextResponse.json({ error: 'pick at least one person' }, { status: 400 })
      const { data: rows } = await db.from('ffe_fixes').select('title,unit_name,est_cost')
        .in('status', ['open', 'doing']).order('created_at', { ascending: false }).limit(200)
      const list = ((rows || []) as any[])
      const r = await notify(to, {
        kind: 'ffe_fix', actor: who || undefined,
        title: list.length + ' FF&E fix' + (list.length === 1 ? '' : 'es') + ' open',
        body: list.slice(0, 5).map(x => (x.unit_name ? x.unit_name + ' — ' : '') + x.title).join(' · ') +
          (list.length > 5 ? ' … and ' + (list.length - 5) + ' more' : ''),
        link: '/ffe#fixes',
      })
      return NextResponse.json({ ok: true, sent: r.sent || 0, open: list.length })
    }

    // ---- PUT A FIX IN FRONT OF THE OWNER ----
    // Only ever at or above the threshold. This is the single door between "the team handles it"
    // and "the owner is asked", and it is closed for anything cheaper on purpose.
    if (action === 'toOrder') {
      const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [str(body.id)].filter(Boolean)
      if (!ids.length) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const { data: rows, error: rErr } = await db.from('ffe_fixes').select('*').in('id', ids).limit(200)
      if (rErr) return fail(rErr.message)
      const fixes = (rows || []) as any[]
      const eligible = fixes.filter(f => needsOwner(f.est_cost))
      const tooCheap = fixes.length - eligible.length
      if (!eligible.length) {
        return NextResponse.json({
          error: `Nothing here reaches $${FIX_OWNER_THRESHOLD}. Under that, the team just does it — the owner is not asked.`,
        }, { status: 400 })
      }

      const units = await ffePortfolio(db)
      const byId = Object.fromEntries(units.map(u => [u.id, u]))
      // One order per owner, reusing an open draft rather than minting a second one every time.
      const byOwner: Record<string, any[]> = {}
      for (const f of eligible) {
        const un = byId[str(f.listing_id)]
        if (!un) continue
        ;(byOwner[un.ownerId] = byOwner[un.ownerId] || []).push({ fix: f, unit: un })
      }

      const touched: { orderId: string; orderNo: string; lines: number }[] = []
      for (const ownerId of Object.keys(byOwner)) {
        const group = byOwner[ownerId]
        const { data: open } = await db.from('ffe_orders')
          .select('id,order_no').eq('owner_id', ownerId).eq('status', 'draft')
          .order('created_at', { ascending: false }).limit(1)
        let order = (open || [])[0]
        if (!order) {
          const ins = await db.from('ffe_orders').insert({
            owner_id: ownerId, owner_name: group[0].unit.ownerName,
            title: group[0].unit.ownerName + ' — FF&E', status: 'draft',
            created_by: who, updated_at: now,
          }).select('id,order_no').limit(1)
          if (ins.error) return fail(ins.error.message)
          order = (ins.data || [])[0]
        }
        const lines = group.map(({ fix, unit }) => ({
          order_id: order.id,
          listing_id: str(fix.listing_id), unit_name: unit.name, building: unit.building,
          room: str(fix.room) || 'living',
          // Namespaced so a fix line can never collide with a checklist item on the same room.
          item_key: 'fix_' + str(fix.id).slice(0, 8),
          title: str(fix.title),
          product: str(fix.title),
          qty: 1,
          unit_cost: fix.est_cost,
          placement: str(fix.note || '').slice(0, 160) || null,
          stage: 'draft', note: 'FF&E fix', updated_at: now,
        }))
        const li = await db.from('ffe_order_lines').insert(lines)
        if (li.error && !/duplicate key/i.test(li.error.message || '')) return fail(li.error.message)
        await db.from('ffe_fixes').update({ order_id: order.id, updated_at: now })
          .in('id', group.map(g => str(g.fix.id)))
        touched.push({ orderId: str(order.id), orderNo: str(order.order_no), lines: lines.length })
      }

      return NextResponse.json({
        ok: true, orders: touched, skippedUnderThreshold: tooCheap,
        note: tooCheap ? `${tooCheap} fix(es) stayed internal — under $${FIX_OWNER_THRESHOLD}.` : null,
      })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return fail(e?.message || e) }
}
