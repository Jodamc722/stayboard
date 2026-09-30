// OPEN LOOPS — what Eve is keeping tabs on, as a page instead of a wall in Slack.
//
// Jon, 2026-09-28, on the "Keeping tabs" roll-up: "where does this live? The long Slack post is not
// super helpful at all." It lives here. The Slack roll-up is now the six things that need a person
// today with a link to this page; everything else is read, filtered and closed on /loops.
//
//   GET  ?status=open|closed&days=N   → items with a Slack link each
//   PATCH { id, action: 'close' | 'dismiss' | 'reopen' | 'owner' | 'nudge', reason?, owner? }
//
// 'close' = it got done (counts as a win for the person on it). 'dismiss' = not a real loop (the
// watcher over-read a line) — same closed status, a reason that says so, and the watcher learns
// nothing from it. 'nudge' posts Eve's gentle ask in the thread now, through the slack_post rung.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { nudgeText } from '@/lib/eve/slack-watch'
import { askNudgeText, ageMinutes } from '@/lib/eve/ccs-desk'
import { agentAllowed, stepDown } from '@/lib/eve/agent-mode'
import { postThreadReply } from '@/lib/slack'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireLevel('loops', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') === 'closed' ? 'closed' : 'open'
  const days = Math.min(30, Math.max(1, Number(sp.get('days')) || 2))
  const db = supabaseAdmin()
  let q = db.from('eve_slack_items').select('*').eq('status', status)
  q = status === 'open' ? q.order('first_seen', { ascending: false }).limit(500) : q.gte('closed_at', new Date(Date.now() - days * 86400000).toISOString()).order('closed_at', { ascending: false }).limit(300)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message, items: [] })
  const items = ((data || []) as any[]).map(i => ({ ...i, link: `https://slack.com/archives/${i.channel}/p${String(i.msg_ts).replace('.', '')}${i.thread_ts && i.thread_ts !== i.msg_ts ? `?thread_ts=${i.thread_ts}&cid=${i.channel}` : ''}` }))
  return NextResponse.json({ ok: true, items })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireLevel('loops', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const id = String(b?.id || ''), action = String(b?.action || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseAdmin()
  const by = gate.access.email || 'someone'
  const { data: it } = await db.from('eve_slack_items').select('*').eq('id', id).maybeSingle()
  if (!it) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const now = new Date().toISOString()
  if (action === 'close' || action === 'dismiss') {
    const reason = action === 'dismiss' ? `dismissed by ${by}: ${String(b?.reason || 'not a real loop').slice(0, 120)}` : `${by}: ${String(b?.reason || 'done').slice(0, 120)}`
    const { error } = await db.from('eve_slack_items').update({ status: 'closed', closed_reason: reason, closed_at: now }).eq('id', id)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }
  if (action === 'reopen') {
    const { error } = await db.from('eve_slack_items').update({ status: 'open', closed_reason: null, closed_at: null }).eq('id', id)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }
  if (action === 'owner') {
    const owner = String(b?.owner || '').trim().slice(0, 80) || null
    const { error } = await db.from('eve_slack_items').update({ owner_name: owner, owner_slack: null }).eq('id', id)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }
  if (action === 'nudge') {
    const who = it.owner_slack ? `<@${it.owner_slack}>` : (it.owner_name || null)
    const text = it.kind === 'guest_ask' ? askNudgeText(it as any, who, ageMinutes(it as any)) : nudgeText(it as any, who)
    const g = await agentAllowed('slack_post')
    const r = await stepDown(g, { action: 'slack_post', summary: `nudge (asked by ${by}) in #${it.channel_name}: ${text.slice(0, 120)}`, exec: { channel: it.channel, channel_name: it.channel_name, thread_ts: it.thread_ts || it.msg_ts, text }, by: 'panel', actor: by },
      async () => { const p = await postThreadReply(it.channel, it.thread_ts || it.msg_ts, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
    if (r.ok && r.mode !== 'observe') await db.from('eve_slack_items').update({ nudged_at: now, nudge_count: (Number(it.nudge_count) || 0) + 1 }).eq('id', id)
    return NextResponse.json({ ok: r.ok, mode: r.mode, error: r.error })
  }
  // TEACHING HER THE MATCH (Jon, 2026-09-30: "constantly improving and learning and making permanent
  // improvements"). A person pins the right Breezeway task ('link_task', a task id or URL), or says
  // the one she picked is wrong ('unlink_task', with why). Either way the correction is written into
  // her match-lesson book and her memory (lib/eve/match-lessons), and she reads it on every future
  // investigation. 'investigate' re-runs her investigation now.
  if (action === 'link_task' || action === 'unlink_task' || action === 'investigate') {
    const { recordMatchLesson } = await import('@/lib/eve/match-lessons')
    const { investigateLoop, refsIn } = await import('@/lib/eve/investigate')
    const ev: any = { ...(it.evidence || {}) }
    const pickedName = ev.taskId ? `Breezeway task ${ev.taskId}${ev.taskName ? ' "' + String(ev.taskName).slice(0, 60) + '"' : ''}` : null
    const why = String(b?.why || b?.reason || '').slice(0, 300)
    if (action === 'unlink_task') {
      delete ev.taskId; delete ev.taskName; delete ev.matchedBy; ev.manualTask = null
      if (ev.investigation) ev.investigation = { ...ev.investigation, taskId: null, confidence: 0, reasoning: 'Unlinked by ' + by + (why ? ': ' + why : '') }
      const { error } = await db.from('eve_slack_items').update({ evidence: ev, tracked_in: null }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await recordMatchLesson({ by, report: String(it.summary || ''), unit: it.unit || null, picked: pickedName, right: null, why: why || 'that task was not the fix for this report' })
      return NextResponse.json({ ok: true })
    }
    if (action === 'link_task') {
      const raw = String(b?.task || '').trim()
      const tid = (refsIn(raw).tasks[0] || (/^\d{5,}$/.test(raw) ? raw : ''))
      if (!tid) return NextResponse.json({ error: 'Paste a Breezeway task link or number.' }, { status: 400 })
      const inv = await investigateLoop({ ...(it as any), evidence: { ...ev, text: String(ev.text || '') + ' breezeway.io/task/' + tid } }, { force: true })
      const next: any = { ...ev, taskId: tid, taskName: inv?.task?.name || null, matchedBy: 'linked by ' + by, manualTask: tid, investigation: inv || ev.investigation || null }
      const patch: any = { evidence: next, tracked_in: 'breezeway:' + tid }
      if (inv?.listingId && inv.listingId !== it.listing_id) { patch.listing_id = inv.listingId; if (inv.unit) { patch.unit = inv.unit; patch.building = inv.unit } }
      const { error } = await db.from('eve_slack_items').update(patch).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await recordMatchLesson({ by, report: String(it.summary || ''), unit: inv?.unit || it.unit || null, picked: pickedName, right: `Breezeway task ${tid}${inv?.task?.name ? ' "' + inv.task.name.slice(0, 60) + '"' : ''}`, why: why || (pickedName ? 'the one I had picked was wrong' : 'I had not found it') })
      return NextResponse.json({ ok: true, investigation: inv })
    }
    const inv = await investigateLoop(it as any, { force: true })
    if (inv) {
      const sure = inv.method === 'linked' || inv.confidence >= 0.7
      const next: any = { ...ev, investigation: inv }
      if (sure && inv.taskId) { next.taskId = inv.taskId; next.taskName = inv.task?.name || null; next.matchedBy = inv.method === 'linked' ? 'linked in the Slack message' : 'Eve investigated: ' + inv.reasoning.slice(0, 200) }
      if (sure && inv.glitchId) next.glitchId = inv.glitchId
      const patch: any = { evidence: next }
      if (sure && inv.taskId) patch.tracked_in = 'breezeway:' + inv.taskId
      if (sure && inv.listingId && inv.listingId !== it.listing_id) { patch.listing_id = inv.listingId; if (inv.unit) { patch.unit = inv.unit; patch.building = inv.unit } }
      await db.from('eve_slack_items').update(patch).eq('id', id)
    }
    return NextResponse.json({ ok: true, investigation: inv })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
