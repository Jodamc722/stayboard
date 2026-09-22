// THE MONTH, IN ONE SCREEN — the page an owner reads if they read nothing else.
//
// Jon, 2026-09-22, picked "verdict page, then the detail": the owner review used to open with a
// snapshot of numbers and never actually answered the two questions an owner has, which are "how
// did my building do?" and "what are you doing about it?". Six sections of correct data do not
// answer those; they leave the owner to do the synthesis, and most owners do not.
//
// DERIVED, NOT GENERATED. Every line here is computed from content the report already carries, so
// the six reviews that exist today gain this page the moment the code deploys — no regeneration, no
// model call, no new pipeline. That was the condition of rebuilding in place rather than shipping a
// new template beside the old one.
//
// THE HONESTY PROBLEM, which is the whole reason this is careful code and not a paragraph of prose.
// The live 17WEST September report is ahead of its comp set on occupancy, ADR and RevPAR — and
// behind its own budget on ADR, RevPAR and gross revenue. Both are true. A verdict that reports
// only the first is the kind of owner communication that destroys trust the month the owner finally
// reads the detail; one that reports only the second buries a genuinely good competitive result.
// So the summary carries BOTH and says so in the headline. Where a fact is not in the report, the
// line is omitted rather than softened — an absent line is honest, a vague one is not.
//
// Nothing here is a forecast and nothing is editorial. If Jon wants different words he overrides
// them, and the override is stored on the report (content.verdict) and wins from then on.
import type { ReportContent } from './owner-report'

export type VerdictTone = 'good' | 'watch' | 'flat'
export type VerdictNumber = { key: string; label: string; value: string; sub: string }
export type VerdictLine = { key: string; text: string; tone: VerdictTone }
export type Verdict = {
  numbers: VerdictNumber[]
  lines: VerdictLine[]
  headline: string
  /** True when Jon typed these rather than the report deriving them. */
  edited?: boolean
}

type Any = any

const str = (v: Any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clean = (v: Any) => str(v).replace(/\s+/g, ' ').trim()

/** Deltas render with a real minus sign (U+2212) as often as a hyphen. Both mean behind. */
function signOf(delta: Any): 1 | -1 | 0 {
  const d = clean(delta)
  if (!d) return 0
  if (/^[+]/.test(d)) return 1
  if (/^[-−]/.test(d)) return -1
  return 0
}

/** "Occupancy, ADR and RevPAR" — an English list, because a comma-joined one reads like a machine. */
function list(items: string[]): string {
  const a = items.filter(Boolean)
  if (a.length === 0) return ''
  if (a.length === 1) return a[0]
  if (a.length === 2) return a[0] + ' and ' + a[1]
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]
}

/**
 * A metric name as it belongs mid-sentence. The house terms are not ordinary words: naive
 * lower-casing turns "RevPAR" into "revPAR" and "Gross Rev" into "gross Rev", which is exactly the
 * sort of detail that makes an owner document read as machine-written.
 */
const METRIC_WORDS: Array<[RegExp, string]> = [
  [/^occupancy$/i, 'occupancy'],
  [/^adr$/i, 'ADR'],
  [/^revpar$/i, 'RevPAR'],
  [/^gross\s*rev(enue)?$/i, 'gross revenue'],
  [/^revenue$/i, 'revenue'],
  [/^net\s*rev(enue)?$/i, 'net revenue'],
  [/^nights?$/i, 'nights'],
]
function lower(s: string): string {
  const v = s.trim()
  for (const [re, word] of METRIC_WORDS) if (re.test(v)) return word
  // An acronym stays an acronym; an ordinary capitalised word drops its capital.
  if (/^[A-Z0-9]{2,}$/.test(v)) return v
  return v.charAt(0).toLowerCase() + v.slice(1)
}

