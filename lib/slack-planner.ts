import 'server-only'
// THE WEEK AHEAD, POSTED TO THE TEAM (Jon, 2026-08-21: "should auto post in slack ... with
// screenshot / file for team to look at. So they can see assignments and schedule. This allows the
// team to see when they are working what they are working on").
//
// WHY A MONOSPACE GRID AND NOT A SCREENSHOT: rendering the planner to an image would need a
// headless browser, which does not exist on the serverless functions this app runs on. A fenced
// code block is the next best thing and is arguably better — Slack renders it as a real grid on
// desktop, it stays readable on a phone, it is searchable, and it never expires the way an uploaded
// file preview can. The live link goes under it for anyone who wants to tap through.
//
// TONE: this is read by the crew, so it follows the house rule — state the picture, point at the
// next thing, stay on their side. Never a scoreboard, never a name held up as a problem.
import { buildTeamSchedule, sunOf, addDays, ymdET, type TeamSchedule } from '@/lib/team-schedule'
import { getSlackRules, type SlackRules } from '@/lib/slack-rules'
import { supabaseAdmin } from '@/lib/supabase-admin'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Pad to a fixed width so the columns line up inside a Slack code block. */
function pad(s: string, n: number): string {
  const t = s.length > n ? s.slice(0, n - 1) + '…' : s
  return t + ' '.repeat(Math.max(0, n - t.length))
}
function padL(s: string, n: number): string {
  const t = s.length > n ? s.slice(0, n) : s
  return ' '.repeat(Math.max(0, n - t.length)) + t
}
function prettyDay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * A market-scoped share link carrying the planner, if one exists — so the Slack post can offer the
 * live version. Jon makes the link in the hub; this just finds it. No link, no line.
 */
async function plannerLinkFor(market: string): Promise<string | null> {
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('share_links')
      .select('code, scope_type, scope_ids, sections')
      .is('revoked_at', null).limit(200)
    for (const row of (data || []) as any[]) {
      const sections = row.sections && typeof row.sections === 'object' ? row.sections : {}
      if (sections.team !== true) continue
      if (str(row.scope_type) !== 'market') continue
      const ids: string[] = Array.isArray(row.scope_ids) ? row.scope_ids.map(str) : []
      if (ids.some(m => m.toLowerCase() === market.toLowerCase())) {
        const base = str(process.env.NEXT_PUBLIC_SITE_URL) || 'https://lighthouse-stay.vercel.app'
        return base.replace(/\/+$/, '') + '/share/' + str(row.code)
      }
    }
  } catch { /* the link is a nicety, never a blocker */ }
  return null
}

export type PlannerPost = {
  market: string
  groupKey: string
  summary: string
  body: string
  threadBody: string | null
  people: number
  cleans: number
}

/**
 * One post per market for the week starting `weekStart` (Sunday). Returns nothing for a market with
 * nobody on — an empty rota is not worth a notification.
 */
export async function buildPlannerPosts(weekStartIn?: string, rulesIn?: SlackRules): Promise<PlannerPost[]> {
  const rules = rulesIn || (await getSlackRules())
  const today = ymdET(new Date())
  // Default to the week that is about to start, which is what a Sunday-evening post is for.
  const weekStart = weekStartIn || sunOf(addDays(today, 1))
  const weekEnd = addDays(weekStart, 6)

  const plan: TeamSchedule = await buildTeamSchedule({ from: weekStart, to: weekEnd })
  const out: PlannerPost[] = []

  for (const m of plan.markets) {
    const people = m.people.filter(p => p.jobs > 0 || Object.keys(p.roster).length > 0)
    if (!people.length) continue

    // ── the grid ──────────────────────────────────────────────────────────────────────────────
    const NAME_W = 14
    const COL_W = 5
    const header = pad('', NAME_W) + plan.days.map(d => padL(d.dow, COL_W)).join('')
    const rows = people.map(p => {
      const cells = plan.days.map(d => {
        const n = (p.byDay[d.date] || []).length
        if (n) return padL(String(n), COL_W)
        const st = p.roster[d.date] || ''
        if (/^working$/i.test(st)) return padL('on', COL_W)
        if (/on.?call/i.test(st)) return padL('call', COL_W)
        if (/^off|req/i.test(st)) return padL('—', COL_W)
        return padL('·', COL_W)
      }).join('')
      return pad(p.name, NAME_W) + cells
    })
    const grid = '```\n' + [header].concat(rows).join('\n') + '\n```'

    // ── what to plan around ───────────────────────────────────────────────────────────────────
    // The tags exist so somebody can get ahead of a heavy day, so name the day and the unit.
    const seen: Record<string, boolean> = {}
    const heads: string[] = []
    for (const d of plan.days) {
      for (const p of people) {
        for (const j of p.byDay[d.date] || []) {
          for (const t of j.tags) {
            const k = t.key + '|' + j.unit + '|' + d.date
            if (seen[k]) continue
            seen[k] = true
            heads.push('• ' + t.label + ' — ' + j.unit + ', ' + prettyDay(d.date))
          }
        }
      }
    }

    const busiest = plan.days
      .map(d => ({ d, n: (m.perDay[d.date] || { cleans: 0 }).cleans }))
      .sort((a, b) => b.n - a.n)[0]

    const link = await plannerLinkFor(m.market)

    const lines: string[] = []
    lines.push('*' + m.market + ' — week of ' + prettyDay(weekStart) + '*')
    lines.push('')
    lines.push(m.cleans + ' cleans across ' + people.length + ' of you' +
      (busiest && busiest.n ? '. ' + prettyDay(busiest.d.date) + ' is the big one at ' + busiest.n + '.' : '.'))
    lines.push('')
    lines.push(grid)
    lines.push('_Numbers are jobs booked in so far · on = rostered, — = off, · = nothing set_')
    if (heads.length) {
      lines.push('')
      lines.push('*Worth planning around:*')
      lines.push(heads.slice(0, 8).join('\n'))
    }
    if (link) {
      lines.push('')
      lines.push('Live planner, always current: ' + link)
    }
    lines.push('')
    lines.push('Anything look wrong for your week? Say so here and we will sort it before Monday.')

    const es = rules.bilingualFieldChannels
      ? [
          '*' + m.market + ' — semana del ' + prettyDay(weekStart) + '*',
          '',
          m.cleans + ' limpiezas entre ' + people.length + ' personas.',
          '',
          grid,
          '_Los números son trabajos ya asignados · on = programado, — = libre, · = sin marcar_',
          '',
          '¿Algo no cuadra con tu semana? Dilo aquí y lo arreglamos antes del lunes.',
        ].join('\n')
      : null

    out.push({
      market: m.market,
      groupKey: 'weekly_planner:' + m.market.toLowerCase() + ':' + weekStart,
      summary: m.market + ' week of ' + weekStart + ' — ' + m.cleans + ' cleans, ' + people.length + ' people',
      body: lines.join('\n'),
      threadBody: es,
      people: people.length,
      cleans: m.cleans,
    })
  }
  return out
}
