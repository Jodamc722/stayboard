// FIELD RUN — the field coordinator's morning (Jon, 2026-10-01). One market, one screen:
//   the day in numbers → Do first (≤5, in order) → the run, per cleaner → arrivals that need a
//   check → the shape of the day. Nothing the coordinator cannot act on before 4pm: no labor, no
//   30-day billing, no root-cause lists, no vacant-unit planning — those belong to the Ops Desk.
//
// Same engine as the old day sheet (lib/ops-brief gather + the daysheet), rendered a quarter the
// size. Every item appears ONCE: a same-day turn is a flag on its numbered row, not also a priority,
// an inspection row and an arrival row.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { gather, lowReviewInspections, niceDay } from '@/lib/ops-brief'
import { upcomingAutoInspections } from '@/lib/auto-inspections'
import { getShifts, nameMatches } from '@/lib/homebase'
import { translator, type BriefLang } from '@/lib/brief-lang'
import { ACCENTS, APP_URL, T, esc, masthead, headline, section, person, block, dayShape, footer, fit, pill, cleanTitle, crewOf, unitShort, personName, crewNote, isOfficeLike, type Line } from './ui'

export type FieldMarket = 'Miami' | 'Broward'
export type Built = { subject: string; html: string; words: number; counts: Record<string, number> }

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const isDone = (s: any) => /complet|finish|close|approv/i.test(str(s))
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length

