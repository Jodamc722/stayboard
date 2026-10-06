// OPS HEALTH — one number for how today is going (Jon, 2026-10-05: "a scorecard for the today board,
// like health of our operations … glitches pending would be a heavy one, having rooms ready for
// arrivals by 4pm, inspection, maintenance tasks, calls made etc").
//
// Pure arithmetic over the counts the Today page already has, so the score never disagrees with the
// tiles under it. Six dimensions, weighted the way Jon ranked them; each starts at 100 and loses
// points for the specific things that cost a guest something, with a floor at 0. The overall is the
// weighted mean. No model, no history, no opinion a tile cannot show.
//
//   Guest issues       25  open glitches — an overdue one is the heaviest single item on the page
//   Rooms ready by 4pm 25  same-day turns: late / at risk / nobody on it; after 4pm, what missed
//   Maintenance        15  urgent or high open, nobody on it
//   Guest touch        15  today's welcome calls owed, notices late, low reviews unanswered
//   Inspections        10  big arrivals with nothing walking the unit, unassigned inspections
//   Office             10  checklist late, claims overdue, unpaid nobody has contacted
//
// Bands: 85+ Smooth · 65–84 Watch · under 65 Behind. The reasons are the sentences a manager would
// say out loud, and each dimension names the tile that opens it.
export type HealthDim = {
  key: 'glitches' | 'rooms' | 'maint' | 'guests' | 'insp' | 'office'
  label: string
  weight: number
  score: number
  /** The one line that explains the number. Empty when nothing is wrong. */
  why: string
  /** The Today tile that opens the list behind it. */
  tile: string
}
export type OpsHealth = { score: number; band: 'smooth' | 'watch' | 'behind'; label: string; dims: HealthDim[]; headline: string }

