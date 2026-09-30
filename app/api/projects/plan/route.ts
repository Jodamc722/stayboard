// PLAN WITH EVE — a brief becomes a project (Jon, 2026-09-30).
//
//   "This can be a good tab where we can prompt / create a project and Eve helps us execute…
//    help us just communicate what we want, and then you organize it, structure it, and then plan it."
//   And on the first cut: "the projects we work on should have tasks associated with them in
//    Breezeway if necessary, or in a project board, assigned to their correct parties… the way you
//    design the tasks there are not really any specifics… make sure that when we communicate the
//    projects it gets more specified and that we can add files, add documents."
//
//   POST multipart  action=draft   brief, files[]           → { ok, plan, roster, units, attachments }
//   POST json       action=create  { plan, brief, starts_on, attachments } → { ok, id, tasks, breezeway }
//
// WHAT EVE SEES when she drafts: the brief, every file attached to it read in full (lib/files/extract —
// a PDF quote, a photo of a damaged railing, an owner's email as .docx), the building's actual units
// by name, the people on the roster with what they do, and the categories that exist. So a task can
// say "Walk Pelican 1–6 and photograph every railing" with the six units as its checklist, not
// "inspect the building".
//
// WHAT COMES BACK is specific by construction: every task has ONE action, what DONE means, the
// units it touches (real names), who owns it, which week, and WHERE it lives — on the board (office
// work: quotes, approvals, ordering) or in Breezeway (field work: inspections, repairs, cleans),
// with the department. Owners are matched to the roster; a name Eve cannot place comes back empty.
//
// CREATE makes an ordinary project (row, first owner, sections + tasks through the template applier,
// assignees), then for every Breezeway task creates the field task(s) in Breezeway — one per unit —
// assigned to the same person by the shared name matcher, dated to the task's week, and links each
// back to its board task (breezeway_task_id) exactly as "Send to Breezeway" on the board does.
// The brief, the answers and what each file said are kept as the project's first note. Files
// themselves are attached by the browser through the board's own upload route afterwards.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelPairFor } from '@/lib/ai-models'
import { KNOWN_BUILDINGS, buildingOf } from '@/lib/segments'
import { getCategories, addNote, logEvent } from '@/lib/projects'
import { toPerson, todayISO, PRIORITIES, type Template } from '@/lib/projects-shared'
import { applyTemplate } from '@/lib/project-templates'
import { personKey, nameMatches } from '@/lib/person-name'
import { extractFile } from '@/lib/files/extract'
import { bustBoards } from '@/lib/bust'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const int = (v: any, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** The next Monday (today if today is one): the week a plan starts on. */
const nextMonday = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); const dow = d.getUTCDay(); return addDays(ymd, dow === 1 ? 0 : (8 - dow) % 7) }

export type PlanTask = {
  title: string; done: string; detail: string
  kind: 'inspect' | 'quote' | 'work' | 'order' | 'approve' | 'admin' | 'clean'
  where: 'board' | 'breezeway'
  dept: 'housekeeping' | 'inspection' | 'maintenance'
  units: string[]
  owner: string | null; week: number; priority: string; checklist: string[]
}
export type PlanPhase = { name: string; week: number; tasks: PlanTask[] }
export type Plan = {
  title: string; summary: string; category: string; building: string | null; market: string | null; priority: string
  weeks: number
  phases: PlanPhase[]
  quotes: { what: string; from: string }[]
  questions: string[]
  assumptions: string[]
}
export type Attachment = { name: string; words: number; method: string; text: string }

