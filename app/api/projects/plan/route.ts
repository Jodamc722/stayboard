// PLAN WITH EVE — a brief becomes a project (Jon, 2026-09-30).
//
//   "This can be a good tab where we can prompt / create a project and Eve helps us execute. Example:
//    we prompt and say we want to do an exterior walkthrough at Pelican — inspect every single unit,
//    get a quote for this and that, redo the exterior, deep clean ACs there. From there you help us
//    build a project, and as we build those projects we can assign those projects weekly… help us
//    just communicate what we want, and then you organize it, structure it, and then plan it."
//
//   POST { action: 'draft', brief }            → { ok, plan }        the structured plan, for review
//   POST { action: 'create', plan, brief }     → { ok, id }          the project, sections, tasks, owners
//
// THE DRAFT is one model call (task 'project-plan') that turns the brief into phases and tasks with
// a week for each, a suggested owner from the real roster, the quotes to chase, and — because a
// brief is never complete — the questions it would ask Jon before starting and the assumptions it
// made in the meantime. It sees the buildings, the roster and the project categories that exist, so
// it names real things. It never invents a person: an owner it cannot place on the roster comes back
// empty and the form says so.
//
// THE CREATE goes through the same shapes the Projects desk already uses — a `projects` row, the
// creator as first owner, sections + tasks by way of the template applier, assignees in
// project_task_assignees — so the result is an ordinary project: on the board, in My tasks, in the
// week's plan, editable by hand, visible to Eve. The plan is reviewed and edited in the browser
// first; nothing is created until a person presses Create. The brief is kept as the first note.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelPairFor } from '@/lib/ai-models'
import { KNOWN_BUILDINGS } from '@/lib/segments'
import { getCategories, addNote } from '@/lib/projects'
import { toPerson, todayISO, PRIORITIES, type Template } from '@/lib/projects-shared'
import { applyTemplate } from '@/lib/project-templates'
import { personKey, nameMatches } from '@/lib/person-name'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const int = (v: any, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** The next Monday (today if today is one): the week a plan starts on. */
const nextMonday = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); const dow = d.getUTCDay(); return addDays(ymd, dow === 1 ? 0 : (8 - dow) % 7) }

export type PlanTask = { title: string; detail: string; kind: 'inspect' | 'quote' | 'work' | 'order' | 'approve' | 'admin' | 'clean'; owner: string | null; week: number; priority: string; checklist: string[] }
export type PlanPhase = { name: string; week: number; tasks: PlanTask[] }
export type Plan = {
  title: string; summary: string; category: string; building: string | null; market: string | null; priority: string
  weeks: number
  phases: PlanPhase[]
  quotes: { what: string; from: string }[]
  questions: string[]
  assumptions: string[]
}

const KINDS = ['inspect', 'quote', 'work', 'order', 'approve', 'admin', 'clean'] as const

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short, specific. "Pelican exterior refresh", not "Project".' },
    summary: { type: 'string', description: 'Two or three sentences: what we are doing, why, and what done looks like.' },
    category: { type: 'string', description: 'One of the category keys given.' },
    building: { type: 'string', description: 'The building label exactly as given, or empty when the work spans buildings.' },
    market: { type: 'string', description: 'Miami, Broward or North — the building’s market, or empty.' },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    weeks: { type: 'integer', description: 'How many weeks the plan runs, 1–12.' },
    phases: {
      type: 'array', description: 'In order. A phase is a stage of the work (Walk & scope, Quotes, Approval, Work, Closeout), each with the week it starts.',
      items: { type: 'object', properties: {
        name: { type: 'string' }, week: { type: 'integer' },
        tasks: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string', description: 'One action, one line, starts with a verb.' },
          detail: { type: 'string', description: 'What "done" means, in a line. Empty is fine.' },
          kind: { type: 'string', enum: KINDS as any },
          owner: { type: 'string', description: 'A name from the roster given, exactly as written — or empty when nobody on it clearly fits. Never invent a person.' },
          week: { type: 'integer', description: 'The week this is due, 1-based.' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          checklist: { type: 'array', items: { type: 'string' }, description: 'Sub-steps, only when they genuinely help (a walkthrough’s rooms, a quote’s line items).' },
        }, required: ['title', 'kind', 'week'] } },
      }, required: ['name', 'week', 'tasks'] },
    },
    quotes: { type: 'array', description: 'Every quote the brief needs, and who to ask (a trade — "exterior painter", "HVAC vendor" — not a company you are guessing at).', items: { type: 'object', properties: { what: { type: 'string' }, from: { type: 'string' } }, required: ['what', 'from'] } },
    questions: { type: 'array', items: { type: 'string' }, description: 'What you would ask Jon before starting — the things the brief leaves open that change the plan. Three to six, specific.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'What you assumed in the meantime, so they can be corrected.' },
  },
  required: ['title', 'summary', 'category', 'priority', 'weeks', 'phases', 'quotes', 'questions', 'assumptions'],
}

