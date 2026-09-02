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
      const { error } = await db.from('glitches').update({ status, history: stamp('moved', { to: status }), updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, status })
    }

    if (action === 'refund') {
      // LOG THE REFUND where the decision happens. A card used to be droppable into the Refund
      // column with nothing recorded — the money then lived nowhere but someone's memory.
      const amount = Number(b.amount)
      if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ ok: false, error: 'A refund amount is required (0 is allowed for "declined").' }, { status: 400 })
      const note = str(b.note).slice(0, 300)
      const { error } = await db.from('glitches').update({
        refund_approved: amount,
        history: stamp('refund_logged', { amount, note: note || undefined }),
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, amount })
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
      if (b.assigneePersonId !== undefined) { const pid = Number(b.assigneePersonId); patch.assignee_person_id = Number.isFinite(pid) && pid > 0 ? pid : null }
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
      const payload: Record<string, any> = { template_id: GLITCH_TEMPLATE_ID, name: title, type_department: deptFor(category), type_priority: 'urgent', scheduled_date: ymd(new Date()), description: parts.join('\n'), home_id: homeId }
      let r = await createBreezewayTask(payload)
      if (!r.ok) {
        // some API versions reject template_id on create — retry without it rather than failing
        delete payload.template_id
        r = await createBreezewayTask(payload)
      }
      if (!r.ok || !r.data?.id) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
      const taskId = String(r.data.id)
      // optional assignee picked at push time
      const ids = (Array.isArray(b.assigneeIds) ? b.assigneeIds : []).map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      if (ids.length) { try { await updateBreezewayTask(taskId, { assignments: ids }) } catch { /* assign best-effort */ } }
      const patch: Record<string, any> = { breezeway_task_id: taskId, status: g.status === 'pool' ? 'ops' : g.status, history: stamp('pushed_to_breezeway', Number.isFinite(overrideHome) && overrideHome > 0 ? { taskId, homeId: overrideHome, property: str(b.homeName) || undefined } : { taskId }), updated_at: new Date().toISOString() }
      // The name-match earned a real listing link — keep it, so this glitch never needs matching again.
      if (!g.listing_id && refListing) patch.listing_id = refListing
      const { error } = await db.from('glitches').update(patch).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, taskId, reportUrl: r.data.report_url || null })
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
