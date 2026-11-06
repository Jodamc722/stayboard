// THE LISTING COPY AUDIT — the checks (Jon, 2026-11-06: "there should be audit in admin center, need it
// to work but should note these things" — after the Regenerate fixes: summary over 500, wrong facts,
// pushes that did not sync). Pure, so the Admin desk can re-run it in the browser on Guesty's live text.
//
// One unit's copy in, a list of findings out:
//   fix    a channel will refuse or cut it (Airbnb summary over 500, title over 50, banned content),
//          or it states the wrong bedrooms / bathrooms / guests
//   check  allowed, but worth fixing (an empty section, the summary without its closing line, all caps)
import { lintCopy, type CopyField } from './channel-lint'
import { factIssues, type Facts } from './listing-fit'

export const AUDIT_SECTIONS = ['summary', 'space', 'access', 'neighborhood', 'transit', 'notes'] as const
export const SECTION_LABEL: Record<string, string> = { title: 'Title', summary: 'Summary', space: 'The space', access: 'Guest access', neighborhood: 'Neighborhood', transit: 'Getting around', notes: 'Other things to note' }

export type AuditCopy = { title: string; sections: Record<string, string> }
export type Finding = { level: 'fix' | 'check'; kind: 'limit' | 'facts' | 'content' | 'empty' | 'closing' | 'sync'; field: string; message: string }

const CLOSING = /Please see Other things to note before booking\.?\s*$/i

export function auditCopy(copy: AuditCopy, facts: Facts): Finding[] {
  const out: Finding[] = []
  const title = String(copy.title || '').trim()
  const s = copy.sections || {}

  // The channel lint: the same rules every push runs through.
  const lint = lintCopy({ title, ...Object.fromEntries(AUDIT_SECTIONS.map(k => [k, String(s[k] || '')])) } as Partial<Record<CopyField, string>>)
  for (const h of lint) {
    const limit = /characters|bytes|limit|cap/i.test(h.message)
    out.push({ level: h.severity === 'block' ? 'fix' : 'check', kind: limit ? 'limit' : 'content', field: h.field === 'vrbo' ? 'Vrbo' : SECTION_LABEL[h.field] || h.field, message: h.message })
  }

  // Wrong facts, title and every section.
  for (const k of ['title', ...AUDIT_SECTIONS]) {
    const text = k === 'title' ? title : String(s[k] || '')
    if (!text.trim()) continue
    for (const m of factIssues(text, facts, k === 'title' ? 'The title' : SECTION_LABEL[k])) out.push({ level: 'fix', kind: 'facts', field: SECTION_LABEL[k], message: m })
  }

  // Missing pieces.
  if (!title) out.push({ level: 'fix', kind: 'empty', field: 'Title', message: 'No title in Guesty.' })
  for (const k of AUDIT_SECTIONS) {
    if (!String(s[k] || '').trim()) out.push({ level: k === 'summary' || k === 'space' ? 'fix' : 'check', kind: 'empty', field: SECTION_LABEL[k], message: `${SECTION_LABEL[k]} is empty.` })
  }
  const summary = String(s.summary || '').trim()
  if (summary && !CLOSING.test(summary)) out.push({ level: 'check', kind: 'closing', field: 'Summary', message: 'Summary does not end with “Please see Other things to note before booking.”' })

  // Fix first, then by field order.
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'fix' ? -1 : 1))
}