const KINDS = ['inspect', 'quote', 'work', 'order', 'approve', 'admin', 'clean'] as const
const DEPTS = ['housekeeping', 'inspection', 'maintenance'] as const

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short and specific: "Pelican exterior refresh — walk, quotes, paint, AC deep clean". Never "Project".' },
    summary: { type: 'string', description: 'Three or four sentences: what we are doing, why, the scope (which units / areas), and what finished looks like.' },
    category: { type: 'string', description: 'One of the category keys given.' },
    building: { type: 'string', description: 'The building label exactly as given, or empty when the work spans buildings.' },
    market: { type: 'string', description: 'Miami, Broward or North — the building’s market, or empty.' },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    weeks: { type: 'integer', description: 'How many weeks the plan runs, 1–12.' },
    phases: {
      type: 'array', description: 'In order. A phase is a stage of the work (Walk & scope, Quotes, Approval, Order & schedule, Work, Closeout), each with the week it starts.',
      items: { type: 'object', properties: {
        name: { type: 'string' }, week: { type: 'integer' },
        tasks: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string', description: 'ONE action a named person can finish, starting with a verb, naming the thing: "Photograph every railing on floors 1–3 and note rust", not "Inspect railings".' },
          done: { type: 'string', description: 'What DONE means, checkable in a sentence: "Photos of all 6 railings in the project, each with a rust yes/no". Required.' },
          detail: { type: 'string', description: 'The how and the specifics: measurements, materials, who to call, what to bring, what to avoid. Empty only when the title says it all.' },
          kind: { type: 'string', enum: KINDS as any },
          where: { type: 'string', enum: ['board', 'breezeway'], description: 'breezeway = somebody goes to a unit or building and does physical work (inspect, clean, repair, install, meet a vendor on site). board = office work (quotes, approvals, ordering, scheduling, documents, owner calls).' },
          dept: { type: 'string', enum: DEPTS as any, description: 'For Breezeway tasks: inspection for walks and checks, housekeeping for cleaning, maintenance for repairs, installs and vendor visits.' },
          units: { type: 'array', items: { type: 'string' }, description: 'The units this task touches, EXACTLY as named in the unit list given. Every unit for "every unit". Empty for building-wide or office work.' },
          owner: { type: 'string', description: 'A name from the roster given, exactly as written — or empty when nobody clearly fits. Never invent a person.' },
          week: { type: 'integer', description: 'The week this is due, 1-based.' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          checklist: { type: 'array', items: { type: 'string' }, description: 'Sub-steps or the items to cover (rooms, line items, the questions to ask a vendor). For a multi-unit task leave this empty — the units become the checklist.' },
        }, required: ['title', 'done', 'kind', 'where', 'week'] } },
      }, required: ['name', 'week', 'tasks'] },
    },
    quotes: { type: 'array', description: 'Every quote the brief needs: what exactly is being priced (scope, quantities, units) and the trade to ask — "exterior painter", "HVAC vendor" — not a company you are guessing at.', items: { type: 'object', properties: { what: { type: 'string' }, from: { type: 'string' } }, required: ['what', 'from'] } },
    questions: { type: 'array', items: { type: 'string' }, description: 'What you would ask Jon before starting — the things the brief leaves open that change the plan. Three to six, specific.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'What you assumed in the meantime, so they can be corrected.' },
  },
  required: ['title', 'summary', 'category', 'priority', 'weeks', 'phases', 'quotes', 'questions', 'assumptions'],
}

const SYSTEM = `You are Eve, the operations brain at Stay Hospitality, a short-term rental operator in South Florida (Miami, Broward, North / Palm Beach). Jon, the GM, tells you in a few lines what he wants done — sometimes with files attached (a quote, photos, an owner's email, a checklist). You turn it into a project the team can run week by week, in Breezeway for field work and on the project board for office work.

How to plan:
- Break the brief into PHASES in the order the work really happens. For physical work that is usually: walk & scope (inspect, photograph, measure) → quotes → owner / budget approval → order & schedule → the work → closeout (punch list, after photos, listing updated, owner billed). Skip a phase the brief does not need; add one it does.
- BE SPECIFIC. Every task names the thing, the place and the quantity: which units (from the list given, exactly as written), which floors or areas, how many, what to measure or photograph, what to bring. Every task says what DONE means so a supervisor can check it without asking. Use what the attached files say — quantities, prices, model numbers, the owner's exact words.
- ONE action per task. "Inspect every unit" is ONE task per building walk with every unit listed in "units" (the units become its checklist), not forty tasks — unless the brief wants a different person per unit.
- WHERE: field work (walk, inspect, clean, repair, install, meet the vendor on site) is a Breezeway task with a dept; office work (get a quote, compare quotes, get approval, order, schedule, write the notice, update the listing, bill the owner) is a board task.
- Every quote the brief asks for is a board task of kind "quote" AND an entry in quotes, with the scope spelled out (what, how many, which units). Two quotes per trade for anything over a few hundred dollars.
- Work that needs owner approval or spend gets an "approve" task before it, high priority.
- Put a week on everything. Week 1 is the first week. Be realistic: quotes take a week to come back, vendors book a week or two out, approvals take days, and nothing in a unit happens while a guest is in it.
- Owners: pick from the roster given, by role — supervisors and the ops manager walk and scope; maintenance techs do repairs and small works; housekeepers clean; the ops manager or GM chases vendors, quotes and approvals; CCS handles guest-facing notices. Field tasks need a field person. Leave the owner empty rather than guess.
- Questions: what you genuinely need to know before this can start — budget ceiling, owner involvement, dates that must be avoided (high season, bookings), scope edges, access. Assumptions: what you assumed instead.
- Tone: plain, specific, no filler. Titles a supervisor would write; no adjectives that do no work.`

