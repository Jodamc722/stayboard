// Glitch actions: move along the escalation path, update fields, push a Breezeway task
// for operations (explicit click only), check the pushed task's status, delete.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask, retrieveBreezewayTask, updateBreezewayTask, normalizeTaskStatus, breezewayConfigured } from '@/lib/breezeway'
import { buildIntel } from '@/lib/listingIntel'
import { canDelete, trashRecord } from '@/lib/trash'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'

/** Refunds at or under this need nobody's permission. Editable in app settings. */
async function refundApprovalCap(): Promise<number> {
  try {
    const { getSetting } = await import('@/lib/app-settings')
    const v = await getSetting<any>('glitch_refund_approval_cap', null)
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 150
  } catch { return 150 }
}
export const maxDuration = 30

const STATUSES = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident', 'closed']
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number | null { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
// The task NAME needs the fault, not the sentence. People file glitches in full polite
// sentences ("The guest reported that the sofa is stained. Can we have this cleaned, please?")
// and the old code sliced the first 70 characters of that mid-word into the title. Strip the
// wrapper, keep the substance, cut at a word boundary. Text an operator typed deliberately
// ("Hot water issue") passes through untouched.
function shortIssue(raw: string, category: string): string {
  let t = String(raw || '').trim().replace(/\s+/g, ' ')
  t = t.replace(/^(the\s+)?guests?\s+(has\s+|have\s+)?(reported|said|says|stated|mentioned|complained)\s+(that\s+)?/i, '')
  t = t.replace(/^(please\s+|can\s+(we|you)\s+(please\s+)?(have\s+)?|we\s+need\s+to\s+|there\s+is\s+|there's\s+)/i, '')
  t = t.replace(/[.!?,;:\s]+$/, '')
  // One sentence is a title; two is a report. Keep the first full sentence when there is one.
  const dot = t.search(/[.!?]\s/)
  if (dot >= 12) t = t.slice(0, dot)
  if (t.length > 60) {
    const cut = t.slice(0, 60)
    const sp = cut.lastIndexOf(' ')
    t = cut.slice(0, sp > 30 ? sp : 60).replace(/[.!?,;:\s]+$/, '') + '\u2026'
  }
  if (!t) t = category
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function deptFor(category: string): string {
  const c = category.toLowerCase()
  if (c.startsWith('cleanliness')) return 'housekeeping'
  if (c.includes('safety') || c.includes('security')) return 'safety'
  return 'maintenance'
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'glitches' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('glitches', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const id = str(b.id)
    const action = str(b.action)
    const db = supabaseAdmin()
    if (!id || !action) return NextResponse.json({ ok: false, error: 'id and action required.' }, { status: 400 })
    const { data: g, error: ge } = await db.from('glitches').select('*').eq('id', id).maybeSingle()
    if (ge || !g) return NextResponse.json({ ok: false, error: 'Glitch not found.' }, { status: 404 })
    const hist = Array.isArray(g.history) ? g.history : []
    const stamp = (act: string, extra?: any) => hist.concat([{ at: new Date().toISOString(), by: user.email || 'team', action: act, ...(extra || {}) }])

    if (action === 'move') {
      const status = str(b.status)
      if (STATUSES.indexOf(status) < 0) return NextResponse.json({ ok: false, error: 'Bad status.' }, { status: 400 })
      // STAMP THE CLOSE (Jon, 2026-09-15: "track time of created, to glitch closed ... a KPI").
      // Until migration 085 there was no closure time at all — closing a card only bumped
      // updated_at, so "how long do guest issues take?" was unanswerable, and any later edit
      // moved the only timestamp that existed. Reopening clears it, so a card that bounces back
      // out of Closed is not silently counted as resolved.
      const patch: Record<string, any> = { status, history: stamp('moved', { to: status }), updated_at: new Date().toISOString() }
      if (status === 'closed') {
        if (!g.closed_at) { patch.closed_at = new Date().toISOString(); patch.closed_at_estimated = false }
      } else if (g.closed_at) {
        patch.closed_at = null
        patch.closed_at_estimated = false
      }
      let upd = await db.from('glitches').update(patch).eq('id', id)
      // The columns arrive with migration 085. Until someone runs it, a move must still work.
      if (upd.error && /column|schema/i.test(upd.error.message)) {
        delete patch.closed_at; delete patch.closed_at_estimated
        upd = await db.from('glitches').update(patch).eq('id', id)
      }
      if (upd.error) return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 })
      return NextResponse.json({ ok: true, status })
    }

    // PRIORITY WITHOUT A TASK. Marking something urgent should not require filing a Breezeway job
    // first — the triage decision comes before the work order, not after it.
    if (action === 'priority') {
      const PRIOS_EDIT = ['urgent', 'high', 'normal', 'low']
      const want = str(b.priority)
      if (PRIOS_EDIT.indexOf(want) < 0) return NextResponse.json({ ok: false, error: 'Unknown priority.' }, { status: 400 })
      const { error } = await db.from('glitches')
        .update({ priority: want, history: stamp('priority', { to: want }), updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) {
        const hint = /column|schema/i.test(error.message) ? ' — run migration 086 in Supabase first.' : ''
        return NextResponse.json({ ok: false, error: error.message.slice(0, 200) + hint }, { status: 500 })
      }
      return NextResponse.json({ ok: true, priority: want })
    }

    if (action === 'refund') {
      // LOG THE REFUND where the decision happens. A card used to be droppable into the Refund
      // column with nothing recorded — the money then lived nowhere but someone's memory.
      const amount = Number(b.amount)
      if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ ok: false, error: 'A refund amount is required (0 is allowed for "declined").' }, { status: 400 })
      const note = str(b.note).slice(0, 300)
      // THE APPROVAL LINE (Jon, 2026-09-15). A flat cap for now — he wants it to grow into
      // something that reads the reservation, the channel and the unit's review score, which is
      // why it is a setting read at decision time rather than a constant compiled into the page.
      const cap = await refundApprovalCap()
      const needsApproval = amount > cap
      const patch: Record<string, any> = {
        refund_approved: amount,
        refund_note: note || null,
        refund_needs_approval: needsApproval,
        history: stamp('refund_logged', { amount, note: note || undefined, cap, needsApproval }),
        updated_at: new Date().toISOString(),
      }
      let upd = await db.from('glitches').update(patch).eq('id', id)
      // Migration 085 adds refund_note and refund_needs_approval. Logging money must not depend on
      // somebody having run it — fall back to the shape that has always existed.
      if (upd.error && /column|schema/i.test(upd.error.message)) {
        delete patch.refund_note; delete patch.refund_needs_approval
        upd = await db.from('glitches').update(patch).eq('id', id)
      }
      if (upd.error) return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 })
      return NextResponse.json({ ok: true, amount, needsApproval, cap })
    }

    if (action === 'update') {
      const patch: Record<string, any> = {}
      if (b.overview !== undefined) patch.overview = str(b.overview)
      if (b.category !== undefined) patch.category = str(b.category) || null
      if (b.glitchType !== undefined) patch.glitch_type = str(b.glitchType) || null
      if (b.incidentDate !== undefined) patch.incident_date = str(b.incidentDate) || null
      if (b.refundApproved !== undefined) patch.refund_approved = num(b.refundApproved) || 0
      if (b.reportedBy !== undefined) patch.reported_by = str(b.reportedBy) || null
      if (b.guestEmail !== undefined) patch.guest_email = str(b.guestEmail) || null
      if (b.unit !== undefined) patch.unit = str(b.unit) || null
      if (b.guestName !== undefined) patch.guest_name = str(b.guestName) || null
      if (b.guestPhone !== undefined) patch.guest_phone = str(b.guestPhone) || null
      if (b.channel !== undefined) patch.channel = str(b.channel) || null
      if (Array.isArray(b.photos)) patch.photos = b.photos.filter((x: any) => typeof x === 'string').slice(0, 20)
      // Ownership + scheduling: who is on it, when it is due, extra detail, and how far along.
      // dueDate may sit in the FUTURE - a glitch raised for an upcoming stay is planned work.
      if (b.dueDate !== undefined) patch.due_date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.dueDate)) ? str(b.dueDate) : null
      if (b.assignee !== undefined) patch.assignee = str(b.assignee) || null
      // The outside vendor on it (migration 109). Name kept as a snapshot next to the key.
      if (b.vendorKey !== undefined) patch.vendor_key = str(b.vendorKey) || null
      if (b.vendorName !== undefined) patch.vendor_name = str(b.vendorName).slice(0, 200) || null
      // When they are coming (migration 110). A changed date re-arms "Tell the team" by itself,
      // because vendor_team_told_for no longer matches.
      if (b.vendorVisitOn !== undefined) patch.vendor_visit_on = /^\d{4}-\d{2}-\d{2}$/.test(str(b.vendorVisitOn)) ? str(b.vendorVisitOn) : null
      if (b.vendorVisitWindow !== undefined) patch.vendor_visit_window = str(b.vendorVisitWindow).slice(0, 60) || null
      if (b.assigneePersonId !== undefined) { const pid = Number(b.assigneePersonId); patch.assignee_person_id = Number.isFinite(pid) && pid > 0 ? pid : null }
      // Assigned to an app user (2026-09-22): tell them. The card link opens the board.
      if (b.assigneeEmail && str(b.assignee) && str(b.assignee) !== str(g.assignee)) {
        try {
          const { notify } = await import('@/lib/notify')
          await notify([str(b.assigneeEmail)], {
            kind: 'assignment', actor: user.email || undefined, link: '/glitches',
            title: 'Glitch assigned to you: ' + (str(g.unit) || 'guest issue'),
            body: str(g.overview).split('\n')[0].slice(0, 200),
          })
        } catch { /* the assignment still saves */ }
      }
      // ASSIGN REACHES THE CREW (Jon, 2026-09-02: "should be able to assign"). Saving an owner
      // here used to write only our row — the Breezeway task, the thing the crew actually looks
      // at, kept its old assignee. When the glitch has a task, the assignment now goes there too.
      // Best-effort: a Breezeway hiccup must not lose the rest of the save.
      if (patch.assignee_person_id && g.breezeway_task_id) {
        try { await updateBreezewayTask(String(g.breezeway_task_id), { assignments: [patch.assignee_person_id] }) } catch { /* our row still saves */ }
      }
      // Tone is a human judgement and stays editable — the person who took the call may only think
  // to record it afterwards.
  if (b.guestTone !== undefined) patch.guest_tone = ['understanding','frustrated','angry','fishing'].includes(String(b.guestTone).toLowerCase()) ? String(b.guestTone).toLowerCase() : null
  if (b.reportedVia !== undefined) patch.reported_via = ['message','call','in_person','at_checkout','review','other'].includes(String(b.reportedVia).toLowerCase()) ? String(b.reportedVia).toLowerCase() : null
  if (b.details !== undefined) patch.details = str(b.details).slice(0, 4000) || null
      if (b.progress !== undefined) { const pr = Number(b.progress); patch.progress = (Number.isFinite(pr) && pr >= 0 && pr <= 100) ? Math.round(pr) : null }
      patch.history = stamp('updated')
      patch.updated_at = new Date().toISOString()
      const { error } = await db.from('glitches').update(patch).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // TELL THE TEAM A VENDOR IS COMING (2026-09-25). Posts one line to the building's maintenance
    // room (lib/slack-rules routing, same as every other field alert) and stamps the glitch, so the
    // board can show "Announced" and stop asking. Best-effort on Slack: if the room is not set the
    // stamp is still written and the response says where it went.
    if (action === 'vendorTell') {
      if (!g.vendor_name) return NextResponse.json({ ok: false, error: 'Pick a vendor first.' }, { status: 400 })
      const visit = str(g.vendor_visit_on).slice(0, 10)
      if (!visit) return NextResponse.json({ ok: false, error: 'Set the day they are coming first.' }, { status: 400 })
      const { getSlackRules, groupForBuilding, channelFor } = await import('@/lib/slack-rules')
      const { buildingOf } = await import('@/lib/segments')
      const { postToChannel } = await import('@/lib/slack')
      const rules = await getSlackRules()
      const building = buildingOf(null, str(g.unit)) || null
      const channel = channelFor(rules, groupForBuilding(rules, building), 'maintenance')
      const day = new Date(visit + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
      const text = `🚚 *${str(g.vendor_name)}* is coming to *${str(g.unit) || 'a unit'}* on ${day}${g.vendor_visit_window ? ', ' + str(g.vendor_visit_window) : ''} — ${str(g.category) || 'guest issue'}${g.overview ? ': ' + str(g.overview).replace(/\s+/g, ' ').slice(0, 120) : ''}${g.guest_name ? ` (guest ${str(g.guest_name).split(' ')[0]} in house)` : ''}\n<${base}/glitches?id=${g.id}|Open the glitch>`
      let posted: { ok: boolean; error?: string } = { ok: false, error: 'no maintenance room for ' + (building || 'this unit') }
      if (channel) posted = await postToChannel(channel, text)
      const stamp2 = { vendor_team_told_at: new Date().toISOString(), vendor_team_told_for: visit, history: stamp('vendor announced' + (channel ? ' in ' + channel : '')), updated_at: new Date().toISOString() }
      const { error } = await db.from('glitches').update(stamp2).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, posted: posted.ok, channel, error: posted.ok ? undefined : posted.error })
    }

    if (action === 'push') {
      if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway not configured.' }, { status: 503 })
      if (g.breezeway_task_id) return NextResponse.json({ ok: false, error: 'Already pushed (task ' + g.breezeway_task_id + ').' }, { status: 400 })
      const category = str(g.category) || 'Other'

      // ── WHERE THE TASK FILES ── override > linked listing > the typed unit name. Resolved
      // FIRST because everything downstream (the unit-history intel, the write-back) wants to
      // know which listing this actually is.
      const overrideHome = Number(b.homeId)
      let homeId: number | null = null
      let refListing: string | null = g.listing_id ? String(g.listing_id) : null
      if (Number.isFinite(overrideHome) && overrideHome > 0) {
        homeId = overrideHome
        refListing = null   // building-level override: "this unit" means nothing here
      } else if (refListing) {
        const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', refListing).limit(1)
        const hid = Number(((props || [])[0] || {}).home_id)
        if (Number.isFinite(hid)) homeId = hid
      } else {
        // THE 2026-09-02 BUG. A glitch filed with a typed unit ("Rustic 24") but no linked listing
        // reached Breezeway with no property at all — 422, raw JSON at the operator. Exact-token
        // match against the property list ("Rustic 24" finds "Rustic 24 - 2BR", never "Rustic
        // 241"); when it matches, the listing link is also WRITTEN BACK to the glitch, so the
        // calendar, intel and every later feature see the unit from now on.
        const unitName = str(g.unit).trim()
        if (unitName) {
          const toks = unitName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
          const { data: cand } = await db.from('breezeway_properties').select('home_id, name, status, reference_property_id').limit(1000)
          const hits = ((cand || []) as any[]).filter(p => {
            if (String(p.status || '').toLowerCase() !== 'active') return false
            const ptoks = String(p.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
            return toks.every(t => ptoks.indexOf(t) >= 0)
          })
          if (hits.length === 1) {
            homeId = Number(hits[0].home_id)
            if (hits[0].reference_property_id) refListing = String(hits[0].reference_property_id)
          }
        }
        if (homeId == null) {
          return NextResponse.json({ ok: false, error: 'This glitch is not linked to a unit' + (unitName ? ' and \u201c' + unitName + '\u201d does not match exactly one Breezeway property' : '') + '. Type the right property into the Property box on this panel, or Edit the glitch and set the unit, then push again.' }, { status: 400 })
        }
      }

      // ── THE NAME ── "Guest Reported / Glitch - <issue>" (matches the built Breezeway template
      // and the Today-in-Ops matcher), with the issue cut to a title, not a paragraph.
      const issue = shortIssue(str(b.issue).trim() || str(g.overview).split('\n')[0], category)
      const title = 'Guest Reported / Glitch - ' + issue

      // ── THE DETAILS ── (Jon, 2026-09-02: "improve the way the details are organized once the
      // task is created — it looks clunky"). The facts a tech scans for sit in labelled lines at
      // the top; the guest's words are quoted under their own heading, never mixed into the
      // metadata; the unit's history gets its own section. Empty facts leave no blank lines.
      const RULE = '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
      const facts: string[] = []
      if (g.unit) facts.push('Unit: ' + str(g.unit))
      facts.push('Category: ' + category)
      if (g.incident_date) facts.push('Incident: ' + str(g.incident_date))
      if (g.guest_name) facts.push('Guest: ' + str(g.guest_name) + (g.guest_phone ? ' \u00b7 ' + str(g.guest_phone) : ''))
      if (g.check_in) facts.push('Stay: ' + str(g.check_in) + ' \u2192 ' + (str(g.check_out) || '?') + (g.channel ? ' \u00b7 ' + str(g.channel) : ''))
      if (g.reported_via) facts.push('Reported via: ' + str(g.reported_via).replace(/_/g, ' '))
      if (g.reported_by) facts.push('Filed by: ' + str(g.reported_by))
      if (g.guest_tone) facts.push('Guest tone: ' + str(g.guest_tone))
      const parts: string[] = ['GUEST-REPORTED GLITCH \u00b7 from the Lighthouse board', RULE, facts.join('\n')]
      const said = str(g.overview).trim()
      if (said) { parts.push(''); parts.push('WHAT THE GUEST SAID'); parts.push(RULE); parts.push(said) }
      // Unit history & access — has this fault been worked here before, can the tech get in now.
      // Best-effort, skipped for building-level overrides.
      if (refListing) {
        try {
          const intel = await buildIntel(refListing, { kind: 'maintenance', taskName: title })
          if (intel) { parts.push(''); parts.push('UNIT HISTORY & ACCESS'); parts.push(RULE); parts.push(String(intel).trim()) }
        } catch (e) { console.error('glitch push: intel failed', e) }
      }

      // Instantiate the built Breezeway "Guest Reported / Glitch -" TEMPLATE (id 356707) so pushed
      // tasks carry the template's checklist/settings.
      const GLITCH_TEMPLATE_ID = 356707
      // THE FORM DECIDES THESE, NOT THIS FILE (Jon, 2026-09-15: the Breezeway task "should be
      // easier to manage, assign, etc ... function like the today in ops add task form").
      //
      // Department, priority and date used to be fixed here: every glitch went out as `urgent`,
      // scheduled for today, in whatever department the category implied — and the due date the
      // card itself carried was never sent, so a job planned for Thursday arrived as a fire. The
      // old behaviour is still the default; it is just no longer the only option.
      const DEPTS = ['housekeeping', 'maintenance', 'safety', 'inspection']
      const PRIOS = ['urgent', 'high', 'normal', 'low']
      const dept = DEPTS.indexOf(str(b.department)) >= 0 ? str(b.department) : deptFor(category)
      const prio = PRIOS.indexOf(str(b.priority)) >= 0 ? str(b.priority) : 'urgent'
      const wantDate = /^\d{4}-\d{2}-\d{2}$/.test(str(b.scheduledDate)) ? str(b.scheduledDate)
        : (/^\d{4}-\d{2}-\d{2}$/.test(str(g.due_date)) ? str(g.due_date) : ymd(new Date()))
      const payload: Record<string, any> = { template_id: GLITCH_TEMPLATE_ID, name: title, type_department: dept, type_priority: prio, scheduled_date: wantDate, description: parts.join('\n'), home_id: homeId }
      let r = await createBreezewayTask(payload)
      if (!r.ok) {
        // some API versions reject template_id on create — retry without it rather than failing
        delete payload.template_id
        r = await createBreezewayTask(payload)
      }
      if (!r.ok || !r.data?.id) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
      const taskId = String(r.data.id)
      // optional assignee picked at push time
      // ASSIGNMENT IS A SECOND CALL — Breezeway does not take assignees on create — and it used to
      // be swallowed whole. A task could be created with nobody on it and the board would report a
      // clean success, so the work sat unassigned while the card said it had been filed. The task
      // still stands if this fails (it exists, it is just unassigned), but now we say so.
      const ids = (Array.isArray(b.assigneeIds) ? b.assigneeIds : []).map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      let assignError = ''
      let assignedName = ''
      if (ids.length) {
        try {
          const ar = await updateBreezewayTask(taskId, { assignments: ids })
          if (!ar.ok) assignError = 'Task created, but assigning it failed: ' + String(ar.text || '').slice(0, 120)
          else assignedName = str(b.assigneeName)
        } catch (e: any) {
          assignError = 'Task created, but assigning it failed: ' + str(e?.message || e).slice(0, 120)
        }
      }
      const patch: Record<string, any> = { breezeway_task_id: taskId, status: g.status === 'pool' ? 'ops' : g.status,
        due_date: wantDate,
        // What was actually filed becomes what the card says (migration 086). Priority used to be
        // chosen here and forgotten a moment later, so the board could never show which issues
        // jump the queue — the one thing you want to know without opening a card.
        priority: prio,
        ...(assignedName ? { assignee: assignedName, assignee_person_id: ids[0] } : {}), history: stamp('pushed_to_breezeway', Number.isFinite(overrideHome) && overrideHome > 0 ? { taskId, homeId: overrideHome, property: str(b.homeName) || undefined } : { taskId }), updated_at: new Date().toISOString() }
      // The name-match earned a real listing link — keep it, so this glitch never needs matching again.
      if (!g.listing_id && refListing) patch.listing_id = refListing
      let pu = await db.from('glitches').update(patch).eq('id', id)
      // priority arrives with migration 086. A task that reached Breezeway must not be reported as
      // a failure because our own column is not there yet.
      if (pu.error && /column|schema/i.test(pu.error.message)) {
        delete patch.priority
        pu = await db.from('glitches').update(patch).eq('id', id)
      }
      if (pu.error) return NextResponse.json({ ok: false, error: pu.error.message }, { status: 500 })
      return NextResponse.json({ ok: true, taskId, reportUrl: r.data.report_url || null, assignError: assignError || undefined, scheduledDate: wantDate })
    }

    if (action === 'checkTask') {
      if (!g.breezeway_task_id) return NextResponse.json({ ok: false, error: 'No Breezeway task on this glitch.' }, { status: 400 })
      const r = await retrieveBreezewayTask(g.breezeway_task_id)
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 120) }, { status: 502 })
      const st = normalizeTaskStatus(r.data)
      return NextResponse.json({ ok: true, taskStatus: st, suggestFollowup: (st === 'completed' || st === 'approved') && (g.status === 'ops' || g.status === 'pool') })
    }

    if (action === 'delete') {
      // WAS: gated on the admin SHARE password — which had never been set, so this button's real
      // behaviour was "Delete is locked", permanently, discoverable only by pressing it. Now it is
      // gated on being an admin (you already signed in) and the row is photographed into the
      // graveyard first, so Restore is a real button. The Breezeway task, if any, is untouched.
      const who = await canDelete()
      if (!who.ok) return NextResponse.json({ ok: false, error: who.reason }, { status: 403 })
      const r = await trashRecord(db, 'glitch', id, who.email)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
      return NextResponse.json({ ok: true, deleted: true, trashId: r.trashId, label: r.label })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
