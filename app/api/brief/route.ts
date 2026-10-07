// THE SHIFT BRIEF API (lib/shift-brief). Any Stay Hospitality login.
// GET  → { mine, pool, team, lastCloseout, me }
// POST { action: 'add', item } · { action: 'tick', id } · { action: 'pass', id, to: email|'pool', note }
//      · { action: 'claim', id } · { action: 'note', id, note } · { action: 'remove', id } · { action: 'seen' }
//      · { action: 'due', id, due, remind } — set or clear the date, arming/cancelling the reminder
//      · { action: 'closeout', note?, slack?: boolean } — refused while anything of mine is still open
// Stored as one JSON value in app_settings ('shift_brief'); every write reads it fresh.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { setSetting } from '@/lib/app-settings'
import { teamDirectory, scheduleBriefReminder, cancelBriefReminder } from '@/lib/handoff-store'
import {
  type BriefStore, type BriefItem, newItem, mineOf, poolOf, tick, pass, claim, addNote, openOf, closeoutOf, pruneBrief,
  dueIso, cleanLink, setDue,
} from '@/lib/shift-brief'

export const dynamic = 'force-dynamic'
const KEY = 'shift_brief'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')

async function read(): Promise<BriefStore> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY).limit(1)
    const raw = (data as any)?.[0]?.value
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { items: Array.isArray(j?.items) ? j.items : [], closeouts: Array.isArray(j?.closeouts) ? j.closeouts : [] }
  } catch { return { items: [], closeouts: [] } }
}
const nameOf = (a: any) => String(a.profile?.name || (a.email ? String(a.email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Someone'))

function view(s: BriefStore, me: { email: string; name: string }, team?: any[]) {
  const last = s.closeouts.filter(c => c.byEmail === me.email).sort((a, b) => b.at.localeCompare(a.at))[0] || null
  const lastAny = s.closeouts.slice().sort((a, b) => b.at.localeCompare(a.at))[0] || null
  return { ok: true, me: me.email, mine: mineOf(s.items, me.email), pool: poolOf(s.items), lastCloseout: last, lastTeamCloseout: lastAny, ...(team ? { team } : {}) }
}

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const me = { email: String(gate.access.email || '').toLowerCase(), name: nameOf(gate.access) }
  const s = await read()
  const team = req.nextUrl.searchParams.get('team') === '1' ? (await teamDirectory()).map(t => ({ email: t.email, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)) : undefined
  return NextResponse.json(view(s, me, team))
}

/** Arm (or re-arm) the item's reminder for whoever holds it. Null when there is nothing to arm. */
async function armReminder(i: BriefItem, by: { email: string; name: string }): Promise<string | null> {
  if (!i.due || !i.remind || !i.owner) return null
  if (Date.parse(i.due) <= Date.now()) return null          // already past: no point waking anyone
  const about = i.link ? i.link.label : (i.unit || null)
  return scheduleBriefReminder({
    title: i.text,
    body: 'From your shift brief' + (about ? ' · ' + about : '') + (i.passNote ? '\n' + i.passNote : ''),
    fireAt: i.due, forEmail: i.owner, unit: about, by,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const me = { email: String(gate.access.email || '').toLowerCase(), name: nameOf(gate.access) }
  const b = await req.json().catch(() => ({} as any))
  const action = String(b?.action || '')
  const s = await read()
  const now = new Date().toISOString()
  const deny = (m: string, st = 400) => NextResponse.json({ ok: false, error: m }, { status: st })
  const idx = s.items.findIndex(i => i.id === String(b?.id || ''))
  const it = idx >= 0 ? s.items[idx] : null

  if (action === 'add') {
    const team = b?.item?.owner && b.item.owner !== 'pool' ? await teamDirectory() : []
    const ownerName = team.find(t => t.email === String(b.item.owner).toLowerCase())?.name || null
    const n = newItem({ ...(b?.item || {}), ownerName }, me, randomUUID(), now)
    if (!n) return deny('Write what needs doing.')
    // The reminder is an alert, armed for whoever holds the item (nobody holds a pool item, so a
    // pool item gets no reminder — there is no one to remind).
    if (n.due && n.remind && n.owner) n.alertId = await armReminder(n, me)
    s.items.push(n)
  } else if (action === 'seen') {
    s.items = s.items.map(i => i.owner === me.email && !i.seenByOwner ? { ...i, seenByOwner: true } : i)
  } else if (action === 'closeout') {
    const open = openOf(s.items, me.email)
    if (open.length) return deny(open.length + ' item' + (open.length === 1 ? ' is' : 's are') + ' still open — tick them off or pass them over first.')
    const since = s.closeouts.filter(c => c.byEmail === me.email).sort((a, b) => b.at.localeCompare(a.at))[0]?.at || new Date(Date.now() - 16 * 3600_000).toISOString()
    const c = closeoutOf(s.items, me, since, b?.note || null, randomUUID(), now)
    if (b?.slack) {
      try {
        const [{ postToChannel }, { EVE_CHANNELS }] = await Promise.all([import('@/lib/slack'), import('@/lib/slack-rules')])
        const lines = [
          `📋 *Shift close-out — ${me.name}*`,
          c.done.length ? `*Done (${c.done.length}):*\n` + c.done.slice(0, 15).map(t => '• ' + t).join('\n') : 'Nothing ticked off this shift.',
          c.passed.length ? `*Passed over (${c.passed.length}):*\n` + c.passed.slice(0, 15).map(p => '• ' + p.text + ' → ' + p.to).join('\n') : '',
          c.note ? `*Note:* ${c.note}` : '',
          `<${APP_URL}/command|Open the brief in Lighthouse>`,
        ].filter(Boolean).join('\n')
        const r = await postToChannel(EVE_CHANNELS.ccsJon, lines)
        if (r.ok) c.slackTs = r.ts || null
      } catch { /* the close-out stands without Slack */ }
    }
    s.closeouts.push(c)
  } else {
    if (!it) return deny('That item is gone.', 404)
    if (action === 'remove') {
      // Added by mistake: whoever wrote it or whoever holds it can take it off.
      if (it.byEmail !== me.email && it.owner !== me.email) return deny('Only whoever added it or holds it can remove it.', 403)
      s.items.splice(idx, 1)
    }
    else if (action === 'tick') {
      s.items[idx] = tick(it, me.name, now)
      // Ticked off: no reminder should arrive for work that is finished.
      if (s.items[idx].status === 'done') { await cancelBriefReminder(it.alertId); s.items[idx].alertId = null }
    }
    else if (action === 'due') {
      if (it.owner !== me.email && it.byEmail !== me.email) return deny('Only whoever holds it can change the date.', 403)
      const due = dueIso(b?.due)
      const remind = b?.remind !== false
      await cancelBriefReminder(it.alertId)
      const next = setDue(it, due, remind, me.name, now)
      next.alertId = due && remind && next.owner ? await armReminder(next, me) : null
      s.items[idx] = next
    }
    else if (action === 'note') { const n = String(b?.note || '').trim(); if (!n) return deny('Write a note.'); s.items[idx] = addNote(it, me.name, n, now) }
    else if (action === 'claim') {
      if (it.owner) return deny('Someone already has it.', 409)
      const c = claim(it, me, now)
      c.alertId = c.due && c.remind ? await armReminder(c, me) : null
      s.items[idx] = c
    }
    else if (action === 'pass') {
      const toPool = !b?.to || b.to === 'pool'
      let to = { email: null as string | null, name: null as string | null }
      if (!toPool) {
        const t = (await teamDirectory()).find(x => x.email === String(b.to).toLowerCase())
        if (!t) return deny('Pick someone on the team.')
        to = { email: t.email, name: t.name }
      }
      const moved = pass(it, to, me.name, b?.note || null, now)
      // The reminder belongs to whoever holds the item, so it moves with it.
      await cancelBriefReminder(it.alertId)
      moved.alertId = moved.due && moved.remind && moved.owner ? await armReminder(moved, me) : null
      s.items[idx] = moved
    } else return deny('Unknown action.')
  }
  const saved = await setSetting(KEY, pruneBrief(s), me.email)
  if (!saved.ok) return NextResponse.json({ ok: false, error: 'Could not save: ' + saved.error }, { status: 500 })
  return NextResponse.json(view(s, me))
}
