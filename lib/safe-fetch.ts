// FETCH A PUBLIC WEBSITE SAFELY — for routes that read a URL a person typed (the building theme
// reader, the building website scan). http(s) only; the host must resolve to a public address (no
// localhost, private, link-local or metadata ranges), checked again on every redirect hop; 8-second
// timeout; a size cap per response; at most three redirects.
import 'server-only'
import { lookup } from 'dns/promises'

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i]

export async function publicUrl(raw: string): Promise<URL> {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only web addresses (http or https) can be read.')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('That address is not a public website.')
  const addrs = await lookup(u.hostname, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error('That website could not be found.')
  if (addrs.some(a => PRIVATE.some(r => r.test(a.address)))) throw new Error('That address is not a public website.')
  return u
}

export async function safeGet(raw: string, max = 1_500_000): Promise<{ url: string; text: string }> {
  let url = await publicUrl(raw)
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    try {
      const r = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StayLighthouse/1.0; +https://stay-hospitality.com)', Accept: 'text/html,text/css,*/*' } })
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await publicUrl(new URL(r.headers.get('location')!, url).toString()); continue }
      if (!r.ok) throw new Error('The website answered ' + r.status + '.')
      const reader = r.body?.getReader()
      if (!reader) return { url: url.toString(), text: '' }
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) { try { await reader.cancel() } catch {} break }
        chunks.push(value)
      }
      return { url: url.toString(), text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') }
    } finally { clearTimeout(t) }
  }
  throw new Error('Too many redirects.')
}

