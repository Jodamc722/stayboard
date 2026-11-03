// A LISTING PICTURE AS ITS URL, WHATEVER SHAPE IT ARRIVED IN.
//
// guesty_listings.pictures is text[] and is meant to hold bare URLs (the listing sync writes
// `p.original || p.regular || p.thumbnail`); raw.pictures holds Guesty's full picture objects.
// Two routes that mirror a photo change back into the row (hero/push, photo-order) used to write
// the OBJECTS into the text[] column, and Postgres stores an object in a text[] as its JSON text —
// so the column ended up holding strings like '{"_id":"…","original":"https://…"}'. Every reader
// that then put a "URL" into an <img src> rendered /r/%7B%22_id%22… and a broken frame: the Boynton
// onboarding deck (2026-11-03) had 83 of them. The writers now go through picUrls, and the readers
// that feed decks accept any of the three shapes, so a row that went wrong before the fix still
// renders while the next sync rewrites it.
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function fromObject(o: any): string {
  if (!o || typeof o !== 'object') return ''
  return str(o.original || o.large || o.regular || o.thumbnail || o.url || o.src)
}

/** One picture — a URL string, a JSON-encoded picture object, or the object itself — as its URL ('' when none). */
export function picUrl(p: any): string {
  if (typeof p === 'string') {
    const s = p.trim()
    if (!s) return ''
    if (s[0] === '{') {
      try { return fromObject(JSON.parse(s)) } catch { return '' }
    }
    return s
  }
  return fromObject(p)
}

/** A pictures list in any mix of shapes as its URLs, blanks dropped, order kept. */
export function picUrls(arr: any): string[] {
  return (Array.isArray(arr) ? arr : []).map(picUrl).filter(Boolean)
}

/** True when the string is a JSON-encoded picture object rather than a URL. */
export function isPicJson(s: any): boolean {
  return typeof s === 'string' && s.trimStart()[0] === '{' && !!picUrl(s)
}

/**
 * Walks report content and replaces every JSON-encoded picture string with its URL, in place
 * of the string, wherever it sits (hero, section photos, listing cards, the photo pool). Returns
 * the same object when nothing needed changing, so callers can tell whether to write it back.
 */
export function picsAsUrls<T>(content: T): T {
  let changed = false
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      if (v.trimStart()[0] === '{') { const u = picUrl(v); if (u) { changed = true; return u } }
      return v
    }
    if (Array.isArray(v)) {
      let out: any[] | null = null
      v.forEach((x, i) => { const y = walk(x); if (y !== x) { if (!out) out = v.slice(); out[i] = y } })
      return out || v
    }
    if (v && typeof v === 'object') {
      let out: any = null
      for (const k of Object.keys(v)) { const y = walk(v[k]); if (y !== v[k]) { if (!out) out = { ...v }; out[k] = y } }
      return out || v
    }
    return v
  }
  const next = walk(content)
  return changed ? next : content
}
