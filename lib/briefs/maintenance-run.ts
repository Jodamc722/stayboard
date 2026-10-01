// MAINTENANCE RUN — one technician's morning (Jon, 2026-10-01). Per tech, in his language:
//   Do first (guest-reported, pest, a unit that is empty only today) → Your list, ordered by the
//   window (empty today → arriving today → occupied, call first → building & common areas) →
//   Free trips (you are already going there, take this with you) → the charge reminder → the
//   shape of the day. Roberto gets the combined version (every tech, same order).
import 'server-only'
import { gather, niceDay } from '@/lib/ops-brief'
import { getShifts, nameMatches } from '@/lib/homebase'
import { buildReviewQueue, niceDate } from '@/lib/review-queue'
import { maintData } from '@/lib/maint-brief'
import { getStaff } from '@/lib/staffing'
import { translator, type BriefLang } from '@/lib/brief-lang'
import { ACCENTS, APP_URL, T, esc, masthead, headline, section, block, dayShape, footer, fit, pill, cleanTitle, unitShort, personName, isOfficeLike, type Line } from './ui'
import type { Built } from './field-run'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length
const capped = <X,>(p: Promise<X>, ms = 45_000): Promise<X | null> => Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))])

type Job = { unit: string; lid: string; task: string; who: string; state: string; kind: 'guest' | 'pest' | 'arrival' | 'empty' | 'occupied' | 'building' | 'other'; age: number | null; withOthers: string[] }

/** Every maintenance technician with something on the board today (or a shift), portfolio-wide. */
export async function maintenanceTechs(): Promise<string[]> {
  const d = await gather('full')
  const names = new Set<string>()
  const deptMap: Record<string, string> = d.deptOfPerson || {}
  for (const o of d.hkOther as any[]) if (o.dept === 'maintenance' && !/UNASSIGNED/.test(o.assignee) && /maint/.test(str(deptMap[o.lead || o.assignee]))) names.add(personName(o.lead || o.assignee))
  try { for (const s of await getStaff()) if (s.active && /maint/i.test(str(s.dept) + ' ' + str(s.role))) names.add(personName(s.name)) } catch { /* board only */ }
  return Array.from(names).filter(n => !isOfficeLike(n) && !(d.officeNames || []).some((o: string) => nameMatches(o, n)))
}

