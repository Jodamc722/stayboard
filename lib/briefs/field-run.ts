// FIELD RUN — the field coordinator's morning (Jon, 2026-10-01, second pass: "should show cleans,
// who's assigned, same-day turns, inspections — VIP and big arrivals, bad-review inspections —
// pending not completed; top priorities clearly labeled and prioritized; it should be direction
// for the day").
//
// One market, in this order:
//   the day in numbers → TOP PRIORITIES (numbered, each with a label) → DEPARTURE CLEANS (every
//   one: unit · cleaner · guest lands · status) → INSPECTIONS PENDING (arrival, VIP / big arrival,
//   owner, bad review, quality — only the ones not done, with who holds them) → ARRIVALS (every one,
//   tagged VIP / BIG $ / OWNER / WALK-IN / EARLY, with the crew note) → OTHER WORK by person →
//   RUNNING THE DAY (the clock). Nothing the coordinator cannot act on before 4pm.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { gather, lowReviewInspections, niceDay } from '@/lib/ops-brief'
import { upcomingAutoInspections } from '@/lib/auto-inspections'
import { getShifts, nameMatches } from '@/lib/homebase'
import { translator, type BriefLang } from '@/lib/brief-lang'
import { ACCENTS, APP_URL, T, esc, masthead, headline, section, block, dayShape, footer, fit, pill, cleanTitle, crewOf, unitShort, personName, crewNote, isOfficeLike, type Line } from './ui'

