// TASK BRIEF — the one place that decides how a Breezeway task's description reads.
//
// Jon, 2026-09-14: "the details that are added to the tasks in the description [should be] a
// little tighter and cleaner. It feels like a lot of noise. Should share guest feedback. Should
// share things to look for based on guest feedback, sentiment, reviews, or previous glitches.
// Things like that should be added to the task, and then it should be organized a little better."
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────
// Two screens each built this text their own way, and neither was readable in the field app.
//
//   The Add-a-task sheet produced: a run-on paragraph of standing instructions, then a bullet list
//   headed "Look specifically at (from this unit's recent guest feedback)", then a 240-character
//   quoted review. On a phone that is most of a screen before the first actionable word, and four
//   of those bullets were generic filler present on every task in the portfolio.
//
//   The scheduler's unit panel produced one long line: "Why: a; b — Last feedback (2/5): <300
//   chars> — Check: a; b; c; d". Semicolons doing the work of line breaks.
//
// ── THE RULES HERE ──────────────────────────────────────────────────────────────────────────────
//   1. NOTHING GENERIC. A line that would be true of every unit in the portfolio is noise, and
//      noise is what teaches people to stop reading the description on the one task that matters.
//      If there is no real evidence, the brief is just the standing instruction and stops.
//   2. EVERY CLAIM CARRIES ITS SOURCE. "A/C — does it actually cool" is an opinion; "A/C — guest,
//      Aug 14, 2★: 'never got below 78'" is a fact somebody can act on and, if it is wrong, argue
//      with. Unsourced checks are how a checklist becomes wallpaper.
//   3. SHORT SECTIONS, PLAIN HEADINGS, HARD CAPS. Four focus rows, one quote, 120 characters of
//      evidence per row. The brief is a phone screen, not a file.
//   4. ORDER IS WHY → WHAT → WHAT THE GUEST SAID. Why this unit is being touched, then what to do
//      about it, then the raw words in case the crew wants the context. Instructions first.
//   5. NOT A CHECKLIST. When a real Breezeway template is attached, its checklist travels with the
//      task; repeating it here is the same duplication the taxonomy fix removed from the board.

export type BriefFocus = {
  item: string
  because?: string
  source?: 'review' | 'glitch'
  when?: string
  rating?: number | null
}

export type BriefIntel = {
  lastFeedback?: { rating: number | null; guest?: string | null; date: string | null; excerpt: string | null } | null
  focus?: BriefFocus[] | null
  /** True when `checklist` is the portfolio-generic fallback — the brief never prints it. */
  generic?: boolean
  history?: {
    lowReviews?: number
    reviewWindowDays?: number
    openGlitches?: number
    fixedGlitches?: number
    glitchWindowDays?: number
    lastGlitch?: { type: string; when: string; open: boolean } | null
  } | null
  inspection?: { recommended: boolean; reasons: string[] } | null
}

const MAX_FOCUS = 4
const MAX_QUOTE = 180

const clip = (s: any, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…'
}
/** "2026-08-14" → "Aug 14". The ISO date is machine spelling; the crew reads a day. */
const niceDay = (iso: string | null | undefined) => {
  const t = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ''
  const [y, m, d] = t.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const stars = (r: number | null | undefined) => (r == null || !Number.isFinite(Number(r)) ? '' : Number(r) + '★')

/** The "why this unit" lines — counts, not prose, and only the ones with a number behind them. */
function whyLines(intel: BriefIntel): string[] {
  const h = intel.history || {}
  const out: string[] = []
  if (h.openGlitches) out.push(h.openGlitches + ' open glitch' + (h.openGlitches > 1 ? 'es' : '') + ' on this unit')
  if (h.lowReviews) {
    out.push(h.lowReviews + ' low review' + (h.lowReviews > 1 ? 's' : '') +
      (h.reviewWindowDays ? ' in the last ' + h.reviewWindowDays + ' days' : ''))
  }
  if (h.fixedGlitches) {
    out.push(h.fixedGlitches + ' glitch' + (h.fixedGlitches > 1 ? 'es' : '') + ' fixed recently — worth confirming ' + (h.fixedGlitches > 1 ? 'they held' : 'it held'))
  }
  return out
}

/**
 * Build a task description.
 *
 * `base` is the standing instruction for this kind of work (the template's own words). Everything
 * after it is evidence about THIS unit, and every section disappears when it has nothing real to
 * say — so a quiet unit gets a two-line task and a troubled one gets the full picture.
 */
export function buildTaskBrief(base: string, intel?: BriefIntel | null, opts?: { unit?: string }): string {
  const blocks: string[] = []
  const head = String(base || '').trim()
  if (head) blocks.push(head)

  if (!intel) return blocks.join('\n\n')

  const why = whyLines(intel)
  if (why.length) blocks.push('WHY THIS UNIT\n' + why.map(w => '• ' + w).join('\n'))

  // Generic fallback rows never make it here — see rule 1.
  const focus = (intel.generic ? [] : (intel.focus || [])).slice(0, MAX_FOCUS)
  if (focus.length) {
    const rows = focus.map(f => {
      const src = f.source === 'glitch' ? 'glitch' : 'guest'
      const meta = [src, f.when || '', f.source === 'review' ? stars(f.rating) : ''].filter(Boolean).join(', ')
      const ev = clip(f.because || '', 120)
      return '• ' + f.item + (ev ? '\n  ' + (meta ? meta + ': ' : '') + '“' + ev + '”' : '')
    })
    blocks.push('LOOK AT\n' + rows.join('\n'))
  }

  const lf = intel.lastFeedback
  if (lf && lf.excerpt && String(lf.excerpt).trim()) {
    const tag = [niceDay(lf.date), stars(lf.rating)].filter(Boolean).join(', ')
    blocks.push('LAST GUEST' + (tag ? ' (' + tag + ')' : '') + '\n“' + clip(lf.excerpt, MAX_QUOTE) + '”')
  }

  // A unit with nothing on it says so in one line, rather than leaving the crew to wonder whether
  // the brief failed to load.
  if (blocks.length === (head ? 1 : 0) && opts?.unit) {
    blocks.push('No recent low reviews or open glitches on ' + opts.unit + '.')
  }

  return blocks.join('\n\n').trim()
}
