// AGENCY PAYROLL / INVOICE — hours and pay owed to a staffing agency for a period.
//
//   GET /api/labor/agency-invoice?from=2026-08-01&to=2026-08-07[&agency=opal][&format=csv]
//
// Hours come LIVE from Homebase punches every time this runs; nothing is snapshotted on our side.
// Correct a punch in Homebase and re-run — the invoice changes, with no re-sync step to forget.
//
// Shape (Jon 2026-08-08): "per agency, hours per day worked... generate an invoice or payroll
// hours and pay to agency", so the payload is agency → person → day, with the agency's fees
// applied once at the agency level (a flat fee is per invoice, not per line).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getTimecards } from '@/lib/homebase-labor'
import { getAgencies, staffByName, resolveStaff, computeAgencyCharge, type Agency } from '@/lib/staffing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const round2 = (n: number) => Math.round(n * 100) / 100
const csvCell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export async function GET(req: NextRequest) {
  const g = await requireLevel('labor', 'view')
  if (!g.ok) return g.res

  const sp = new URL(req.url).searchParams
  const now = new Date()
  const today = dISO(now)
  const toQ = sp.get('to') || ''
  const fromQ = sp.get('from') || ''
  const to = DATE_RE.test(toQ) ? (toQ > today ? today : toQ) : today
  const from = DATE_RE.test(fromQ) ? fromQ : dISO(new Date(now.getTime() - 6 * 864e5))
  const wantAgency = String(sp.get('agency') || '').trim().toLowerCase()

  try {
    const [cards, agencies, index] = await Promise.all([
      getTimecards(from, to), getAgencies(true), staffByName(),
    ])
    const byKey: Record<string, Agency> = {}
    for (const a of agencies) byKey[a.key] = a

    // person+day → hours/pay, bucketed by agency. Unassigned people are reported separately
    // rather than dropped: a punch with no agency is a data gap someone must close before
    // payday, and silently omitting it is how an invoice goes out short.
    type Line = { name: string; date: string; hours: number; wage: number | null; base: number; role: string | null }
    const buckets: Record<string, Line[]> = {}
    const unassigned: Line[] = []

    for (const t of cards) {
      const hours = Number(t.hours)
      if (!Number.isFinite(hours) || hours <= 0) continue
      const wage = Number.isFinite(Number(t.wageRate)) ? Number(t.wageRate) : null
      // Prefer Homebase's own cost (it nets breaks and splits OT); fall back to rate × hours.
      const base = Number.isFinite(Number(t.laborCost)) ? Number(t.laborCost) : (wage != null ? wage * hours : 0)
      const rec = resolveStaff(t.name, index)
      const line: Line = {
        name: t.name, date: t.date || '', hours: round2(hours), wage,
        base: round2(base), role: rec?.role || t.role || null,
      }
      if (rec?.agency && byKey[rec.agency]) (buckets[rec.agency] = buckets[rec.agency] || []).push(line)
      else unassigned.push(line)
    }

    const keys = Object.keys(buckets).filter(k => !wantAgency || k === wantAgency)
    const out = keys.map(key => {
      const a = byKey[key]
      const lines = buckets[key].sort((x, y) => x.name.localeCompare(y.name) || x.date.localeCompare(y.date))
      const hours = round2(lines.reduce((s, l) => s + l.hours, 0))
      const base = round2(lines.reduce((s, l) => s + l.base, 0))
      const charge = computeAgencyCharge(hours, base, a)

      // Per-person rollup — what most agencies actually want to reconcile against.
      const people: Record<string, { name: string; role: string | null; hours: number; base: number; days: number }> = {}
      for (const l of lines) {
        const p = people[l.name] || (people[l.name] = { name: l.name, role: l.role, hours: 0, base: 0, days: 0 })
        p.hours = round2(p.hours + l.hours); p.base = round2(p.base + l.base); p.days += 1
      }
      return {
        agency: key, label: a.label,
        rates: { percent: a.fee_percent, perHour: a.fee_per_hour, flat: a.fee_flat },
        ...charge,
        people: Object.values(people).sort((x, y) => y.hours - x.hours),
        lines,
      }
    }).sort((x, y) => y.total - x.total)

    if (sp.get('format') === 'csv') {
      const rows: string[][] = [['Agency', 'Person', 'Role', 'Date', 'Hours', 'Wage', 'Base pay']]
      for (const a of out) for (const l of a.lines) {
        rows.push([a.label, l.name, l.role || '', l.date, String(l.hours), l.wage == null ? '' : String(l.wage), String(l.base)])
      }
      for (const a of out) {
        rows.push([])
        rows.push([a.label, 'SUBTOTAL hours', '', '', String(a.hours), '', String(a.base)])
        if (a.rates.percent) rows.push([a.label, `Agency fee ${a.rates.percent}%`, '', '', '', '', String(a.feePercentAmt)])
        if (a.rates.perHour) rows.push([a.label, `Agency fee $${a.rates.perHour}/hr`, '', '', '', '', String(a.feePerHourAmt)])
        if (a.rates.flat) rows.push([a.label, 'Agency flat fee', '', '', '', '', String(a.feeFlatAmt)])
        rows.push([a.label, 'TOTAL DUE', '', '', String(a.hours), '', String(a.total)])
      }
      const csv = rows.map(r => r.map(csvCell).join(',')).join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="agency-hours_${from}_${to}.csv"`,
        },
      })
    }

    return NextResponse.json({
      ok: true, from, to,
      agencies: out,
      unassigned: {
        hours: round2(unassigned.reduce((s, l) => s + l.hours, 0)),
        base: round2(unassigned.reduce((s, l) => s + l.base, 0)),
        people: Array.from(new Set(unassigned.map(l => l.name))).sort(),
        note: unassigned.length ? 'These punches have no agency assigned — set one on /users → Staffing, or they are in-house.' : undefined,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
