// ADD A JOB FROM THE FIELD BOARD (Jon, 2026-08-25: "can we add a task… be able to add stuff").
//
// The app's own add-task route requires a Lighthouse login and the 'plan' edit level. A cleaner
// standing in a unit has neither, and the whole point of a board is that the person who FINDS the
// problem can file it. So this is a deliberately narrow sibling:
//
//   • The board must have its Add section switched on. No flag, no writes.
//   • The unit must be INSIDE THAT BOARD'S SCOPE — the code is the capability, and it grants
//     exactly the units the board covers, never the portfolio.
//   • Whoever files it types their name. There is no login to attribute it to, so the name goes in
//     the Breezeway description; an unattributed task is a task nobody can ask about.
//   • Signed-in users skip the passcode, same as reading.
//
// Everything else matches /api/ops-today/add-task: create in Breezeway, then write through to
// breezeway_tasks_sync so the board shows it before the 15-minute sync catches up.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask } from '@/lib/breezeway'
import { getBoardLink, buildFieldBoard } from '@/lib/field-board'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEPTS = ['housekeeping', 'maintenance', 'inspection', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const link = await getBoardLink(String(params.code || ''))
  if (!link) return NextResponse.json({ ok: false, error: 'Unknown or revoked board.' }, { status: 404 })
  if (!link.sections?.add) return NextResponse.json({ ok: false, error: 'This board cannot add jobs.' }, { status: 403 })

  let signedIn = false
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    signedIn = !!user
  } catch { signedIn = false }

  const body = await req.json().catch(() => ({} as any))
  const pass = String(body?.pass || '')
  const shareOk = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value).catch(() => false)
  const passOk = link.passcode ? pass === link.passcode : shareOk
  if (!signedIn && !passOk) return NextResponse.json({ ok: false, error: 'Enter the board passcode first.' }, { status: 403 })

  const listingId = String(body?.listingId || '').trim()
  const title = String(body?.title || '').trim().slice(0, 120)
  const who = String(body?.who || '').trim().slice(0, 60)
  if (!listingId || !title) return NextResponse.json({ ok: false, error: 'Pick a unit and say what needs doing.' }, { status: 400 })
  if (!who && !signedIn) return NextResponse.json({ ok: false, error: 'Add your name so the office knows who found it.' }, { status: 400 })

  // THE SCOPE GUARD. buildFieldBoard already resolved this board's units for the picker; asking it
  // again is cheap next to the alternative — a code for one building filing work on the portfolio.
  const board: any = await buildFieldBoard({ ...link, sections: { ...link.sections, add: true } })
  const allowed: string[] = (board.units || []).map((u: any) => String(u.id))
  if (allowed.length && allowed.indexOf(listingId) < 0) {
    return NextResponse.json({ ok: false, error: 'That unit is not on this board.' }, { status: 403 })
  }
  const unitName = ((board.units || []).find((u: any) => String(u.id) === listingId) || {}).name || 'unit'

  const department = DEPTS.indexOf(String(body?.department)) >= 0 ? String(body.department) : 'maintenance'
  const priority = PRIOS.indexOf(String(body?.priority)) >= 0 ? String(body.priority) : 'normal'
  const date = todayET()
  const note = String(body?.description || '').slice(0, 800)
  const description = (note ? note + '\n\n' : '')
    + 'Added from the ' + (link.label || 'field') + ' board' + (who ? ' by ' + who : '') + ' on ' + date + '.'

  try {
    const db = supabaseAdmin()
    const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
    const homeId = Number(((props || [])[0] || {}).home_id)
    const payload: Record<string, any> = { name: title, type_department: department, type_priority: priority, scheduled_date: date, description }
    if (Number.isFinite(homeId)) payload.home_id = homeId
    else payload.reference_property_id = listingId
    const r = await createBreezewayTask(payload)
    if (!r.ok || !r.data?.id) return NextResponse.json({ ok: false, error: 'Breezeway did not accept it (' + r.status + ').' }, { status: 502 })
    try {
      await db.from('breezeway_tasks_sync').upsert({
        id: String(r.data.id), reference_property_id: listingId, name: title, status: 'created',
        scheduled_date: date, type_department: department, assignees: [],
        raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    } catch { /* the sync catches up */ }
    return NextResponse.json({ ok: true, taskId: String(r.data.id), unit: unitName })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
