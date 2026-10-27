// The Owner Statement section, built from the Guesty owner-statement mirror.
//
// ONE BUILDER, TWO CALLERS (2026-10-27). Lifted out of /api/reports/generate so a live report's
// per-slide Refresh can re-derive this section against the same owner-months the generator used,
// instead of the only path to it being minting a whole new report.
//
// No AI goes near these figures: `net` is what the owner earned on the recognised Owners-ledger
// basis and `paid` is the payout that actually moved.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ownerMonths, rollup, MONTH_LABEL, statementDetail } from '@/lib/owner-statements'

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export async function buildStatementSection(statementIds: string[], scopeLabel: string) {
  const sb = supabaseAdmin()
  const { data } = await sb.from('guesty_owner_statements')
    .select('id, owner_id, owner_name, period_month, period_start, period_end, due_to_owner')
    .in('id', statementIds)
  const stmts = (data || []) as any[]
  if (!stmts.length) return null

  const ownerIds = Array.from(new Set(stmts.map(s => String(s.owner_id || '')).filter(Boolean)))
  const months = Array.from(new Set(stmts.map(s => String(s.period_month || '')).filter(Boolean)))
  const picked = new Set(stmts.map(s => String(s.owner_id) + '|' + String(s.period_month)))
  const all = await ownerMonths({ ownerIds, months })
  const rows = all.filter(r => picked.has(r.key))
  if (!rows.length) return null

  const r = rollup(rows)
  const t = r.totals

  // Unit-level and fee-level detail for the same owner-months. Non-fatal by design: this is
  // added depth on a section that already stands on its own, so a failure here must not cost
  // the whole report.
  let detail: Awaited<ReturnType<typeof statementDetail>> | null = null
  try {
    detail = await statementDetail({ ownerIds, months })
  } catch { detail = null }
  if (detail && detail.units.length) {
    const ids = detail.units.filter(u => !u.portfolio).map(u => u.listingId)
    if (ids.length) {
      const { data: ls } = await sb.from('guesty_listings').select('id, title, nickname, unit').in('id', ids)
      const nameOf: Record<string, string> = {}
      for (const l of (ls || []) as any[]) nameOf[String(l.id)] = String(l.nickname || l.title || l.unit || l.id)
      for (const u of detail.units) if (!u.portfolio) u.name = nameOf[u.listingId] || u.listingId
    }
    // Named so it reads as a deliberate line on the statement rather than a rounding plug.
    for (const u of detail.units) if (u.portfolio) u.name = 'Portfolio-level — not unit-attributed'
  }
  const spanLabel = r.span
    ? (r.span.first === r.span.last ? MONTH_LABEL(r.span.first) : MONTH_LABEL(r.span.first) + ' – ' + MONTH_LABEL(r.span.last))
    : ''
  const ownerNames = Array.from(new Set(rows.map(x => x.ownerName))).filter(Boolean)
  const scope = ownerNames.length <= 2 ? ownerNames.join(' + ') : ownerNames.length + ' owners'

  // Settlement lags recognition, so a variance is normal; it is only worth a line when it is
  // big enough to notice against net.
  const varPct = t.net ? Math.abs(t.variance / t.net) * 100 : 0
  const noteBits = [
    'Recognised owner-ledger basis, direct from Guesty accounting.',
    t.statements + ' statement' + (t.statements === 1 ? '' : 's') + ', ' + t.tied + ' tied to the cent.',
  ]
  if (varPct >= 1) {
    noteBits.push('Payouts run ' + usd(Math.abs(t.variance)) + (t.variance >= 0 ? ' ahead of' : ' behind') + ' recognised earnings — settlement timing, not a shortfall.')
  }

  return {
    headline: 'Owner earnings of ' + usd(t.net) + ' net across ' + spanLabel + '.',
    subtitle: 'Recognised Guesty accounting for ' + (scope || scopeLabel) + ' · ' + spanLabel,
    scope: scope || scopeLabel,
    note: noteBits.join(' '),
    kpis: [
      { label: 'Rental income', value: usd(t.rental), sub: 'Before expenses' },
      { label: 'Management commission', value: usd(t.commission), sub: t.commissionPct + '% of rental' },
      { label: 'Net to owner', value: usd(t.net), sub: 'After commission and charges' },
      { label: 'Paid out', value: usd(t.paid), sub: 'Actually settled' },
    ],
    months: r.months,
    owners: r.owners.map(o => ({
      ownerName: o.ownerName, rental: o.rental, commission: o.commission,
      net: o.net, paid: o.paid, months: o.months,
    })),
    totals: t,
    units: detail ? detail.units : [],
    fees: detail ? detail.fees : [],
    unattributed: detail ? detail.unattributed : 0,
    feeLabels: detail ? detail.named : false,
  }
}