export async function buildMaintenanceRun(tech: string | 'all', lang: BriefLang = 'en'): Promise<Built> {
  const { t, pick } = translator(lang)
  const A = ACCENTS.maint
  const d = await gather('full')
  const sheet: any = d.sheet || {}
  const today = d.today
  const scope = new Set<string>(); const nameOf: Record<string, string> = {}
  for (const o of d.hkOther as any[]) { scope.add(o.lid); nameOf[o.lid] = o.unit }
  const [shifts, mMi, mBr, review] = await Promise.all([
    capped(getShifts(today, 'America/New_York')),
    capped(maintData('Miami')), capped(maintData('Broward')),
    capped(buildReviewQueue(Array.from(scope), today, { nameOf, horizon: 7 })),
  ])

  // ---- the state of every unit today --------------------------------------------------------
  const arrivingLids = new Set<string>((sheet.arrivals || []).map((a: any) => str(a.listingId)))
  const leavingLids = new Set<string>((sheet.departures || []).map((a: any) => str(a.listingId)))
  const vacantLids = new Set<string>((sheet.vacants || []).map((a: any) => str(a.listingId)))
  const emptyToday = (lid: string) => vacantLids.has(lid) || (leavingLids.has(lid) && !arrivingLids.has(lid))
  const occupiedToday = (lid: string) => !emptyToday(lid) && !arrivingLids.has(lid) && lid !== '' && !!lid
  const ageOf: Record<string, number> = {}
  for (const m of [mMi, mBr]) for (const lid of Object.keys(m?.openByUnit || {})) for (const tk of (m as any).openByUnit[lid].tasks) { const k = lid + '|' + str(tk.name).slice(0, 40); if (tk.age != null) ageOf[k] = tk.age }

  // ---- today's maintenance board, by technician ---------------------------------------------
  const deptMap: Record<string, string> = d.deptOfPerson || {}
  const deptOfName = (n: string) => str(deptMap[n] || deptMap[Object.keys(deptMap).find(k => nameMatches(k, n)) || ''])
  const office = (d.officeNames || []) as string[]
  const isTechName = (n: string) => !isOfficeLike(n) && !office.some(o => nameMatches(o, n)) && (/maint/.test(deptOfName(n)) || (tech !== 'all' && nameMatches(n, tech)))
  const jobs: Record<string, Job[]> = {}
  const unowned: Job[] = []
  let heldByOthers = 0
  for (const o of d.hkOther as any[]) {
    if (o.dept !== 'maintenance' || o.state === 'done') continue
    const ppl = str(o.assignee).split(',').map((x: string) => x.trim()).filter(Boolean)
    const who = /UNASSIGNED/.test(o.assignee) ? '' : (o.lead || ppl[0] || '')
    const title = cleanTitle(o.task, lang)
    const raw = str(o.task).toLowerCase()
    // GUEST means the guest raised it — the title says so at the front ("Guest reported…", a glitch,
    // a request). A job that merely mentions a guest ("…/guest stairways") is not one.
    const kind: Job['kind'] = /roach|pest|bed ?bug|cucaracha|plaga|insect|fogg/.test(raw) ? 'pest'
      : /^(guest|hu[eé]sped)|glitch|guest (reported|requested|says|complain|report)/.test(raw) ? 'guest'
      : !o.lid || o.unit === 'Unknown unit' || /common|lobby|pool|drain|floor \d|hallway|landing|laundry|trash|basura|pasillo|building/.test(raw) ? 'building'
      : arrivingLids.has(o.lid) ? 'arrival' : emptyToday(o.lid) ? 'empty' : occupiedToday(o.lid) ? 'occupied' : 'other'
    const j: Job = { unit: o.unit === 'Unknown unit' ? pick('Building / common area', 'Edificio / área común') : o.unit, lid: o.lid, task: title, who, state: o.state, kind, age: ageOf[o.lid + '|' + str(o.task).slice(0, 40)] ?? null, withOthers: ppl.filter((p: string) => p !== who && !/^[—-]/.test(p)) }
    if (!who) { unowned.push(j); continue }
    // ONLY THE TECHNICIANS (2026-10-01). A maintenance-department task held by a supervisor, the
    // office or the CCS line is not a technician's run — it stays on the Ops Desk and the boards.
    if (!isTechName(who)) { heldByOthers++; continue }
    ;(jobs[personName(who)] = jobs[personName(who)] || []).push(j)
  }
  // A tech covering a departure clean today — it is on his list, first.
  const coverCleans: Record<string, string[]> = {}
  for (const c of d.cleans as any[]) { const n = c.lead || c.assignee; if (/maint/.test(str((d.deptOfPerson || {})[n]))) (coverCleans[n] = coverCleans[n] || []).push(c.unit) }

  const ORDER: Job['kind'][] = ['pest', 'guest', 'empty', 'arrival', 'occupied', 'other', 'building']
  const rank = (j: Job) => ORDER.indexOf(j.kind)
  const sortJobs = (xs: Job[]) => xs.slice().sort((a, b) => rank(a) - rank(b) || (b.age || 0) - (a.age || 0) || a.unit.localeCompare(b.unit))
  const kindPill = (j: Job) => j.kind === 'pest' ? pill(pick('PEST', 'PLAGA'), 'red') : j.kind === 'guest' ? pill(pick('GUEST', 'HUÉSPED'), 'red') : j.kind === 'empty' ? pill(pick('EMPTY TODAY', 'VACÍA HOY'), 'green') : j.kind === 'arrival' ? pill(pick('ARRIVES 4PM', 'LLEGA 4PM'), 'amber') : j.kind === 'occupied' ? pill(pick('OCCUPIED — CALL FIRST', 'OCUPADA — LLAMAR ANTES'), 'amber') : ''
  const jobRow = (j: Job) => `<b>${esc(unitShort(j.unit))}</b> · ${esc(j.task)} ${kindPill(j)}${j.age && j.age >= 3 ? ` <span style="${T.amber};font-size:11px">${j.age}d</span>` : ''}${j.state === 'running' ? ' ' + pill(t('in progress'), 'amber') : ''}${j.withOthers.length ? `<span style="${T.muted};font-size:11.5px"> · ${pick('with', 'con')} ${j.withOthers.slice(0, 2).map(first).map(esc).join(', ')}</span>` : ''}`

  const onShift = ((shifts || []) as any[]).filter(s => !s.open && s.startAt)
  const shiftLabel = (n: string) => str(onShift.find(s => nameMatches(s.name, n))?.label)
  const techs = tech === 'all' ? Object.keys(jobs).sort((a, b) => jobs[b].length - jobs[a].length) : [Object.keys(jobs).find(n => nameMatches(n, tech)) || personName(tech)]
  const rv: any = review
  const freeFor = (n: string) => (rv?.items || []).filter((i: any) => i.target?.hasTrade && (i.target.who || []).some((w: string) => nameMatches(w, n))).slice(0, 3)

  // ---- per technician ------------------------------------------------------------------------
  const doFirstAll: Line[] = []
  const techBlocks: string[] = []
  for (const n of techs) {
    const list = sortJobs(jobs[n] || [])
    const urgent = list.filter(j => j.kind === 'pest' || j.kind === 'guest' || (j.kind === 'empty' && (j.age || 0) >= 2)).slice(0, 3)
    for (const j of urgent) doFirstAll.push({ tone: j.kind === 'pest' || j.kind === 'guest' ? 'red' : 'amber', html: (tech === 'all' ? `<b>${esc(first(n))}</b> → ` : '') + jobRow(j), sub: j.kind === 'guest' || j.kind === 'occupied' ? pick('Guest is in the unit or waiting on this — message them before you go.', 'El huésped está en la unidad o esperando — escríbale antes de ir.') : j.kind === 'pest' ? pick('Treat today; block the next arrival if it is not clear.', 'Tratar hoy; bloquear la próxima llegada si no está resuelto.') : pick('Only empty today — the next window may be weeks away.', 'Vacía solo hoy — la próxima ventana puede ser en semanas.') })
    const free = freeFor(n)
    const covering = coverCleans[n] || []
    const meta = [shiftLabel(n) || pick('no Homebase shift today', 'sin turno en Homebase hoy'), `${list.length} ${list.length === 1 ? pick('job', 'trabajo') : pick('jobs', 'trabajos')}`, covering.length ? `<b style="${T.amber}">${pick('covering a clean', 'cubre una limpieza')}: ${covering.map(unitShort).map(esc).join(', ')}</b>` : ''].filter(Boolean).join(' · ')
    const rows = list.map(jobRow)
    techBlocks.push(`<p style="margin:10px 0 2px;font-size:13px"><b>${esc(n)}</b> <span style="${T.muted};font-size:12px">· ${meta}</span></p>` +
      (rows.length ? `<table cellspacing="0" cellpadding="0" style="margin-left:4px">${rows.slice(0, tech === 'all' ? 8 : 14).map((h, i) => `<tr><td style="width:18px;padding:2px 0;font-size:12.5px;color:#9ca3af;vertical-align:top">${i + 1}</td><td style="padding:2px 0;font-size:13px;line-height:1.45">${h}</td></tr>`).join('')}${rows.length > (tech === 'all' ? 8 : 14) ? `<tr><td></td><td style="padding:2px 0;font-size:11.5px;color:#9ca3af">+${rows.length - (tech === 'all' ? 8 : 14)} ${t('more on the board')}</td></tr>` : ''}</table>` : `<p style="margin:2px 0 0 4px;font-size:12.5px;color:#6b7280">${pick('Nothing on the board — take a carryover from the Review tab.', 'Nada en el tablero — tome un pendiente de la pestaña Review.')}</p>`) +
      (free.length ? `<p style="margin:6px 0 0 4px;font-size:12px;color:#065f46">${pick('Free trips', 'Viajes gratis')}: ${free.map((i: any) => `<b>${esc(unitShort(i.unit))}</b> ${esc(niceDate(i.target.date))} — ${esc(cleanTitle(i.task, lang))}`).join(' · ')}</p>` : ''))
  }
  const unownedLines: Line[] = sortJobs(unowned).slice(0, 4).map(j => ({ tone: 'red', html: jobRow(j), sub: pick('Nobody is on it.', 'Nadie lo tiene.') }))
  if (heldByOthers && tech === 'all') unownedLines.push({ tone: 'none', html: `<span style="${T.muted}">${heldByOthers} ${pick('maintenance jobs are held by supervisors or the office — on the Ops Desk, not here.', 'trabajos de mantenimiento los tienen supervisores u oficina — en el Ops Desk, no aquí.')}</span>` })

  // ---- the charge reminder — the one number a tech moves ---------------------------------------
  const noCharge7 = Number(mMi?.d7?.noCharge || 0) + Number(mBr?.d7?.noCharge || 0)
  const reminder = noCharge7 ? `<p style="margin:6px 0 0;font-size:13px"><b>${noCharge7}</b> ${pick('tasks were closed this week with no charge entered', 'tareas se cerraron esta semana sin cargo')}. <span style="${T.muted}">${pick('When you close a job, type the cost — parts and time. A close with no cost bills the owner nothing.', 'Al cerrar un trabajo, escriba el costo — piezas y tiempo. Un cierre sin costo no factura nada al propietario.')}</span></p>` : ''

  // ---- shape of the day --------------------------------------------------------------------
  const allJobs = techs.flatMap(n => jobs[n] || [])
  const k = (x: Job['kind']) => allJobs.filter(j => j.kind === x).length
  const steps = [
    { at: pick('start', 'inicio'), do: `${pick('Message every guest whose unit you need to enter', 'Escriba a cada huésped cuya unidad deba entrar')} (${k('guest') + k('occupied')}). ${pick('Pest and guest-reported first.', 'Plagas y reportes de huéspedes primero.')}` },
    { at: '10–4', do: `${pick('Empty units while they are empty', 'Unidades vacías mientras lo estén')} (${k('empty')})${k('arrival') ? ` · ${pick('arrival units finished before 4pm', 'las de llegada listas antes de las 4pm')} (${k('arrival')})` : ''}.` },
    { at: pick('between', 'entre'), do: `${pick('Occupied units by appointment only', 'Unidades ocupadas solo con cita')} (${k('occupied')}). ${pick('Free trips ride along.', 'Los viajes gratis van de paso.')}` },
    { at: pick('after 4', 'después 4'), do: `${pick('Building and common areas', 'Edificio y áreas comunes')} (${k('building')}). ${pick('Close every job in Breezeway with its cost before you leave.', 'Cierre cada trabajo en Breezeway con su costo antes de irse.')}` },
  ]

  // ---- assemble ------------------------------------------------------------------------------
  const who = tech === 'all' ? pick('All technicians', 'Todos los técnicos') : first(techs[0])
  const head = `<b>${allJobs.length}</b> ${pick('jobs', 'trabajos')} · <b style="${T.red}">${k('pest') + k('guest')}</b> ${pick('guest / pest', 'huésped / plaga')} · <b style="${T.green}">${k('empty')}</b> ${pick('in empty units', 'en unidades vacías')} · <b style="${T.amber}">${k('arrival')}</b> ${pick('before 4pm', 'antes de las 4pm')}${unowned.length ? ` · <b style="${T.red}">${unowned.length} ${pick('with nobody', 'sin nadie')}</b>` : ''}`
  const parts = [
    { html: masthead(A, pick('Maintenance Run', 'Ruta de mantenimiento'), who, niceDay(today)) },
    { html: headline(A, head, [{ label: pick('Maintenance board', 'Tablero de mantenimiento'), href: `${APP_URL}/maintenance` }, { label: pick('Review tab', 'Pestaña Review'), href: `${APP_URL}/plan?tab=review` }]) },
    { html: doFirstAll.length ? section(pick('Do first', 'Primero'), doFirstAll, { cap: 5, accent: A }) : '' },
    { html: block(pick('Your list — in order', 'Su lista — en orden'), techBlocks.join('') || `<p style="margin:6px 0 0;font-size:13px;color:#6b7280">${t('Nothing on the board today.')}</p>`, A, allJobs.length) },
    { html: unownedLines.length && tech === 'all' ? section(pick('Nobody on it', 'Sin asignar'), unownedLines, { cap: 4, accent: A }) : '', optional: true },
    { html: dayShape(A, steps, pick('Shape of the day', 'Forma del día')) },
    { html: reminder ? block(pick('Charges', 'Cargos'), reminder, A) : '', optional: true },
    { html: footer(pick('Maintenance Run · every morning at 7 · the board has the live picture.', 'Ruta de mantenimiento · cada mañana a las 7 · el tablero tiene la foto en vivo.')) },
  ]
  const { html } = fit(parts, 60_000)
  const subject = `${pick('Maintenance Run', 'Ruta de mantenimiento')}${tech === 'all' ? '' : ' · ' + who} · ${allJobs.length} ${pick('jobs', 'trabajos')}${k('pest') + k('guest') ? ` · ${k('pest') + k('guest')} ${pick('urgent', 'urgentes')}` : ''} · ${niceDay(today)}`
  return { subject, html, words: words(html), counts: { jobs: allJobs.length, urgent: k('pest') + k('guest'), empty: k('empty'), unowned: unowned.length, techs: techs.length } }
}
