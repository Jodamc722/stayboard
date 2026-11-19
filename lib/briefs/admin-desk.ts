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
import { worklist, optimizeState, PROBLEM, channelLabel, type WorkItem, type AdminRow } from '@/lib/admin-desk-shared'
import { removalGrounds, removalPath, type RemovalGround } from '@/lib/review-playbook'
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

type Fightable = { id: string; unit: string; guest: string; rating: any; channel: string; date: string; grounds: RemovalGround[] }

/** Low reviews of the last 30 days whose own wording points at a policy breach. */
async function removalCandidates(): Promise<{ list: Fightable[]; lowTotal: number }> {
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
  const list: Fightable[] = []
  for (const r of low) {
    const grounds = removalGrounds({ rating: r.rating, content: r.content, channel: r.channel, guest: r.guest_name, created_at: r.created_at, privateFeedback: r.priv || null })
    if (!grounds.length) continue
    list.push({ id: str(r.id), unit: nameOf[str(r.listing_id)] || 'Unit', guest: str(r.guest_name) || 'Guest', rating: r.rating, channel: str(r.channel), date: str(r.created_at), grounds })
  }
  const rank = (f: Fightable) => f.grounds.some(g => g.strength === 'worth filing') ? 0 : 1
  list.sort((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date))
  return { list, lowTotal: low.length }
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
    removalCandidates().catch(() => ({ list: [] as Fightable[], lowTotal: 0 })),
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

  // TOP ISSUES: what stops a listing selling or leaves a guest unanswered, most serious first.
  const top = work.filter(w => w.severity === 'high' && (w.kind === 'channel' || w.kind === 'reply' || w.kind === 'blocked'))
  // CHANNELS: every unit off a major channel, the broken ones before the never-connected.
  const chan = work.filter(w => w.kind === 'channel')
  const notForSale = rows.filter(r => r.active && Object.values(r.channels || {}).some((c: any) => c && PROBLEM.indexOf(c.verdict) >= 0 && c.verdict !== 'missing')).length
  // OPTIMIZATION: never optimized first, then low score, then stale.
  const opt = work.filter(w => w.kind === 'optimize' || w.kind === 'refresh')
  const live = rows.filter(r => r.active)
  const st = { never: 0, low: 0, stale: 0 }
  for (const r of live) { const s = optimizeState(r, today); if (s !== 'ok') st[s]++ }
  const owed = live.reduce((s, r) => s + (r.reviews?.owed || 0), 0)
  const owedLow = live.reduce((s, r) => s + (r.reviews?.owedLow || 0), 0)

  const stars = (f: Fightable) => /booking/i.test(f.channel) ? `${f.rating}/10` : `${f.rating}★`
  const remLines: Line[] = rem.list.map(f => {
    const g = f.grounds[0], strong = g.strength === 'worth filing'
    const where = removalPath(f.channel).where
    return {
      tone: strong ? 'red' : 'amber',
      html: `${pill(strong ? 'worth filing' : 'only with proof', strong ? 'red' : 'amber')} <b>${esc(unitShort(f.unit))}</b> — ${esc(f.guest)} · ${esc(stars(f))} · ${esc(channelLabel(f.channel.toLowerCase().replace(/[^a-z]/g, '')) || f.channel)} · ${esc(shortDate(f.date))}`,
      sub: `<b>${esc(g.label)}.</b> ${g.matched ? `“${esc(g.matched.slice(0, 150))}” ` : ''}Needs: ${esc(g.evidence)}${f.grounds.length > 1 ? ` · ${f.grounds.length - 1} more ground${f.grounds.length === 2 ? '' : 's'}` : ''}${where ? ` · file: ${esc(where)}` : ''}`,
    }
  })
  const noGround = Math.max(0, rem.lowTotal - rem.list.length)

  const prepLines: Line[] = prep ? prep.open.map((p: any) => ({
    tone: p.noFees ? 'red' as const : 'amber' as const,
    html: `<b>${esc(unitShort(str(p.unit)))}</b> — ${esc(str(p.guest) || 'Guest')} · ${esc(shortDate(p.checkIn))} to ${esc(shortDate(p.checkOut))} · ${esc(str(p.source))}`,
    sub: `${p.noFees ? 'No fees on the folio: the cleaning and repair fees were never set up.' : 'Cleaning and repair split not entered.'} ${esc(str(p.ownerName))}`,
  })) : []

  const head = [
    top.length ? `<b style="${T.red}">${plural(top.length, 'top issue')}</b>` : `<span style="${T.green}">no top issues</span>`,
    `<b>${notForSale}</b> ${notForSale === 1 ? 'unit' : 'units'} off a channel`,
    owed ? `<b>${owed}</b> ${owed === 1 ? 'review' : 'reviews'} to reply${owedLow ? ` (<b style="${T.red}">${owedLow} low</b>)` : ''}` : '',
    remLines.length ? `<b>${remLines.length}</b> worth a removal request` : '',
    `<b>${st.never + st.low + st.stale}</b> listings to optimize`,
    prep ? `<b>${prep.prepOpen}</b> statement prep open` : '',
  ].filter(Boolean).join(' · ')

  const parts = [
    { html: masthead(A, 'Admin morning', 'Channels, listings, reviews and statements', niceDay(today)) },
    { html: headline(A, head) },
    { html: top.length ? section('Top issues', top.map(itemLine), { cap: 8, accent: A, more: on('Admin desk', '/admin') }) : block('Top issues', `<p style="margin:2px 0 0;font-size:13.5px"><span style="${T.green}">Nothing urgent.</span> <span style="${T.muted}">No listing is off a channel it was selling on and no low review is waiting for a reply.</span></p>`, A) },
    { html: chan.length ? section('Channels not connected', chan.map(itemLine), { cap: 10, accent: A, more: on('Channels page', '/channels?problems=1') }) : block('Channels not connected', `<p style="margin:2px 0 0;font-size:13.5px;${T.green}">Every active listing is live on its channels.</p>`, A) },
    { html: remLines.length
        ? section('Reviews worth a removal request', remLines, { cap: 6, accent: A, more: on('Reviews page', '/reviews'), note: `Checked ${plural(rem.lowTotal, 'low review')} from the last 30 days. ${noGround ? `${noGround} ${noGround === 1 ? 'has' : 'have'} no policy ground: a fair complaint is not removable, so the work there is the reply and the fix. ` : ''}The request text is drafted on each review under More → Removal request; a person files it.` })
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
  const subject = `Admin morning · ${niceDay(today)} · ${plural(top.length, 'top issue')} · ${notForSale} off a channel${remLines.length ? ` · ${remLines.length} to dispute` : ''}`
  return { subject, html, words: words(html), counts: { top: top.length, channels: chan.length, notForSale, removal: remLines.length, lowReviews: rem.lowTotal, optimize: st.never + st.low + st.stale, prepOpen: prep ? prep.prepOpen : 0, repliesOwed: owed } }
}
