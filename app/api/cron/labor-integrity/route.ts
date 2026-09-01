// LABOR INTEGRITY WATCHDOG (Jon, 2026-09-01: "what are we doing to make sure this is ALWAYS
// accurate").
//
// Accuracy decays quietly: a Homebase week stops coming back, a market stops summing to the
// total, checkouts stop finding their cleans, someone new starts punching with no roster row.
// None of that announces itself — the numbers just drift, and get trusted for weeks. So every
// night this route re-runs the same engine the boards and briefs read and re-proves the claims
// they rest on. It emails ONLY when a check fails: silence means the numbers earned their keep,
// a message names exactly what broke and where to fix it.
//
//   GET  (cron)         → run all checks over the last 30 days; email Jon only on failures
//   GET ?preview=1      → signed-in: run the checks and return them as JSON, sending nothing
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { laborEconomics } from '@/lib/labor-econ'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const OWNER = 'jon@stay-hospitality.com'
const dISO = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

type Check = { key: string; ok: boolean; level: 'red' | 'amber'; what: string; fix: string }

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const preview = sp.get('preview')
  if (preview) {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: 'sign in to preview' }, { status: 401 })
    } catch { return NextResponse.json({ error: 'sign in to preview' }, { status: 401 }) }
  }

  const yd = dISO(new Date(Date.now() - 864e5))
  const d30 = dISO(new Date(Date.now() - 30 * 864e5))
  const checks: Check[] = []
  const push = (key: string, ok: boolean, level: 'red' | 'amber', what: string, fix: string) =>
    checks.push({ key, ok, level, what, fix })

  try {
    const ec: any = await laborEconomics({ from: d30, to: yd, market: 'all' })

    // 1. Every Homebase week answered. The single most important check: everything money rests on it.
    const pa = ec.payrollAudit || {}
    push('punches-complete', pa.complete !== false, 'red',
      pa.complete === false ? `Homebase weeks missing: ${(pa.failedWeeks || []).join(', ')} — payroll is a floor, not a total` : 'every Homebase week came back',
      'Usually rate limiting — re-check in an hour. If it persists, the API key or a location id broke.')

    // 2. Markets sum to totals, for every crew. The grid's whole promise.
    const rec = ec.pnl?.reconciles || {}
    for (const crew of ['housekeeping', 'supervision', 'maintenance']) {
      const r = rec[crew]
      if (!r) continue
      const off = Math.abs(r.payrollDelta || 0) > 1 || Math.abs(r.hoursDelta || 0) > 0.5 || Math.abs(r.cleansDelta || 0) > 0
      push(`reconcile-${crew}`, !off, 'red',
        off ? `${crew}: markets do not sum to the total (payroll off ${r.payrollDelta}, hours off ${r.hoursDelta}${r.cleansDelta ? `, cleans off ${r.cleansDelta}` : ''})` : `${crew} markets reconcile`,
        'An allocation bug in lib/labor-econ — the numbers on every surface are suspect until fixed.')
    }

    // 3. The crew × market cost-per-clean grid sums.
    const g = ec.pnl?.perClean
    if (g?.total?.all) {
      const parts = (g.total.housekeeping?.payroll || 0) + (g.total.supervision?.payroll || 0) + (g.total.maintenance?.payroll || 0)
      const off = Math.abs(parts - (g.total.all.payroll || 0)) > 1
      push('percleangrid', !off, 'red',
        off ? `cost-per-clean grid: crews sum to $${parts.toFixed(2)} but combined says $${(g.total.all.payroll || 0).toFixed(2)}` : 'cost-per-clean grid sums',
        'lib/labor-econ perClean block.')
    }

    // 4. Checkouts are finding their cleans. Drift here = the Breezeway board changed shape.
    const fa = ec.feeAudit || {}
    const total = (Number(fa.credited) || 0) + (Number(fa.cleanNotClosed) || 0) + (Number(fa.cleanNoAssignee) || 0) + (Number(fa.noCleanFound) || 0)
    const lost = (Number(fa.noCleanFound) || 0) + (Number(fa.cleanNotClosed) || 0)
    const lostPct = total > 0 ? Math.round((lost / total) * 100) : 0
    push('fee-matching', lostPct <= 15, lostPct > 25 ? 'red' : 'amber',
      lostPct > 15 ? `${lostPct}% of cleaning fees ($${Math.round(lost).toLocaleString()}) found no clean to land on` : `fee matching healthy (${lostPct}% unmatched)`,
      'Open /labor → Data health → True-up. Usually cleans left unassigned or a folio-mapping change on one channel.')

    // 5. People with punches but no roster row — their wages count nowhere.
    const unro = ec.unrostered || {}
    push('roster', !(Number(unro.people) > 0), 'amber',
      Number(unro.people) > 0 ? `${unro.people} people on payroll with no crew set (${(unro.names || []).slice(0, 4).join(', ')}${(unro.names || []).length > 4 ? '…' : ''}) — $${Math.round(unro.payroll || 0).toLocaleString()} outside every department` : 'everyone on payroll has a crew',
      '/users → People — set their crew and market.')

    // 6. Wage sanity: cards priced at zero or wildly under the median.
    const q = ec.pnl?.quality || {}
    const outliers = Array.isArray(q.rateOutliers) ? q.rateOutliers.length : 0
    const noPay = Array.isArray(q.workedNoPay) ? q.workedNoPay.length : 0
    push('wages', outliers + noPay === 0, 'amber',
      outliers + noPay ? `${outliers} people with an implied rate far under the median, ${noPay} with cleans but $0 payroll` : 'wage data sane',
      'Homebase wage missing on their profile — the engine can only price what Homebase knows.')
  } catch (e: any) {
    push('engine', false, 'red', 'the labor engine itself failed to run: ' + String(e?.message || e).slice(0, 160),
      'Nothing downstream can be trusted until this runs — check Vercel logs for /api/cron/labor-integrity.')
  }

  const failed = checks.filter(c => !c.ok)
  if (preview) return NextResponse.json({ ok: failed.length === 0, window: `${d30}..${yd}`, checks })

  // Email ONLY on failure — a quiet inbox is the healthy state, so noise here would teach
  // everyone to ignore the one morning it matters.
  if (failed.length) {
    const esc = (x: any) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const li = (c: Check) =>
      `<li style="margin:0 0 10px"><b style="color:${c.level === 'red' ? '#dc2626' : '#d97706'}">${esc(c.what)}</b><br>` +
      `<span style="font-size:12px;color:#6b7280">${esc(c.fix)}</span></li>`
    await sendGmail({
      fromEmail: OWNER, to: [OWNER],
      subject: `⚠️ Labor integrity: ${failed.length} check${failed.length === 1 ? '' : 's'} failing`,
      html: '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:640px">' +
        `<p style="font-size:14px;line-height:1.6">The nightly labor audit re-ran the engine over ${d30} – ${yd} and these claims did not hold:</p>` +
        `<ul style="font-size:13px;line-height:1.6;padding-left:18px">${failed.map(li).join('')}</ul>` +
        `<p style="font-size:12px;color:#6b7280">The ${checks.length - failed.length} other checks passed. This email only arrives when something fails — no news is good news.</p></div>`,
    }).catch(() => null)
  }
  return NextResponse.json({ ok: failed.length === 0, window: `${d30}..${yd}`, failed: failed.length, checks })
}
