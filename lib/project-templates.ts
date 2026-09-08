// PROJECT TEMPLATES AND RECURRENCE — the project that starts full, and the one that makes itself.
//
// Jon, 2026-09-08: "There should also be templates" and "the Monday 1:1 that creates itself".
//
// A template is sections with tasks. Built-ins below are the shapes this operation actually runs:
// a one-on-one, taking on a building, a renovation, letting a unit go, a rollout across units. The
// team can save any project as its own template (snapshotTemplate) and a saved template with the
// same key overrides the built-in — so the 1:1 can be tuned without a deploy.
//
// Recurrence: a project with `recurs` is the latest instance of a series. Each morning the cron
// asks "is next_on today or earlier?" and if so creates the next instance from the same template
// (same members, same links), rolls every open task from the last instance into a Follow-ups
// section, moves `recurs` onto the new instance, and marks the old one done. The series is the
// thread; each instance is one meeting.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { addNote } from './projects'
import {
  type Template, type TemplateSection, type Recurrence, type ProjectKind, type Member,
  nextOccurrence, todayISO, toPerson, PROJECT_KINDS,
} from './projects-shared'

// ---------------------------------------------------------------- built-ins
const T = (title: string, extra: Partial<{ description: string; priority: string; dueOffsetDays: number }> = {}) => ({ title, ...extra })

export const BUILT_IN: Template[] = [
  {
    key: 'one_on_one', label: 'One-on-one', kind: 'one_on_one', category: 'internal', builtIn: true,
    blurb: 'Private. Wins, blockers, follow-ups, next week. Repeats weekly and carries open items forward.',
    summary: 'Weekly one-on-one. Notes here are between the two of us.',
    recurs: { every: 'week', weekday: 1, next_on: '', carry: true },
    sections: [
      { name: 'Wins', tasks: [T('What went well this week')] },
      { name: 'Blockers', tasks: [T('What is in the way')] },
      { name: 'Follow-ups', tasks: [T('Carry-overs from last time')] },
      { name: 'Next week', tasks: [T('Top three for next week')] },
    ],
  },
  {
    key: 'building_onboarding', label: 'Building onboarding', kind: 'project', category: 'onboarding', builtIn: true,
    blurb: 'Access, listings, ops, owner, compliance — everything before the first guest.',
    summary: 'Bring a new building live: access sorted, listings built, crew and supplies in place, owner set up.',
    sections: [
      { name: 'Access', tasks: [T('Collect keys, fobs and garage remotes', { dueOffsetDays: 3 }), T('Door codes set and tested per unit', { dueOffsetDays: 5 }), T('Lockbox placed for cleaners', { dueOffsetDays: 5 }), T('Wi-Fi names and passwords recorded per unit', { dueOffsetDays: 5 })] },
      { name: 'Listings', tasks: [T('Guesty listings created', { dueOffsetDays: 7 }), T('Photos shot and ordered', { dueOffsetDays: 10 }), T('Pricing and minimum stay set', { dueOffsetDays: 10 }), T('House rules and check-in guide written', { dueOffsetDays: 10 })] },
      { name: 'Operations', tasks: [T('Breezeway property created with checklists', { dueOffsetDays: 7 }), T('Cleaner and inspector assigned', { dueOffsetDays: 7 }), T('Inventory count and starter supplies delivered', { dueOffsetDays: 12 }), T('Linen par levels set', { dueOffsetDays: 12 })] },
      { name: 'Owner', tasks: [T('Management agreement signed', { priority: 'high', dueOffsetDays: 1 }), T('Owner portal access sent', { dueOffsetDays: 7 }), T('Statement and payout details confirmed', { dueOffsetDays: 14 })] },
      { name: 'Compliance', tasks: [T('STR permit / registration on file', { priority: 'high', dueOffsetDays: 7 }), T('Insurance certificate received', { dueOffsetDays: 7 }), T('HOA rules and quiet hours noted in the listing', { dueOffsetDays: 7 })] },
    ],
  },
  {
    key: 'renovation', label: 'Renovation', kind: 'project', category: 'renovation', builtIn: true,
    blurb: 'Scope, owner approval, vendors, the work, closeout.',
    summary: 'A renovation from scope to the listing being updated.',
    sections: [
      { name: 'Scope', tasks: [T('Walk the unit and write the scope'), T('Before photos')] },
      { name: 'Approval', tasks: [T('Budget drafted', { priority: 'high' }), T('Owner approval requested', { priority: 'high' }), T('Approval received')] },
      { name: 'Vendors', tasks: [T('Quotes in (at least two)'), T('Vendor booked and dates set'), T('Calendar blocked in Guesty')] },
      { name: 'Work', tasks: [T('Demo / prep'), T('Install'), T('Punch list walk')] },
      { name: 'Closeout', tasks: [T('After photos'), T('Listing photos and description updated'), T('Owner billed / statement line added'), T('Inventory updated')] },
    ],
  },
  {
    key: 'unit_offboarding', label: 'Unit offboarding', kind: 'project', category: 'offboarding', builtIn: true,
    blurb: 'Letting a unit go without a guest or an owner falling through the cracks.',
    summary: 'Wind a unit down cleanly: guests rebooked, access returned, owner squared.',
    sections: [
      { name: 'Guesty', tasks: [T('Block the calendar from the end date', { priority: 'high' }), T('Future reservations rebooked or refunded', { priority: 'high' }), T('Listing unpublished on every channel')] },
      { name: 'Access', tasks: [T('Keys, fobs and remotes returned'), T('Door codes reset'), T('Lockbox removed')] },
      { name: 'Owner', tasks: [T('Final statement issued'), T('Deposits and supplies settled'), T('Portal access closed')] },
      { name: 'Operations', tasks: [T('Breezeway property archived'), T('Inventory removed or transferred'), T('Cleaner and inspector told')] },
    ],
  },
  {
    key: 'rollout', label: 'Portfolio rollout', kind: 'project', category: 'rollout', builtIn: true,
    blurb: 'One change across many units — attach the building and tick units off as you go.',
    summary: 'Roll one change across a set of units. Progress is counted in units, not steps.',
    sections: [
      { name: 'Plan', tasks: [T('Confirm the unit list (attach the building)'), T('Order materials'), T('Schedule around occupancy')] },
      { name: 'Install', tasks: [T('Install — tick each unit off under About as it is done')] },
      { name: 'Verify', tasks: [T('Spot-check a sample'), T('Update checklists / guides'), T('Bill owners where applicable')] },
    ],
  },
  {
    key: 'personal', label: 'My board', kind: 'personal', category: 'internal', builtIn: true,
    blurb: 'A private board only you can see. Arrange it however you like.',
    summary: null as any,
    settings: { view: 'board' },
    sections: [
      { name: 'To do', tasks: [T('First thing')] },
      { name: 'Doing', tasks: [] },
      { name: 'Done', tasks: [] },
    ],
  },
]

