// GARDEN HOTEL OWNER REPORTS — a hotel report is an owner_reports row, the same page the VR owner
// review renders (/r/<code>): same themes, the same in-place editor, the same share link and PPTX
// export. What differs is where the numbers come from (lib/garden/report-datasets) and which
// sections it carries (lib/garden/report-templates).
//
// Jon, 2026-09-28: "same styling, same format, same look, same feel, but customized and editable to
// fit the hotel reporting style they prefer… use a lot of design templates, and we'll create the
// datasets." The row is marked with listing_ids ['garden'] and content.meta.business 'garden', so
// the VR Owner Reports desk can leave it out and the hotel's page can find it.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'
import { makeCode, weekBuckets } from '../owner-report'
import type { ReportContent } from '../owner-report'
import { datasetsFor, monthLabel, monthShort } from './report-datasets'
import { listTemplates, type ReportTemplate } from './report-templates'
import { getHotel, getVoice, voiceBlock } from './settings'

export const GARDEN_SENTINEL = 'garden'
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const pct = (n: number) => `${Math.round(n)}%`
const prettyDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fill = (s: string, v: Record<string, string>) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

export async function buildGardenContent(from: string, to: string, tpl: ReportTemplate, asOf: string): Promise<ReportContent> {
  const [D, hotel] = await Promise.all([datasetsFor(from, to), getHotel()])
  const P = D.period.summary as any
  const periodLabel = from.slice(0, 7) === to.slice(0, 7) ? monthLabel(from) : `${prettyDate(from)} – ${prettyDate(to)}`
  const vars = { hotel: hotel.name, period: periodLabel, rooms: String(P.rooms) }
  const ops = D.operations.summary as any, rv = D.reviews.summary as any
  const ahead0 = D.ahead.rows[0]
  const cleansDone = Object.values(ops.cleans || {}).reduce((a: number, c: any) => a + c.done, 0) as number
  const cleansTotal = Object.values(ops.cleans || {}).reduce((a: number, c: any) => a + c.total, 0) as number

  const CARD: Record<string, () => { key: string; label: string; value: string; sub: string }> = {
    occupancy: () => ({ key: 'occupancy', label: 'OCCUPANCY', value: pct(P.occPct), sub: `${P.roomNights} of ${P.available} room-nights` }),
    adr: () => ({ key: 'adr', label: 'ADR', value: money(P.adr), sub: 'Booked revenue per room-night sold' }),
    revpar: () => ({ key: 'revpar', label: 'REVPAR', value: money(P.revpar), sub: 'Per available room-night' }),
    revenue: () => ({ key: 'revenue', label: 'BOOKED REVENUE', value: money(P.revenue), sub: 'As Cloudbeds totals it' }),
    arrivals: () => ({ key: 'arrivals', label: 'ARRIVALS', value: String(P.arrivals), sub: `${P.stays} stays touched the period` }),
    roomNights: () => ({ key: 'roomNights', label: 'ROOM-NIGHTS', value: String(P.roomNights), sub: `${P.rooms} rooms · ${P.days} nights` }),
    reviews: () => ({ key: 'reviews', label: 'REVIEWS', value: rv.avg != null ? `${rv.avg}★` : '—', sub: rv.count ? `${rv.count} reviews · ${rv.negative} negative` : 'none in the period' }),
    welcome: () => ({ key: 'welcome', label: 'WELCOME CALLS', value: ops.welcome.due ? `${ops.welcome.done}/${ops.welcome.due}` : '—', sub: ops.welcome.expired ? `${ops.welcome.expired} missed the window` : 'completed of due' }),
    cleans: () => ({ key: 'cleans', label: 'CLEANS DONE', value: String(cleansDone), sub: `of ${cleansTotal} on the board` }),
    onbooks: () => ({ key: 'onbooks', label: (ahead0 ? ahead0.short : 'NEXT MONTH').toUpperCase() + ' ON THE BOOKS', value: ahead0 ? pct(ahead0.occPct) : '—', sub: ahead0 ? `${money(ahead0.revenue)} booked so far` : '' }),
  }
  const cards = (tpl.cards.length ? tpl.cards : ['occupancy', 'adr', 'revpar', 'revenue']).map(k => (CARD[k] || CARD.occupancy)())
  const has = (k: string) => tpl.sections.includes(k as any)

  // By room type → the "by listing" table. Both bases equal: the hotel has one revenue figure.
  const byListing = D.byRoomType.rows.map((t: any) => ({ id: `type:${t.type}`, name: t.type, unit: `${t.rooms} room${t.rooms === 1 ? '' : 's'}`, bedrooms: null, building: hotel.shortName, revenue: money(t.revenue), grossRevenue: money(t.revenue), occPct: Math.round(t.occPct), adr: money(t.adr), grossAdr: money(t.adr), revpar: money(t.revpar), grossRevpar: money(t.revpar), reservations: t.stays, revNum: t.revenue, accomNum: t.revenue, grossNum: t.revenue, accomGrossNum: t.revenue, cleaningNum: 0, feeNum: 0, occNights: t.roomNights, availNights: t.available }))
  const byMonth = D.byMonth.rows.length > 1 ? D.byMonth.rows.map((m: any) => ({ label: m.label, monthIso: m.monthIso, revenue: money(m.revenue), grossRevenue: money(m.revenue), occPct: Math.round(m.occPct), adr: money(m.adr), grossAdr: money(m.adr), revpar: money(m.revpar), accomNum: m.revenue, accomGrossNum: m.revenue, cleaningNum: 0, feeNum: 0, occNights: m.roomNights, availNights: m.available })) : undefined
  const ahead = { headline: fill(tpl.copy.aheadHeadline, vars), subtitle: 'Booked as of ' + prettyDate(asOf) + ' — before the month\'s own pickup.', months: D.ahead.rows.map((m: any) => ({ label: m.label, status: m.occPct >= 60 ? 'Strong' : m.occPct >= 35 ? 'Building' : 'Open', occPct: Math.round(m.occPct), adr: money(m.adr), revpar: money(m.revpar), note: `${money(m.revenue)} booked · ${m.roomNights} room-nights`, accomNum: m.revenue, accomGrossNum: m.revenue, cleaningNum: 0, feeNum: 0, occNights: m.roomNights, availNights: m.available })), strip: D.ahead.rows.map((m: any) => ({ month: m.short, occPct: Math.round(m.occPct) })) }

  // Reviews → quotes and themes.
  const R = D.reviews.rows as any[]
  const quotes = R.filter(r => r.body && String(r.body).length > 40).sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 4).map(r => ({ text: String(r.body).slice(0, 260), guest: r.guest_name || 'A guest', unit: r.source, br: `${r.rating}★` }))
  const themeRows = Object.entries(rv.themes || {}).sort((a: any, b: any) => b[1].n - a[1].n).slice(0, 3)
  const themes = themeRows.map(([k, v]: any) => ({ title: k.charAt(0).toUpperCase() + k.slice(1), body: `${v.n} review${v.n === 1 ? '' : 's'} mentioned it${v.neg ? `, ${v.neg} of them negative` : ', none negative'}.`, action: v.neg ? 'On the list for the team this month.' : 'Keep doing it.' }))

  // Work by week.
  const weeks = weekBuckets(from, to).map(b => {
    const rows = (D.work.rows as any[]).filter(t => t.date >= b.start && t.date <= b.endIncl)
    const group = (label: string, kinds: string[]) => { const items = rows.filter(t => kinds.includes(t.kind)).map(t => `${t.room_name || 'Room'} — ${t.kind === 'clean' ? 'departure clean' : t.kind.replace('_', ' ')}${t.status === 'done' ? '' : ' (open)'}`); return items.length ? { category: label, items: items.slice(0, 12) } : null }
    return { label: b.label, groups: [group('DEEP CLEANS', ['deep_clean']), group('INSPECTIONS', ['inspection']), group('MAINTENANCE', ['maintenance'])].filter(Boolean) as { category: string; items: string[] }[] }
  }).filter(w => w.groups.length)

  const custom: any[] = []
  if (has('sources')) custom.push({ kind: 'text', title: fill(tpl.copy.sourcesHeadline, vars), body: (D.bySource.rows as any[]).map(s => `${s.source}: ${s.arrivals} arrival${s.arrivals === 1 ? '' : 's'}, ${s.nights} nights, ${money(s.revenue)} (${s.share}% of booked revenue)`).join('\n') || 'No bookings arrived in the period.' })
  if (has('operations')) custom.push({ kind: 'text', title: fill(tpl.copy.operationsHeadline, vars), body: [
    `Welcome calls: ${ops.welcome.due ? `${ops.welcome.done} of ${ops.welcome.due} completed${ops.welcome.expired ? `, ${ops.welcome.expired} missed the window` : ''}` : 'none due'}.`,
    `Calls: ${ops.calls.total} logged, ${ops.calls.total ? Math.round((ops.calls.reached / ops.calls.total) * 100) : 0}% reached${ops.missedInbound ? `; ${ops.missedInbound} inbound calls missed` : ''}.`,
    `Verifications: ${ops.verifications.total} checks, ${ops.verifications.passed} passed, ${ops.verifications.failed} failed.`,
    `Housekeeping: ${cleansDone} of ${cleansTotal} cleans and tasks done${Object.entries(ops.cleans || {}).map(([k, v]: any) => ` · ${k.replace('_', ' ')} ${v.done}/${v.total}`).join('')}.`,
  ].join('\n') })

  const all = ['verdict', 'snapshot', 'listings', 'byMonth', 'ahead', 'voices', 'projects', 'pacing', 'plan', 'statement', 'recs']
  const omit = all.filter(k => k === 'pacing' || k === 'plan' || k === 'statement' || k === 'recs' || !has(k))
  const content: ReportContent & { custom?: any[] } = {
    meta: { scopeLabel: hotel.name, periodStart: from, periodEnd: to, asOf, activeListings: P.rooms, daysRemaining: 0, generatedAt: new Date().toISOString(), kind: 'review', ...({ business: GARDEN_SENTINEL, template: tpl.key, wordmark: 'THE GARDEN HOTEL & RESORT', logoUrl: '/garden-logo.svg' } as any) },
    hero: { eyebrow: fill(tpl.copy.heroEyebrow, vars), title: hotel.name, headline: `${pct(P.occPct)} occupancy, ${money(P.adr)} ADR and ${money(P.revenue)} booked across ${periodLabel}.`, preparedFor: fill(tpl.copy.preparedFor, vars), dateLabel: fill(tpl.copy.heroDateLabel, vars), heroImage: null },
    snapshot: { headline: fill(tpl.copy.snapshotHeadline, vars), subtitle: fill(tpl.copy.snapshotSubtitle, vars), cards, ytd: null, metrics: { accomNum: P.revenue, accomGrossNum: P.revenue, cleaningNum: 0, feeNum: 0, occNights: P.roomNights, availNights: P.available, reservations: P.stays, units: P.rooms, occPct: Math.round(P.occPct) } },
    pacing: null, plan: null, statement: null,
    ahead: has('ahead') ? ahead : { headline: '', subtitle: '', months: [], strip: [] },
    voices: { headline: fill(tpl.copy.voicesHeadline, vars), subtitle: rv.count ? `${rv.count} reviews in the period · ${rv.avg}★ average` : 'No reviews in the period yet.', quotes, themes },
    projects: { headline: fill(tpl.copy.projectsHeadline, vars), subtitle: `${cleansDone} tasks finished across ${weeks.length} week${weeks.length === 1 ? '' : 's'}.`, weeks, tracking: [] },
    byMonth, byListing: has('listings') ? byListing : undefined,
    basis: { default: 'netota', snapshotSecondary: 'none' },
    custom, omit,
    ...({ style: { font: tpl.font || 'garden' } } as any),
  }
  return content
}

