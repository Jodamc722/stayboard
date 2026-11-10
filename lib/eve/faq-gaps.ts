// MISSING FAQ ANSWERS — a short list, not an essay (owner, 2026-11-10: "We need to learn FAQ and guest
// related questions. If the team asks you can answer it quickly").
//
// Every time faq_search finds nothing for a real question, the question is noted here: deduped by its
// words, counted, kept 30 days, at most 40 rows (app_settings `eve_faq_gaps`, no migration). What comes
// out is the list the team can fill on Property FAQ — "parking at Eden (asked 4×)" — read by the
// knowledge browser's card, the weekly review pack and Eve herself. Nothing is asked of anyone and
// nothing is sent; a gap only becomes a question to a person through askQuestion's own gate.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'

export const FAQ_GAPS_KEY = 'eve_faq_gaps'
const KEEP_DAYS = 30
const MAX_ROWS = 40

export type FaqGap = { q: string; unit: string | null; n: number; first: string; last: string }

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

async function read(): Promise<FaqGap[]> {
  const v = await getSetting<FaqGap[] | null>(FAQ_GAPS_KEY, null).catch(() => null)
  const cutoff = Date.now() - KEEP_DAYS * 86400_000
  return (Array.isArray(v) ? v : []).filter(g => g && g.q && Date.parse(String(g.last || '')) >= cutoff)
}

/** Note one unanswered guest question. Never throws; a gap that cannot be noted is simply not noted. */
export async function noteFaqGap(question: string, unit?: string | null): Promise<void> {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  if (norm(q).length < 3) return
  try {
    const rows = await read()
    const now = new Date().toISOString()
    const key = norm(q)
    const hit = rows.find(g => norm(g.q) === key && (g.unit || null) === (unit || null))
    if (hit) { hit.n++; hit.last = now }
    else rows.push({ q, unit: unit || null, n: 1, first: now, last: now })
    rows.sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)))
    await setSetting(FAQ_GAPS_KEY, rows.slice(0, MAX_ROWS), 'eve')
  } catch { /* best-effort */ }
}

/** The most-asked unanswered questions of the last 30 days. */
export async function listFaqGaps(limit = 10): Promise<FaqGap[]> {
  try { return (await read()).sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last))).slice(0, Math.max(1, limit)) } catch { return [] }
}

/** "parking at Eden 1205 (asked 4×)" */
export function faqGapLine(g: FaqGap): string {
  return `${g.q}${g.unit ? ` — ${g.unit}` : ''}${g.n > 1 ? ` (asked ${g.n}×)` : ''}`
}
