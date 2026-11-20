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
  // ONE OWNER, ONE BUILDING OR ONE LISTING (Jon, 2026-11-20: "share with owners on their actual gross values … pull
  // it by owner or by listing or by property … filter options and a downloadable Excel"). Picking one narrows the
  // whole report to it, and the Excel button then downloads that owner's own file.
  const [scope, setScope] = useState<{ kind: 'owner' | 'building' | 'listing'; id: string } | null>(null)
  const [opts, setOpts] = useState<{ owners: { id: string; name: string }[]; buildings: string[]; listings: { id: string; name: string; building: string }[] } | null>(null)
  const qs = (a: string, b: string, sc = scope) => `from=${a}&to=${b}` + (sc ? '&' + sc.kind + '=' + encodeURIComponent(sc.id) : '')
  const load = (a: string, b: string, sc = scope) => {
    setBusy(true); setErr('')
    fetch('/api/owner-financials?' + qs(a, b, sc), { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!j?.ok) { setErr(j?.error || 'Could not build the report.'); return }
      const fin: Financials = j.financials; setF(fin)
      // the pick lists come from a whole-portfolio read, and grow as wider periods are opened
      if (!fin.scope) setOpts(o => {
        const owners = new Map((o?.owners || []).map(x => [x.id, x] as [string, { id: string; name: string }])); fin.owners.forEach(x => owners.set(x.key, { id: x.key, name: x.name }))
        const listings = new Map((o?.listings || []).map(x => [x.id, x] as [string, { id: string; name: string; building: string }])); fin.listings.forEach(x => { const id = x.key.split('|')[0]; if (id !== 'none') listings.set(id, { id, name: x.name, building: x.building }) })
        const buildings = new Set([...(o?.buildings || []), ...fin.buildings.map(x => x.name).filter(n => n !== 'Not tied to a unit' && n !== 'No building set')])
        return { owners: Array.from(owners.values()).sort((x, y) => x.name.localeCompare(y.name)), buildings: Array.from(buildings).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), listings: Array.from(listings.values()).sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })) }
      })
    }).catch(() => setErr('Could not build the report.')).finally(() => setBusy(false))
  }
  const pickScope = (sc: typeof scope) => { setScope(sc); setQ(''); if (sc?.kind === 'listing') setView('pl'); if (from && to) load(from, to, sc) }
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
    { k: 'guestGross', h: 'Guests paid', title: 'Gross booking value: accommodation plus cleaning, from the bookings' }, { k: 'guestCleaning', h: 'Cleaning (guests)', title: 'Cleaning fees guests paid, from the bookings' },
    { k: 'rental', h: 'Rental' }, { k: 'cleaning', h: 'Cleaning to owner', title: 'Cleaning fees and reimbursements credited on the statements' }, { k: 'fees', h: 'Guest fees' }, { k: 'other', h: 'Other' },
    { k: 'gross', h: 'Owner gross', strong: true, title: 'Rental + cleaning credited + guest fees + other income, on the statements' }, { k: 'commission', h: 'Commission' }, { k: 'charges', h: 'Charges', title: 'Owner charges: repairs, supplies, adjustments' },
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
        <a href={f ? '/api/owner-financials?' + qs(f.from, f.to) + '&format=xlsx' : undefined} aria-disabled={!f} className={'ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-semibold text-white ' + (f ? '' : 'pointer-events-none opacity-40')}><Download size={13} /> {scope ? 'Excel for this ' + (scope.kind === 'building' ? 'building' : scope.kind) : 'Excel'}</a>
        <div className="basis-full flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="font-semibold text-ink">Show</span>
          <button type="button" onClick={() => pickScope(null)} className={'rounded-lg border px-2.5 py-1.5 font-semibold ' + (!scope ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}>Everything</button>
          <select value={scope?.kind === 'owner' ? scope.id : ''} onChange={e => pickScope(e.target.value ? { kind: 'owner', id: e.target.value } : null)} aria-label="One owner" className={sel + ' max-w-[220px] ' + (scope?.kind === 'owner' ? 'border-ink font-semibold' : '')}><option value="">One owner…</option>{(opts?.owners || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select value={scope?.kind === 'building' ? scope.id : ''} onChange={e => pickScope(e.target.value ? { kind: 'building', id: e.target.value } : null)} aria-label="One building" className={sel + ' max-w-[220px] ' + (scope?.kind === 'building' ? 'border-ink font-semibold' : '')}><option value="">One property…</option>{(opts?.buildings || []).map(b => <option key={b} value={b}>{b}</option>)}</select>
          <select value={scope?.kind === 'listing' ? scope.id : ''} onChange={e => pickScope(e.target.value ? { kind: 'listing', id: e.target.value } : null)} aria-label="One listing" className={sel + ' max-w-[240px] ' + (scope?.kind === 'listing' ? 'border-ink font-semibold' : '')}><option value="">One listing…</option>{(opts?.listings || []).map(l => <option key={l.id} value={l.id}>{l.name}{l.building && l.building !== l.name ? ' · ' + l.building : ''}</option>)}</select>
          {f?.scope ? <span className="text-muted">Showing only <b className="text-ink">{f.scope.name}</b>. The Excel button downloads this {f.scope.kind === 'building' ? 'property' : f.scope.kind}’s own file, ready to share.</span> : null}
        </div>
      </div>
      {err ? <LeanEmpty>{err}</LeanEmpty> : !f ? <LeanEmpty>Reading the owner statements…</LeanEmpty> : <>
        {f.notSynced.length ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"><b>Not fully synced:</b> {f.notSynced.map(mLabel).join(', ')}. Figures for {f.notSynced.length === 1 ? 'that month' : 'those months'} may be short until the owner-statement sync finishes.</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([['Gross booking value', f.total.guestGross, 'what guests paid, ' + f.stays.toLocaleString() + ' stays'], ['Cleaning fees guests paid', f.total.guestCleaning, usd(f.total.cleaning) + ' credited to owners'], ['Gross owner revenue', f.total.gross, 'on the statements'], ['Commission', f.total.commission, pct(f.total.commission, f.total.rental) + ' of rental'], ['Net to owner', f.total.net, pct(f.total.net, f.total.gross) + ' of owner gross']] as [string, number, string][]).map(([l, v, s]) => (
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
              <tbody>{FIN_LINES.map(ln => { const k = ln.key as keyof FinVals; const strong = ln.kind === 'total' || ln.kind === 'guestTotal'; const fmt = (n: number) => (ln.kind === 'count' ? (n ? Math.round(n).toLocaleString() : '—') : usd(n, true)); return [
                ln.key === 'guestRent' || ln.key === 'rental' ? <tr key={ln.key + '-h'}><td colSpan={f.months.length + 2} className={'sticky left-0 bg-white pl-4 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted ' + (ln.key === 'rental' ? 'pt-4' : 'pt-2')}>{ln.key === 'rental' ? 'On the owner statements' : 'What guests paid, from the bookings'}</td></tr> : null,
                <tr key={ln.key} className={(strong ? 'border-t border-line font-semibold ' : '') + (ln.key === 'net' ? 'bg-app/70 ' : '') + (ln.kind === 'memo' ? 'text-muted italic ' : 'text-ink ')}>
                  <td className={'sticky left-0 py-1.5 pl-4 pr-2 whitespace-nowrap ' + (ln.key === 'net' ? 'bg-[#f3f1ec]' : 'bg-white') + (strong ? '' : ' pl-7')}>{ln.label}</td>
                  {f.monthly.map(m => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums">{fmt(m[k])}</td>)}
                  <td className="px-2 py-1.5 pr-4 text-right tabular-nums">{fmt(f.total[k])}</td>
                </tr>] })}</tbody>
            </table>
          </div>
        ) : rows.length === 0 ? <LeanEmpty>Nothing matches.</LeanEmpty> : (
          <div className="rounded-2xl border border-line bg-white overflow-x-auto">
            <table className="w-full min-w-[1180px] text-[12.5px]">
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
        <p className="px-1 text-[11.5px] text-muted">From the recognized lines of the owner ledger in Guesty, the same lines the statements are made of. <b>What guests paid</b> comes from the bookings (accommodation spread over the nights, cleaning on the check-in month); most of the cleaning fee pays for the clean and never reaches a statement, which is why the owner-side cleaning line is far smaller. <b>Owner gross</b> is what the units earned for the owner before Stay’s commission and any charges. A stay whose commission equals its rental is a pass-through and is kept out of both{f.total.passthru ? ` (net ${usd(f.total.passthru)})` : ''}. <b>Paid out</b> is the payouts sent, shown beside net, not inside it. The Excel file has the same figures on five sheets, with net by month for every building, listing and owner.</p>
      </>}
    </div>
  )
}
