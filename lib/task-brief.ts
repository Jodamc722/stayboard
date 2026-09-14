// UNIT BRIEF PREVIEW — what the Add-a-task sheet SHOWS on screen before you create the task.
//
// ── READ THIS BEFORE USING IT ───────────────────────────────────────────────────────────────────
// Nothing here is ever sent to Breezeway. The text a crew member actually reads is built on the
// server by lib/listingIntel, which has done this since August and does it properly: role-shaped
// (a cleaner, an inspector and a maintenance tech need three different briefs), bilingual, scored
// against the portfolio, batched so a 40-unit push costs one context load rather than forty.
//
// ── WHY THIS FILE EXISTS, AND WHY IT SHRANK (2026-09-14) ────────────────────────────────────────
// It started the morning as a task-description composer, written to fix Jon's complaint that task
// details "feel like a lot of noise". The complaint was right and the diagnosis was half wrong.
//
// The noise was not that the description was badly composed. It was that it was composed TWICE.
// components/AddTaskSheet built guest feedback, a checklist and a quoted review in the browser,
// and /api/ops-today/add-task then appended the real listingIntel block underneath it — so the
// person opening the task in the field app read the same complaint in two different formats, one
// of them thinner and English-only. Making the browser half tidier, which is what the first pass
// did, only made the duplicate look more deliberate.
//
// So the rule is now: THE SERVER ATTACHES THE UNIT BRIEF, CALLERS SEND THE STANDING INSTRUCTION.
// /api/sentiment/create-qc learned to do it too, and both routes strip any block a client sends.
// What is left for this file is the honest remainder — letting somebody SEE, while they fill the
// form in, what the crew is going to get, without that preview becoming a second copy of it.

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
  /** True when the intel is the portfolio-generic fallback — the preview says nothing rather than that. */
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

export type PreviewRow = { label: string; detail?: string; tone: 'alert' | 'info' }

const clip = (s: any, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…'
}
const stars = (r: number | null | undefined) => (r == null || !Number.isFinite(Number(r)) ? '' : Number(r) + '★')
/** "2026-08-14" → "Aug 14". The ISO date is machine spelling; a person reads a day. */
const niceDay = (iso: string | null | undefined) => {
  const t = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ''
  const [y, m, d] = t.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * A handful of lines summarising what this unit has on it, for display in the sheet.
 *
 * NOTHING GENERIC gets through: a row that would be true of every unit in the portfolio teaches
 * people to stop reading, and the point of the preview is to tell you whether this particular unit
 * has anything worth knowing. An empty array means "quiet unit", and the caller should say so in
 * one line rather than drawing an empty box.
 */
export function previewRows(intel?: BriefIntel | null): PreviewRow[] {
  if (!intel || intel.generic) return []
  const rows: PreviewRow[] = []
  const h = intel.history || {}

  if (h.openGlitches) rows.push({ label: h.openGlitches + ' open glitch' + (h.openGlitches > 1 ? 'es' : ''), tone: 'alert' })
  if (h.lowReviews) {
    rows.push({
      label: h.lowReviews + ' low review' + (h.lowReviews > 1 ? 's' : ''),
      detail: h.reviewWindowDays ? 'last ' + h.reviewWindowDays + ' days' : undefined,
      tone: 'alert',
    })
  }
  if (h.fixedGlitches) {
    rows.push({ label: h.fixedGlitches + ' glitch' + (h.fixedGlitches > 1 ? 'es' : '') + ' fixed recently', detail: 'worth confirming ' + (h.fixedGlitches > 1 ? 'they held' : 'it held'), tone: 'info' })
  }

  for (const f of (intel.focus || []).slice(0, 4)) {
    const src = f.source === 'glitch' ? 'glitch' : 'guest'
    const meta = [src, f.when || '', f.source === 'review' ? stars(f.rating) : ''].filter(Boolean).join(', ')
    const ev = clip(f.because || '', 90)
    rows.push({ label: f.item, detail: ev ? (meta ? meta + ': “' + ev + '”' : '“' + ev + '”') : undefined, tone: 'info' })
  }

  const lf = intel.lastFeedback
  if (lf && lf.excerpt && String(lf.excerpt).trim()) {
    const tag = [niceDay(lf.date), stars(lf.rating)].filter(Boolean).join(', ')
    rows.push({ label: 'Last guest' + (tag ? ' (' + tag + ')' : ''), detail: '“' + clip(lf.excerpt, 140) + '”', tone: 'info' })
  }
  return rows
}
