// HANDOFF ALERTS API (lib/handoff, lib/handoff-store). Any Stay Hospitality login.
// GET  → { mine (my banner: fired, open, for me, not confirmed), open (every open alert, with who has
//          confirmed), team, roles, channels, me }
// POST { action: 'create', alert } · { action: 'ack', id } · { action: 'close', id } (writer or admin)
//      · { action: 'resolve', id, note?, attach? } (anyone it reached: closes it for everyone; note onto the glitch)
//      · { action: 'fire', id } (writer or admin: send it now instead of waiting for its time)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireVrUser } from '@/lib/vr-gate'
import { isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { makeAlert, bannerFor, fyiFor, isOpen, isFor, mark, withTagged, GROUP_EVERYONE, type Alert } from '@/lib/handoff'
import { readAlerts, writeAlerts, teamDirectory, runHandoffs, mentionsFor, resolveAlert } from '@/lib/handoff-store'
import { HANDOFF_CHANNELS } from '@/lib/slack-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const nameOf = (a: any) => String(a.profile?.name || (a.email ? String(a.email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Someone'))
const isLeader = (a: any) => isSuperadmin(a.email) || a.role === 'admin'
const meOf = (a: any) => ({ email: String(a.email || '').toLowerCase(), role: a.role === 'admin' ? 'admin' : (a.accessRole || null) })

async function roleList(): Promise<{ key: string; label: string }[]> {
  try {
    const { data } = await supabaseAdmin().from('app_roles').select('key,label,sort').order('sort', { ascending: true })
    return ((data || []) as any[]).map(r => ({ key: String(r.key), label: String(r.label || r.key) }))
  } catch { return [] }
}

