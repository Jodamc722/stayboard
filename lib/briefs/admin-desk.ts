// ADMIN MORNING (Jon, 2026-11-19: "Let's also have an admin brief, this needs to be sent to Bernadette,
// Suleman and Karla each day. This should show top issues, channels not connected, listing optimizations,
// bad reviews we should attempt to remove based on smart understanding, meaning is it fightable, prep work
// for statements"). Nothing new is measured: every line is assembled from what the app already keeps.
//   top issues / channels / optimizations   lib/admin-desk (the same rows and work list /admin draws)
//   reviews worth a removal request         lib/review-playbook removalGrounds, on the last 30 days' low reviews
//   statement prep                          lib/owner-audit (the Owner audit page's month, totals and prep list)
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildAdminDesk } from '@/lib/admin-desk'
import { worklist, optimizeState, type WorkItem, type AdminRow } from '@/lib/admin-desk-shared'
import { removalGrounds, type RemovalGround } from '@/lib/review-playbook'
import { isLowReview } from '@/lib/review-scale'
import { ACCENTS, T, esc, masthead, block, footer, pill, fit, unitShort, tileTable, type Line } from './ui'
import { buildScorecards, briefTiles, topOfBoard, type Scorecards } from '@/lib/scorecards'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app'
const str = (v: any) => (v == null ? '' : String(v)).trim()
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length
const niceDay = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const link = (label: string, path: string) => `<a href="${APP_URL}${path}" style="color:#6F5527">${esc(label)}</a>`
const on = (label: string, path: string) => `on the ${link(label, path)}`
const sevTone = (s: string): Line['tone'] => s === 'high' ? 'red' : s === 'medium' ? 'amber' : 'none'
const shortDate = (iso: string) => { const d = new Date(str(iso).slice(0, 10) + 'T12:00:00Z'); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }

type Fightable = { id: string; unit: string; guest: string; rating: any; channel: string; date: string; strong: boolean; ground: string; quote: string; evidence: string; by: 'model' | 'keywords' }
const chanName = (c: string) => /airbnb/i.test(c) ? 'Airbnb' : /booking/i.test(c) ? 'Booking.com' : /vrbo|homeaway/i.test(c) ? 'Vrbo' : /expedia/i.test(c) ? 'Expedia' : /google/i.test(c) ? 'Google' : (c || 'Direct')

// IS IT FIGHTABLE (Jon, 2026-11-19: "bad reviews we should attempt to remove based on smart understanding,
// meaning is it fightable"). Keyword matching alone called a flooded entrance "off topic" and a slow reply
// "retaliation". So the morning's low reviews are read once by the model against what each channel will
// actually remove, and the keyword grounds are only the fallback when the model is unavailable. The
// verdict is kept for the day so a preview, a test and the 7:01 send agree and pay once.
const REMOVAL_SYSTEM = `You review low guest reviews for a short-term rental manager and decide whether each one could realistically be REMOVED by the booking channel. Be strict: channels remove very few reviews.

What a channel removes:
- Airbnb (Reviews Policy): the review is not about the stay (irrelevant, about Airbnb itself, weather, the city, something outside the host's control and unrelated to the listing); the guest never stayed or cancelled; retaliation or coercion (the guest demanded money or threatened a bad review, or the review answers a reported rule violation, damage claim or eviction); a competitor or conflict of interest; content that breaks the content policy (discrimination, threats, profanity aimed at a person, private information such as full names, phone numbers, addresses).
- Booking.com: only for inappropriate content (profanity, personal data, discrimination), a review that is not about the stay, a guest who did not stay (no-show, cancelled), or fraud. It does not remove a review for being unfair or wrong.
- Vrbo: only first-hand stays; removes content-guideline breaches (profanity, personal data, discrimination), reviews not about the property or stay, and reviews by guests who did not stay.

What is NOT removable: a harsh, unfair, exaggerated or factually disputed complaint about cleanliness, noise, smell, maintenance, access, communication, the building, parking or a refund that was simply declined. A problem at the property, even one caused by weather (a flooded entrance, a power cut), is about the stay.

For each review answer:
- "file": the text itself shows a policy breach. Worth filing today.
- "proof": a breach is plausible but only holds with evidence the manager would have to produce (a message thread, a claim, a no-arrival record).
- "no": a fair or merely harsh complaint. Reply and fix.

Reply with ONLY a JSON array, one object per review, in order: {"i": <number>, "verdict": "file"|"proof"|"no", "ground": "<the policy ground in under 12 words, or empty>", "quote": "<the exact words from the review that show it, under 30 words, or empty>", "evidence": "<what a person must attach, under 20 words, or empty>"}`

