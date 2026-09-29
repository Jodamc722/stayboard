// LABOR INTEGRITY CHECKS (Jon, 2026-09-01: "what are we doing to make sure this is ALWAYS
// accurate").
//
// Accuracy decays quietly: a Homebase week stops coming back, a market stops summing to the
// total, checkouts stop finding their cleans, someone new starts punching with no roster row.
// None of that announces itself — the numbers just drift, and get trusted for weeks. So every
// morning the same engine the boards and briefs read is re-proved against the claims they rest on,
// and the owner gets an email ONLY when a check fails: silence means the numbers earned their keep.
//
// Until 2026-09-28 this was its own cron (/api/cron/labor-integrity at 07:12 UTC) that re-ran the
// exact 30-day laborEconomics window the Daily Labor job computes five hours later, cold, in another
// function. The checks now run on the Daily Labor job's own 30-day result (app/api/cron/labor-trueup).
import 'server-only'
import { sendGmail } from './gmail-send'

export type IntegrityCheck = { key: string; ok: boolean; level: 'red' | 'amber'; what: string; fix: string }

const OWNER = 'jon@stay-hospitality.com'

/** The six checks over one laborEconomics result (the 30-day window, yesterday back). */
export function integrityChecks(ec: any): IntegrityCheck[] {
  const checks: IntegrityCheck[] = []
  const push = (key: string, ok: boolean, level: 'red' | 'amber', what: string, fix: string) =>
    checks.push({ key, ok, level, what, fix })

  // 1. Every Homebase week answered. The single most important check: everything money rests on it.
  const pa = (ec && ec.payrollAudit) || {}
  push('punches-complete', pa.complete !== false, 'red',
    pa.complete === false ? `Homebase weeks missing: ${(pa.failedWeeks || []).join(', ')} — payroll is a floor, not a total` : 'every Homebase week came back',
    'Usually rate limiting — re-check in an hour. If it persists, the API key or a location id broke.')

  // 2. Markets sum to totals, for every crew. The grid's whole promise.
  const rec = (ec && ec.pnl && ec.pnl.reconciles) || {}
  for (const crew of ['housekeeping', 'supervision', 'maintenance']) {
    const r = rec[crew]
    if (!r) continue
    const off = Math.abs(r.payrollDelta || 0) > 1 || Math.abs(r.hoursDelta || 0) > 0.5 || Math.abs(r.cleansDelta || 0) > 0
    push(`reconcile-${crew}`, !off, 'red',
      off ? `${crew}: markets do not sum to the total (payroll off ${r.payrollDelta}, hours off ${r.hoursDelta}${r.cleansDelta ? `, cleans off ${r.cleansDelta}` : ''})` : `${crew} markets reconcile`,
      'An allocation bug in lib/labor-econ — the numbers on every surface are suspect until fixed.')
  }

  // 3. The crew × market cost-per-clean grid sums.
  const g = ec && ec.pnl && ec.pnl.perClean
  if (g && g.total && g.total.all) {
    const parts = (g.total.housekeeping?.payroll || 0) + (g.total.supervision?.payroll || 0) + (g.total.maintenance?.payroll || 0)
    const off = Math.abs(parts - (g.total.all.payroll || 0)) > 1
    push('percleangrid', !off, 'red',
      off ? `cost-per-clean grid: crews sum to $${parts.toFixed(2)} but combined says $${(g.total.all.payroll || 0).toFixed(2)}` : 'cost-per-clean grid sums',
      'lib/labor-econ perClean block.')
  }

  // 4. Checkouts are finding their cleans. Drift here = the Breezeway board changed shape.
  const fa = (ec && ec.feeAudit) || {}
  const total = (Number(fa.credited) || 0) + (Number(fa.cleanNotClosed) || 0) + (Number(fa.cleanNoAssignee) || 0) + (Number(fa.noCleanFound) || 0)
  const lost = (Number(fa.noCleanFound) || 0) + (Number(fa.cleanNotClosed) || 0)
  const lostPct = total > 0 ? Math.round((lost / total) * 100) : 0
  push('fee-matching', lostPct <= 15, lostPct > 25 ? 'red' : 'amber',
    lostPct > 15 ? `${lostPct}% of cleaning fees ($${Math.round(lost).toLocaleString()}) found no clean to land on` : `fee matching healthy (${lostPct}% unmatched)`,
    'Open /labor → Data health → True-up. Usually cleans left unassigned or a folio-mapping change on one channel.')

  // 5. People with punches but no roster row — their wages count nowhere.
  const unro = (ec && ec.unrostered) || {}
  push('roster', !(Number(unro.people) > 0), 'amber',
    Number(unro.people) > 0 ? `${unro.people} people on payroll with no crew set (${(unro.names || []).slice(0, 4).join(', ')}${(unro.names || []).length > 4 ? '…' : ''}) — $${Math.round(unro.payroll || 0).toLocaleString()} outside every department` : 'everyone on payroll has a crew',
    '/users → People — set their crew and market.')

  // 6. Wage sanity: cards priced at zero or wildly under the median. NAME THEM — a count cannot be
  // fixed by anybody. The same people are flagged in the daily labor email, which is the one
  // Roberto reads and the only place the Homebase profile actually gets corrected.
  const q = (ec && ec.pnl && ec.pnl.quality) || {}
  const oList: any[] = Array.isArray(q.rateOutliers) ? q.rateOutliers : []
  const nList: any[] = Array.isArray(q.workedNoPay) ? q.workedNoPay : []
  const nm = (xs: any[]) => xs.slice(0, 5).map((x: any) => String(x?.name || '?')).join(', ') + (xs.length > 5 ? ` +${xs.length - 5} more` : '')
  const noPayCleans = nList.reduce((a: number, x: any) => a + (Number(x.cleans) || 0), 0)
  push('wages', oList.length + nList.length === 0, nList.length ? 'red' : 'amber',
    oList.length + nList.length
      ? [
          nList.length ? `${nm(nList)} — ${noPayCleans} clean${noPayCleans === 1 ? '' : 's'} with $0 payroll, so those turns cost nothing and every cost per clean reads low` : '',
          oList.length ? `${nm(oList)} — implied rate far under the median` : '',
        ].filter(Boolean).join('; ')
      : 'wage data sane',
    'Homebase → the person → wage. The engine can only price what Homebase knows.')

  return checks
}

