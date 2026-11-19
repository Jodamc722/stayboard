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
import { worklist, optimizeState, PROBLEM, type WorkItem, type AdminRow } from '@/lib/admin-desk-shared'
import { removalGrounds, type RemovalGround } from '@/lib/review-playbook'
import { isLowReview } from '@/lib/review-scale'
import { ACCENTS, T, esc, masthead, headline, section, block, footer, pill, fit, unitShort, type Line } from './ui'

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
  const [desk, rem, prep] = await Promise.all([
    buildAdminDesk(),
    removalCandidates().catch(() => ({ list: [] as Fightable[], lowTotal: 0, by: 'keywords' as const })),
    statementPrep().catch(() => null),
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
  const notForSale = rows.filter(r => r.active && Object.values(r.channels || {}).some((c: any) => c && PROBLEM.indexOf(c.verdict) >= 0 && c.verdict !== 'missing')).length
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
  const noGround = Math.max(0, rem.lowTotal - rem.list.length)

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
  if (notForSale - newChan.length > 0) top.push({ tone: 'amber', html: `<b>${plural(notForSale, 'unit')} off at least one channel</b> they should be selling on`, sub: `Grouped by fault below.` })

  const head = [
    `<b>${notForSale}</b> ${notForSale === 1 ? 'unit' : 'units'} off a channel`,
    owed ? `<b>${owed}</b> ${owed === 1 ? 'review' : 'reviews'} to reply${owedLow ? ` (<b style="${T.red}">${owedLow} low</b>)` : ''}` : '',
    remLines.length ? `<b>${remLines.length}</b> worth a removal request` : '',
    `<b>${st.never + st.low + st.stale}</b> listings to optimize`,
    prep ? `<b>${prep.prepOpen}</b> statement prep open` : '',
  ].filter(Boolean).join(' · ')

  const parts = [
    { html: masthead(A, 'Admin morning', 'Channels, listings, reviews and statements', niceDay(today)) },
    { html: headline(A, head) },
    { html: top.length ? section('Top issues', top, { cap: 6, accent: A }) : block('Top issues', `<p style="margin:2px 0 0;font-size:13.5px"><span style="${T.green}">Nothing urgent.</span> <span style="${T.muted}">No listing stopped selling, no low review is waiting and prep has its fees.</span></p>`, A) },
    { html: chanLines.length ? section('Channels not connected', chanLines, { cap: 10, accent: A, more: on('Channels page', '/channels?problems=1'), note: `${plural(chanAll.filter(w => w.name !== 'Portfolio').length, 'unit and channel pair')}. Red = was selling and stopped. Amber = never connected.` }) : block('Channels not connected', `<p style="margin:2px 0 0;font-size:13.5px;${T.green}">Every active listing is live on its channels.</p>`, A) },
    { html: remLines.length
        ? section('Reviews worth a removal request', remLines, { cap: 6, accent: A, more: on('Reviews page', '/reviews'), note: `Checked ${plural(rem.lowTotal, 'low review')} from the last 30 days. ${noGround ? `${noGround} ${noGround === 1 ? 'has' : 'have'} no policy ground: a fair complaint is not removable, so the work there is the reply and the fix. ` : ''}${rem.by === 'model' ? 'Each review was read against its channel\'s own removal rules.' : 'Keyword match only today; read each one before filing.'} The request text is drafted on each review under More → Removal request; a person files it.` })
        : block('Reviews worth a removal request', `<p style="margin:2px 0 0;font-size:13.5px;${T.muted}">${rem.lowTotal ? `None of the ${plural(rem.lowTotal, 'low review')} from the last 30 days points at a policy breach. Reply and fix; do not file.` : 'No low reviews in the last 30 days.'}</p>`, A) },
    { html: opt.length ? section('Listing optimization', opt.map(itemLine), { cap: 8, accent: A, more: on('Admin desk', '/admin'), note: `${st.never} never optimized · ${st.low} scoring low · ${st.stale} not touched in 90 days. Start each building with its best unit: the first one optimized sets the pattern for the rest.` }) : '' },
    { html: prep
        ? (prepLines.length
            ? section(`Statement prep · ${prep.label}`, prepLines, { cap: 8, accent: A, more: on('Owner audit, Prep', '/owner-audit'), note: `${prep.statements} statements · ${prep.review} to review · ${prep.action} need action · ${prep.signedOff} signed off. Oldest check-in first.` })
            : block(`Statement prep · ${prep.label}`, `<p style="margin:2px 0 0;font-size:13.5px"><span style="${T.green}">Prep is clear.</span> <span style="${T.muted}">${prep.statements} statements · ${prep.review} to review · ${prep.action} need action · ${prep.signedOff} signed off.</span></p>`, A))
        : '', optional: true },
    { html: footer(`${link('Admin desk', '/admin')} · ${link('Channels', '/channels')} · ${link('Reviews', '/reviews')} · ${link('Owner audit', '/owner-audit')}<br>Admin morning · 7:01 every morning`) },
  ]
  const { html } = fit(parts, 90_000)
  const subject = `Admin morning · ${niceDay(today)} · ${notForSale} off a channel · ${owed} to reply${remLines.length ? ` · ${remLines.length} to dispute` : ''}`
  return { subject, html, words: words(html), counts: { top: top.length, channels: chanAll.length, notForSale, removal: remLines.length, lowReviews: rem.lowTotal, optimize: st.never + st.low + st.stale, prepOpen: prep ? prep.prepOpen : 0, repliesOwed: owed } }
}
