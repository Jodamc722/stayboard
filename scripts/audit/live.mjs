// Lighthouse self-audit — live production probes.
//
// Runs with no credentials. Every probe asserts an EXPECTED signature rather than merely
// "did it respond", because the dangerous failures here look fine from the outside: a page
// that 200s when it should redirect means auth fell open, and a sync that reports healthy
// while no new data arrives is the exact incident that started the watchdog.

const TIMEOUT_MS = 35000

async function probe(url, { method = 'GET', ms = TIMEOUT_MS } = {}) {
  const t0 = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, { method, redirect: 'manual', signal: ac.signal })
    let body = ''
    try { body = (await r.text()).slice(0, 4000) } catch {}
    return { ok: true, status: r.status, location: r.headers.get('location') || '', ms: Date.now() - t0, body }
  } catch (e) {
    return { ok: false, status: 0, location: '', ms: Date.now() - t0, body: '', error: String(e && e.name === 'AbortError' ? `timed out after ${ms}ms` : e) }
  } finally { clearTimeout(timer) }
}

// The pages that must never break. A 307 to /login is the healthy signature for all of them.
const GATED_PAGES = ['/', '/command', '/plan', '/schedule', '/reservations', '/buildings', '/glitches',
  '/messages', '/reviews', '/billing', '/revenue', '/labor', '/claims', '/audits', '/users', '/links', '/guests']

export async function runLive(base) {
  const findings = []
  const facts = { base, pages: [], slow: [] }

  for (const p of GATED_PAGES) {
    const r = await probe(base + p)
    facts.pages.push({ path: p, status: r.status, ms: r.ms })
    if (!r.ok) {
      findings.push({ id: `page-unreachable:${p}`, sev: 'red', area: 'Live',
        title: `${p} did not respond`, detail: r.error || 'No response.', where: [base + p] })
    } else if (r.status >= 500) {
      findings.push({ id: `page-5xx:${p}`, sev: 'red', area: 'Live',
        title: `${p} returns ${r.status}`,
        detail: 'A signed-in user hitting this page gets an error screen. This is the top-priority class of failure.',
        where: [base + p, r.body.slice(0, 300)] })
    } else if (r.status === 200) {
      findings.push({ id: `page-open:${p}`, sev: 'red', area: 'Security',
        title: `${p} served content with no session`,
        detail: 'This page is supposed to redirect an unauthenticated visitor to /login. Serving 200 means the auth gate is open — middleware fails open by design, so this is the symptom to watch for.',
        where: [base + p] })
    } else if (r.status === 307 || r.status === 302) {
      if (!/\/login/.test(r.location)) {
        findings.push({ id: `page-odd-redirect:${p}`, sev: 'amber', area: 'Live',
          title: `${p} redirects somewhere unexpected`, detail: `Expected /login, got ${r.location}.`, where: [base + p] })
      }
    }
    if (r.ms > 8000) facts.slow.push({ path: p, ms: r.ms })
  }
  if (facts.slow.length >= 3) {
    findings.push({ id: 'pages-slow', sev: 'amber', area: 'Live',
      title: `${facts.slow.length} pages took over 8s to answer`,
      detail: 'Slow enough that people will think it is broken, and close enough to the function limit that it will start timing out.',
      where: facts.slow.map(s => `${s.path} — ${(s.ms / 1000).toFixed(1)}s`) })
  }

  // ── The watchdog is the app's own health reporter. If IT is down, every other feed is
  //    unmonitored and a stalled sync will not be announced to anyone.
  const wd = await probe(base + '/api/cron/watchdog', { ms: 60000 })
  facts.watchdog = { status: wd.status, ms: wd.ms }
  if (!wd.ok || wd.status >= 500) {
    findings.push({ id: 'watchdog-down', sev: 'red', area: 'Live',
      title: `The sync watchdog is failing (${wd.status || 'no response'} after ${(wd.ms / 1000).toFixed(0)}s)`,
      detail: 'This job runs every 30 minutes and is the only thing that announces a stalled Guesty or Breezeway feed. While it is down, a frozen board looks exactly like a quiet day and nobody is told.',
      where: [base + '/api/cron/watchdog', wd.error || wd.body.slice(0, 200)] })
  } else if (wd.status === 200) {
    findings.push({ id: 'watchdog-unauthed', sev: 'amber', area: 'Security',
      title: 'The watchdog answers without CRON_SECRET',
      detail: 'Cron routes use `if (secret) { check }`, so an unset CRON_SECRET leaves them all open to the internet. Setting CRON_SECRET closes every cron route at once.',
      where: [base + '/api/cron/watchdog'] })
    try {
      const j = JSON.parse(wd.body)
      facts.feeds = j.feeds || j.report || null
      for (const f of (facts.feeds || [])) {
        if (f.healthy === false) {
          findings.push({ id: `feed-stale:${f.feed}`, sev: 'red', area: 'Data',
            title: `Feed "${f.feed}" is stale`,
            detail: `Last update ${f.ageMin == null ? 'never' : f.ageMin + ' min ago'}, limit is ${f.limit} min.${f.error ? ' Error: ' + f.error : ''} The board is showing data that stopped refreshing.`,
            where: ['/api/cron/watchdog'] })
        }
      }
    } catch { facts.feeds = null }
  }

  return { findings, facts }
}
