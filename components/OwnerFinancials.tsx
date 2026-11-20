'use client'
// OWNER FINANCIALS, ON THE OWNER STATEMENTS PAGE (lib/owner-financials; Jon, 2026-11-20: "a financials owner
// report … select the time period or all owner statements … by listing, by property, by building … like a P&L
// … formatted as an Excel as well … cleaning values and gross values … net owner").
// Pick the months (or all of them), read the P&L, switch between the whole portfolio and each building, listing
// or owner, and download the same thing as an Excel workbook.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, Loader2, Search } from 'lucide-react'
import { LeanPick, LeanEmpty } from '@/components/lean'
import { FIN_LINES, type Financials, type FinRow, type FinVals } from '@/lib/owner-financials-shared'

type Any = any
type View = 'pl' | 'building' | 'listing' | 'owner'
const mLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const usd = (n: number | null | undefined, dash = false) => (n == null || (dash && !n) ? '—' : (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString())
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—')

export function OwnerFinancials() {
  const [span, setSpan] = useState<{ from: string; to: string; months: { m: string; statements: number }[] } | null>(null)
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [f, setF] = useState<Financials | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [view, setView] = useState<View>('pl'); const [q, setQ] = useState(''); const [sort, setSort] = useState<keyof FinVals | 'name'>('net')
  const load = (a: string, b: string) => {
    setBusy(true); setErr('')
    fetch(`/api/owner-financials?from=${a}&to=${b}`, { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) setF(j.financials); else setErr(j?.error || 'Could not build the report.') }).catch(() => setErr('Could not build the report.')).finally(() => setBusy(false))
  }
  useEffect(() => { fetch('/api/owner-financials?span=1', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok && j.from) { setSpan(j); setFrom(j.from); setTo(j.to); load(j.from, j.to) } else setErr('No owner statements on file yet.') }).catch(() => setErr('Could not read the statements.')) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (a: string, b: string) => { const x = a <= b ? [a, b] : [b, a]; setFrom(x[0]); setTo(x[1]); load(x[0], x[1]) }
  const yearOf = span ? Array.from(new Set(span.months.map(m => m.m.slice(0, 4)))) : []
  const rows: FinRow[] = useMemo(() => {
    if (!f || view === 'pl') return []
    const src = view === 'building' ? f.buildings : view === 'listing' ? f.listings : f.owners
    const s = q.trim().toLowerCase()
    return src.filter(r => !s || (r.name + ' ' + r.building + ' ' + r.owner).toLowerCase().includes(s))
      .slice().sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : (b[sort] as number) - (a[sort] as number)))
  }, [f, view, q, sort])
  const sel = 'rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink'
  const th = 'px-2 py-2 text-right font-semibold whitespace-nowrap cursor-pointer select-none'
  const COLS: { k: keyof FinVals; h: string; title?: string; strong?: boolean }[] = [
    { k: 'rental', h: 'Rental' }, { k: 'cleaning', h: 'Cleaning', title: 'Cleaning fees and their channel-fee reimbursements' }, { k: 'fees', h: 'Guest fees' }, { k: 'other', h: 'Other' },
    { k: 'gross', h: 'Gross', strong: true, title: 'Rental + cleaning + guest fees + other income' }, { k: 'commission', h: 'Commission' }, { k: 'charges', h: 'Charges', title: 'Owner charges: repairs, supplies, adjustments' },
    { k: 'net', h: 'Net to owner', strong: true }, { k: 'paid', h: 'Paid out', title: 'Payouts actually sent' },
  ]

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-semibold text-ink">Period</span>
        <select value={from} onChange={e => pick(e.target.value, to)} aria-label="From month" className={sel}>{(span?.months || []).map(m => <option key={m.m} value={m.m}>{mLabel(m.m)}</option>)}</select>
        <span className="text-muted">to</span>
        <select value={to} onChange={e => pick(from, e.target.value)} aria-label="To month" className={sel}>{(span?.months || []).map(m => <option key={m.m} value={m.m}>{mLabel(m.m)}</option>)}</select>
        {span ? <button type="button" onClick={() => pick(span.from, span.to)} className={'rounded-lg border px-2.5 py-1.5 font-semibold ' + (from === span.from && to === span.to ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}>All statements</button> : null}
        {yearOf.map(y => { const ms = (span?.months || []).filter(m => m.m.startsWith(y)); const a = ms[0]?.m, b = ms[ms.length - 1]?.m; return a && b ? <button key={y} type="button" onClick={() => pick(a, b)} className={'rounded-lg border px-2.5 py-1.5 font-semibold ' + (from === a && to === b && !(from === span!.from && to === span!.to) ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}>{y}</button> : null })}
        {busy ? <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 size={13} className="animate-spin" /> Adding up the statements…</span> : null}
        <a href={f ? `/api/owner-financials?from=${f.from}&to=${f.to}&format=xlsx` : undefined} aria-disabled={!f} className={'ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-semibold text-white ' + (f ? '' : 'pointer-events-none opacity-40')}><Download size={13} /> Excel</a>
      </div>
      {err ? <LeanEmpty>{err}</LeanEmpty> : !f ? <LeanEmpty>Reading the owner statements…</LeanEmpty> : <>
        {f.notSynced.length ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"><b>Not fully synced:</b> {f.notSynced.map(mLabel).join(', ')}. Figures for {f.notSynced.length === 1 ? 'that month' : 'those months'} may be short until the owner-statement sync finishes.</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([['Gross revenue', f.total.gross, ''], ['Cleaning fees', f.total.cleaning, pct(f.total.cleaning, f.total.gross) + ' of gross'], ['Commission', f.total.commission, pct(f.total.commission, f.total.rental) + ' of rental'], ['Owner charges', f.total.charges, ''], ['Net to owner', f.total.net, pct(f.total.net, f.total.gross) + ' of gross']] as [string, number, string][]).map(([l, v, s]) => (
            <div key={l} className="rounded-2xl border border-line bg-white px-3 py-2.5"><p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{l}</p><p className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink">{usd(v)}</p><p className="text-[11.5px] text-muted">{s || ' '}</p></div>))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeanPick size="sm" value={view} onPick={v => { setView(v); setQ('') }} options={[{ v: 'pl', label: 'P&L by month' }, { v: 'building', label: <>By building <span className="opacity-60 tabular-nums">{f.buildings.length}</span></> }, { v: 'listing', label: <>By listing <span className="opacity-60 tabular-nums">{f.listings.length}</span></> }, { v: 'owner', label: <>By owner <span className="opacity-60 tabular-nums">{f.owners.length}</span></> }]} />
          {view !== 'pl' ? <div className="relative"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find…" aria-label="Find a row" className="w-52 max-w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" /></div> : null}
          <span className="ml-auto text-[11.5px] text-muted">{mLabel(f.from)} to {mLabel(f.to)} · {f.statements} statements · {f.ledgerLines.toLocaleString()} statement lines</span>
        </div>

        {view === 'pl' ? (
          <div className="rounded-2xl border border-line bg-white overflow-x-auto">
            <table className="w-full text-[12.5px]" style={{ minWidth: 260 + (f.months.length + 1) * 92 }}>
              <thead><tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-muted"><th className="sticky left-0 bg-white py-2 pl-4 pr-2 text-left font-semibold">Line</th>{f.months.map(m => <th key={m} className="px-2 py-2 text-right font-semibold whitespace-nowrap">{mLabel(m)}</th>)}<th className="px-2 py-2 pr-4 text-right font-semibold">Total</th></tr></thead>
              <tbody>{FIN_LINES.map(ln => { const k = ln.key as keyof FinVals; const strong = ln.kind === 'total'; return (
                <tr key={ln.key} className={(strong ? 'border-t border-line font-semibold ' : '') + (ln.key === 'net' ? 'bg-app/70 ' : '') + (ln.kind === 'memo' ? 'text-muted italic ' : 'text-ink ')}>
                  <td className={'sticky left-0 py-1.5 pl-4 pr-2 whitespace-nowrap ' + (ln.key === 'net' ? 'bg-[#f3f1ec]' : 'bg-white') + (strong ? '' : ' pl-7')}>{ln.label}</td>
                  {f.monthly.map(m => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums">{usd(m[k], true)}</td>)}
                  <td className="px-2 py-1.5 pr-4 text-right tabular-nums">{usd(f.total[k], true)}</td>
                </tr>) })}</tbody>
            </table>
          </div>
        ) : rows.length === 0 ? <LeanEmpty>Nothing matches.</LeanEmpty> : (
          <div className="rounded-2xl border border-line bg-white overflow-x-auto">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead><tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-muted">
                <th className="py-2 pl-4 pr-2 text-left font-semibold cursor-pointer" onClick={() => setSort('name')}>{view === 'building' ? 'Building' : view === 'listing' ? 'Listing' : 'Owner'}</th>
                {COLS.map(c => <th key={c.k} title={c.title} onClick={() => setSort(c.k)} className={th + (sort === c.k ? ' text-ink underline' : '')}>{c.h}</th>)}
                <th className="px-2 py-2 pr-4 text-right font-semibold whitespace-nowrap" title="Net to owner as a share of gross revenue">Net %</th>
              </tr></thead>
              <tbody>
                {rows.map(r => { const lid = view === 'listing' && !r.key.startsWith('none|') ? r.key.split('|')[0] : ''; return (
                  <tr key={r.key} className="border-b border-line/70 last:border-0 hover:bg-app/60">
                    <td className="py-1.5 pl-4 pr-2"><span className="font-semibold text-ink">{lid ? <Link href={'/listings/' + lid} className="hover:underline">{r.name}</Link> : r.name}</span><span className="block text-[11.5px] text-muted">{view === 'listing' ? [r.building, r.owner].filter(Boolean).join(' · ') : r.units + (r.units === 1 ? ' unit' : ' units')}</span></td>
                    {COLS.map(c => <td key={c.k} className={'px-2 py-1.5 text-right tabular-nums ' + (c.strong ? 'font-semibold text-ink' : 'text-ink') + (r[c.k] < 0 ? ' text-rose-700' : '')}>{usd(r[c.k], true)}</td>)}
                    <td className="px-2 py-1.5 pr-4 text-right tabular-nums text-muted">{pct(r.net, r.gross)}</td>
                  </tr>) })}
                <tr className="border-t border-ink bg-app/70 font-semibold text-ink"><td className="py-2 pl-4 pr-2">Total{q ? ' (all rows)' : ''}</td>{COLS.map(c => <td key={c.k} className="px-2 py-2 text-right tabular-nums">{usd(f.total[c.k], true)}</td>)}<td className="px-2 py-2 pr-4 text-right tabular-nums">{pct(f.total.net, f.total.gross)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[11.5px] text-muted">From the recognized lines of the owner ledger in Guesty, the same lines the statements are made of. <b>Gross</b> is what the units earned for the owner before Stay’s commission and any charges. A stay whose commission equals its rental is a pass-through and is kept out of both{f.total.passthru ? ` (net ${usd(f.total.passthru)})` : ''}. <b>Paid out</b> is the payouts sent, shown beside net, not inside it. The Excel file has the same figures on five sheets, with net by month for every building, listing and owner.</p>
      </>}
    </div>
  )
}