type Unit = { id: string; name: string; building: string | null }
type Ctx = {
  categories: { key: string; label: string }[]
  roster: { name: string; role: string | null; field: boolean }[]
  buildings: { label: string; market: string; vendor: boolean }[]
  units: Unit[]
  today: string
}

async function context(): Promise<Ctx> {
  const sb = supabaseAdmin()
  const [categories, { data: users }, { data: listings }] = await Promise.all([
    getCategories().catch(() => [] as any[]),
    sb.from('app_users').select('email,profile,role').eq('status', 'active').limit(200),
    sb.from('guesty_listings').select('id,nickname,title,building,status').limit(1000),
  ])
  const roster: Ctx['roster'] = []
  const seen = new Set<string>()
  for (const u of (users || []) as any[]) {
    const name = String((u.profile && (u.profile.name || u.profile.full_name)) || u.email)
    const k = personKey(name) || String(u.email).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    roster.push({ name, role: str((u.profile && u.profile.title) || u.role) || null, field: false })
  }
  try {
    const { listBreezewayPeople } = await import('@/lib/breezeway')
    for (const bp of await listBreezewayPeople()) {
      const k = personKey(bp.name)
      if (!k) continue
      const twin = roster.find(r => nameMatches(r.name, bp.name))
      if (twin) { twin.field = true; if (!twin.role && bp.departments?.length) twin.role = bp.departments.join('/'); continue }
      if (seen.has(k)) continue
      seen.add(k); roster.push({ name: bp.name, role: (bp.departments || []).join('/') || bp.role || 'field', field: true })
    }
  } catch { /* the app users alone are a usable roster */ }
  const units: Unit[] = ((listings || []) as any[])
    .filter(l => String(l.status || 'active').toLowerCase() !== 'inactive')
    .map(l => { const name = String(l.nickname || l.title || 'Unit'); return { id: String(l.id), name, building: buildingOf(l.building, name) } })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { categories: (categories || []).map((c: any) => ({ key: String(c.key), label: String(c.label) })), roster, buildings: KNOWN_BUILDINGS.map(b => ({ label: b.label, market: b.market, vendor: b.vendor })), units, today: todayISO() }
}

/** The buildings the brief names, so the unit list Eve sees is theirs and not all 290. */
function briefBuildings(brief: string, ctx: Ctx): string[] {
  const low = brief.toLowerCase()
  return ctx.buildings.filter(b => low.includes(b.label.toLowerCase())).map(b => b.label)
}