/** The check that stands in for all six when the engine itself would not run. */
export function engineFailedCheck(e: any): IntegrityCheck {
  return {
    key: 'engine', ok: false, level: 'red',
    what: 'the labor engine itself failed to run: ' + String((e && e.message) || e).slice(0, 160),
    fix: 'Nothing downstream can be trusted until this runs — check Vercel logs for /api/cron/labor-trueup.',
  }
}

/** Email the owner the failing checks. Only ever called with at least one failure. */
export async function emailIntegrityFailures(failed: IntegrityCheck[], totalChecks: number, from: string, to: string): Promise<boolean> {
  if (!failed.length) return false
  const esc = (x: any) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const li = (c: IntegrityCheck) =>
    `<li style="margin:0 0 10px"><b style="color:${c.level === 'red' ? '#dc2626' : '#d97706'}">${esc(c.what)}</b><br>` +
    `<span style="font-size:12px;color:#6b7280">${esc(c.fix)}</span></li>`
  const r = await sendGmail({
    fromEmail: OWNER, to: [OWNER],
    subject: `⚠️ Labor integrity: ${failed.length} check${failed.length === 1 ? '' : 's'} failing`,
    html: '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:640px">' +
      `<p style="font-size:14px;line-height:1.6">The morning labor audit re-ran the engine over ${from} – ${to} and these claims did not hold:</p>` +
      `<ul style="font-size:13px;line-height:1.6;padding-left:18px">${failed.map(li).join('')}</ul>` +
      `<p style="font-size:12px;color:#6b7280">The ${Math.max(0, totalChecks - failed.length)} other checks passed. This email only arrives when something fails — no news is good news.</p></div>`,
  }).catch(() => null)
  return !!(r && (r as any).ok)
}