/** Adam's verdict headline, in the hotel's voice — optional, saved onto content.verdict.headline. */
async function headlineFor(content: ReportContent): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const v = await getVoice()
  const { model, fallback } = await modelPairFor('adam')
  const r = await anthropicMessages(key, { model, max_tokens: 120, system: `Write ONE sentence, under 22 words, that says how the month went for the hotel's owner — a fact, not a slogan. ${voiceBlock(v)}`, messages: [{ role: 'user', content: JSON.stringify({ cards: content.snapshot.cards, ahead: content.ahead.months.slice(0, 1), reviews: content.voices.subtitle }) }] }, fallback, 'adam').catch(() => null)
  return r && r.ok ? textOf(r.data).trim().replace(/^"|"$/g, '') || null : null
}

export async function generateGardenReport(opts: { from: string; to: string; templateKey: string; theme?: string; title?: string; by: string; asOf?: string }): Promise<{ id: string; code: string }> {
  const tpl = (await listTemplates()).find(t => t.key === opts.templateKey)
  if (!tpl) throw new Error('unknown template')
  const asOf = opts.asOf || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const content = await buildGardenContent(opts.from, opts.to, tpl, asOf)
  const hl = await headlineFor(content)
  if (hl) (content as any).verdict = { headline: hl }
  const code = makeCode()
  const periodLabel = opts.from.slice(0, 7) === opts.to.slice(0, 7) ? monthLabel(opts.from) : `${monthShort(opts.from)} – ${monthShort(opts.to)}`
  const title = opts.title || `${content.meta.scopeLabel} — ${tpl.name} — ${periodLabel}`
  const { data, error } = await supabaseAdmin().from('owner_reports').insert({
    code, title, scope_label: content.meta.scopeLabel, listing_ids: [GARDEN_SENTINEL],
    period_start: opts.from, period_end: opts.to, as_of: asOf, theme: opts.theme || tpl.theme, status: 'draft', content, created_by: opts.by,
  }).select('id, code').single()
  if (error) throw new Error(error.message)
  return { id: String(data.id), code }
}

export async function listGardenReports() {
  const { data } = await supabaseAdmin().from('owner_reports').select('id, code, title, scope_label, period_start, period_end, as_of, theme, status, created_at, updated_at').contains('listing_ids', [GARDEN_SENTINEL]).order('updated_at', { ascending: false }).limit(100)
  return (data || []) as any[]
}