function view(alerts: Alert[], a: any) {
  const me = meOf(a)
  const now = Date.now()
  return {
    ok: true, me: me.email, leader: isLeader(a),
    mine: bannerFor(alerts, me),
    // QUIET (2026-10-07): Eve's alerts this person has not opened — a small dot on the bell, no pop-up.
    fyi: fyiFor(alerts, me).map(x => x.id),
    // The bell: open alerts (and the last day's closed) that are for me, that I wrote, or — for an
    // admin — all of them. Newest first. Fired ones only, plus my own scheduled ones.
    open: alerts.filter(x => (isOpen(x) || (x.closedAt && now - Date.parse(x.closedAt) < 86400_000))
      && (isLeader(a) || x.byEmail === me.email || (x.firedAt && isFor(x, me))))
      .sort((x, y) => String(y.firedAt || y.fireAt).localeCompare(String(x.firedAt || x.fireAt))).slice(0, 40),
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const alerts = await readAlerts()
  const out: any = view(alerts, gate.access)
  // The form's lists only when asked (the banner polls without them).
  out.channels = HANDOFF_CHANNELS
  if (req.nextUrl.searchParams.get('form') === '1') {
    const [team, roles] = await Promise.all([teamDirectory(), roleList()])
    out.team = team.map(t => ({ email: t.email, name: t.name, role: t.role })).sort((x, y) => x.name.localeCompare(y.name))
    out.roles = roles
  }
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const a = gate.access
  const me = meOf(a)
  const b = await req.json().catch(() => ({} as any))
  const action = String(b?.action || '')
  const alerts = await readAlerts()
  const nowIso = new Date().toISOString()
  const deny = (m: string, s = 403) => NextResponse.json({ ok: false, error: m }, { status: s })
  let fireNow = false

  if (action === 'create') {
    const al = makeAlert({ ...(b?.alert || {}), source: 'person' }, { name: nameOf(a), email: me.email }, randomUUID(), nowIso)
    if (!al) return deny('Write what the team needs to know.', 400)
    alerts.unshift(al)
    fireNow = Date.parse(al.fireAt) <= Date.now()
  } else {
    const al = alerts.find(x => x.id === String(b?.id || ''))
    if (!al) return deny('That alert is gone.', 404)
    const mine = al.byEmail === me.email || isLeader(a)
    const i = alerts.indexOf(al)
    if (action === 'seen' || action === 'read' || action === 'ack') {
      alerts[i] = mark(al, me.email, nameOf(a), action, nowIso)
      if (action === 'ack') alerts[i].ackNames = { ...(al.ackNames || {}), [me.email]: nameOf(a) }
    } else if (action === 'comment') {
      const text = String(b?.text || '').trim().slice(0, 1000)
      if (!text) return deny('Write something first.', 400)
      // TAGGED PEOPLE (Jon, 2026-10-07). Only real teammates, and never a tag that silently does
      // nothing: each one is added to the alert so it lands in their bell, and @-mentioned in the
      // Slack thread. Tagging yourself is dropped — you are already reading it.
      const want = (Array.isArray(b?.mentions) ? b.mentions : []).map((e: any) => String(e || '').toLowerCase().trim()).filter((e: string) => /@/.test(e)).slice(0, 10)
      // GROUPS expand to people here, once, at post time (Jon, 2026-10-07). What gets recorded is
      // both: the group that was tagged, so the comment still reads "@Customer service", and the
      // people it actually reached, so the alert's recipient list is a fact rather than a lookup
      // that would answer differently next year.
      const groupKeys = (Array.isArray(b?.groups) ? b.groups : []).map((g: any) => String(g || '').trim()).filter(Boolean).slice(0, 6)
      const dir = (want.length || groupKeys.length) ? await teamDirectory() : []
      const picked = new Map<string, { email: string; name: string }>()
      for (const t of dir) if (want.includes(t.email)) picked.set(t.email, { email: t.email, name: t.name })
      const groupLabels: Record<string, string> = {}
      if (groupKeys.length) {
        const roles = await roleList()
        for (const g of groupKeys) {
          if (g === GROUP_EVERYONE) {
            groupLabels[g] = 'Everyone'
            for (const t of dir) picked.set(t.email, { email: t.email, name: t.name })
            continue
          }
          const r = roles.find(x => x.key === g)
          if (!r) continue
          groupLabels[g] = r.label
          for (const t of dir) if (t.role === g) picked.set(t.email, { email: t.email, name: t.name })
        }
      }
      picked.delete(me.email)
      const tagged = Array.from(picked.values()).slice(0, 60)
      const c = {
        id: randomUUID(), by: nameOf(a), byEmail: me.email, text, at: nowIso,
        ...(tagged.length ? { mentions: tagged.map(t => t.email), mentionNames: Object.fromEntries(tagged.map(t => [t.email, t.name])) } : {}),
        ...(Object.keys(groupLabels).length ? { groups: Object.keys(groupLabels), groupLabels } : {}),
      }
      const withC = { ...mark(al, me.email, nameOf(a), 'read', nowIso), comments: [...(al.comments || []), c].slice(-100) }
      alerts[i] = withTagged(withC, tagged)
      // The conversation follows the alert into Slack: a reply on its thread, tagging whoever the
      // comment tagged so they are told where the question is, not just that there is one.
      if (al.channel && al.slackTs) {
        try {
          const { postThreadReply } = await import('@/lib/slack')
          // A group of twenty people does not need twenty @s on one line: name the group, tag at
          // most ten, and say how many more it reached.
          const names = Object.values(groupLabels)
          const head = names.length ? names.map(n => '@' + n).join(' ') + ' — ' : ''
          const who = tagged.length ? await mentionsFor(tagged.slice(0, 10)) : ''
          const more = tagged.length > 10 ? ` +${tagged.length - 10} more` : ''
          const tail = (head || who) ? `\n${head}${who}${more} — you were tagged on this.` : ''
          await postThreadReply(al.channel, al.slackTs, `💬 *${c.by}:* ${text}` + tail)
        } catch { /* Lighthouse has it either way */ }
      }
    } else if (action === 'resolve') {
      // RESOLVED FOR EVERYONE (Jon, 2026-10-07). Anyone it reached — not only its writer — can say it
      // is handled. It closes for everybody, with who and why; the note goes onto the glitch when
      // the alert is about one (attach defaults on).
      if (!(mine || isFor(al, me))) return deny('Only someone this alert reached can resolve it.')
      if (al.closedAt) return deny('Already closed.', 400)
      const note = String(b?.note || '').trim().slice(0, 600)
      await resolveAlert(al, { name: nameOf(a), email: me.email }, note, b?.attach !== false)
      alerts[i] = mark(al, me.email, nameOf(a), 'read', nowIso)
    } else if (action === 'close') {
      if (!mine) return deny('Only whoever wrote it or an admin can close it.')
      al.closedAt = nowIso; al.closedBy = nameOf(a)
    } else if (action === 'fire') {
      if (!mine) return deny('Only whoever wrote it or an admin can send it early.')
      if (!al.firedAt) { al.fireAt = nowIso; fireNow = true }
    } else return deny('Unknown action.', 400)
  }
  const saved = await writeAlerts(alerts, me.email)
  if (!saved.ok) return NextResponse.json({ ok: false, error: 'Could not save: ' + saved.error }, { status: 500 })
  // "Now" means now — post it straight away rather than on the next 5-minute tick.
  if (fireNow) { try { await runHandoffs() } catch { /* the cron picks it up */ } }
  return NextResponse.json({ ...view(await readAlerts(), a), channels: HANDOFF_CHANNELS })
}
