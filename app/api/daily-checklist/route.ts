// THE DAILY CHECKLIST API.
//
//   GET                              → today's list, with today's ticks already on it
//   POST { action: 'tick' | … }      → tick an item, or change the standing list
//
// TICKING needs 'edit'; CHANGING THE STANDING LIST needs 'full'. That split is the point of the
// feature: the list is agreed once and then everybody works it. If anybody who can tick can also
// quietly delete an item, "we do this every day" stops meaning anything.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { todayList, setTick, pruneOldTicks, progressOf, BANDS } from '@/lib/daily-checklist'
import { countSignals, signalLink } from '@/lib/checklist-signals'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

/**
 * An item's link goes in the page's own href, so it may only ever be an in-app path. Anything else
 * — an absolute URL, a protocol-relative one, a javascript: — is dropped rather than corrected: the
 * standing list is edited in the browser, and a checklist row is not a place to be sending people
 * off-site.
 */
function cleanLink(v: any): string | null {
  const s = str(v)
  if (!s) return null
  if (!s.startsWith('/') || s.startsWith('//')) return null
  return s.slice(0, 200)
}

export async function GET() {
  const g = await requireLevel('checklist', 'view')
  if (!g.ok) return g.res
  const { day, clock, rows } = await todayList()
  // Only the signals this list actually names, and a failure of any one of them costs a number,
  // never the list.
  const signals = await countSignals(rows.map(r => r.signal || '')).catch(() => ({}))
  return NextResponse.json({
    ok: true, day, clock, rows, signals, progress: progressOf(rows),
    // What this person may do, so the page does not offer buttons that will be refused.
    canTick: atLeast(g.access.levels['checklist'], 'edit'),
    canManage: atLeast(g.access.levels['checklist'], 'full') || isSuperadmin(String(g.access.email || '')),
  })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('checklist', 'edit')
  if (!g.ok) return g.res
  const email = String(g.access.email || '')
  const manage = atLeast(g.access.levels['checklist'], 'full') || isSuperadmin(email)
  const b = await req.json().catch(() => ({}))
  const action = str(b.action)
  const sb = supabaseAdmin()

  try {
    switch (action) {
      // WHOEVER DID IT TICKS IT. done_by records who, so "anyone can tick" never becomes
      // "nobody knows who did it".
      case 'tick': {
        const id = str(b.itemId)
        if (!id) return NextResponse.json({ error: 'Which item?' }, { status: 400 })
        const r = await setTick(id, b.done !== false, email, str(b.note))
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
        // Cheap, best-effort, and only on a write — the read path stays a pure read.
        pruneOldTicks().catch(() => {})
        break
      }

      case 'itemAdd': {
        if (!manage) return NextResponse.json({ error: 'Changing the daily list needs full access.' }, { status: 403 })
        const title = str(b.title)
        if (!title) return NextResponse.json({ error: 'Give it a title.' }, { status: 400 })
        const { error } = await sb.from('daily_checklist_items').insert({
          title: title.slice(0, 200), detail: str(b.detail).slice(0, 1000) || null,
          band: (BANDS as readonly string[]).includes(str(b.band)) ? str(b.band) : 'morning',
          by_time: /^\d{1,2}:\d{2}$/.test(str(b.by_time)) ? str(b.by_time) : null,
          owner_role: str(b.owner_role).slice(0, 60) || null,
          link: cleanLink(b.link) ?? signalLink(str(b.signal)),
          signal: str(b.signal).slice(0, 60) || null,
          sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : null,
          created_by: email,
        })
        if (error) {
          // `column` as well as `relation`: the link and signal fields arrived after the first
          // draft of 091, so a half-migrated database says the column is missing, not the table.
          if (/relation|column|does not exist|schema cache/i.test(error.message)) return NextResponse.json({ error: 'The checklist needs migration 091 — run it in Supabase and this will work.' }, { status: 500 })
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        break
      }

      case 'itemSet': {
        if (!manage) return NextResponse.json({ error: 'Changing the daily list needs full access.' }, { status: 403 })
        const id = str(b.itemId)
        const patch: any = {}
        if (b.title !== undefined) patch.title = str(b.title).slice(0, 200)
        if (b.detail !== undefined) patch.detail = str(b.detail).slice(0, 1000) || null
        if (b.band !== undefined && (BANDS as readonly string[]).includes(str(b.band))) patch.band = str(b.band)
        if (b.by_time !== undefined) patch.by_time = /^\d{1,2}:\d{2}$/.test(str(b.by_time)) ? str(b.by_time) : null
        if (b.owner_role !== undefined) patch.owner_role = str(b.owner_role).slice(0, 60) || null
        if (b.link !== undefined) patch.link = cleanLink(b.link)
        if (b.signal !== undefined) patch.signal = str(b.signal).slice(0, 60) || null
        if (b.sort !== undefined && Number.isFinite(Number(b.sort))) patch.sort = Number(b.sort)
        if (b.active !== undefined) patch.active = !!b.active
        if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
        const { error } = await sb.from('daily_checklist_items').update(patch).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }

      // RETIRE, DO NOT DELETE. An item switched off stops appearing tomorrow morning and takes its
      // ticks with it quietly; deleting would cascade away the record of the days it WAS done.
      case 'itemRetire': {
        if (!manage) return NextResponse.json({ error: 'Changing the daily list needs full access.' }, { status: 403 })
        const { error } = await sb.from('daily_checklist_items').update({ active: false }).eq('id', str(b.itemId))
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }

      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }

    const { day, clock, rows } = await todayList()
    const signals = await countSignals(rows.map(r => r.signal || '')).catch(() => ({}))
    return NextResponse.json({ ok: true, day, clock, rows, signals, progress: progressOf(rows) })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