/** Built-ins plus the team's saved templates; a saved one with a built-in's key replaces it. */
export async function listTemplates(): Promise<Template[]> {
  const out = new Map<string, Template>()
  for (const t of BUILT_IN) out.set(t.key, t)
  try {
    const { data } = await supabaseAdmin().from('project_templates').select('*').eq('active', true).order('label')
    for (const r of (data || []) as any[]) {
      const body = r.body || {}
      out.set(String(r.key), {
        key: String(r.key), label: String(r.label), kind: (PROJECT_KINDS as readonly string[]).includes(r.kind) ? r.kind : 'project',
        category: String(r.category || 'other'), summary: r.summary || undefined, blurb: body.blurb || undefined,
        sections: Array.isArray(body.sections) ? body.sections : [], settings: body.settings || undefined, recurs: body.recurs || null, builtIn: false,
      })
    }
  } catch { /* the table not existing yet must not hide the built-ins */ }
  return Array.from(out.values())
}

export async function getTemplate(key: string): Promise<Template | null> {
  return (await listTemplates()).find(t => t.key === key) || null
}

// ---------------------------------------------------------------- apply
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Write a template's sections and tasks into a project. Sort keeps the template's order. */
export async function applyTemplate(projectId: string, t: Template, opts: { startsOn?: string | null; createdBy: string; skipEmptySections?: boolean }) {
  const sb = supabaseAdmin()
  const start = opts.startsOn || todayISO()
  const rows: any[] = []
  let sort = 0
  for (const sec of t.sections) {
    for (const task of sec.tasks) {
      rows.push({
        project_id: projectId, title: String(task.title).slice(0, 300), description: task.description || null,
        section: sec.name || null, priority: ['low', 'normal', 'high', 'urgent'].includes(String(task.priority)) ? task.priority : 'normal',
        due_on: task.dueOffsetDays != null ? addDays(start, Number(task.dueOffsetDays)) : null,
        status: 'todo', created_by: opts.createdBy, sort: sort++,
      })
    }
  }
  if (rows.length) {
    const { error } = await sb.from('project_steps').insert(rows)
    if (error) throw new Error('template tasks: ' + error.message)
  }
  // Sections with no tasks (a personal board's "Doing" / "Done") only exist as an order preference.
  const order = t.sections.map(s => s.name).filter(Boolean)
  const settings = { ...(t.settings || {}), sectionOrder: order }
  await sb.from('projects').update({ settings, template_key: t.key }).eq('id', projectId)
  return rows.length
}