const SYSTEM = `You are Eve, the operations brain at Stay Hospitality, a short-term rental operator in South Florida (Miami, Broward, North / Palm Beach). Jon, the GM, tells you in a few lines what he wants done; you turn it into a project the team can run week by week.

How to plan:
- Break the brief into PHASES in the order the work really happens. For physical work that is usually: walk & scope (inspect, photograph, measure) → quotes → owner / budget approval → order & schedule → the work → closeout (punch list, photos, listing updated, owner billed). Skip a phase the brief does not need; add one it does.
- Every task is ONE action a named person can finish, starting with a verb. "Walk units 101–112 and photograph the exterior" — not "Exterior".
- "Inspect every unit" means one task per building walk with the units as a checklist, not forty tasks.
- Every quote the brief asks for is a task of kind "quote" AND an entry in quotes. Two quotes per trade for anything over a few hundred dollars.
- Work that needs owner approval or spend gets an "approve" task before it, high priority.
- Put a week on everything. Week 1 is the first week. Be realistic: quotes take a week to come back, vendors book a week or two out, approvals take days.
- Owners: pick from the roster given, by role — supervisors and the ops manager walk and scope; maintenance techs do repairs and small works; the ops manager or GM chases vendors, quotes and approvals; CCS handles guest-facing notices. Leave the owner empty rather than guess.
- Category: pick the closest key given.
- Questions: what you genuinely need to know before this can start — budget ceiling, owner involvement, dates that must be avoided (high season, bookings), scope edges. Assumptions: what you assumed instead.
- Tone: plain, specific, no filler. Titles and summaries a supervisor would write.`

type Ctx = { categories: { key: string; label: string }[]; roster: { name: string; role: string | null }[]; buildings: { label: string; market: string; vendor: boolean }[]; today: string }

async function context(): Promise<Ctx> {
  const sb = supabaseAdmin()
  const [categories, { data: users }] = await Promise.all([
    getCategories().catch(() => [] as any[]),
    sb.from('app_users').select('email,profile,role').eq('status', 'active').limit(200),
  ])
  const roster: { name: string; role: string | null }[] = []
  const seen = new Set<string>()
  for (const u of (users || []) as any[]) {
    const name = String((u.profile && (u.profile.name || u.profile.full_name)) || u.email)
    const k = personKey(name) || String(u.email).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    roster.push({ name, role: str((u.profile && u.profile.title) || u.role) || null })
  }
  try {
    const { breezewayPeopleLite } = await import('@/lib/breezeway')
    for (const bp of await breezewayPeopleLite()) {
      const k = personKey(bp.name)
      if (!k || seen.has(k) || roster.some(r => nameMatches(r.name, bp.name))) continue
      seen.add(k); roster.push({ name: bp.name, role: 'field' })
    }
  } catch { /* the app users alone are a usable roster */ }
  return { categories: (categories || []).map((c: any) => ({ key: String(c.key), label: String(c.label) })), roster, buildings: KNOWN_BUILDINGS.map(b => ({ label: b.label, market: b.market, vendor: b.vendor })), today: todayISO() }
}