/** The three numbers. A card's `override` is what the report actually shows, so it wins. */
function numbersFrom(c: Any): VerdictNumber[] {
  const cards: Any[] = Array.isArray(c?.snapshot?.cards) ? c.snapshot.cards : []
  const want = ['revenue', 'occupancy', 'revpar']
  const out: VerdictNumber[] = []
  for (const key of want) {
    const card = cards.find(x => str(x.key).toLowerCase() === key)
    if (!card) continue
    const value = clean(card.override || card.value)
    if (!value) continue
    out.push({ key, label: clean(card.label) || key.toUpperCase(), value, sub: clean(card.gross ? 'Gross ' + card.gross : '') })
  }
  // A report missing one of the three still gets a row of whatever it does have, rather than nothing.
  if (out.length < 3) {
    for (const card of cards) {
      if (out.length >= 3) break
      const k = str(card.key).toLowerCase()
      if (out.some(o => o.key === k)) continue
      const value = clean(card.override || card.value)
      if (value) out.push({ key: k, label: clean(card.label) || k.toUpperCase(), value, sub: clean(card.gross ? 'Gross ' + card.gross : '') })
    }
  }
  return out.slice(0, 3)
}

/** How we did against the comp set. */
function marketLine(c: Any): VerdictLine | null {
  const rows: Any[] = Array.isArray(c?.pacing?.rows) ? c.pacing.rows : []
  if (!rows.length) return null
  const ahead: string[] = [], behind: string[] = []
  for (const r of rows) {
    const metric = clean(r.metric)
    if (!metric) continue
    const s = signOf(r.delta)
    if (s > 0) ahead.push(lower(metric))
    else if (s < 0) behind.push(lower(metric))
  }
  if (!ahead.length && !behind.length) return null
  if (ahead.length && !behind.length) {
    return { key: 'market', tone: 'good', text: `Ahead of the comp set on ${ahead.length >= 3 ? 'every metric' : list(ahead)}.` }
  }
  if (behind.length && !ahead.length) {
    return { key: 'market', tone: 'watch', text: `Behind the comp set on ${behind.length >= 3 ? 'every metric' : list(behind)}.` }
  }
  return { key: 'market', tone: 'watch', text: `Ahead of the comp set on ${list(ahead)}, behind on ${list(behind)}.` }
}

/** How we did against the budget we agreed. Reads the month that is actually being reported. */
function budgetLine(c: Any): VerdictLine | null {
  const months: Any[] = Array.isArray(c?.plan?.months) ? c.plan.months : []
  // A PACING month is a forward month filling in — measuring it against a full month's budget says
  // nothing yet, and reading it as a miss is the exact misreading the PACING label exists to stop.
  const m = months.find(x => !/pacing/i.test(str(x.status))) || null
  if (!m || !Array.isArray(m.rows) || !m.rows.length) return null
  const good: string[] = [], bad: string[] = []
  for (const r of m.rows) {
    const metric = clean(r.metric)
    if (!metric) continue
    if (r.good === true) good.push(lower(metric))
    else if (r.good === false) bad.push(lower(metric))
  }
  if (!good.length && !bad.length) return null
  const label = clean(m.label) || 'the month'
  const name = /^[A-Z ]+$/.test(label) ? label.charAt(0) + label.slice(1).toLowerCase() : label
  if (good.length && !bad.length) return { key: 'budget', tone: 'good', text: `${name} is at or ahead of budget on ${good.length >= 3 ? 'every line' : list(good)}.` }
  if (bad.length && !good.length) return { key: 'budget', tone: 'watch', text: `${name} is behind budget on ${bad.length >= 3 ? 'every line' : list(bad)}.` }
  return { key: 'budget', tone: 'watch', text: `Against budget, ${name} is ahead on ${list(good)} and behind on ${list(bad)}.` }
}

/** What the next month looks like on the books. */
function aheadLine(c: Any): VerdictLine | null {
  const months: Any[] = Array.isArray(c?.ahead?.months) ? c.ahead.months : []
  // The first FORWARD month — the one that is still filling, not the month being reported.
  const next = months.find(m => /pacing/i.test(str(m.status))) || months.find(m => !/in month|closed/i.test(str(m.status)))
  if (!next) return null
  const label = clean(next.label)
  const occ = Number(next.occPct)
  if (!label || !Number.isFinite(occ)) return null
  const name = label.replace(/\s+\d{4}$/, '')
  const nice = /^[A-Z ]+$/.test(name) ? name.charAt(0) + name.slice(1).toLowerCase() : name
  const well = /well/i.test(str(next.status))
  return {
    key: 'ahead', tone: well ? 'good' : 'flat',
    text: `${nice} is ${Math.round(occ)}% on the books so far${well ? ' and pacing well' : ''}.`,
  }
}