export async function buildFieldRun(market: FieldMarket, lang: BriefLang = 'en'): Promise<Built> {
  const { t, pick } = translator(lang)
  const A = ACCENTS.field
  const d = await gather(market)
  const sheet: any = d.sheet || {}
  const today = d.today

  // ---- the extras the run needs, each best-effort ------------------------------------------
  const [shiftsRes, autoRes, reviewRes, linkRes] = await Promise.all([
    getShifts(today, 'America/New_York').catch(() => [] as any[]),
    upcomingAutoInspections(1).catch(() => [] as any[]),
    lowReviewInspections().catch(() => [] as any[]),
    Promise.resolve(supabaseAdmin().from('share_links').select('code,passcode_hint,scope,created_at').eq('kind', 'scheduler').is('revoked_at', null).order('created_at', { ascending: false }).limit(50)).then(r => (r.data || []) as any[]).catch(() => [] as any[]),
  ])
  const onShift = new Set<string>()
  for (const s of shiftsRes as any[]) if (!s.open && s.startAt) onShift.add(str(s.name))
  const shiftOf = (n: string) => Array.from(onShift).some(x => nameMatches(x, n))
  const sched = (linkRes as any[]).find(r => str(r.scope?.market) === market)
  const schedUrl = sched?.code ? `${APP_URL}/scheduler/${sched.code}` : null
  const schedHint = sched?.passcode_hint ? '…' + str(sched.passcode_hint).replace(/•/g, '') : null

  // ---- the facts -----------------------------------------------------------------------------
  const cleans = d.cleans as { unit: string; lid: string; assignee: string; lead: string; state: string; sameDayArrival: boolean }[]
  const other = d.hkOther as { unit: string; lid: string; assignee: string; lead: string; task: string; dept: string; state: string }[]
  const arrivals: any[] = sheet.arrivals || []
  const departures: any[] = sheet.departures || []
  const glitches: any[] = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)))
  const exceptions: any[] = (sheet.exceptions || []).filter((e: any) => e.severity === 'high')
  const unassigned = cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  const walkIns = arrivals.filter(a => a.bookedToday || a.bookedAfterSync)
  const office = new Set((d.officeNames || []) as string[])
  const isOffice = (n: string) => isOfficeLike(n) || Array.from(office).some(o => nameMatches(o, n))
  const deptMap: Record<string, string> = d.deptOfPerson || {}
  const dept = (n: string) => str(deptMap[n] || deptMap[Object.keys(deptMap).find(k => nameMatches(k, n)) || ''] || 'housekeeping')
  const isTech = (n: string) => /maint/.test(dept(n))
  const arrivalByLid: Record<string, any> = {}
  for (const a of arrivals) arrivalByLid[str(a.listingId)] = a
  const noteOf = (lid: string) => crewNote(str((d.arrivalNotes || {})[lid]))
  const timeOf = (lid: string) => str(arrivalByLid[lid]?.checkInTime || '4:00 PM')

  const autoInsp = (autoRes as any[]).filter(i => str(i.market) === market && !isDone(i.status) && str(i.check_in) <= today)
  const reviewToday = (reviewRes as any[]).filter(i => i.market === market && !isDone(i.status) && str(i.check_in) <= today)

  // ---- DO FIRST: ≤5, in the order the day breaks ----------------------------------------------
  const doFirst: Line[] = []
  for (const c of unassigned) doFirst.push({ tone: 'red', html: `<b>${esc(unitShort(c.unit))}</b> — ${t('clean has no one assigned')}${c.sameDayArrival ? ` · ${pick('guest lands', 'el huésped llega')} ${esc(timeOf(c.lid))}` : ''}`, sub: pick('Assign it before the crew leaves the lot.', 'Asígnala antes de que el equipo salga.') })
  const ALREADY = /nobody assigned|booked today|walk-?in|same-?day turn|clean not started/i
  for (const e of exceptions) {
    if (ALREADY.test(str(e.kind) + ' ' + str(e.detail))) continue
    if (doFirst.length >= 5) break
    doFirst.push({ tone: 'amber', html: `<b>${esc(unitShort(str(e.unit)))}</b> — ${esc(str(e.detail))}`, sub: esc(str(e.action)) })
  }
  for (const a of walkIns) { if (doFirst.length >= 5) break; doFirst.push({ tone: 'amber', html: `<b>${esc(unitShort(str(a.unit)))}</b> — ${t('walk-in arriving today')} (${esc(first(a.guest))}, ${esc(str(a.checkInTime || '4:00 PM'))})`, sub: t('Booked last minute — confirm the unit is guest-ready.') }) }
  for (const g of glitches.slice(0, 2)) { if (doFirst.length >= 5) break; doFirst.push({ tone: 'amber', html: `<b>${esc(unitShort(str(g.unit)))}</b> — ${t('open guest issue')}`, sub: esc(str(g.overview).replace(/\s+/g, ' ').slice(0, 110)) }) }
  for (const i of autoInsp.slice(0, 2)) { if (doFirst.length >= 5) break; doFirst.push({ tone: 'amber', html: `<b>${esc(unitShort(str(i.unit_name)))}</b> — ${t('pre-arrival inspection')} · ${esc(str(i.reason))} · ${esc(first(i.guest_name))} ${t('lands')} ${esc(timeOf(str(i.listing_id)))}`, sub: i.assignees?.length ? `${t('With')} ${i.assignees.map(first).join(', ')}.` : t('Not assigned — pick it up.') }) }
  for (const i of reviewToday.slice(0, 1)) { if (doFirst.length >= 5) break; doFirst.push({ tone: 'amber', html: `<b>${esc(unitShort(i.unit_name))}</b> — ${pick('walk it today', 'revísala hoy')} · ${esc(i.reason)} · ${pick('unit is empty', 'la unidad está vacía')}`, sub: i.assignees?.length ? `${t('With')} ${i.assignees.map(first).join(' & ')}.` : '' }) }

  // ---- THE RUN: every field person with work, cleaners first, same-day turns first ------------
  const byPerson: Record<string, { cleans: typeof cleans; other: typeof other }> = {}
  const bucket = (n: string) => (byPerson[n] = byPerson[n] || { cleans: [], other: [] })
  for (const c of cleans) if (!/UNASSIGNED/.test(c.assignee)) bucket(personName(c.lead || c.assignee)).cleans.push(c)
  for (const o of other) {
    if (/UNASSIGNED/.test(o.assignee)) continue
    const n = o.lead || o.assignee
    if (isOffice(n) || isTech(n)) continue          // office runs the desk; techs have their own run
    if (o.state === 'done') continue
    bucket(personName(n)).other.push(o)
  }
  const names = Object.keys(byPerson).sort((a, b) => {
    const ta = isTech(a) ? 1 : 0, tb = isTech(b) ? 1 : 0
    if (ta !== tb) return ta - tb
    const sa = byPerson[a].cleans.filter(c => c.sameDayArrival).length, sb = byPerson[b].cleans.filter(c => c.sameDayArrival).length
    if (sa !== sb) return sb - sa
    return byPerson[b].cleans.length - byPerson[a].cleans.length || a.localeCompare(b)
  })
  const cleanRow = (c: typeof cleans[number]) => {
    const ppl = c.assignee.split(',').map(x => x.trim()).filter(Boolean)
    const note = noteOf(c.lid)
    return `<b>${esc(unitShort(c.unit))}</b>${c.sameDayArrival ? ` ${pill(`${pick('by', 'antes de')} ${timeOf(c.lid)}`, 'red')}` : ''}${c.state === 'done' ? ` ${pill(t('done'), 'green')}` : c.state === 'running' ? ` ${pill(t('in progress'), 'amber')}` : ''}${crewOf(ppl, c.lead)}${note ? `<div style="font-size:11.5px;color:#4338ca">📝 ${esc(note)}</div>` : ''}`
  }
  const runBlocks = names.map(n => {
    const b = byPerson[n]
    const run = b.cleans.slice().sort((x, y) => (y.sameDayArrival ? 1 : 0) - (x.sameDayArrival ? 1 : 0) || x.unit.localeCompare(y.unit))
    const sd = run.filter(c => c.sameDayArrival).length
    const metaBits = [
      isTech(n) ? pick('maintenance, covering', 'mantenimiento, cubriendo') : /superv/.test(dept(n)) ? t('supervision') : /inspect/.test(dept(n)) ? t('inspection') : t('housekeeping'),
      run.length ? `${run.length} ${run.length === 1 ? t('clean') : t('cleans')}${sd ? ` · <b style="${T.red}">${sd} ${pick('by 4pm', 'antes de las 4')}</b>` : ''}` : '',
      b.other.length ? `${b.other.length} ${pick('other', 'otras')}` : '',
      onShift.size && !shiftOf(n) && !isTech(n) && !/superv|inspect/.test(dept(n)) ? `<span style="${T.amber}">${pick('not on the schedule — confirm', 'no está en el horario — confirmar')}</span>` : '',
    ].filter(Boolean).join(' · ')
    return person(n, metaBits, run.map(cleanRow), b.other.map(o => `${esc(unitShort(o.unit))} · ${esc(cleanTitle(o.task, lang))}${o.state === 'running' ? ' ' + pill(t('in progress'), 'amber') : ''}`), { bulletCap: 2 })
  })
  const unassignedBlock = unassigned.length
    ? person(t('NO ONE ASSIGNED'), `${unassigned.length} ${unassigned.length === 1 ? t('clean') : t('cleans')}`, unassigned.map(cleanRow), [], { tone: 'red' })
    : ''

  // ---- ARRIVALS THAT NEED A CHECK (no clean today, and something about them) ------------------
  const cleanLids = new Set(cleans.map(c => c.lid))
  const flagged: Line[] = []
  let quiet = 0
  for (const a of arrivals) {
    if (cleanLids.has(str(a.listingId))) continue
    const note = noteOf(str(a.listingId))
    const owner = str(a.ownerFlag) === 'owner booking'
    const vip = d.bigTodayIds?.has?.(str(a.listingId))
    const early = /early|temprano|antes de|8\s*am|9\s*am|10\s*am|11\s*am|12\s*pm/i.test(note)
    const why = owner ? pill('OWNER', 'blue') : (a.bookedToday || a.bookedAfterSync) ? pill(t('WALK-IN'), 'red') : vip ? pill(t('VIP'), 'amber') : early ? pill(pick('EARLY', 'TEMPRANO'), 'amber') : ''
    if (!why && !note) { quiet++; continue }
    flagged.push({ tone: owner || vip ? 'amber' : 'none', html: `<b>${esc(unitShort(str(a.unit)))}</b> · ${esc(str(a.checkInTime || '4:00 PM'))} · ${esc(first(a.guest))}${a.nights ? ` · ${a.nights}n` : ''} ${why}`, sub: note ? esc(note) : undefined })
  }
  const ownerStays: any[] = sheet.ownerStays || []
  for (const o of ownerStays.slice(0, 2)) flagged.push({ tone: 'amber', html: `<b>${esc(unitShort(str(o.unit)))}</b> ${pill('OWNER IN-HOUSE', 'blue')} · ${esc(str(o.owner || o.guest))} · ${pick('until', 'hasta')} ${esc(str(o.checkOut).slice(5))}`, sub: pick('White-glove — no shortcuts.', 'Servicio impecable — sin atajos.') })

  // ---- SHAPE OF THE DAY — built from the facts, in clock order ---------------------------------
  const outTimes = departures.map((x: any) => str(x.checkOutTime)).filter(Boolean)
  const firstOut = outTimes.sort()[0] || '10:00 AM'
  const supervisor = names.find(n => /superv/.test(dept(n))) || ''
  const sdList = sameDay.slice().sort((a, b) => a.unit.localeCompare(b.unit)).map(c => `${esc(unitShort(c.unit))} (${esc(first(c.lead || c.assignee))})`)
  const notOnSched = names.filter(n => onShift.size && !shiftOf(n) && !isTech(n) && !/superv|inspect/.test(dept(n)) && !isOffice(n))
  const steps: { at: string; do: string }[] = []
  steps.push({ at: '8:00', do: [
    unassigned.length ? `<b>${pick('Assign', 'Asignar')} ${unassigned.map(c => esc(unitShort(c.unit))).join(', ')}</b>.` : '',
    notOnSched.length ? `${pick('Confirm', 'Confirmar')} ${notOnSched.map(first).map(esc).join(', ')} ${pick('are coming — not on the Homebase schedule.', 'vienen — no están en el horario.')}` : '',
    pick('Crew briefed on the same-day turns below.', 'Equipo informado de los cambios del mismo día.'),
  ].filter(Boolean).join(' ') })
  steps.push({ at: firstOut.replace(/\s*[AP]M/i, m => m.trim().toLowerCase()), do: `${departures.length} ${pick('checkouts', 'salidas')} · ${pick('strips and linen first in the same-day units', 'primero sábanas y ropa en las unidades del mismo día')}.` })
  if (sameDay.length) steps.push({ at: pick('by 2:00', 'antes 2:00'), do: `${pick('Same-day turns finished, in this order', 'Cambios del mismo día terminados, en este orden')}: ${sdList.slice(0, 8).join(', ')}${sdList.length > 8 ? ` +${sdList.length - 8}` : ''}.` })
  steps.push({ at: '2:00', do: `${supervisor ? esc(first(supervisor)) + ' ' : ''}${pick('inspects every same-day turn', 'inspecciona cada cambio del mismo día')}${autoInsp.length ? ` + ${autoInsp.map(i => esc(unitShort(str(i.unit_name)))).join(', ')}` : ''}.` })
  steps.push({ at: '3:30', do: `${pick('Arrival check', 'Revisión de llegadas')}: ${arrivals.length} ${pick('arriving', 'llegan')}${walkIns.length ? ` · ${walkIns.length} ${pick('walk-in', 'de último minuto')}` : ''}${flagged.length ? ` · ${pick('flagged ones below first', 'primero las marcadas abajo')}` : ''}.` })
  steps.push({ at: '4:00', do: pick('Doors open. Anything not ready → call Roberto before the guest calls us.', 'Abren las puertas. Lo que no esté listo → llamar a Roberto antes de que el huésped nos llame.') })

  // ---- assemble ------------------------------------------------------------------------------
  const mk = pick(market, market)
  const head = [
    `<b>${cleans.length}</b> ${cleans.length === 1 ? t('clean') : t('cleans')}`,
    sameDay.length ? `<b style="${T.red}">${sameDay.length} ${pick('by 4pm', 'antes de las 4')}</b>` : '',
    `<b>${arrivals.length}</b> ${pick('in', 'entran')} · <b>${departures.length}</b> ${pick('out', 'salen')}`,
    unassigned.length ? `<b style="${T.red}">${unassigned.length} ${pick('unassigned', 'sin asignar')}</b>` : `<span style="${T.green}">${pick('everyone has a name', 'todas asignadas')}</span>`,
    glitches.length ? `${glitches.length} ${pick('open guest issue', 'problema abierto')}${glitches.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  const links = [{ label: pick('Live board', 'Tablero en vivo'), href: `${APP_URL}/day?market=${encodeURIComponent(market)}` }]
  if (schedUrl) links.push({ label: pick('Team schedule', 'Horario del equipo') + (schedHint ? ` (${pick('passcode ends', 'clave termina')} ${schedHint})` : ''), href: schedUrl })

  const parts = [
    { html: masthead(A, pick('Field Run', 'Ruta del día') + ' — ' + mk, pick('Field coordinator', 'Coordinador de campo'), niceDay(today)) },
    { html: headline(A, head + `<br><span style="font-size:12px;color:#6b7280">${pick('7am snapshot — the board is live. Confirm access before entering any unit.', 'Foto de las 7am — el tablero está en vivo. Confirme acceso antes de entrar a una unidad.')}</span>`, links) },
    { html: doFirst.length ? section(pick('Do first', 'Primero'), doFirst, { cap: 5, accent: A }) : block(pick('Do first', 'Primero'), `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">${t('Nothing on fire.')}</span> <span style="${T.muted}">${pick('Run the list, keep 4pm in sight.', 'Siga la lista, con las 4pm en mente.')}</span></p>`, A) },
    { html: block(pick('The run — same-day turns first', 'La ruta — primero los del mismo día'), (unassignedBlock + runBlocks.join('')) || `<p style="margin:6px 0 0;font-size:13px;color:#6b7280">${t('Nothing on the board today.')}</p>`, A, cleans.length) },
    { html: dayShape(A, steps, pick('Shape of the day', 'Forma del día')) },
    { html: flagged.length ? section(pick('Arrivals to check', 'Llegadas a revisar'), flagged, { cap: 6, accent: A, note: quiet ? `${quiet} ${pick('other arrivals are routine — on the board.', 'otras llegadas son rutina — en el tablero.')}` : undefined }) : '', optional: true },
    { html: footer(pick('Field Run · sent every morning at 7 · the board has the live picture.', 'Ruta del día · cada mañana a las 7 · el tablero tiene la foto en vivo.')) },
  ]
  const { html } = fit(parts, 60_000)
  const subject = `${pick('Field Run', 'Ruta')} ${mk} · ${cleans.length} ${cleans.length === 1 ? t('clean') : t('cleans')}${sameDay.length ? ` · ${sameDay.length} ${pick('by 4pm', 'antes de las 4')}` : ''}${unassigned.length ? ` · ${unassigned.length} ${pick('UNASSIGNED', 'SIN ASIGNAR')}` : ''} · ${niceDay(today)}`
  return { subject, html, words: words(html), counts: { cleans: cleans.length, sameDay: sameDay.length, unassigned: unassigned.length, arrivals: arrivals.length, departures: departures.length, doFirst: doFirst.length } }
}