export type HealthInputs = {
  /** Minutes past midnight, ET. Decides whether "ready by 4pm" is a forecast or a result. */
  nowMin: number
  cleans: { total: number; done: number; late: number; atRisk: number; nobody: number; sameDay: number; sameDayDone: number; sameDayTrouble: number }
  glitches: { open: number; overdue: number; noTask: number; awaitingApproval: number }
  maint: { open: number; urgentOpen: number; nobody: number }
  insp: { needed: number; done: number; nobody: number; missingBig: number }
  calls: { todayOwed: number; todayDone: number; recoveryOwed: number; recoveryDone: number; loaded: boolean }
  notices: { toSend: number; late: number }
  reviews: { waiting: number; lowWaiting: number }
  checklist: { total: number; done: number; late: number }
  claims: { open: number; dueSoon: number; review: number }
  unpaid: { open: number; today: number }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const FOUR_PM = 16 * 60

export function opsHealth(i: HealthInputs): OpsHealth {
  const dims: HealthDim[] = []

  // ── Guest issues (25) ──
  {
    const g = i.glitches
    const why: string[] = []
    let s = 100 - g.overdue * 25 - Math.max(0, g.open - g.overdue - g.awaitingApproval) * 8 - g.awaitingApproval * 3 - g.noTask * 4
    if (g.overdue) why.push(`${plural(g.overdue, 'glitch', 'glitches')} overdue`)
    if (g.noTask) why.push(`${g.noTask} with no task`)
    if (g.awaitingApproval) why.push(`${g.awaitingApproval} awaiting manager approval`)
    if (!why.length && g.open) why.push(`${plural(g.open, 'glitch', 'glitches')} open, all moving`)
    dims.push({ key: 'glitches', label: 'Guest issues', weight: 25, score: clamp(s), why: why.join(' · '), tile: 'glitches' })
  }

  // ── Rooms ready by 4pm (25) ──
  {
    const c = i.cleans
    const why: string[] = []
    let s = 100
    if (c.sameDay > 0) {
      // The same-day turns are the deadline; a late or at-risk one is a guest at the door of a dirty room.
      s -= (c.sameDayTrouble / c.sameDay) * 70
      if (c.sameDayTrouble) why.push(`${c.sameDayTrouble} of ${c.sameDay} same-day turns ${i.nowMin >= FOUR_PM ? 'missed 4pm' : 'late or at risk'}`)
    }
    // The rest of the board: late anywhere costs, nobody-on-it costs more before noon than after.
    const otherTrouble = Math.max(0, c.late + c.atRisk - c.sameDayTrouble)
    s -= otherTrouble * 8
    s -= c.nobody * (i.nowMin < 12 * 60 ? 6 : 12)
    if (otherTrouble) why.push(`${otherTrouble} other ${otherTrouble === 1 ? 'clean' : 'cleans'} late or at risk`)
    if (c.nobody) why.push(`${c.nobody} nobody on it`)
    if (!why.length && c.total) why.push(c.done === c.total ? 'every clean done' : `${c.done}/${c.total} done, on track`)
    dims.push({ key: 'rooms', label: 'Rooms ready by 4pm', weight: 25, score: clamp(s), why: why.join(' · '), tile: 'cleans' })
  }

  // ── Maintenance (15) ──
  {
    const m = i.maint
    const why: string[] = []
    const s = 100 - m.urgentOpen * 15 - m.nobody * 10 - Math.max(0, m.open - m.urgentOpen - m.nobody) * 2
    if (m.urgentOpen) why.push(`${m.urgentOpen} urgent/high open`)
    if (m.nobody) why.push(`${m.nobody} nobody on it`)
    if (!why.length && m.open) why.push(`${plural(m.open, 'job')} open, all assigned`)
    dims.push({ key: 'maint', label: 'Maintenance', weight: 15, score: clamp(s), why: why.join(' · '), tile: 'maint' })
  }

  // ── Guest touch (15): calls, notices, reviews ──
  {
    const why: string[] = []
    let s = 100
    if (i.calls.loaded) {
      const owed = i.calls.todayOwed + i.calls.recoveryOwed
      const done = i.calls.todayDone + i.calls.recoveryDone
      const total = owed + done
      // Before 2pm the day's calls are still being made; by 4pm an unmade welcome call is a miss.
      const sting = i.nowMin < 14 * 60 ? 25 : i.nowMin < FOUR_PM ? 45 : 60
      if (total) s -= (owed / total) * sting
      if (owed) why.push(`${owed} of ${total} ${total === 1 ? 'call' : 'calls'} still owed`)
    }
    s -= i.notices.late * 12
    s -= i.reviews.lowWaiting * 10 + Math.max(0, i.reviews.waiting - i.reviews.lowWaiting) * 1
    if (i.notices.late) why.push(`${plural(i.notices.late, 'notice')} late`)
    if (i.reviews.lowWaiting) why.push(`${i.reviews.lowWaiting} low ${i.reviews.lowWaiting === 1 ? 'review' : 'reviews'} unanswered`)
    if (!why.length) why.push(i.calls.loaded ? 'calls made, notices out' : 'calls not read yet')
    dims.push({ key: 'guests', label: 'Guest touch', weight: 15, score: clamp(s), why: why.join(' · '), tile: 'welcome' })
  }

  // ── Inspections (10) ──
  {
    const x = i.insp
    const why: string[] = []
    const s = 100 - x.missingBig * 30 - x.nobody * 12
    if (x.missingBig) why.push(`${plural(x.missingBig, 'big arrival')} with no inspection`)
    if (x.nobody) why.push(`${x.nobody} unassigned`)
    if (!why.length && x.needed) why.push(x.done === x.needed ? 'all walked' : `${x.done}/${x.needed} walked, rest covered`)
    dims.push({ key: 'insp', label: 'Inspections', weight: 10, score: clamp(s), why: why.join(' · '), tile: 'insp' })
  }

  // ── Office (10): checklist, claims, unpaid ──
  {
    const why: string[] = []
    let s = 100
    s -= i.checklist.late * 8
    if (i.checklist.total) s -= Math.max(0, 1 - i.checklist.done / i.checklist.total) * (i.nowMin >= FOUR_PM ? 25 : 10)
    s -= i.claims.dueSoon * 10
    s -= i.unpaid.today * 10 + Math.max(0, i.unpaid.open - i.unpaid.today) * 3
    if (i.checklist.late) why.push(`${plural(i.checklist.late, 'checklist item')} late`)
    if (i.claims.dueSoon) why.push(`${plural(i.claims.dueSoon, 'claim')} due soon`)
    if (i.unpaid.today) why.push(`${i.unpaid.today} unpaid in house / arriving, not contacted`)
    else if (i.unpaid.open) why.push(`${i.unpaid.open} unpaid not contacted`)
    if (!why.length) why.push('checklist on pace, nothing overdue')
    dims.push({ key: 'office', label: 'Office', weight: 10, score: clamp(s), why: why.join(' · '), tile: 'checklist' })
  }

  const wsum = dims.reduce((a, d) => a + d.weight, 0)
  const score = clamp(dims.reduce((a, d) => a + d.score * d.weight, 0) / wsum)
  const band: OpsHealth['band'] = score >= 85 ? 'smooth' : score >= 65 ? 'watch' : 'behind'
  const label = band === 'smooth' ? 'Smooth' : band === 'watch' ? 'Watch' : 'Behind'
  // The headline is the worst weighted shortfall — the one thing to go fix.
  const worst = dims.slice().sort((a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight)[0]
  const headline = worst && worst.score < 100 ? `${worst.label}: ${worst.why}` : 'Nothing on the board is slipping.'
  return { score, band, label, dims, headline }
}