export type FieldMarket = 'Miami' | 'Broward'
export type Built = { subject: string; html: string; words: number; counts: Record<string, number> }

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const isDone = (s: any) => /complet|finish|close|approv|done/i.test(str(s))
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length
const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export async function buildFieldRun(market: FieldMarket, lang: BriefLang = 'en'): Promise<Built> {
  const { t, pick } = translator(lang)
  const A = ACCENTS.field
  const d = await gather(market)
  const sheet: any = d.sheet || {}
  const today = d.today

  const [shiftsRes, autoRes, reviewRes, linkRes] = await Promise.all([
    getShifts(today, 'America/New_York').catch(() => [] as any[]),
    upcomingAutoInspections(2).catch(() => [] as any[]),
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
  type Clean = { unit: string; lid: string; assignee: string; lead: string; state: string; sameDayArrival: boolean }
  type Other = { unit: string; lid: string; assignee: string; lead: string; task: string; dept: string; state: string }
  const cleans = d.cleans as Clean[]
  const other = d.hkOther as Other[]
  const arrivals: any[] = (sheet.arrivals || []).slice().sort((a: any, b: any) => str(a.checkInTime).localeCompare(str(b.checkInTime)) || str(a.unit).localeCompare(str(b.unit)))
  const departures: any[] = sheet.departures || []
  const ownerStays: any[] = sheet.ownerStays || []
  // Glitches are not market-scoped by the day sheet; keep the ones on a unit this market's sheet knows.
  const marketLids = new Set<string>()
  for (const rows of [sheet.work, sheet.arrivals, sheet.departures, sheet.vacants, sheet.ownerStays]) for (const r of (Array.isArray(rows) ? rows : [])) if (r?.listingId) marketLids.add(str(r.listingId))
  for (const c of d.cleans as any[]) marketLids.add(str(c.lid))
  for (const o of d.hkOther as any[]) marketLids.add(str(o.lid))
  const glitches: any[] = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)) && (!g.listing_id || marketLids.has(str(g.listing_id))))
  const exceptions: any[] = (sheet.exceptions || []).filter((e: any) => e.severity === 'high')
  const unassigned = cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  const walkIns = arrivals.filter(a => a.bookedToday || a.bookedAfterSync)
  const flags: Record<string, { long: boolean; big: boolean; owner: boolean; total: number; nights: number }> = (d as any).todayFlags || {}
  const office = new Set((d.officeNames || []) as string[])
  const isOffice = (n: string) => isOfficeLike(n) || Array.from(office).some(o => nameMatches(o, n))
  const deptMap: Record<string, string> = d.deptOfPerson || {}
  const dept = (n: string) => str(deptMap[n] || deptMap[Object.keys(deptMap).find(k => nameMatches(k, n)) || ''] || 'housekeeping')
  const isTech = (n: string) => /maint/.test(dept(n))
  const arrivalByLid: Record<string, any> = {}
  for (const a of arrivals) arrivalByLid[str(a.listingId)] = a
  const noteOf = (lid: string) => crewNote(str((d.arrivalNotes || {})[lid]))
  const timeOf = (lid: string) => str(arrivalByLid[lid]?.checkInTime || '4:00 PM')
  const isVip = (lid: string) => !!(flags[lid]?.long || flags[lid]?.big || flags[lid]?.owner || str(arrivalByLid[lid]?.ownerFlag) === 'owner booking')
  const vipWhy = (lid: string) => {
    const f = flags[lid]; const bits: string[] = []
    if (f?.owner || str(arrivalByLid[lid]?.ownerFlag) === 'owner booking') bits.push(pill('OWNER', 'blue'))
    if (f?.big) bits.push(pill(`BIG $ · ${money0(f.total)}`, 'amber'))
    if (f?.long) bits.push(pill(`${pick('LONG STAY', 'ESTANCIA LARGA')} · ${f.nights}n`, 'amber'))
    return bits.join(' ')
  }

  // Inspections pending: Lighthouse's arrival inspections (window: today + tomorrow), bad-review
  // walks, and any inspection/unit-check task on today's board — only the ones NOT done.
  const autoInsp = (autoRes as any[]).filter(i => str(i.market) === market && !isDone(i.status))
  // A bad-review walk already carried by an arrival inspection (same unit, review reason) is one item, not two.
  const reviewInsp = (reviewRes as any[]).filter(i => i.market === market && !isDone(i.status))
    .filter(i => !autoInsp.some(a => str(a.unit_name) === i.unit_name && /review|★/i.test(str(a.reason))))
  const boardInsp = other.filter(o => o.dept !== 'maintenance' && /^(inspec|unit check|quality|walk-?through)|inspecci[oó]n de llegada|arrival inspection|post clean inspection/i.test(o.task.trim()) && o.state !== 'done')
  const inspLines: Line[] = []
  const seenInsp = new Set<string>()
  for (const i of autoInsp) {
    const lid = str(i.listing_id); seenInsp.add(lid + '|arrival')
    const reason = str(i.reason)
    const kind = /owner/i.test(reason) ? pill('OWNER', 'blue') : /big|vip|long/i.test(reason) ? pill(pick('VIP ARRIVAL', 'LLEGADA VIP'), 'amber') : /review|★/i.test(reason) ? pill(pick('BAD REVIEW', 'MALA RESEÑA'), 'red') : pill(pick('ARRIVAL', 'LLEGADA'), 'blue')
    inspLines.push({ tone: str(i.check_in) <= today ? 'red' : 'amber', html: `${kind} <b>${esc(unitShort(str(i.unit_name)))}</b> · ${esc(reason)} · ${esc(first(i.guest_name))} ${t('lands')} ${str(i.check_in) <= today ? esc(timeOf(lid)) : esc(niceDay(str(i.check_in)))}`, sub: (i.assignees?.length ? `${t('With')} ${i.assignees.map(first).map(esc).join(', ')}` : `<span style="${T.red}">${t('Not assigned — pick it up.')}</span>`) + (/progress|start/i.test(str(i.status)) ? ` · ${t('in progress')}` : ` · ${pick('open', 'pendiente')}`) })
  }
  for (const i of reviewInsp) {
    inspLines.push({ tone: i.check_in <= today ? 'red' : 'amber', html: `${pill(pick('BAD REVIEW', 'MALA RESEÑA'), 'red')} <b>${esc(unitShort(i.unit_name))}</b> · ${esc(i.reason)} · ${i.check_in <= today ? pick('unit is empty — walk it today', 'la unidad está vacía — revísala hoy') : pick('on the checkout', 'en la salida') + ' ' + esc(niceDay(i.check_in))}`, sub: (i.assignees?.length ? `${t('With')} ${i.assignees.map(first).map(esc).join(', ')}` : `<span style="${T.red}">${t('Not assigned — pick it up.')}</span>`) + ` · ${pick('open', 'pendiente')}` })
  }
  for (const o of boardInsp) {
    if (seenInsp.has(o.lid + '|arrival') && /llegada|arrival/i.test(o.task)) continue
    inspLines.push({ tone: 'none', html: `${pill(pick('INSPECTION', 'INSPECCIÓN'), 'grey')} <b>${esc(unitShort(o.unit))}</b> · ${esc(cleanTitle(o.task, lang))}`, sub: `${/UNASSIGNED/.test(o.assignee) ? `<span style="${T.red}">${t('Not assigned — pick it up.')}</span>` : t('With') + ' ' + esc(personName(first(o.lead || o.assignee)))}${o.state === 'running' ? ' · ' + t('in progress') : ''}` })
  }

  // ---- TOP PRIORITIES — numbered, labeled, in the order the day breaks -------------------------
  const prio: Line[] = []
  const P = (label: string, tone: 'red' | 'amber' | 'blue' | 'grey', html: string, sub?: string, lineTone: Line['tone'] = 'none') => prio.push({ tone: lineTone, html: `${pill(label, tone)} ${html}`, sub })
  for (const c of unassigned) P(pick('UNASSIGNED', 'SIN ASIGNAR'), 'red', `<b>${esc(unitShort(c.unit))}</b> — ${t('clean has no one assigned')}${c.sameDayArrival ? ` · ${pick('guest lands', 'el huésped llega')} ${esc(timeOf(c.lid))}` : ''}`, pick('Assign it before the crew leaves the lot.', 'Asígnala antes de que el equipo salga.'), 'red')
  if (sameDay.length) {
    const byCleaner: Record<string, string[]> = {}
    for (const c of sameDay) (byCleaner[personName(first(c.lead || c.assignee)) || '—'] = byCleaner[personName(first(c.lead || c.assignee)) || '—'] || []).push(unitShort(c.unit))
    P(pick('SAME-DAY TURNS', 'MISMO DÍA'), 'red', `<b>${sameDay.length}</b> ${pick('guests land in units being cleaned today — these doors first, done by', 'huéspedes llegan a unidades que se limpian hoy — estas puertas primero, listas antes de')} ${esc(timeOf(sameDay[0].lid))}`, Object.keys(byCleaner).map(n => `<b>${esc(n)}</b>: ${byCleaner[n].map(esc).join(', ')}`).join(' · '), 'red')
  }
  for (const a of walkIns) P(pick('WALK-IN', 'ÚLTIMO MINUTO'), 'red', `<b>${esc(unitShort(str(a.unit)))}</b> — ${pick('booked last minute', 'reservado de último momento')} · ${esc(first(a.guest))} ${t('lands')} ${esc(str(a.checkInTime || '4:00 PM'))}`, t('Booked last minute — confirm the unit is guest-ready.'), 'red')
  const ALREADY = /nobody assigned|booked today|walk-?in|same-?day turn|clean not started/i
  // One exception per unit, labeled by what it is — a checkout with no clean booked is not a guest
  // in the unit, and a unit already named above (walk-in) is not named again.
  const seenExc = new Set<string>(walkIns.map(a => str(a.unit)))
  const excLabel = (e: any): string => {
    const k = (str(e.kind) + ' ' + str(e.detail)).toLowerCase()
    if (/nothing .*clean|no clean|book a clean/.test(k)) return pick('NO CLEAN BOOKED', 'SIN LIMPIEZA')
    if (/straight back|books back|rebook|staying on|extend/.test(k)) return pick('STAYING ON', 'SE QUEDA')
    if (/in house|occupied|in the unit|guest is in/.test(k)) return pick('GUEST IN UNIT', 'HUÉSPED DENTRO')
    return pick('CHECK', 'REVISAR')
  }
  // Work booked while a guest is inside is ONE line naming the units — the instruction is the same
  // for all of them (message the guest first) and seven copies of it buried the rest of the list.
  const inHouse: string[] = []
  for (const e of exceptions) {
    if (ALREADY.test(str(e.kind) + ' ' + str(e.detail))) continue
    if (seenExc.has(str(e.unit))) continue
    seenExc.add(str(e.unit))
    if (excLabel(e) === pick('GUEST IN UNIT', 'HUÉSPED DENTRO')) { inHouse.push(unitShort(str(e.unit))); continue }
    P(excLabel(e), 'amber', `<b>${esc(unitShort(str(e.unit)))}</b> — ${esc(str(e.detail))}`, esc(str(e.action)), 'amber')
  }
  if (inHouse.length) P(pick('GUEST IN UNIT', 'HUÉSPED DENTRO'), 'amber', `<b>${inHouse.length}</b> ${pick('units have work booked while a guest is inside', 'unidades tienen trabajo con el huésped dentro')} — ${inHouse.map(esc).join(', ')}`, t('Call or message the guest before anyone enters.'), 'amber')
  for (const g of glitches.slice(0, 3)) P(pick('OPEN ISSUE', 'PROBLEMA ABIERTO'), 'amber', `<b>${esc(unitShort(str(g.unit)))}</b> — ${t('open guest issue')}${str(g.created_at) ? ` ${pick('since', 'desde')} ${esc(str(g.created_at).slice(5, 10))}` : ''}`, esc(str(g.overview).replace(/\s+/g, ' ').slice(0, 120)), 'amber')
  for (const a of arrivals.filter(a => isVip(str(a.listingId)))) {
    const lid = str(a.listingId)
    const insp = autoInsp.find(i => str(i.listing_id) === lid)
    P(pick('VIP ARRIVAL', 'LLEGADA VIP'), 'amber', `<b>${esc(unitShort(str(a.unit)))}</b> ${vipWhy(lid)} · ${esc(first(a.guest))} ${t('lands')} ${esc(str(a.checkInTime || '4:00 PM'))}`, insp ? `${pick('Pre-arrival inspection', 'Inspección previa')}: ${insp.assignees?.length ? esc(insp.assignees.map(first).join(', ')) : `<span style="${T.red}">${pick('not assigned', 'sin asignar')}</span>`} · ${/progress|start/i.test(str(insp.status)) ? t('in progress') : pick('open', 'pendiente')}` : pick('Walk it before 3pm — no inspection is on the board.', 'Revísala antes de las 3pm — no hay inspección en el tablero.'), 'amber')
  }
  const walkToday = reviewInsp.filter(i => i.check_in <= today)
  for (const i of walkToday.slice(0, 3)) P(pick('BAD REVIEW', 'MALA RESEÑA'), 'red', `<b>${esc(unitShort(i.unit_name))}</b> — ${esc(i.reason)} · ${pick('unit is empty today, walk it before the next guest does', 'la unidad está vacía hoy, revísala antes que el próximo huésped')}`, i.assignees?.length ? `${t('With')} ${i.assignees.map(first).map(esc).join(', ')}.` : t('Not assigned — pick it up.'), 'amber')
  if (walkToday.length > 3) P(pick('BAD REVIEW', 'MALA RESEÑA'), 'red', `<b>${walkToday.length - 3}</b> ${pick('more units with a bad-review walk due and empty today', 'unidades más con revisión por mala reseña, vacías hoy')} — ${walkToday.slice(3).map(i => esc(unitShort(i.unit_name))).join(', ')}`, pick('Listed under Inspections below.', 'Listadas en Inspecciones abajo.'), 'amber')
  for (const i of autoInsp.filter(i => str(i.check_in) <= today && !isVip(str(i.listing_id)))) P(pick('ARRIVAL INSPECTION', 'INSPECCIÓN'), 'blue', `<b>${esc(unitShort(str(i.unit_name)))}</b> — ${esc(str(i.reason))} · ${esc(first(i.guest_name))} ${t('lands')} ${esc(timeOf(str(i.listing_id)))}`, i.assignees?.length ? `${t('With')} ${i.assignees.map(first).map(esc).join(', ')}.` : t('Not assigned — pick it up.'))
  for (const o of ownerStays.slice(0, 2)) P(pick('OWNER IN-HOUSE', 'PROPIETARIO'), 'blue', `<b>${esc(unitShort(str(o.unit)))}</b> — ${esc(str(o.owner || o.guest))} · ${pick('until', 'hasta')} ${esc(str(o.checkOut).slice(5))}`, pick('White-glove — no shortcuts, no surprises.', 'Servicio impecable — sin atajos.'))
  const prioNumbered: Line[] = prio.map((l, i) => ({ ...l, html: `<span style="display:inline-block;min-width:18px;font-weight:700;color:${A.ink}">${i + 1}</span> ${l.html}` }))

  // ---- DEPARTURE CLEANS — BY CLEANER (Jon, 2026-10-05: "organize by cleaner so that it's just
  // easier to visually see"). The flat unit list made the coordinator find each person's doors by
  // scanning the second column. Now: the unassigned doors first, in red, because they are nobody's;
  // then one block per cleaner — her name, her shift state, her count — and her run numbered in the
  // order to work it: same-day turns first (with the arrival time that sets the deadline), then the
  // rest. The row order IS the instruction. ------------------------------------------------------
  const stateOf = (c: Clean) => c.state === 'done' ? pill(t('done'), 'green') : c.state === 'running' ? pill(t('in progress'), 'amber') : `<span style="${T.faint}">${pick('scheduled', 'programada')}</span>`
  const ownerOf = (c: Clean) => /UNASSIGNED/.test(c.assignee) ? '' : personName(first(c.lead || c.assignee.split(',')[0].trim()))
  const othersOn = (c: Clean, me: string) => c.assignee.split(',').map(x => x.trim()).filter(x => x && !/UNASSIGNED/.test(x) && !nameMatches(x, me)).map(personName)
  const cleanRow = (c: Clean, n: number | null, me: string) => {
    const note = noteOf(c.lid)
    const extra = me ? othersOn(c, me) : []
    return `<tr>
      <td style="padding:5px 4px 5px 0;font-size:12px;border-top:1px solid #f3f4f6;vertical-align:top;width:22px;text-align:center">${n != null ? `<span style="display:inline-block;min-width:18px;padding:1px 4px;border-radius:9px;background:${c.sameDayArrival ? '#fee2e2' : '#f1f5f9'};color:${c.sameDayArrival ? '#b91c1c' : '#475569'};font-weight:700;font-size:11px">${n}</span>` : ''}</td>
      <td style="padding:5px 6px;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top"><b>${esc(unitShort(c.unit))}</b>${extra.length ? ` <span style="${T.muted};font-size:11.5px">· ${pick('with', 'con')} ${esc(extra.join(', '))}</span>` : ''}${me ? crewOf(c.assignee.split(',').map(x => x.trim()), c.lead) : ''}${note ? `<div style="font-size:11.5px;color:#4338ca">📝 ${esc(note)}</div>` : ''}</td>
      <td style="padding:5px 6px;font-size:12px;border-top:1px solid #f3f4f6;vertical-align:top;white-space:nowrap">${c.sameDayArrival ? pill(`${pick('lands', 'llega')} ${timeOf(c.lid)}`, 'red') + (isVip(c.lid) ? ' ' + vipWhy(c.lid) : '') : `<span style="${T.faint}">—</span>`}</td>
      <td style="padding:5px 0 5px 6px;font-size:12px;border-top:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap">${stateOf(c)}</td>
    </tr>`
  }
  const runOrder = (a: Clean, b: Clean) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || (a.state === 'done' ? 1 : 0) - (b.state === 'done' ? 1 : 0) || a.unit.localeCompare(b.unit)
  const cleansByPerson: Record<string, Clean[]> = {}
  for (const c of cleans) { const n = ownerOf(c); if (n) (cleansByPerson[n] = cleansByPerson[n] || []).push(c) }
  const personOrder = Object.keys(cleansByPerson).sort((a, b) => {
    const ha = cleansByPerson[a].some(c => c.sameDayArrival && c.state !== 'done') ? 0 : 1
    const hb = cleansByPerson[b].some(c => c.sameDayArrival && c.state !== 'done') ? 0 : 1
    return ha - hb || cleansByPerson[b].length - cleansByPerson[a].length || a.localeCompare(b)
  })
  const personHead = (n: string, list: Clean[]) => {
    const doneN = list.filter(c => c.state === 'done').length
    const hot = list.filter(c => c.sameDayArrival && c.state !== 'done').length
    const sched = onShift.size && !shiftOf(n) && !isTech(n) && !/superv|inspect/.test(dept(n)) && !isOffice(n) ? ` · <span style="${T.amber}">${pick('not on the schedule — confirm', 'no está en el horario — confirmar')}</span>` : ''
    return `<tr><td colspan="4" style="padding:10px 0 4px;font-size:13.5px;border-top:2px solid #e5e7eb"><b>${esc(n)}</b> <span style="${T.muted};font-size:12px">· ${list.length} ${list.length === 1 ? t('clean') : t('cleans')}${hot ? ` · <span style="${T.red}">${hot} ${pick('same-day', 'mismo día')}</span>` : ''}${doneN ? ` · ${doneN} ${t('done')}` : ''}${sched}</span></td></tr>`
  }
  const unassignedRows = unassigned.length
    ? `<tr><td colspan="4" style="padding:6px 0 4px;font-size:13.5px"><b style="${T.red}">${t('NO ONE ASSIGNED')}</b> <span style="${T.muted};font-size:12px">· ${unassigned.length} — ${pick('nobody’s list; assign before 10am', 'sin dueño; asignar antes de las 10')}</span></td></tr>` + unassigned.slice().sort(runOrder).map(c => cleanRow(c, null, '')).join('')
    : ''
  const personRows = personOrder.map(n => personHead(n, cleansByPerson[n]) + cleansByPerson[n].slice().sort(runOrder).map((c, i) => cleanRow(c, i + 1, n)).join('')).join('')
  const th = (x: string, right = false) => `<th style="padding:4px 6px 4px 0;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af;text-align:${right ? 'right' : 'left'}">${x}</th>`
  const cleansTable = cleans.length
    ? `<table width="100%" cellspacing="0" cellpadding="0"><tr>${th('#')}${th(pick('Unit', 'Unidad'))}${th(pick('Guest lands', 'Llega'))}${th(pick('Status', 'Estado'), true)}</tr>${unassignedRows}${personRows}</table>`
    : `<p style="margin:6px 0 0;font-size:13px;color:#6b7280">${t('Nothing on the board today.')}</p>`

  // ---- ARRIVALS — every one, tagged ---------------------------------------------------------------
  const cleanLids = new Set(cleans.map(c => c.lid))
  const arrRows = arrivals.map(a => {
    const lid = str(a.listingId)
    const note = noteOf(lid)
    const early = /early|temprano|\b(8|9|10|11)\s*am\b|\b12\s*pm\b/i.test(note)
    const tags = [vipWhy(lid), (a.bookedToday || a.bookedAfterSync) ? pill(t('WALK-IN'), 'red') : '', early ? pill(pick('EARLY', 'TEMPRANO'), 'amber') : '', cleanLids.has(lid) ? pill(pick('CLEAN TODAY', 'LIMPIEZA HOY'), 'grey') : ''].filter(Boolean).join(' ')
    return `<tr>
      <td style="padding:4px 6px 4px 0;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top"><b>${esc(unitShort(str(a.unit)))}</b> ${tags}${note ? `<div style="font-size:11.5px;color:#4338ca">📝 ${esc(note)}</div>` : ''}</td>
      <td style="padding:4px 0 4px 6px;font-size:12.5px;border-top:1px solid #f3f4f6;vertical-align:top;text-align:right;white-space:nowrap">${esc(str(a.checkInTime || '4:00 PM'))} · ${esc(first(a.guest))}${a.nights ? ` · ${a.nights}n` : ''}</td>
    </tr>`
  })
  const arrivalsTable = arrivals.length ? `<table width="100%" cellspacing="0" cellpadding="0">${arrRows.join('')}</table>` : `<p style="margin:6px 0 0;font-size:13px;color:#6b7280">${pick('No arrivals today.', 'Sin llegadas hoy.')}</p>`

  // ---- OTHER WORK by person (strips, restocks, vendor visits) — not cleans, not inspections ------
  const byPerson: Record<string, Other[]> = {}
  for (const o of other) {
    if (/UNASSIGNED/.test(o.assignee) || o.state === 'done') continue
    if (boardInsp.includes(o)) continue
    const n = personName(o.lead || o.assignee)
    if (isOffice(n) || isTech(n)) continue
    ;(byPerson[n] = byPerson[n] || []).push(o)
  }
  const otherBlocks = Object.keys(byPerson).sort().map(n => `<p style="margin:8px 0 2px;font-size:13px"><b>${esc(n)}</b> <span style="${T.muted};font-size:12px">· ${byPerson[n].length} ${byPerson[n].length === 1 ? pick('job', 'trabajo') : pick('jobs', 'trabajos')}${onShift.size && !shiftOf(n) && !/superv|inspect/.test(dept(n)) ? ` · <span style="${T.amber}">${pick('not on the schedule — confirm', 'no está en el horario — confirmar')}</span>` : ''}</span></p>` +
    `<table cellspacing="0" cellpadding="0" style="margin-left:4px">${byPerson[n].slice(0, 5).map(o => `<tr><td style="width:14px;padding:1px 0;font-size:12px;color:#cbd5e1;vertical-align:top">•</td><td style="padding:1px 0;font-size:12.5px;line-height:1.45;color:#374151">${esc(unitShort(o.unit))} · ${esc(cleanTitle(o.task, lang))}${o.state === 'running' ? ' ' + pill(t('in progress'), 'amber') : ''}</td></tr>`).join('')}${byPerson[n].length > 5 ? `<tr><td></td><td style="font-size:11.5px;color:#9ca3af">+${byPerson[n].length - 5} ${t('more on the board')}</td></tr>` : ''}</table>`)

  // ---- RUNNING THE DAY — the clock, from the facts ----------------------------------------------
  const outTimes = departures.map((x: any) => str(x.checkOutTime)).filter(Boolean).sort()
  const firstOut = outTimes[0] || '10:00 AM'
  const supervisor = Object.keys(deptMap).find(n => /superv/.test(deptMap[n]) && (cleans.some(c => nameMatches(c.lead, n)) || other.some(o => nameMatches(o.lead, n)))) || ''
  const cleanerNames = Array.from(new Set(cleans.filter(c => !/UNASSIGNED/.test(c.assignee)).map(c => personName(first(c.lead || c.assignee)))))
  const notOnSched = cleanerNames.filter(n => onShift.size && !shiftOf(n) && !isTech(n) && !/superv|inspect/.test(dept(n)) && !isOffice(n))
  const vipArr = arrivals.filter(a => isVip(str(a.listingId)))
  const steps: { at: string; do: string }[] = [
    { at: '8:00', do: [
      unassigned.length ? `<b>${pick('Assign', 'Asignar')} ${unassigned.map(c => esc(unitShort(c.unit))).join(', ')}</b>.` : `${pick('Every clean has a name', 'Cada limpieza tiene nombre')}.`,
      notOnSched.length ? ` ${pick('Confirm', 'Confirmar')} ${notOnSched.map(esc).join(', ')} ${pick('are coming — not on the Homebase schedule.', 'vienen — no están en el horario.')}` : '',
      ` ${pick('Brief the crew: same-day turns first, in the order above.', 'Informar al equipo: primero los del mismo día, en el orden de arriba.')}`,
    ].join('') },
    { at: firstOut.replace(/\s*([AP])M/i, (_m, p) => p.toLowerCase() + 'm'), do: `${departures.length} ${pick('checkouts', 'salidas')} — ${pick('strips and linen into the same-day units first; call any guest still inside at', 'sábanas y ropa primero a las unidades del mismo día; llamar a cualquier huésped que siga dentro a las')} ${esc(firstOut)}.` },
    ...(sameDay.length ? [{ at: pick('by 1:30', 'antes 1:30'), do: `${pick('Same-day turns finished', 'Cambios del mismo día terminados')} (${sameDay.length}) ${pick('so there is time to inspect before the guest lands', 'para poder inspeccionar antes de que llegue el huésped')}.` }] : []),
    { at: '2:00', do: `${supervisor ? esc(first(supervisor)) + ' ' : ''}${pick('inspects every same-day turn', 'inspecciona cada cambio del mismo día')}${inspLines.length ? ` · ${pick('clears the pending inspections', 'cierra las inspecciones pendientes')} (${inspLines.length})` : ''}${vipArr.length ? ` · ${pick('VIP units walked personally', 'las unidades VIP revisadas en persona')}: ${vipArr.map(a => esc(unitShort(str(a.unit)))).join(', ')}` : ''}.` },
    { at: '3:30', do: `${pick('Arrival check', 'Revisión de llegadas')}: ${arrivals.length} ${pick('arriving', 'llegan')}${walkIns.length ? ` · ${walkIns.length} ${pick('walk-in', 'de último minuto')}` : ''} — ${pick('doors, codes, AC on, welcome note', 'puertas, códigos, AC encendido, nota de bienvenida')}.` },
    { at: '4:00', do: pick('Doors open. Anything not ready → call Roberto before the guest calls us. Close every clean in Breezeway before you leave.', 'Abren las puertas. Lo que no esté listo → llamar a Roberto antes de que el huésped nos llame. Cerrar cada limpieza en Breezeway antes de irse.') },
  ]

  // ---- assemble ------------------------------------------------------------------------------
  const head = [
    `<b>${cleans.length}</b> ${cleans.length === 1 ? t('clean') : t('cleans')}`,
    sameDay.length ? `<b style="${T.red}">${sameDay.length} ${pick('same-day', 'mismo día')}</b>` : '',
    unassigned.length ? `<b style="${T.red}">${unassigned.length} ${pick('unassigned', 'sin asignar')}</b>` : `<span style="${T.green}">${pick('all assigned', 'todas asignadas')}</span>`,
    `<b>${arrivals.length}</b> ${pick('in', 'entran')} · <b>${departures.length}</b> ${pick('out', 'salen')}`,
    vipArr.length ? `<b style="${T.amber}">${vipArr.length} VIP</b>` : '',
    inspLines.length ? `<b>${inspLines.length}</b> ${pick('inspections pending', 'inspecciones pendientes')}` : '',
    glitches.length ? `${glitches.length} ${pick('open issue', 'problema abierto')}${glitches.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  const links = [{ label: pick('Live board', 'Tablero en vivo'), href: `${APP_URL}/day?market=${encodeURIComponent(market)}` }]
  if (schedUrl) links.push({ label: pick('Team schedule', 'Horario del equipo') + (schedHint ? ` (${pick('passcode ends', 'clave termina')} ${schedHint})` : ''), href: schedUrl })

  const parts = [
    { html: masthead(A, pick('Field Run', 'Ruta del día') + ' — ' + market, pick('Field coordinator', 'Coordinador de campo'), niceDay(today)) },
    { html: headline(A, head + `<br><span style="font-size:12px;color:#6b7280">${pick('7am snapshot — the board is live. Confirm access before entering any unit.', 'Foto de las 7am — el tablero está en vivo. Confirme acceso antes de entrar a una unidad.')}</span>`, links) },
    { html: prioNumbered.length ? section(pick('Top priorities — in order', 'Prioridades — en orden'), prioNumbered, { cap: 12, accent: A }) : block(pick('Top priorities', 'Prioridades'), `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">${t('Nothing on fire.')}</span> <span style="${T.muted}">${pick('Run the list, keep 4pm in sight.', 'Siga la lista, con las 4pm en mente.')}</span></p>`, A) },
    { html: block(pick('Departure cleans — by cleaner, same-day turns first', 'Limpiezas de salida — por persona, primero los del mismo día'), cleansTable, A, cleans.length) },
    { html: inspLines.length ? section(pick('Inspections — pending', 'Inspecciones — pendientes'), inspLines, { cap: 10, accent: A, note: pick('Only open ones are listed. A completed inspection leaves this list the next morning.', 'Solo las pendientes. Una inspección completada desaparece a la mañana siguiente.') }) : block(pick('Inspections — pending', 'Inspecciones — pendientes'), `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">${pick('None pending.', 'Ninguna pendiente.')}</span></p>`, A) },
    { html: dayShape(A, steps, pick('Running the day', 'El día, hora por hora')) },
    { html: block(pick('Arrivals today', 'Llegadas hoy'), arrivalsTable, A, arrivals.length) },
    { html: otherBlocks.length ? block(pick('Other work on the board — by person', 'Otro trabajo — por persona'), otherBlocks.join(''), A) : '', optional: true },
    { html: footer(pick('Field Run · sent every morning at 7 · the board has the live picture.', 'Ruta del día · cada mañana a las 7 · el tablero tiene la foto en vivo.')) },
  ]
  const { html } = fit(parts, 80_000)
  const subject = `${pick('Field Run', 'Ruta')} ${market} · ${cleans.length} ${cleans.length === 1 ? t('clean') : t('cleans')}${sameDay.length ? ` · ${sameDay.length} ${pick('same-day', 'mismo día')}` : ''}${unassigned.length ? ` · ${unassigned.length} ${pick('UNASSIGNED', 'SIN ASIGNAR')}` : ''}${vipArr.length ? ` · ${vipArr.length} VIP` : ''} · ${niceDay(today)}`
  return { subject, html, words: words(html), counts: { cleans: cleans.length, sameDay: sameDay.length, unassigned: unassigned.length, arrivals: arrivals.length, departures: departures.length, priorities: prio.length, inspections: inspLines.length, vip: vipArr.length } }
}