/**
 * What we are doing about it — the half of the question the numbers never answer.
 *
 * THE BOILERPLATE TRAP, found live on the 17WEST September report. Its three guest themes were all
 * praise, and the third one's action read "We run departure checklists and pre-arrival inspections
 * on every turn." That is a true sentence about how we always operate, and as the closing line of
 * an owner summary it is filler — it describes standing practice, not a response to anything that
 * happened this month. An owner who reads one line of boilerplate stops trusting the other three.
 *
 * So a theme's action only qualifies when it reads as a RESPONSE: not attached to a theme the
 * report itself labelled a highlight, and not phrased as what we always do. Everything else falls
 * through to the work actually completed on the property, which is concrete and checkable, and
 * failing that the line is simply omitted.
 */
const PRAISE = /highlight|great|excellent|loved|positive/i
const STANDING_PRACTICE = /^\s*we\s+(keep|maintain|run|continue|always|remain|ensure|provide)\b/i

function actionLine(c: Any): VerdictLine | null {
  const themes: Any[] = Array.isArray(c?.voices?.themes) ? c.voices.themes : []
  const response = themes.find(t => {
    const action = clean(t?.action)
    if (!action) return false
    if (PRAISE.test(str(t?.title))) return false
    if (STANDING_PRACTICE.test(action)) return false
    return true
  })
  const action = clean(response?.action)
  if (action) return { key: 'action', tone: 'flat', text: action }

  const weeks: Any[] = Array.isArray(c?.projects?.weeks) ? c.projects.weeks : []
  let items = 0
  for (const w of weeks) for (const g of (w?.groups || [])) items += (g?.items || []).length
  if (items > 0) {
    return {
      key: 'action', tone: 'flat',
      text: `${items} piece${items === 1 ? '' : 's'} of work were completed on the property this period — the detail is below.`,
    }
  }
  return null
}

/** The one sentence at the top. It has to survive being the only thing read. */
function headlineFrom(market: VerdictLine | null, budget: VerdictLine | null): string {
  const mGood = market?.tone === 'good'
  const bGood = budget?.tone === 'good'
  if (market && budget) {
    if (mGood && bGood) return 'A strong month — ahead of the market and on plan.'
    if (mGood && !bGood) return 'Ahead of the market, behind our own budget.'
    if (!mGood && bGood) return 'On plan, though the market ran ahead of us.'
    return 'A soft month against both the market and the plan.'
  }
  if (market) return mGood ? 'Ahead of the market this period.' : 'The market ran ahead of us this period.'
  if (budget) return bGood ? 'Tracking at or ahead of budget.' : 'Running behind budget this period.'
  return 'The period at a glance.'
}

/**
 * Build the summary. Returns null when the report carries too little to say anything true —
 * a blank section is better than a confident empty one.
 */
export function buildVerdict(content: Any): Verdict | null {
  const c = (content || {}) as Partial<ReportContent> & Any
  // An override Jon typed wins outright and is never blended with derived lines.
  const saved = c.verdict
  if (saved && typeof saved === 'object' && (Array.isArray(saved.lines) || saved.headline)) {
    return {
      numbers: Array.isArray(saved.numbers) && saved.numbers.length ? saved.numbers : numbersFrom(c),
      lines: Array.isArray(saved.lines) ? saved.lines : [],
      headline: clean(saved.headline) || 'The period at a glance.',
      edited: true,
    }
  }

  const numbers = numbersFrom(c)
  const market = marketLine(c)
  const budget = budgetLine(c)
  const lines = [market, budget, aheadLine(c), actionLine(c)].filter(Boolean) as VerdictLine[]
  if (!numbers.length && !lines.length) return null
  return { numbers, lines, headline: headlineFrom(market, budget) }
}