/** A template from a live project: its sections and open-or-done task titles, nothing personal. */
export async function snapshotTemplate(projectId: string, opts: { key: string; label: string; createdBy: string }) {
  const sb = supabaseAdmin()
  const [{ data: p }, { data: steps }] = await Promise.all([
    sb.from('projects').select('kind,category,summary,settings').eq('id', projectId).maybeSingle(),
    sb.from('project_steps').select('title,description,section,priority,parent_id,sort,created_at').eq('project_id', projectId).is('parent_id', null).order('sort', { nullsFirst: false }).order('created_at'),
  ])
  if (!p) throw new Error('No such project.')
  const bySec = new Map<string, TemplateSection>()
  const order: string[] = Array.isArray((p as any).settings?.sectionOrder) ? (p as any).settings.sectionOrder : []
  for (const name of order) bySec.set(name, { name, tasks: [] })
  for (const s of (steps || []) as any[]) {
    const name = s.section || ''
    if (!bySec.has(name)) bySec.set(name, { name, tasks: [] })
    bySec.get(name)!.tasks.push({ title: s.title, description: s.description || undefined, priority: s.priority !== 'normal' ? s.priority : undefined })
  }
  const body = { sections: Array.from(bySec.values()), settings: (p as any).settings || {}, blurb: `Saved from a live project by ${opts.createdBy.split('@')[0]}.` }
  const key = opts.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'template'
  const { error } = await sb.from('project_templates').upsert({
    key, label: opts.label.slice(0, 80), kind: (p as any).kind || 'project', category: (p as any).category || 'other',
    summary: (p as any).summary || null, body, created_by: opts.createdBy, active: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  if (error) throw new Error('save template: ' + error.message)
  return key
}

// ---------------------------------------------------------------- recurrence
/** Normalise what the UI sends into a Recurrence, computing the first next_on when missing. */
export function normaliseRecurrence(raw: any, from = todayISO()): Recurrence | null {
  if (!raw || !['week', '2weeks', 'month'].includes(raw.every)) return null
  const r: Recurrence = {
    every: raw.every,
    weekday: raw.every === 'month' ? undefined : Math.min(6, Math.max(0, Number(raw.weekday ?? 1))),
    day: raw.every === 'month' ? Math.min(28, Math.max(1, Number(raw.day || 1))) : undefined,
    next_on: '', carry: raw.carry !== false,
  }
  r.next_on = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.next_on || '')) && String(raw.next_on) > from ? String(raw.next_on) : nextOccurrence(r, from)
  return r
}

