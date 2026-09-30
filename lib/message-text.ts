// Guesty stores some templates as raw HTML ("<!DOCTYPE html><html><head>…") and some integrations
// post under a machine author ("hook"). Both made the inbox read like a server log (Jon, 2026-09-30).
// These two helpers are display-only: the stored message is never changed.

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Readable text from a message body that may be HTML. Plain text passes through untouched. */
export function plainText(s: string | null | undefined): string {
  const t = String(s ?? '')
  if (!/<\/?[a-z!][^>]*>/i.test(t)) return t
  return t
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      if (ENT[e.toLowerCase()]) return ENT[e.toLowerCase()]
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m }
      return m
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** A machine author name — an integration posting as the host, not a teammate. */
export function isMachineName(name: string | null | undefined): boolean {
  const n = String(name ?? '').trim()
  return !!n && /^(hook|webhook|web hook|api|integration|automation|automated|bot|guesty|system|zapier)$/i.test(n) || /webhook|\bbot\b|automation/i.test(n)
}