/** Low reviews of the last 30 days, each judged against its channel's removal rules. */
async function removalCandidates(): Promise<{ list: Fightable[]; lowTotal: number; by: 'model' | 'keywords' }> {
  const sb = supabaseAdmin()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data } = await sb.from('guesty_reviews')
    .select('id, listing_id, rating, content, channel, guest_name, created_at, dismissed, removed_at, excluded_from_score, priv:raw->rawReview->>private_feedback')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(1000)
  const low = ((data || []) as any[]).filter(r => !r.dismissed && !r.removed_at && !r.excluded_from_score && isLowReview(r.rating, r.channel))
  const ids = Array.from(new Set(low.map(r => str(r.listing_id)).filter(Boolean)))
  const nameOf: Record<string, string> = {}
  if (ids.length) {
    const { data: ls } = await sb.from('guesty_listings').select('id,nickname,title').in('id', ids.slice(0, 300))
    for (const l of ((ls || []) as any[])) nameOf[str(l.id)] = str(l.nickname) || str(l.title)
  }
  const base = (r: any) => ({ id: str(r.id), unit: nameOf[str(r.listing_id)] || 'Unit', guest: str(r.guest_name) || 'Guest', rating: r.rating, channel: str(r.channel), date: str(r.created_at) })
  const sorted = (list: Fightable[]) => list.sort((a, b) => Number(b.strong) - Number(a.strong) || b.date.localeCompare(a.date))

  // The model's read, once a day.
  const withText = low.filter(r => str(r.content).length >= 20).slice(0, 45)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const sig = today + ':' + withText.map(r => str(r.id)).join(',')
  let verdicts: Record<string, { verdict: string; ground: string; quote: string; evidence: string }> | null = null
  try {
    const { getSetting } = await import('@/lib/app-settings')
    const saved = await getSetting<any>('admin_brief_removal', null)
    if (saved && saved.sig === sig && saved.verdicts) verdicts = saved.verdicts
  } catch { /* judge again */ }
  if (!verdicts && withText.length && process.env.ANTHROPIC_API_KEY) {
    try {
      const { modelPairFor } = await import('@/lib/ai-models')
      const { anthropicMessages, textOf } = await import('@/lib/anthropic-call')
      const { model, fallback } = await modelPairFor('review-removal')
      const user = withText.map((r, i) => `#${i + 1} · ${chanName(str(r.channel))} · rating ${r.rating}\nPUBLIC: ${str(r.content).replace(/\s+/g, ' ').slice(0, 700)}${r.priv ? `\nPRIVATE TO HOST: ${str(r.priv).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n\n')
      const res = await anthropicMessages(process.env.ANTHROPIC_API_KEY as string, { model, max_tokens: 3500, system: REMOVAL_SYSTEM, messages: [{ role: 'user', content: user }] }, fallback, 'review-removal')
      const raw = res.ok ? str(textOf(res.data)) : ''
      const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1))
      if (Array.isArray(arr) && arr.length) {
        verdicts = {}
        for (const v of arr) { const r = withText[Number(v?.i) - 1]; if (r) verdicts[str(r.id)] = { verdict: str(v.verdict), ground: str(v.ground), quote: str(v.quote), evidence: str(v.evidence) } }
        try { const { setSetting } = await import('@/lib/app-settings'); await setSetting('admin_brief_removal', { sig, at: new Date().toISOString(), verdicts }, 'admin-brief') } catch { /* judged, just not kept */ }
      }
    } catch { verdicts = null }
  }
  if (verdicts) {
    const list: Fightable[] = []
    for (const r of withText) {
      const v = verdicts[str(r.id)]
      if (!v || (v.verdict !== 'file' && v.verdict !== 'proof') || !v.ground) continue
      list.push({ ...base(r), strong: v.verdict === 'file', ground: v.ground, quote: v.quote, evidence: v.evidence, by: 'model' })
    }
    return { list: sorted(list), lowTotal: low.length, by: 'model' }
  }
  // Fallback: the keyword grounds the Reviews page shows.
  const list: Fightable[] = []
  for (const r of low) {
    const grounds: RemovalGround[] = removalGrounds({ rating: r.rating, content: r.content, channel: r.channel, guest: r.guest_name, created_at: r.created_at, privateFeedback: r.priv || null })
    if (!grounds.length) continue
    const g = grounds[0]
    list.push({ ...base(r), strong: g.strength === 'worth filing', ground: g.label, quote: g.matched, evidence: g.evidence, by: 'keywords' })
  }
  return { list: sorted(list), lowTotal: low.length, by: 'keywords' }
}