/** Trim the model's plan to the shapes we store; owners must be real roster names. */
function normalise(raw: any, ctx: Ctx): Plan {
  const rosterNames = ctx.roster.map(r => r.name)
  const owner = (v: any): string | null => { const s = str(v); if (!s) return null; const hit = rosterNames.find(n => n === s) || rosterNames.find(n => nameMatches(n, s)) || null; return hit }
  const weeks = int(raw?.weeks, 1, 12, 4)
  const phases: PlanPhase[] = (Array.isArray(raw?.phases) ? raw.phases : []).slice(0, 12).map((p: any) => ({
    name: str(p?.name).slice(0, 80) || 'Phase',
    week: int(p?.week, 1, weeks, 1),
    tasks: (Array.isArray(p?.tasks) ? p.tasks : []).slice(0, 40).map((t: any): PlanTask => ({
      title: str(t?.title).slice(0, 300), detail: str(t?.detail).slice(0, 500),
      kind: (KINDS as readonly string[]).includes(str(t?.kind)) ? str(t?.kind) as PlanTask['kind'] : 'work',
      owner: owner(t?.owner), week: int(t?.week, 1, weeks, int(p?.week, 1, weeks, 1)),
      priority: (PRIORITIES as readonly string[]).includes(str(t?.priority)) ? str(t?.priority) : 'normal',
      checklist: (Array.isArray(t?.checklist) ? t.checklist : []).map(str).filter(Boolean).slice(0, 60),
    })).filter((t: PlanTask) => t.title),
  })).filter((p: PlanPhase) => p.tasks.length)
  const catKeys = ctx.categories.map(c => c.key)
  const building = ctx.buildings.find(b => b.label === str(raw?.building))?.label || ctx.buildings.find(b => str(raw?.building) && nameMatches(b.label, str(raw?.building)))?.label || null
  return {
    title: str(raw?.title).slice(0, 200) || 'New project',
    summary: str(raw?.summary).slice(0, 2000),
    category: catKeys.includes(str(raw?.category)) ? str(raw?.category) : (catKeys.includes('other') ? 'other' : catKeys[0] || 'other'),
    building, market: building ? ctx.buildings.find(b => b.label === building)!.market : (['Miami', 'Broward', 'North'].includes(str(raw?.market)) ? str(raw?.market) : null),
    priority: (PRIORITIES as readonly string[]).includes(str(raw?.priority)) ? str(raw?.priority) : 'normal',
    weeks, phases,
    quotes: (Array.isArray(raw?.quotes) ? raw.quotes : []).slice(0, 20).map((q: any) => ({ what: str(q?.what).slice(0, 200), from: str(q?.from).slice(0, 120) })).filter((q: any) => q.what),
    questions: (Array.isArray(raw?.questions) ? raw.questions : []).map(str).filter(Boolean).slice(0, 8),
    assumptions: (Array.isArray(raw?.assumptions) ? raw.assumptions : []).map(str).filter(Boolean).slice(0, 8),
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const action = str(b?.action)
  const brief = str(b?.brief).slice(0, 4000)

  if (action === 'draft') {
    if (brief.length < 8) return NextResponse.json({ ok: false, error: 'Tell Eve what you want done — a few lines is enough.' }, { status: 400 })
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ ok: false, error: 'No model key on the server.' }, { status: 500 })
    const ctx = await context()
    const pack = [
      `Today: ${ctx.today}. Plans start the following Monday.`,
      `Buildings: ${ctx.buildings.map(b => b.label + ' (' + b.market + (b.vendor ? ', vendor-run' : '') + ')').join('; ')}.`,
      `Roster (name — role): ${ctx.roster.map(r => r.name + (r.role ? ' — ' + r.role : '')).join('; ')}.`,
      `Category keys: ${ctx.categories.map(c => c.key + ' (' + c.label + ')').join(', ')}.`,
      '', 'THE BRIEF, in Jon’s words:', brief,
    ].join('\n')
    const { model, fallback } = await modelPairFor('project-plan')
    const r = await anthropicMessages(key, {
      model, max_tokens: 3500, system: SYSTEM,
      tools: [{ name: 'plan', description: 'The project plan.', input_schema: SCHEMA }], tool_choice: { type: 'tool', name: 'plan' },
      messages: [{ role: 'user', content: pack }],
    }, fallback, 'project-plan')
    const out = (r.data?.content || []).find((c: any) => c.type === 'tool_use')?.input
    if (!r.ok || !out) return NextResponse.json({ ok: false, error: 'Eve could not draft that just now' + (r.data?.error?.message ? ' — ' + String(r.data.error.message).slice(0, 120) : '.') }, { status: 502 })
    const plan = normalise(out, ctx)
    if (!plan.phases.length) return NextResponse.json({ ok: false, error: 'Eve came back without any tasks. Try a fuller brief.' }, { status: 502 })
    return NextResponse.json({ ok: true, plan, roster: ctx.roster.map(r => r.name), categories: ctx.categories, buildings: ctx.buildings.map(x => x.label), model: r.model })
  }

  if (action === 'create') {
    const ctx = await context()
    const plan = normalise(b?.plan, ctx)
    if (!plan.phases.length) return NextResponse.json({ ok: false, error: 'Nothing to create — the plan has no tasks.' }, { status: 400 })
    const sb = supabaseAdmin()
    const start = /^\d{4}-\d{2}-\d{2}$/.test(str(b?.starts_on)) ? str(b.starts_on) : nextMonday(todayISO())
    const due = addDays(start, plan.weeks * 7 - 3)   // the Friday of the last week
    const row: any = {
      title: plan.title, summary: plan.summary || null, category: plan.category, stage: 'planned', priority: plan.priority,
      lead_email: g.access.email, market: plan.market, building: plan.building, starts_on: start, due_on: due,
      kind: 'project', created_by: g.access.email, approval: 'not_needed',
    }
    const { data: p, error } = await sb.from('projects').insert(row).select('id').maybeSingle()
    if (error || !p) return NextResponse.json({ ok: false, error: error?.message || 'insert failed' }, { status: 500 })
    const me = toPerson(String(g.access.email || ''))
    await sb.from('project_members').upsert([{ project_id: p.id, ...me, role: 'owner', added_by: g.access.email }], { onConflict: 'project_id,person_key' })

    // Sections = phases, in order; a task's due date is the Friday of its week; the week is named
    // in the description so a task read on its own still says when.
    const tpl: Template = {
      key: 'eve_plan', label: 'Planned with Eve', kind: 'project', category: plan.category, icon: '✨', accent: 'violet',
      sections: plan.phases.map(ph => ({
        name: `${ph.name}`,
        tasks: ph.tasks.map(t => ({
          title: t.title,
          description: [`Week ${t.week}` + (t.kind !== 'work' ? ' · ' + t.kind : ''), t.detail].filter(Boolean).join(' — '),
          priority: t.priority, dueOffsetDays: (t.week - 1) * 7 + 4, checklist: t.checklist.length ? t.checklist : undefined,
        })),
      })),
    }
    try { await applyTemplate(p.id, tpl, { startsOn: start, createdBy: String(g.access.email || '') }) }
    catch (e: any) { return NextResponse.json({ ok: false, error: 'Project created but its tasks did not land: ' + String(e?.message || e), id: p.id }, { status: 500 }) }
    // template_key is for real templates; a plan is its own thing.
    await sb.from('projects').update({ template_key: null }).eq('id', p.id)

    // Owners → assignees. Match each created task back by section + title (the applier keeps both).
    const { data: steps } = await sb.from('project_steps').select('id,title,section').eq('project_id', p.id).is('parent_id', null)
    const asg: any[] = []
    for (const ph of plan.phases) for (const t of ph.tasks) {
      if (!t.owner) continue
      const s = ((steps || []) as any[]).find(x => x.section === ph.name && x.title === t.title)
      if (!s) continue
      const who = toPerson(t.owner)
      const u = ctx.roster.find(r => r.name === t.owner)
      void u
      asg.push({ task_id: s.id, project_id: p.id, ...who, role: 'assignee' })
    }
    if (asg.length) {
      const { error: aErr } = await sb.from('project_task_assignees').upsert(asg, { onConflict: 'task_id,person_key' })
      if (!aErr) for (const a of asg) await sb.from('project_steps').update({ assignee: a.display }).eq('id', a.task_id)
    }
    const quotes = plan.quotes.length ? '\n\nQuotes to get: ' + plan.quotes.map(q => q.what + ' (' + q.from + ')').join('; ') : ''
    const open = plan.questions.length ? '\n\nStill open: ' + plan.questions.join(' · ') : ''
    const assumed = plan.assumptions.length ? '\n\nAssumed: ' + plan.assumptions.join(' · ') : ''
    await addNote(p.id, `Planned with Eve from this brief:\n\n${brief || '(no brief kept)'}${quotes}${open}${assumed}`, g.access.email, 'comment', false)
    await addNote(p.id, 'created this project with Eve', g.access.email, 'event', false, { meta: { type: 'stage', name: 'created' } })
    return NextResponse.json({ ok: true, id: p.id, tasks: plan.phases.reduce((a, ph) => a + ph.tasks.length, 0), assigned: asg.length })
  }

  return NextResponse.json({ ok: false, error: 'action must be draft or create' }, { status: 400 })
}
