// COMMAND CENTER — THE SCOREBOARD STRIP. The week's KPIs in one read (Jon, 2026-09-18: "Command
// Center should also track important KPIs: welcome calls, claims, glitches, labor per clean in
// Miami / Broward, maintenance labor and billable labor, etc. Also checklist completion").
//
// The tiles are built in lib/scoreboard.ts (shared with Eve's weekly review). This route is the
// thin wrapper: a five-minute cache (tag 'scoreboard') and the per-viewer money redaction, applied
// AFTER the cache so the cached copy is the same for everyone.
import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { getAccess, canSeeMoney } from '@/lib/access'
import { buildScoreboard, type ScoreTile } from '@/lib/scoreboard'

export type { ScoreDelta, ScoreRow, ScoreTile, Scoreboard } from '@/lib/scoreboard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cachedScoreboard = unstable_cache(buildScoreboard, ['command-scoreboard-v1'], { revalidate: 300, tags: ['scoreboard'] })

/** A viewer without the money perm gets the strip with the amounts blanked, never the amounts. */
function redact(t: ScoreTile): ScoreTile {
  const { money: _m, compare: _c, ...rest } = t
  if (!t.money) return rest
  if (t.key === 'claims') return { ...rest, sub: rest.sub.replace(/ · \$[\d,]+ back|\$[\d,]+ back/g, '').trim() || 'open', detail: { rows: rest.detail.rows.map(r => ({ ...r, text: r.text.replace(/ · \$[\d,]+/g, '') })), note: undefined } }
  return { ...rest, value: '—', sub: 'amounts hidden', delta: undefined, detail: { rows: [], note: 'Dollar amounts are shown to the owner and to people switched on at /users → Dollar amounts.' } }
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const board = await cachedScoreboard()
    const showMoney = canSeeMoney(access)
    return NextResponse.json({ ...board, tiles: board.tiles.map(t => showMoney ? (({ money: _m, compare: _c, ...rest }) => rest)(t) : redact(t)) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
