// A REAL OWNER STATEMENT FOR THE SALES DECK, NAMES REMOVED (Jon, 2026-10-28: "use a real owner
// statement"; Nick Carline's brief: "sample owner statement… names removed").
//
// The onboarding deck teaches with the house sample (lib/statement-sample). A prospect deserves
// the real thing: one owner's actual month, off the recognised owner ledger — the same rows the
// statement in Guesty is built from — with every identifying detail taken out. No owner name, no
// unit number, guests reduced to initials. What stays is what makes it persuasive: real rental,
// the real fee, real charges, the real payout.
//
// WHICH MONTH. The deck asks for a clean example rather than a typical one, and says so in the
// code rather than pretending otherwise: a single-unit owner (one property's statement, not a
// portfolio), a completed month, at least three stays, a positive payout, a handful of charges
// rather than none or dozens, and no owner-stay pass-through lines that would need explaining.
// Miami luxury buildings first, because that is the prospect this deck is usually for.
import { supabaseAdmin } from './supabase-admin'
import { rollupBuilding } from './optimize-score'

const money = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const MONTH = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function monthsBack(asOf: string, n: number): string {
  const d = new Date(asOf.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 7)
}
const initials = (name: string) => {
  const w = str(name).trim().split(/\s+/).filter(Boolean)
  if (!w.length) return 'Guest'
  return w.slice(0, 2).map(x => x[0].toUpperCase() + '.').join(' ')
}

export type RealStatement = {
  real: true
  key: string                // ownerId|month, so the desk can step to the next one
  unitLabel: string          // "2 BR · 17WEST"
  period: string             // "September 2026"
  kpis: { k: string; v: string }[]
  summary: { k: string; v: string; neg?: boolean; rule?: boolean }[]
  due: { k: string; v: string }
  reservations: { guest: string; stay: string; lines: { desc: string; cat: string; amt: string; neg?: boolean }[] }[]
}

const LEAD = ['17WEST', 'Elser', 'Arya', 'Salato']

