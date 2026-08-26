// The standing audit, on a schedule. Runs the checks, updates the tab, and — only when something
// NEW went wrong — says so in Slack.
//
// THE RESTRAINT IS THE FEATURE. It posts newly-opened findings, never the whole open list. An alert
// that repeats every two hours trains people to mute the channel, and a muted channel is worse than
// no channel because everyone believes they are covered. Once a day it also posts a short roll-up
// so a quiet week still gets confirmed as quiet rather than merely silent.
import { NextRequest, NextResponse } from 'next/server'
import { runAudit, listAudits } from '@/lib/eve/audit'
import { getApprovalsChannel } from '@/lib/eve/approvals'
import { postToChannel } from '@/lib/slack'
import { getSetting, setSetting } from '@/lib/app-settings'
import { todayET } from '@/lib/eve/ctx'
import { eveGate } from '../../agent/route'
import { recordRun } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }

const ICON: Record<string, string> = { critical: '🔴', warn: '🟠', info: '⚪️' }
const ROLLUP_KEY = 'eve_audit_last_rollup'

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const viaCron = !!secret && auth === `Bearer ${secret}`
  if (!viaCron) {
    const gate = await eveGate()
    if (!gate.ok) return gate.res
  }

  const sp = new URL(req.url).searchParams
  const quiet = sp.get('quiet') === '1'
  const res = await runAudit()

  let posted: string | null = null
  if (!quiet) {
    const ch = await getApprovalsChannel()
    const loud = res.opened.filter(f => f.severity !== 'info')
    // The daily roll-up fires on the FIRST run after 7am Eastern, tracked by date rather than by
    // matching an hour. Matching an hour looks tidier and breaks twice a year: an every-other-hour
    // UTC schedule lines up with 7am ET in winter and misses it entirely all summer.
    const hourET = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()))
    const today = todayET()
    const lastRollup = await getSetting<string>(ROLLUP_KEY, '')
    const rollup = hourET >= 7 && lastRollup !== today

    if (ch && (loud.length || rollup)) {
      const lines: string[] = []
      if (loud.length) {
        lines.push(`*${loud.length} new issue${loud.length === 1 ? '' : 's'} found*`)
        for (const f of loud.slice(0, 8)) {
          lines.push(`${ICON[f.severity] || '•'} *${f.title}*\n${f.detail.slice(0, 240)}\n_→ ${f.fix.slice(0, 160)}_`)
        }
        if (loud.length > 8) lines.push(`…and ${loud.length - 8} more.`)
      }
      if (rollup) {
        const open = await listAudits({ status: 'open', limit: 200 })
        const crit = open.filter(x => x.severity === 'critical').length
        const warn = open.filter(x => x.severity === 'warn').length
        lines.push(open.length
          ? `*On the tab this morning:* ${crit} critical, ${warn} warnings, ${open.length - crit - warn} info.`
            + (crit ? `\nOldest critical: ${open.filter(x => x.severity === 'critical')[0]?.title} — open ${open.filter(x => x.severity === 'critical')[0]?.ageDays} day(s).` : '')
          : '*Nothing on the tab.* Every feed is current, nobody is waiting on a reply past six hours, and no arrival is missing a clean.')
        if (res.resolved.length) lines.push(`_${res.resolved.length} item(s) closed themselves since the last run._`)
      }
      const text = '🔎 *Eve audit*\n\n' + lines.join('\n\n')
      const r = await postToChannel(ch.id, text)
      posted = r.ok ? '#' + ch.name : `failed: ${r.error}`
      if (rollup && r.ok) await setSetting(ROLLUP_KEY, today, 'eve-audit')
    }
  }

  recordRun({ name: 'eve-audit', ok: true, itemCount: (res as any)?.open?.length ?? (res as any)?.found ?? undefined, detail: { posted, resolved: (res as any)?.resolved?.length } })
  return NextResponse.json({ ...res, ranBy: viaCron ? 'cron' : 'admin', posted })
}