async function statementPrep(): Promise<{ label: string; statements: number; review: number; action: number; prepOpen: number; signedOff: number; open: any[] } | null> {
  const { getAuditMonths, getAudit } = await import('@/lib/owner-audit-cache')
  const { defaultAuditMonth, prevMonthUnsigned } = await import('@/lib/owner-audit')
  const months = await getAuditMonths()
  const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const [y, m] = et.slice(0, 7).split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
  const prevUnsigned = Number(et.slice(8, 10)) <= 10 ? await prevMonthUnsigned(prev).catch(() => false) : false
  const month = defaultAuditMonth(months, { prevUnsigned })
  if (!month) return null
  const d: any = await getAudit(month)
  const resolved = (p: any) => p.splitDone || (p.cleaningAmt != null && p.rmAmt != null) || !!p.saved
  const open = ((d.prep || []) as any[]).filter(p => !resolved(p)).sort((a, b) => str(a.checkIn).localeCompare(str(b.checkIn)))
  return { label: str(d.label) || month, statements: Number(d.totals?.statements) || 0, review: Number(d.totals?.review) || 0, action: Number(d.totals?.action) || 0, prepOpen: open.length, signedOff: Number(d.totals?.signedOff) || 0, open }
}

export async function buildAdminBrief(): Promise<{ subject: string; html: string; words: number; counts: Record<string, number> }> {
  const A = ACCENTS.ops
  const [desk, rem, prep, cards] = await Promise.all([
    buildAdminDesk(),
    removalCandidates().catch(() => ({ list: [] as Fightable[], lowTotal: 0, by: 'keywords' as const })),
    statementPrep().catch(() => null),
    // SCORECARDS (Jon, 2026-11-20: "In the admin report that gets sent should show what was completed the
    // other day. Optimized listing, new connected units, reviews responded etc. Like a KPI."). Capped: a
    // slow read drops the two blocks and the rest of the brief still sends.
    Promise.race([buildScorecards().catch(() => null), new Promise<null>(r => setTimeout(() => r(null), 40_000))]) as Promise<Scorecards | null>,
  ])
  const today = desk.today
  const rows = desk.rows as AdminRow[]
  const work = worklist(rows, today)
  const itemLine = (w: WorkItem): Line => ({
    tone: sevTone(w.severity),
    html: `${w.name && w.name !== 'Portfolio' ? `<b>${esc(unitShort(w.name))}</b> — ` : ''}${esc(w.title)}`,
    sub: `${esc(w.why)} · <a href="${APP_URL}${w.href}" style="color:#6F5527">${esc(w.verb)}</a>`,
  })

  // CHANNELS, GROUPED. Ninety lines of "Vrbo — failed" are one line per kind of fault with the units named.
  const chanAll = work.filter(w => w.kind === 'channel')
  const sinceOf = (w: WorkItem) => (str(w.why).match(/since (\d{4}-\d{2}-\d{2})/) || [])[1] || ''
  const dayBefore = new Date(Date.parse(today + 'T12:00:00Z') - 2 * 86400000).toISOString().slice(0, 10)
  const groups = new Map<string, WorkItem[]>()
  for (const w of chanAll) { const k = w.name === 'Portfolio' ? 'P|' + w.title : str(w.title); const g = groups.get(k) || []; g.push(w); groups.set(k, g) }
  const SEV: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const chanLines: Line[] = Array.from(groups.entries())
    .sort((a, b) => SEV[a[1][0].severity] - SEV[b[1][0].severity] || b[1].length - a[1].length)
    .map(([k, g]) => {
      const w = g[0]
      if (k.startsWith('P|')) return { tone: 'none' as const, html: esc(w.title), sub: `${esc(w.why)} · <a href="${APP_URL}${w.href}" style="color:#6F5527">${esc(w.verb)}</a>` }
      const fresh = g.filter(x => sinceOf(x) >= dayBefore).length
      const names = g.map(x => unitShort(x.name))
      return {
        tone: sevTone(w.severity),
        html: `<b style="float:right;margin-left:12px">${g.length}</b><b>${esc(w.title)}</b>${fresh ? ' ' + pill(`${fresh} new`, 'red') : ''}`,
        sub: `${esc(names.slice(0, 8).join(' · '))}${names.length > 8 ? ` · +${names.length - 8} more` : ''} · <a href="${APP_URL}${w.channel ? '/channels?channel=' + encodeURIComponent(w.channel) + '&problems=1' : '/channels?problems=1'}" style="color:#6F5527">Open</a>`,
      }
    })
  // Units that WERE selling on a major channel and stopped (failed, removed, suspended, disconnected).
  const notForSale = new Set(chanAll.filter(w => w.name !== 'Portfolio' && w.severity === 'high').map(w => w.listingId || w.name)).size
  const neverOn = new Set(chanAll.filter(w => w.name !== 'Portfolio' && w.severity !== 'high').map(w => w.listingId || w.name)).size
  // OPTIMIZATION: never optimized first, then low score, then stale. (The "underperforming" refresh
  // list stays on the Admin desk: it reads a unit listed last week as 100% under its peers.)
  const opt = work.filter(w => w.kind === 'optimize')
  const live = rows.filter(r => r.active)
  const st = { never: 0, low: 0, stale: 0 }
  for (const r of live) { const s = optimizeState(r, today); if (s !== 'ok') st[s]++ }
  const owed = live.reduce((s, r) => s + (r.reviews?.owed || 0), 0)
  const owedLow = live.reduce((s, r) => s + (r.reviews?.owedLow || 0), 0)

  const stars = (f: Fightable) => /booking/i.test(f.channel) ? `${f.rating}/10` : `${f.rating}★`
  const remLines: Line[] = rem.list.map(f => ({
    tone: f.strong ? 'red' as const : 'amber' as const,
    html: `${pill(f.strong ? 'worth filing' : 'only with proof', f.strong ? 'red' : 'amber')} <b>${esc(unitShort(f.unit))}</b> — ${esc(f.guest)} · ${esc(stars(f))} · ${esc(chanName(f.channel))} · ${esc(shortDate(f.date))}`,
    sub: `<b>${esc(f.ground.replace(/\.$/, ''))}.</b> ${f.quote ? `“${esc(f.quote.slice(0, 170))}” ` : ''}${f.evidence ? `Attach: ${esc(f.evidence.replace(/\.$/, ''))}.` : ''}`,
  }))

  const prepLines: Line[] = prep ? prep.open.map((p: any) => ({
    tone: p.noFees ? 'red' as const : 'amber' as const,
    html: `<b>${esc(unitShort(str(p.unit)))}</b> — ${esc(str(p.guest) || 'Guest')} · ${esc(shortDate(p.checkIn))} to ${esc(shortDate(p.checkOut))} · ${esc(str(p.source))}`,
    sub: `${p.noFees ? 'No fees on the folio: the cleaning and repair fees were never set up.' : 'Cleaning and repair split not entered.'} ${esc(str(p.ownerName))}`,
  })) : []

  // TOP ISSUES: a handful of one-liners, each a thing to do first, never the long lists again.
  const newChan = chanAll.filter(w => w.name !== 'Portfolio' && w.severity === 'high' && sinceOf(w) >= dayBefore)
  const lowOwed = live.filter(r => (r.reviews?.owedLow || 0) > 0)
  const noFees = prep ? prep.open.filter((p: any) => p.noFees) : []
  const strongRem = rem.list.filter(f => f.strong)
  const names = (xs: string[], n = 5) => `${xs.slice(0, n).map(x => esc(unitShort(x))).join(' · ')}${xs.length > n ? ` · +${xs.length - n} more` : ''}`
  const top: Line[] = []
  if (newChan.length) top.push({ tone: 'red', html: `<b>${plural(newChan.length, 'listing')} stopped selling on a channel in the last two days</b>`, sub: `${names(newChan.map(w => `${w.name} (${str(w.title).split(' — ')[0]})`))} · ${link('Channels', '/channels?problems=1')}` })
  if (lowOwed.length) top.push({ tone: 'red', html: `<b>${plural(owedLow, 'low review')} waiting for a reply</b>`, sub: `${names(lowOwed.map(r => r.name))} · ${link('Reviews', '/reviews')}` })
  if (strongRem.length) top.push({ tone: 'red', html: `<b>${plural(strongRem.length, 'review')} worth a removal request today</b>`, sub: `${names(strongRem.map(f => f.unit))} · details below` })
  if (noFees.length) top.push({ tone: 'red', html: `<b>${plural(noFees.length, 'reservation')} with no fees on the folio</b> for ${esc(prep!.label)} statements`, sub: `${names(noFees.map((p: any) => str(p.unit)))} · ${link('Owner audit, Prep', '/owner-audit')}` })
  if (st.never) top.push({ tone: 'amber', html: `<b>${plural(st.never, 'live listing')} never optimized</b>`, sub: `${names(live.filter(r => optimizeState(r, today) === 'never').map(r => r.name))} · ${link('Admin desk', '/admin')}` })
  if (notForSale - newChan.length > 0) top.push({ tone: 'amber', html: `<b>${plural(notForSale, 'unit')} stopped selling on a channel</b> and ${neverOn} more were never connected to one`, sub: `Grouped by fault below.` })

  // ---- THE LOOK (Jon, 2026-11-19, on the first cut: "looks so ugly"). It was a wall: every unit on its own
  // line, the same sentence forty times, grey notes under everything. Now it is four numbers, a short
  // numbered "do first" list, and one quiet count table per subject with a single link out. Unit names
  // appear only where a person needs them to act (the reviews to dispute).
  const SERIF = "Georgia,'Times New Roman',serif"
  const INK = '#101114', MUTED = '#6B6C72', FAINT = '#9A9BA0', RULE = '#F1EFEA', RED = '#B42318'
  type Row = { label: string; sub?: string; value?: string | number; red?: boolean }
  const table = (rows: Row[]) => `<table width="100%" cellspacing="0" cellpadding="0">${rows.map((r, i) => `<tr>
      <td style="padding:10px 12px 10px 0;${i ? `border-top:1px solid ${RULE};` : ''}font-size:14px;line-height:1.45;color:${INK}">${r.label}${r.sub ? `<div style="margin-top:2px;font-size:12px;line-height:1.5;color:${MUTED}">${r.sub}</div>` : ''}</td>
      <td align="right" valign="top" style="padding:8px 0 0;${i ? `border-top:1px solid ${RULE};` : ''}font-family:${SERIF};font-size:20px;line-height:1.3;white-space:nowrap;color:${r.red ? RED : INK}">${r.value ?? ''}</td>
    </tr>`).join('')}</table>`
  const more = (label: string, path: string) => `<p style="margin:10px 0 0;font-size:12.5px"><a href="${APP_URL}${path}" style="color:#6F5527;font-weight:600;text-decoration:none">${esc(label)} →</a></p>`
  const few = (xs: string[], n = 4) => `${xs.slice(0, n).map(x => esc(unitShort(x))).join(', ')}${xs.length > n ? ` and ${xs.length - n} more` : ''}`
  const bldOf = (name: string) => str(name).split(/\s+-\s+|\s+\d|\//)[0].trim() || str(name)

  // The four numbers.
  const numbers = tileTable([
    { label: 'Stopped selling', value: String(notForSale), note: newChan.length ? `${newChan.length} new in 2 days` : 'on a channel', tone: notForSale ? 'red' : 'none' },
    { label: 'Low reviews to reply', value: String(owedLow), note: `${owed} to reply in all`, tone: owedLow ? 'red' : 'none' },
  ]) + tileTable([
    { label: 'Worth disputing', value: String(strongRem.length), note: `of ${rem.lowTotal} low reviews`, tone: 'none' },
    { label: 'Statement prep open', value: String(prep ? prep.prepOpen : 0), note: prep ? prep.label : '', tone: 'none' },
  ])

  // COMPLETED YESTERDAY (Jon, 2026-11-20: "should show what was completed the other day… Like a KPI").
  // The same numbers as the Scorecards page (lib/scorecards); a tile whose source could not be read is
  // left out, never drawn as a zero. Then the week by person: the top five and what each completed.
  // Only the top of the board goes in an email; the full table is on the page.
  const cap = (text: string) => `<p style="margin:10px 0 0;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#8C6D3A">${esc(text)}</p>`
  const yTiles = cards ? briefTiles(cards.yesterday.teams.admin, ['optimized', 'answered', 'channels', 'guidebooks', 'claims'], { optimized: 'Listings optimised', answered: 'Reviews answered', channels: 'Channels connected', guidebooks: 'Guidebooks approved', claims: 'Claims filed' }).map(t => ({ ...t, note: t.note && t.note.length <= 24 ? t.note : undefined })) : []
  const doneHtml = yTiles.length ? cap(`Completed yesterday · ${cards!.yesterday.label}`) + tileTable(yTiles) + cap('Open now') : ''
  const leaders = cards ? topOfBoard(cards.week.teams.admin.leaderboard, 5) : []
  const leadersHtml = leaders.length
    ? table(leaders.map(r => ({ label: `<b>${esc(r.name)}</b>`, sub: esc(r.secondary.join(' · ')), value: r.kpi })))
      + `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${FAINT}">Last 7 days, ${esc(cards!.week.label)}. The number is everything a person completed.</p>` + more('Open Scorecards', '/scoreboard?team=admin&period=week')
    : ''

  // Do first: at most five, each one sentence and one link.
  const todo: string[] = []
  const a = (label: string, path: string) => `<a href="${APP_URL}${path}" style="color:#6F5527;text-decoration:none;font-weight:600">${esc(label)}</a>`
  if (newChan.length) {
    const byTitle = new Map<string, number>()
    for (const w of newChan) byTitle.set(str(w.title), (byTitle.get(str(w.title)) || 0) + 1)
    const [t, n] = Array.from(byTitle.entries()).sort((x, y) => y[1] - x[1])[0]
    todo.push(`<b>Check ${plural(n, 'listing')}: ${esc(t.replace(' — ', ', '))}</b> in the last two days. ${a('Channels', '/channels?problems=1')}`)
  }
  if (owedLow) todo.push(`<b>Reply to ${plural(owedLow, 'low review')}.</b> Drafts are waiting on each one. ${a('Reviews', '/reviews')}`)
  if (strongRem.length) todo.push(`<b>File ${plural(strongRem.length, 'removal request')}.</b> Details below. ${a('Reviews', '/reviews')}`)
  if (noFees.length) todo.push(`<b>Set up fees on ${plural(noFees.length, 'reservation')}</b> before ${esc(prep!.label)} statements. ${a('Owner audit', '/owner-audit')}`)
  if (st.never) todo.push(`<b>Optimize ${plural(st.never, 'listing')} that never has been.</b> ${a('Admin desk', '/admin')}`)
  const todoHtml = todo.length
    ? `<table width="100%" cellspacing="0" cellpadding="0">${todo.slice(0, 5).map((t, i) => `<tr><td valign="top" style="width:26px;padding:8px 0;font-family:${SERIF};font-size:18px;line-height:1.2;color:#8C6D3A">${i + 1}</td><td style="padding:8px 0;font-size:14px;line-height:1.5;color:${INK}">${t}</td></tr>`).join('')}</table>`
    : `<p style="margin:2px 0 0;font-size:14px;${T.green}">Nothing urgent today.</p>`

  // Channels: one row per fault, counts on the right.
  const stopped: Row[] = [], never: Row[] = []
  let rollout = ''
  for (const [k, g] of Array.from(groups.entries()).sort((x, y) => y[1].length - x[1].length)) {
    const w = g[0]
    if (k.startsWith('P|')) { rollout = esc(w.title); continue }
    const fresh = g.filter(x => sinceOf(x) >= dayBefore).length
    const label = esc(str(w.title).replace(' — ', ' · '))
    if (w.severity === 'high') stopped.push({ label: `<b>${label}</b>`, sub: `${few(g.map(x => x.name))}${fresh ? ` · <span style="color:${RED}">${fresh} new</span>` : ''}`, value: g.length, red: true })
    else never.push({ label, value: g.length })
  }
  const chanHtml = (stopped.length ? `<p style="margin:0 0 2px;font-size:12px;color:${MUTED}">Was selling and stopped</p>${table(stopped)}` : `<p style="margin:0;font-size:14px;${T.green}">Nothing that was selling has stopped.</p>`)
    + (never.length ? `<p style="margin:16px 0 2px;font-size:12px;color:${MUTED}">Never connected</p>${table(never)}` : '')
    + (rollout ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:${FAINT}">${rollout}: a rollout to decide, not a fault.</p>` : '')
    + more('Open Channels', '/channels?problems=1')

  // Reviews to dispute: the only place a unit gets its own card.
  const noGround = Math.max(0, rem.lowTotal - rem.list.length)
  const remHtml = rem.list.length
    ? rem.list.slice(0, 5).map((f, i) => `<div style="padding:${i ? '14px' : '2px'} 0 12px;${i ? `border-top:1px solid ${RULE}` : ''}">
        <p style="margin:0;font-size:14px;line-height:1.4;color:${INK}"><b>${esc(unitShort(f.unit))}</b> <span style="font-size:12px;color:${MUTED}">· ${esc(stars(f))} · ${esc(chanName(f.channel))} · ${esc(shortDate(f.date))}</span></p>
        <p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:${INK}">${pill(f.strong ? 'file it' : 'needs proof', f.strong ? 'red' : 'amber')} &nbsp;${esc(f.ground.replace(/\.$/, ''))}</p>
        ${f.quote ? `<p style="margin:6px 0 0;padding-left:10px;border-left:2px solid #E7E4DD;font-family:${SERIF};font-style:italic;font-size:13.5px;line-height:1.5;color:#3A3B40">“${esc(f.quote.slice(0, 180))}”</p>` : ''}
        ${f.evidence ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:${MUTED}">Attach: ${esc(f.evidence.replace(/\.$/, ''))}</p>` : ''}
      </div>`).join('')
      + `<p style="margin:2px 0 0;font-size:12px;line-height:1.5;color:${FAINT}">${noGround ? `The other ${noGround} are fair complaints: reply and fix. ` : ''}${rem.by === 'model' ? '' : 'Keyword match only today, so read each one first. '}</p>` + more('Open Reviews', '/reviews')
    : `<p style="margin:2px 0 0;font-size:14px;color:${MUTED}">${rem.lowTotal ? `None of the ${plural(rem.lowTotal, 'low review')} from the last 30 days breaks a channel rule. Reply and fix.` : 'No low reviews in the last 30 days.'}</p>`

  // Listing optimization: by building.
  const needs = live.filter(r => optimizeState(r, today) !== 'ok')
  const byB = new Map<string, { never: number; other: number }>()
  for (const r of needs) { const k = str(r.building) || bldOf(r.name); const g = byB.get(k) || { never: 0, other: 0 }; if (optimizeState(r, today) === 'never') g.never++; else g.other++; byB.set(k, g) }
  const optRows: Row[] = Array.from(byB.entries()).sort((x, y) => (y[1].never * 2 + y[1].other) - (x[1].never * 2 + x[1].other)).slice(0, 6)
    .map(([k, g]) => ({ label: `<b>${esc(k)}</b>`, sub: [g.never ? `${g.never} never optimized` : '', g.other ? `${g.other} low or older than 90 days` : ''].filter(Boolean).join(' · '), value: g.never + g.other }))
  const optHtml = needs.length ? table(optRows) + (byB.size > 6 ? `<p style="margin:8px 0 0;font-size:12px;color:${FAINT}">and ${byB.size - 6} more buildings</p>` : '') + more('Open Admin desk', '/admin') : `<p style="margin:2px 0 0;font-size:14px;${T.green}">Every live listing is current.</p>`

  // Statement prep: by owner.
  let prepHtml = ''
  if (prep) {
    const byO = new Map<string, { n: number; noFees: number; first: string }>()
    for (const p of prep.open as any[]) { const k = str(p.ownerName) || 'No owner'; const g = byO.get(k) || { n: 0, noFees: 0, first: str(p.checkIn) }; g.n++; if (p.noFees) g.noFees++; byO.set(k, g) }
    const rowsO: Row[] = Array.from(byO.entries()).sort((x, y) => y[1].n - x[1].n).slice(0, 6)
      .map(([k, g]) => ({ label: `<b>${esc(k)}</b>`, sub: `${g.noFees ? `<span style="color:${RED}">${g.noFees} with no fees</span> · ` : ''}oldest check-in ${esc(shortDate(g.first))}`, value: g.n }))
    prepHtml = prep.open.length
      ? `<p style="margin:0 0 2px;font-size:12px;color:${MUTED}">Reservations that still need the cleaning and repair split</p>` + table(rowsO) + (byO.size > 6 ? `<p style="margin:8px 0 0;font-size:12px;color:${FAINT}">and ${byO.size - 6} more owners</p>` : '') + more('Open Owner audit, Prep', '/owner-audit')
      : `<p style="margin:2px 0 0;font-size:14px;${T.green}">Prep is clear.</p>`
  }

  const parts = [
    { html: masthead(A, 'Admin morning', 'Channels, reviews, listings and statements', niceDay(today)) },
    { html: `<div style="background:#FAF8F4;padding:8px 22px 10px">${doneHtml}${numbers}</div>` },
    { html: leadersHtml ? block('This week, by person', leadersHtml, A) : '', optional: true },
    { html: block('Do first', todoHtml, A) },
    { html: block('Channels', chanHtml, A) },
    { html: block('Reviews worth disputing', remHtml, A, rem.list.length || null) },
    { html: block('Listings to optimize', optHtml, A, needs.length || null) },
    { html: prep ? block(`Statement prep · ${prep.label}`, prepHtml, A, prep.prepOpen || null) : '', optional: true },
    { html: footer(`<a href="${APP_URL}/scoreboard?team=admin" style="color:#6b7280">Scorecards</a><br>Admin morning · 7:01 every morning`) },
  ]
  const { html } = fit(parts, 90_000)
  const subject = `Admin morning · ${niceDay(today)} · ${notForSale} off a channel · ${owed} to reply${remLines.length ? ` · ${remLines.length} to dispute` : ''}`
  return { subject, html, words: words(html), counts: { top: top.length, channels: chanAll.length, notForSale, removal: remLines.length, lowReviews: rem.lowTotal, optimize: st.never + st.low + st.stale, prepOpen: prep ? prep.prepOpen : 0, repliesOwed: owed } }
}