export async function realStatement(opts: { asOf: string; skip?: number; bedrooms?: number | null }): Promise<RealStatement | null> {
  const sb = supabaseAdmin()
  const months = [monthsBack(opts.asOf, 1), monthsBack(opts.asOf, 2), monthsBack(opts.asOf, 3)]

  const { data: owners } = await sb.from('guesty_owners').select('id, listing_ids')
  const single = ((owners || []) as any[]).filter(o => Array.isArray(o.listing_ids) && o.listing_ids.length === 1)
  if (!single.length) return null
  const listingOf: Record<string, string> = {}
  for (const o of single) listingOf[String(o.id)] = String(o.listing_ids[0])

  const { data: ls } = await sb.from('guesty_listings').select('id, building, bedrooms, status')
    .in('id', Object.values(listingOf))
  const lmeta: Record<string, { b: string; br: number | null }> = {}
  for (const l of (ls || []) as any[]) lmeta[String(l.id)] = { b: rollupBuilding(str(l.building)) || '', br: l.bedrooms == null ? null : Number(l.bedrooms) }

  const { data: stmts } = await sb.from('guesty_owner_statements').select('owner_id, period_month, due_to_owner')
    .in('period_month', months).in('owner_id', Object.keys(listingOf))
  const cands = ((stmts || []) as any[]).filter(s => lmeta[listingOf[String(s.owner_id)]])
  if (!cands.length) return null

  // One pull for every candidate's ledger across the window, then score.
  const ownerIds = Array.from(new Set(cands.map(s => String(s.owner_id))))
  const rows: any[] = []
  for (let i = 0; i < 10; i++) {
    const { data } = await sb.from('guesty_owner_ledger')
      .select("owner_id, listing_id, entry_date, entry_month, charge_code, amount, name:raw->>name, res:raw->reservationConfirmationCode->>title")
      .in('owner_id', ownerIds).in('entry_month', months).eq('recognized', true)
      .order('id').range(i * 1000, i * 1000 + 999)
    const d = (data || []) as any[]
    rows.push(...d)
    if (d.length < 1000) break
  }
  const byKey: Record<string, any[]> = {}
  for (const r of rows) (byKey[str(r.owner_id) + '|' + str(r.entry_month)] = byKey[str(r.owner_id) + '|' + str(r.entry_month)] || []).push(r)

  type Scored = { key: string; score: number }
  const scored: Scored[] = []
  for (const s of cands) {
    const key = str(s.owner_id) + '|' + str(s.period_month)
    const rs = byKey[key] || []
    let rental = 0, cms = 0, other = 0, otherLines = 0
    const resv: Record<string, { af: number; cms: number }> = {}
    for (const r of rs) {
      const code = str(r.charge_code); const eff = -(Number(r.amount) || 0)
      if (code === 'PO') continue
      if (code === 'AF') rental += eff
      else if (code === 'CMS') cms -= eff
      else { other += eff; otherLines++ }
      const rc = str(r.res)
      if (rc && (code === 'AF' || code === 'CMS')) { const a = resv[rc] || (resv[rc] = { af: 0, cms: 0 }); if (code === 'AF') a.af += eff; else a.cms -= eff }
    }
    const stays = Object.values(resv).filter(a => a.af > 1)
    const passthru = Object.values(resv).some(a => a.af > 1 && a.cms / a.af > 0.9)
    const net = rental - cms + other
    if (passthru || stays.length < 3 || rental < 2500 || net <= 0 || otherLines < 1 || otherLines > 8) continue
    const m = lmeta[listingOf[str(s.owner_id)]]
    let score = 0
    const li = LEAD.indexOf(m.b); if (li >= 0) score += 40 - li * 5
    if (opts.bedrooms != null && m.br === opts.bedrooms) score += 30
    score += Math.min(20, rental / 1000)
    score += str(s.period_month) === months[0] ? 5 : 0
    scored.push({ key, score })
  }
  if (!scored.length) return null
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  const pick = scored[Math.max(0, opts.skip || 0) % scored.length]
  const [ownerId, month] = pick.key.split('|')
  const rs = byKey[pick.key]
  const lid = listingOf[ownerId]
  const m = lmeta[lid]

  // Guests, reduced to initials.
  const codes = Array.from(new Set(rs.map(r => str(r.res)).filter(Boolean)))
  const { data: resRows } = codes.length
    ? await sb.from('guesty_reservations').select('confirmation_code, guest_name, check_in, check_out, nights').in('confirmation_code', codes)
    : { data: [] as any[] }
  const resInfo: Record<string, any> = {}
  for (const r of (resRows || []) as any[]) resInfo[str(r.confirmation_code)] = r
  const fmtD = (d: string) => d ? new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''

  let rental = 0, commission = 0
  const otherBy: Record<string, number> = {}
  const resLines: Record<string, { desc: string; cat: string; amt: number }[]> = {}
  for (const r of rs) {
    const code = str(r.charge_code); const eff = money(-(Number(r.amount) || 0))
    if (code === 'PO') continue
    const label = str(r.name).trim() || code
    let cat = label
    if (code === 'AF') { rental = money(rental + eff); cat = 'Rental income' }
    else if (code === 'CMS') { commission = money(commission - eff); cat = 'Management fee' }
    else otherBy[label] = money((otherBy[label] || 0) + eff)
    const rc = str(r.res)
    if (rc) (resLines[rc] = resLines[rc] || []).push({ desc: code === 'AF' ? 'Rental, net of channel fee' : code === 'CMS' ? 'Management fee' : label, cat, amt: eff })
  }
  const net = money(rental - commission + Object.values(otherBy).reduce((a, b) => a + b, 0))
  const nights = codes.reduce((n, c) => n + (Number(resInfo[c]?.nights) || 0), 0)
  const [yy, mm] = month.split('-').map(Number)
  const days = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const occ = Math.min(100, Math.round((Math.min(nights, days) / days) * 100))
  const feePct = rental > 0 ? Math.round((commission / rental) * 1000) / 10 : 0

  const summary: RealStatement['summary'] = [
    { k: 'Rental income', v: usd(rental) },
    { k: 'Management fee' + (feePct ? ' (' + feePct + '%)' : ''), v: usd(-commission), neg: true },
  ]
  for (const [k, v] of Object.entries(otherBy).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
    if (Math.abs(v) < 0.01) continue
    summary.push({ k, v: usd(v), neg: v < 0 })
  }
  summary.push({ k: 'Ending balance', v: usd(net), rule: true })

  return {
    real: true,
    key: pick.key,
    unitLabel: [m.br == null ? '' : m.br === 0 ? 'Studio' : m.br + ' BR', m.b].filter(Boolean).join(' · '),
    period: MONTH(month),
    kpis: [
      { k: 'Occupancy', v: occ + '%' },
      { k: 'Proceeds', v: usd(net) },
      { k: 'Stays', v: String(Object.keys(resLines).filter(c => (resLines[c] || []).some(l => l.cat === 'Rental income')).length) },
    ],
    summary,
    due: { k: 'Payment due to owner', v: usd(net) },
    reservations: codes.filter(c => resLines[c]).slice(0, 8).map(c => {
      const ri = resInfo[c] || {}
      return {
        guest: initials(ri.guest_name),
        stay: [fmtD(str(ri.check_in)), fmtD(str(ri.check_out))].filter(Boolean).join(' – ') + (ri.nights ? ' · ' + ri.nights + ' nights' : ''),
        lines: resLines[c].map(l => ({ desc: l.desc, cat: l.cat, amt: usd(l.amt), neg: l.amt < 0 })),
      }
    }),
  }
}