/** Trim the model's plan to the shapes we store; owners must be real roster names, units real units. */
function normalise(raw: any, ctx: Ctx): Plan {
  const rosterNames = ctx.roster.map(r => r.name)
  const owner = (v: any): string | null => { const s = str(v); if (!s) return null; return rosterNames.find(n => n === s) || rosterNames.find(n => nameMatches(n, s)) || null }
  const unitName = (v: any): string | null => { const s = str(v); if (!s) return null; const hit = ctx.units.find(u => u.name === s) || ctx.units.find(u => u.name.toLowerCase() === s.toLowerCase()); return hit ? hit.name : null }
  const weeks = int(raw?.weeks, 1, 12, 4)
  const phases: PlanPhase[] = (Array.isArray(raw?.phases) ? raw.phases : []).slice(0, 12).map((p: any) => ({
    name: str(p?.name).slice(0, 80) || 'Phase',
    week: int(p?.week, 1, weeks, 1),
    tasks: (Array.isArray(p?.tasks) ? p.tasks : []).slice(0, 40).map((t: any): PlanTask => {
      const kind = (KINDS as readonly string[]).includes(str(t?.kind)) ? str(t?.kind) as PlanTask['kind'] : 'work'
      const units = Array.from(new Set((Array.isArray(t?.units) ? t.units : []).map(unitName).filter(Boolean))) as string[]
      const where: PlanTask['where'] = str(t?.where) === 'breezeway' || (!str(t?.where) && (kind === 'inspect' || kind === 'clean')) ? 'breezeway' : 'board'
      const dept: PlanTask['dept'] = (DEPTS as readonly string[]).includes(str(t?.dept)) ? str(t?.dept) as PlanTask['dept'] : kind === 'inspect' ? 'inspection' : kind === 'clean' ? 'housekeeping' : 'maintenance'
      return {
        title: str(t?.title).slice(0, 300), done: str(t?.done).slice(0, 400), detail: str(t?.detail).slice(0, 800),
        kind, where, dept, units: units.slice(0, 60),
        owner: owner(t?.owner), week: int(t?.week, 1, weeks, int(p?.week, 1, weeks, 1)),
        priority: (PRIORITIES as readonly string[]).includes(str(t?.priority)) ? str(t?.priority) : 'normal',
        checklist: (Array.isArray(t?.checklist) ? t.checklist : []).map(str).filter(Boolean).slice(0, 60),
      }
    }).filter((t: PlanTask) => t.title),
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
    quotes: (Array.isArray(raw?.quotes) ? raw.quotes : []).slice(0, 20).map((q: any) => ({ what: str(q?.what).slice(0, 300), from: str(q?.from).slice(0, 120) })).filter((q: any) => q.what),
    questions: (Array.isArray(raw?.questions) ? raw.questions : []).map(str).filter(Boolean).slice(0, 8),
    assumptions: (Array.isArray(raw?.assumptions) ? raw.assumptions : []).map(str).filter(Boolean).slice(0, 8),
  }
}

const WORDS_PER_FILE = 6000
function attachmentPack(atts: Attachment[]): string {
  if (!atts.length) return ''
  return '\n\nATTACHED FILES (read in full; use their specifics):\n' + atts.map(a => {
    const words = a.text.split(/\s+/)
    const body = words.length > WORDS_PER_FILE ? words.slice(0, WORDS_PER_FILE).join(' ') + ' …[cut]' : a.text
    return `--- ${a.name} (${a.words} words, ${a.method}) ---\n${body}`
  }).join('\n\n')
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const me = String(g.access.email || '')
  const ctype = req.headers.get('content-type') || ''

  // ── DRAFT (multipart: brief + files) ──
  if (/multipart\/form-data/i.test(ctype)) {
    const form = await req.formData()
    const action = str(form.get('action'))
    if (action !== 'draft') return NextResponse.json({ ok: false, error: 'multipart is for drafting' }, { status: 400 })
    const brief = str(form.get('brief')).slice(0, 6000)
    if (brief.length < 8) return NextResponse.json({ ok: false, error: 'Tell Eve what you want done — a few lines is enough.' }, { status: 400 })
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ ok: false, error: 'No model key on the server.' }, { status: 500 })
    // Files already read on an earlier draft come back as text so they are not transcribed twice.
    const prior: Attachment[] = (() => { try { const j = JSON.parse(str(form.get('attachments')) || '[]'); return Array.isArray(j) ? j.filter((a: any) => a && a.name && a.text).map((a: any) => ({ name: str(a.name).slice(0, 200), words: Number(a.words) || 0, method: str(a.method), text: String(a.text).slice(0, 60000) })) : [] } catch { return [] } })()
    const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f && (f as File).size > 0).slice(0, 8)
    const attachments: Attachment[] = [...prior]
    const refused: string[] = []
    for (const f of files) {
      const r = await extractFile(f, 'plan/' + me.replace(/[^a-z0-9]+/gi, '_'))
      if (r.ok) attachments.push({ name: r.name, words: r.words, method: r.method, text: r.text })
      else refused.push(r.error)
    }
    const ctx = await context()
    const named = briefBuildings(brief + ' ' + attachments.map(a => a.text.slice(0, 2000)).join(' '), ctx)
    const unitsShown = named.length ? ctx.units.filter(u => u.building && named.includes(u.building)) : []
    const pack = [
      `Today: ${ctx.today}. Plans start the following Monday.`,
      `Buildings: ${ctx.buildings.map(b => b.label + ' (' + b.market + (b.vendor ? ', vendor-run: their own crew does the field work' : '') + ')').join('; ')}.`,
      unitsShown.length ? `Units in ${named.join(' / ')} (use these exact names in \`units\`): ${unitsShown.map(u => u.name).join('; ')}.` : 'No building named in the brief, so no unit list — ask which building if the work is in one.',
      `Roster (name — role · field = can take Breezeway tasks): ${ctx.roster.map(r => r.name + (r.role ? ' — ' + r.role : '') + (r.field ? ' · field' : '')).join('; ')}.`,
      `Category keys: ${ctx.categories.map(c => c.key + ' (' + c.label + ')').join(', ')}.`,
      '', 'THE BRIEF, in Jon’s words:', brief,
      attachmentPack(attachments),
    ].join('\n')
    const { model, fallback } = await modelPairFor('project-plan')
    const r = await anthropicMessages(key, {
      model, max_tokens: 6000, system: SYSTEM,
      tools: [{ name: 'plan', description: 'The project plan.', input_schema: SCHEMA }], tool_choice: { type: 'tool', name: 'plan' },
      messages: [{ role: 'user', content: pack }],
    }, fallback, 'project-plan')
    const out = (r.data?.content || []).find((c: any) => c.type === 'tool_use')?.input
    if (!r.ok || !out) return NextResponse.json({ ok: false, error: 'Eve could not draft that just now' + (r.data?.error?.message ? ' — ' + String(r.data.error.message).slice(0, 120) : '.') }, { status: 502 })
    const plan = normalise(out, ctx)
    if (!plan.phases.length) return NextResponse.json({ ok: false, error: 'Eve came back without any tasks. Try a fuller brief.' }, { status: 502 })
    return NextResponse.json({
      ok: true, plan, model: r.model,
      roster: ctx.roster.map(x => ({ name: x.name, field: x.field })), categories: ctx.categories, buildings: ctx.buildings.map(x => x.label),
      units: (plan.building ? ctx.units.filter(u => u.building === plan.building) : unitsShown).map(u => u.name),
      attachments, refused,
    })
  }

  // ── CREATE (json) ──
  const b = await req.json().catch(() => ({} as any))
  if (str(b?.action) !== 'create') return NextResponse.json({ ok: false, error: 'action must be draft (multipart) or create (json)' }, { status: 400 })
  const brief = str(b?.brief).slice(0, 8000)
  const ctx = await context()
  const plan = normalise(b?.plan, ctx)
  if (!plan.phases.length) return NextResponse.json({ ok: false, error: 'Nothing to create — the plan has no tasks.' }, { status: 400 })
  const attachments: Attachment[] = Array.isArray(b?.attachments) ? b.attachments.filter((a: any) => a && a.name).map((a: any) => ({ name: str(a.name).slice(0, 200), words: Number(a.words) || 0, method: str(a.method), text: String(a.text || '').slice(0, 60000) })) : []
  const sb = supabaseAdmin()
  const start = /^\d{4}-\d{2}-\d{2}$/.test(str(b?.starts_on)) ? str(b.starts_on) : nextMonday(todayISO())
  const due = addDays(start, plan.weeks * 7 - 3)   // the Friday of the last week

  const row: any = {
    title: plan.title, summary: plan.summary || null, category: plan.category, stage: 'planned', priority: plan.priority,
    lead_email: me, market: plan.market, building: plan.building, starts_on: start, due_on: due,
    kind: 'project', created_by: me, approval: 'not_needed',
  }
  const { data: p, error } = await sb.from('projects').insert(row).select('id').maybeSingle()
  if (error || !p) return NextResponse.json({ ok: false, error: error?.message || 'insert failed' }, { status: 500 })
  const meP = toPerson(me)
  await sb.from('project_members').upsert([{ project_id: p.id, ...meP, role: 'owner', added_by: me }], { onConflict: 'project_id,person_key' })

  // Sections = phases; a task's due date is the Friday of its week; the description carries the
  // week, where it lives, what done means and the how — so a task read alone still says it all.
  // A multi-unit task's checklist is its units (one sub-task per unit, each pushed to Breezeway).
  const tpl: Template = {
    key: 'eve_plan', label: 'Planned with Eve', kind: 'project', category: plan.category, icon: '✨', accent: 'violet',
    sections: plan.phases.map(ph => ({
      name: ph.name,
      tasks: ph.tasks.map(t => ({
        title: t.title,
        description: [
          `Week ${t.week} · ${t.where === 'breezeway' ? 'Breezeway · ' + t.dept : 'board'}${t.kind !== 'work' ? ' · ' + t.kind : ''}${t.units.length ? ' · ' + t.units.length + ' unit' + (t.units.length === 1 ? '' : 's') : ''}`,
          t.done ? 'Done means: ' + t.done : '',
          t.detail,
        ].filter(Boolean).join('\n'),
        priority: t.priority, dueOffsetDays: (t.week - 1) * 7 + 4,
        checklist: t.units.length > 1 ? t.units : (t.checklist.length ? t.checklist : undefined),
      })),
    })),
  }
  try { await applyTemplate(p.id, tpl, { startsOn: start, createdBy: me }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: 'Project created but its tasks did not land: ' + String(e?.message || e), id: p.id }, { status: 500 }) }
  await sb.from('projects').update({ template_key: null }).eq('id', p.id)

  // The created rows, matched back by section + title (parents) and parent + title (unit sub-tasks).
  const { data: stepsAll } = await sb.from('project_steps').select('id,title,section,parent_id').eq('project_id', p.id)
  const steps = (stepsAll || []) as { id: string; title: string; section: string | null; parent_id: string | null }[]
  const parentOf = (ph: PlanPhase, t: PlanTask) => steps.find(x => !x.parent_id && x.section === ph.name && x.title === t.title) || null

  // Owners → assignees, on the parent and on every unit sub-task.
  const asg: any[] = []
  for (const ph of plan.phases) for (const t of ph.tasks) {
    if (!t.owner) continue
    const parent = parentOf(ph, t); if (!parent) continue
    const who = toPerson(t.owner)
    asg.push({ task_id: parent.id, project_id: p.id, ...who, role: 'assignee' })
    for (const k of steps.filter(x => x.parent_id === parent.id)) asg.push({ task_id: k.id, project_id: p.id, ...who, role: 'assignee' })
  }
  if (asg.length) {
    const { error: aErr } = await sb.from('project_task_assignees').upsert(asg, { onConflict: 'task_id,person_key' })
    if (!aErr) for (const a of asg) await sb.from('project_steps').update({ assignee: a.display }).eq('id', a.task_id)
  }

  // Units → links on the parent task, so "Send to Breezeway" and the unit pages know.
  const unitId = (name: string) => ctx.units.find(u => u.name === name)?.id || null
  const links: any[] = []
  for (const ph of plan.phases) for (const t of ph.tasks) {
    const parent = parentOf(ph, t); if (!parent) continue
    for (const u of t.units) { const lid = unitId(u); if (lid) links.push({ project_id: p.id, task_id: parent.id, kind: 'listing', ref_id: lid, label: null }) }
  }
  if (links.length) await sb.from('project_links').insert(links.slice(0, 400)).then(() => {}, () => {})

  // ── BREEZEWAY: one field task per unit, assigned to the same person, dated to the week ──
  const bz = { created: 0, assigned: 0, skipped: [] as string[] }
  const wantBz = plan.phases.some(ph => ph.tasks.some(t => t.where === 'breezeway'))
  if (wantBz) {
    try {
      const { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson } = await import('@/lib/breezeway')
      const { neverAssignGuard } = await import('@/lib/never-assign')
      const guard = await neverAssignGuard()
      const homeIds: Record<string, number> = {}
      const allLids = Array.from(new Set(links.map(l => String(l.ref_id))))
      if (allLids.length) {
        const { data: props } = await sb.from('breezeway_properties').select('home_id,reference_property_id').in('reference_property_id', allLids)
        for (const pr of (props || []) as any[]) homeIds[String(pr.reference_property_id)] = Number(pr.home_id)
      }
      let budget = 40   // never more than 40 field tasks from one press
      for (const ph of plan.phases) for (const t of ph.tasks) {
        if (t.where !== 'breezeway') continue
        const parent = parentOf(ph, t); if (!parent) continue
        const kids = steps.filter(x => x.parent_id === parent.id)
        const targets: { stepId: string; unit: string }[] = t.units.length > 1
          ? t.units.map(u => ({ stepId: kids.find(k => k.title === u)?.id || parent.id, unit: u }))
          : t.units.length === 1 ? [{ stepId: parent.id, unit: t.units[0] }] : []
        if (!targets.length) { bz.skipped.push(`${t.title}: no unit named — send it from the board when you know where`); continue }
        let personId: number | null = null
        if (t.owner) { personId = await matchBreezewayPerson(t.owner).catch(() => null); if (personId && !guard.keepIds([personId]).length) personId = null }
        const date = addDays(start, (t.week - 1) * 7)
        for (const tg of targets) {
          if (budget-- <= 0) { bz.skipped.push(`${t.title} @ ${tg.unit}: over the 40-task limit — send the rest from the board`); continue }
          const lid = unitId(tg.unit); if (!lid) { bz.skipped.push(`${t.title} @ ${tg.unit}: unit not found`); continue }
          const payload: Record<string, any> = {
            name: (t.units.length > 1 ? `${t.title} — ${tg.unit}` : t.title).slice(0, 120),
            type_department: t.dept, type_priority: t.priority, scheduled_date: date,
            description: [t.done ? 'Done means: ' + t.done : '', t.detail, t.checklist.length && t.units.length <= 1 ? 'Checklist:\n- ' + t.checklist.join('\n- ') : '', `From the “${plan.title}” project in Lighthouse · planned with Eve · sent by ${me}`].filter(Boolean).join('\n\n').slice(0, 1500),
          }
          if (Number.isFinite(homeIds[lid])) payload.home_id = homeIds[lid]; else payload.reference_property_id = lid
          const r = await createBreezewayTask(payload)
          if (!r.ok || !r.data?.id) { bz.skipped.push(`${t.title} @ ${tg.unit}: Breezeway ${r.status}`); continue }
          const bzId = String(r.data.id)
          bz.created++
          let assigned = false
          if (personId) { try { assigned = !!(await updateBreezewayTask(bzId, { assignments: [personId] })).ok } catch { assigned = false } }
          if (assigned) bz.assigned++
          await sb.from('project_steps').update({ breezeway_task_id: bzId }).eq('id', tg.stepId)
          try { await sb.from('breezeway_tasks_sync').upsert({ id: bzId, reference_property_id: lid, name: payload.name, status: 'created', scheduled_date: date, type_department: t.dept, assignees: [], report_url: r.data.report_url || null, raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString() }, { onConflict: 'id' }) } catch { /* the sync catches up */ }
        }
      }
      if (bz.created) { bustBoards(); await logEvent(p.id, me, 'task_moved', `${bz.created} field task${bz.created === 1 ? '' : 's'} created in Breezeway by the plan (${bz.assigned} assigned)`, { to: 'breezeway', name: String(bz.created) }) }
    } catch (e: any) { bz.skipped.push('Breezeway: ' + String(e?.message || e).slice(0, 120)) }
  }

  const quotes = plan.quotes.length ? '\n\nQuotes to get: ' + plan.quotes.map(q => q.what + ' (' + q.from + ')').join('; ') : ''
  const open = plan.questions.length ? '\n\nStill open: ' + plan.questions.join(' · ') : ''
  const assumed = plan.assumptions.length ? '\n\nAssumed: ' + plan.assumptions.join(' · ') : ''
  const read = attachments.length ? '\n\nFiles Eve read for this plan: ' + attachments.map(a => a.name + ' (' + a.words + ' words)').join(', ') : ''
  const field = bz.created || bz.skipped.length ? '\n\nBreezeway: ' + bz.created + ' field task' + (bz.created === 1 ? '' : 's') + ' created, ' + bz.assigned + ' assigned' + (bz.skipped.length ? '. Not sent: ' + bz.skipped.join('; ') : '') : ''
  await addNote(p.id, `Planned with Eve from this brief:\n\n${brief || '(no brief kept)'}${quotes}${open}${assumed}${read}${field}`, me, 'comment', false)
  await addNote(p.id, 'created this project with Eve', me, 'event', false, { meta: { type: 'stage', name: 'created' } })
  return NextResponse.json({ ok: true, id: p.id, tasks: plan.phases.reduce((a, ph) => a + ph.tasks.length, 0), assigned: asg.length, breezeway: bz })
}
