// The words that make a post itself, and a subject's key — pure, no imports, so the tests and the
// registry (lib/eve/said.ts) share one definition.
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'it', 'this', 'that', 'was', 'be', 'by', 'with', 'from', 'as', 'are', 'we', 'you', 'i', 'de', 'la', 'el', 'en', 'y', 'que', 'los', 'las', 'un', 'una', 'por', 'para', 'con', 'se', 'su', 'lo', 'al', 'del', 'es'])

/** The words that make a post itself: mentions, links, times and emoji dropped; the first 14 real words kept in order. */
export function fingerprint(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/<@[a-z0-9]+(\|[^>]*)?>/g, ' ').replace(/<!here>|<!channel>|<!subteam\^[^>]+>/g, ' ')
    .replace(/<https?:\/\/[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/g, ' ').replace(/:[a-z0-9_+-]+:/g, ' ')
    .replace(/[^a-z0-9áéíóúñü/.-]+/g, ' ')
    .split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d{1,2}(am|pm|h|m)?$/.test(w))
    .slice(0, 14).join(' ')
}

/** A stable key for a subject: a unit name, a Breezeway task id, a loop id — whatever the caller has. */
export function subjectKey(subject: string | null | undefined): string {
  return String(subject || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120)
}