const instanceTitle = (base: string, on: string) => {
  const stripped = base.replace(/\s*·\s*[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/, '')
  const d = new Date(on + 'T12:00:00Z')
  return `${stripped} · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)}`
}

/**
 * THE MORNING PASS. For every project whose recurs.next_on is today or earlier: make the next
 * instance, carry open tasks, move the schedule forward. Idempotent — the schedule moves with the
 * instance, so a second run the same morning finds nothing due.
 */
export async function runRecurrences(today = todayISO()): Promise<{ created: { id: string; title: string; from: string }[]; errors: string[] }> {
  const sb = supabaseAdmin()
  const created: { id: string; title: string; from: string }[] = []
  const errors: string[] = []
  const { data: due, error } = await sb.from('projects').select('*').not('recurs', 'is', null).eq('archived', false).limit(200)
  if (error) throw new Error('recur: ' + error.message)
  for (const prev of (due || []) as any[]) {
    const r = prev.recurs as Recurrence
    if (!r?.next_on || r.next_on > today) continue
    try {
      const on = r.next_on
      const series = prev.series_key || prev.id
      const tpl = prev.template_key ? await getTemplate(prev.template_key) : null
      // The new instance is a copy of the shape, not the content.
      const { data: next, error: e1 } = await sb.from('projects').insert({
        title: instanceTitle(prev.title, on), summary: prev.summary, category: prev.category, stage: 'in_progress', priority: prev.priority,
        lead_email: prev.lead_email, market: prev.market, building: prev.building, starts_on: on,
        private: prev.private, kind: prev.kind, template_key: prev.template_key, series_key: series, settings: prev.settings || {},
        created_by: prev.created_by, recurs: { ...r, next_on: nextOccurrence(r, on) },
      }).select('id,title').single()
      if (e1) throw new Error(e1.message)
      // Same people, same things it is about.
      const [{ data: mems }, { data: links }] = await Promise.all([
        sb.from('project_members').select('person_key,display,email,role,notify').eq('project_id', prev.id),
        sb.from('project_links').select('kind,ref_id,label').eq('project_id', prev.id),
      ])
      if (mems?.length) await sb.from('project_members').insert(mems.map((m: any) => ({ ...m, project_id: next.id, added_by: 'recurrence' })))
      if (links?.length) await sb.from('project_links').insert(links.map((l: any) => ({ ...l, project_id: next.id })))
      // Fresh sections from the template, then whatever was left open last time.
      if (tpl) await applyTemplate(next.id, tpl, { startsOn: on, createdBy: prev.created_by || 'recurrence', skipEmptySections: true })
      let carried = 0
      if (r.carry !== false) {
        const { data: open } = await sb.from('project_steps').select('id,title,description,priority,due_on,section')
          .eq('project_id', prev.id).neq('status', 'done').is('parent_id', null).limit(500)
        const rows = ((open || []) as any[]).filter(t => !/^(what went well|what is in the way|carry-overs|top three)/i.test(t.title)).map((t, i) => ({
          project_id: next.id, title: t.title, description: t.description, priority: t.priority, due_on: t.due_on,
          section: 'Follow-ups', status: 'todo', created_by: 'recurrence', sort: 1000 + i,
        }))
        if (rows.length) {
          const { data: ins } = await sb.from('project_steps').insert(rows).select('id,title')
          carried = ins?.length || 0
          // Assignees come along with the task.
          const { data: asg } = await sb.from('project_task_assignees').select('task_id,person_key,display,email').in('task_id', (open || []).map((t: any) => t.id))
          if (asg?.length && ins?.length) {
            const byTitle = new Map((open || []).map((t: any) => [t.id, t.title]))
            const newByTitle = new Map(ins.map((t: any) => [t.title, t.id]))
            const arows = asg.map((a: any) => ({ task_id: newByTitle.get(byTitle.get(a.task_id)), project_id: next.id, person_key: a.person_key, display: a.display, email: a.email })).filter(x => x.task_id)
            if (arows.length) await sb.from('project_task_assignees').upsert(arows, { onConflict: 'task_id,person_key' })
          }
        }
      }
      // The series moves on: the old instance stops recurring and is closed.
      await sb.from('projects').update({ recurs: null, series_key: series, stage: 'done', done_on: today }).eq('id', prev.id)
      await addNote(next.id, `Created from the series${carried ? ` · ${carried} open item${carried === 1 ? '' : 's'} carried over` : ''}.`, null, 'event', false, { meta: { type: 'stage', name: 'recurrence' } })
      await addNote(prev.id, `Closed — the next one is ready.`, null, 'event', false, { meta: { type: 'stage', name: 'recurrence' } })
      created.push({ id: next.id, title: next.title, from: prev.id })
    } catch (e: any) {
      errors.push(`${prev.title}: ${String(e?.message || e)}`)
    }
  }
  return { created, errors }
}

export type { Template, Recurrence, ProjectKind, Member }
