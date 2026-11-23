'use client'
// THE IN-DEPTH REPORT (lib/garden/report-depth) — Jon, 2026-11-23. The period and the scope come from
// the Revenue page above it. First the three side by side — Whole property, Garden, Botanica — then
// the chosen scope cut every way: month, day of week, wing, room type, channel, length of stay, how
// far ahead, every room, balances owed. Print gives the whole report; Export gives it as a spreadsheet.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Loader2, Printer, Search } from 'lucide-react'
import { LeanEmpty } from '@/components/lean'

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const pct = (n: number | null | undefined) => n == null ? '—' : n + '%'
const int = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US')
const dayLabel = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
type Scope = 'all' | 'garden' | 'botanica'
type Col = { h: string; v: (r: any) => any; f?: (v: any) => string; left?: boolean; bar?: boolean; s?: (r: any) => any }
type Chip = { label: string; test: (r: any) => boolean }

// EVERY TABLE CAN BE SEARCHED, FILTERED AND SORTED (Jon, 2026-11-23: "have filterable tables here too").
// Click a heading to sort by it (again to flip, a third time to go back to the report's own order);
// the search box matches any text in the row; chips are that table's quick filters. Print and Export
// always carry the whole table, whatever is filtered on screen.
function Table({ title, note, cols, rows, max = 0, id, chips }: { title: string; note?: string; cols: Col[]; rows: any[]; max?: number; id?: string; chips?: Chip[] }) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [chip, setChip] = useState(0)
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null)
  const text = (r: any) => cols.map(c => { const v = c.v(r); return typeof v === 'object' ? '' : String(c.f && typeof v !== 'string' ? c.f(v) : v ?? '') }).join(' ').toLowerCase()
  const ql = q.trim().toLowerCase()
  let list = rows.filter(r => (!chips || chips[chip].test(r)) && (!ql || text(r).includes(ql)))
  if (sort) { const c = cols[sort.i], val = (r: any) => (c.s ? c.s(r) : c.v(r)); list = list.slice().sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir }) }
  const filtered = list.length !== rows.length
  const shown = max && !all && !ql ? list.slice(0, max) : list
  const barMax = Math.max(1, ...rows.map(r => Number(cols.find(c => c.bar)?.v(r)) || 0))
  const click = (i: number) => setSort(cur => !cur || cur.i !== i ? { i, dir: cols[i].left ? 1 : -1 } : cur.dir === (cols[i].left ? 1 : -1) ? { i, dir: cols[i].left ? -1 : 1 } : null)
  const tools = rows.length > 6 || !!chips
  return (
    <section className="mb-5 break-inside-avoid scroll-mt-4" id={id}>
      <div className="flex items-center gap-2 mb-1 px-1 flex-wrap">
        <h2 className="gh-display text-[13px] font-bold tracking-wide uppercase text-ink">{title}</h2>{note ? <span className="text-[11.5px] text-muted">{note}</span> : null}
        {tools ? <span className="np ml-auto inline-flex items-center gap-1.5 flex-wrap">
          {chips ? chips.map((c, i) => <button key={c.label} onClick={() => setChip(i)} className={`text-[11.5px] font-semibold px-2 py-1 rounded-md border ${chip === i ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{c.label} <span className="font-normal opacity-70">{rows.filter(c.test).length}</span></button>) : null}
          <label className="relative inline-flex items-center"><Search size={12} className="absolute left-2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter this table" className="h-7 w-40 rounded-md border border-line bg-white pl-6 pr-2 text-[12px] outline-none focus:border-brand-600" /></label>
        </span> : null}
      </div>
      <div className="rounded-xl border border-line bg-white overflow-x-auto">
        <table className="w-full text-[12.5px] tabular-nums">
          <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{cols.map((c, i) => <th key={c.h || i} className={'px-3 py-2 font-semibold ' + (c.left ? 'text-left' : 'text-right')}>{c.h ? <button onClick={() => click(i)} title="Sort by this column" className={'inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-ink ' + (sort?.i === i ? 'text-ink' : '')}>{c.h}{sort?.i === i ? (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : null}</button> : null}</th>)}</tr></thead>
          <tbody>{shown.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {cols.map(c => { const v = c.v(r); return (
                <td key={c.h} className={'px-3 py-1.5 ' + (c.left ? 'text-left text-ink font-semibold' : 'text-right')}>
                  {c.bar ? <span className="inline-flex items-center gap-2 justify-end w-full"><span className="hidden sm:inline-block w-24 h-1.5 rounded bg-app overflow-hidden"><span className="block h-full bg-brand-600" style={{ width: Math.round(((Number(v) || 0) / barMax) * 100) + '%' }} /></span>{c.f ? c.f(v) : v}</span> : (c.f ? c.f(v) : v)}
                </td>
              ) })}
            </tr>))}
            {!shown.length ? <tr><td colSpan={cols.length} className="px-3 py-4 text-center text-muted">Nothing in this table matches.</td></tr> : null}
          </tbody>
        </table>
        {max && !ql && list.length > max ? <button onClick={() => setAll(a => !a)} className="print:hidden w-full text-[12px] font-semibold text-brand-700 py-2 border-t border-line/60 hover:bg-app">{all ? 'Show fewer' : `Show all ${list.length}`}</button> : null}
        {filtered ? <p className="np text-[11.5px] text-muted px-3 py-1.5 border-t border-line/60">Showing {list.length} of {rows.length}. <button onClick={() => { setQ(''); setChip(0) }} className="font-semibold text-brand-700">Show all</button></p> : null}
      </div>
    </section>
  )
}

/** WHOLE PROPERTY · GARDEN · BOTANICA, side by side. Shown at the top of the Revenue page so it is the
 *  first thing read (Jon, 2026-11-23: "can this be more readily available to review"), and again in
 *  the printed report. Click a column to make it the side the whole page looks at. */
export function GardenSplit({ d, scope, onScope, compact = false }: { d: any; scope: Scope; onScope: (s: Scope) => void; compact?: boolean }) {
  const all = d.split[0], bo = d.split[2]
  const rows: [string, (x: any) => string, string][] = [
    ['Rooms', x => `${x.rooms}${x.blocked ? ` (${x.blocked} blocked)` : ''}`, 'rooms'], ['Rent', x => money(x.rent), 'rent'], ['Fee income', x => money(x.fees), 'fees'], ['Fees on top of rent', x => x.feePct == null ? '—' : '+' + x.feePct + '%', ''], ['Total revenue (rent + fees)', x => money((x.rent || 0) + (x.fees || 0)), '__total'],
    ['Room nights sold', x => int(x.nights), 'nights'], ['Occupancy', x => pct(x.occupancy), ''],
    ['ADR, rent only', x => money(x.adrRent), ''], ['ADR with fees', x => money(x.adrAll), ''], [d.rentOnly ? 'RevPAR, rent only' : 'RevPAR with fees', x => money(x.revpar), ''], ['Stays', x => int(x.stays), 'stays'], ['Arrivals in the period', x => int(x.arrivals), 'arrivals'], ['Average stay', x => x.avgStay == null ? '—' : x.avgStay + ' nights', ''],
    ['Cancelled / no-show', x => `${int(x.cancelled)} (${x.cancelRate}%)`, 'cancelled'], ['Revenue lost to cancellations', x => money(x.lostRevenue), 'lostRevenue'], ['Balance owed', x => `${money(x.owed)} · ${x.owedStays} stays`, 'owed'],
  ]
  const pad = compact ? 'px-3 py-1' : 'px-3 py-1.5'
  return (
    <section className="mb-5">
      <div className="flex items-baseline gap-2 mb-1 px-1"><h2 className="gh-display text-[13px] font-bold tracking-wide uppercase text-ink">Whole property, Garden and Botanica</h2><span className="np text-[11.5px] text-muted">click a column to look at that side</span></div>
      <div className="rounded-xl border border-line bg-white overflow-x-auto">
        <table className="w-full text-[12.5px] tabular-nums">
          <thead><tr className="border-b border-line">
            <th className="px-3 py-2" />
            {d.split.map((x: any) => <th key={x.scope} className={'px-3 py-2 text-right ' + (x.scope === scope ? 'bg-brand-50' : '')}><button onClick={() => onScope(x.scope)} className={'gh-display text-[13px] font-bold uppercase tracking-wide ' + (x.scope === scope ? 'text-brand-800' : 'text-ink hover:underline')}>{x.label}</button></th>)}
            <th className="px-3 py-2 text-right text-[10.5px] uppercase tracking-wider text-muted font-semibold">Botanica share</th>
          </tr></thead>
          <tbody>{rows.map(([label, f, key]) => (
            <tr key={label} className="border-b border-line/60 last:border-0">
              <td className={pad + ' text-muted'}>{label}</td>
              {d.split.map((x: any) => <td key={x.scope} className={pad + ' text-right ' + (x.scope === scope ? 'bg-brand-50 font-semibold text-ink' : 'text-ink')}>{f(x)}</td>)}
              <td className={pad + ' text-right text-muted'}>{key === '__total' ? (all.rent + all.fees ? Math.round(((bo.rent + bo.fees) / (all.rent + all.fees)) * 100) + '%' : '') : key && all[key] ? Math.round((bo[key] / all[key]) * 100) + '%' : ''}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-muted mt-1.5 px-1">Botanica = the rooms sold as Botanica through Guesty, matched by room number. A stay is counted on the side its room is on, whichever system it was booked in. Rent is the room charge before taxes (Cloudbeds) or the accommodation fare (Guesty). Fee income is cleaning, parking and the other guest fees in Guesty, and add-on items in Cloudbeds. Taxes are in neither.</p>
    </section>
  )
}
const CORE: Col[] = [
  { h: 'Revenue', v: r => r.revenue, f: money, bar: true }, { h: 'Room nights', v: r => r.nights, f: int }, { h: 'Occupancy', v: r => r.occupancy, f: pct },
  { h: 'ADR', v: r => r.adr, f: money }, { h: 'RevPAR', v: r => r.revpar, f: money },
]

/** `data` = the report already loaded by the page (it then fetches nothing itself). `splitAbove` = the
 *  side-by-side table is already on screen above, so here it is kept for print only. */
export function GardenDepth({ from, to, scope, onScope, api = '/api/garden/revenue', fq = '', shared = false, data, splitAbove = false }: { from: string; to: string; scope: Scope; onScope: (s: Scope) => void; api?: string; fq?: string; shared?: boolean; data?: any; splitAbove?: boolean }) {
  const [own, setD] = useState<any | null>(null)
  const d = data !== undefined ? data : own
  useEffect(() => { if (data !== undefined) return; setD(null); fetch(`${api}?depth=1&from=${from}&to=${to}&scope=${scope}${fq}`, { cache: 'no-store' }).then(r => r.json()).then(setD).catch(e => setD({ ok: false, error: String(e) })) }, [from, to, scope, api, fq, data === undefined])
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Building the report…</p>
  if (!d.ok) return <LeanEmpty>{d.error}</LeanEmpty>
  const cur = d.split.find((x: any) => x.scope === scope) || d.split[0]
  const exportCsv = () => {
    const out: any[][] = [[`The Garden Hotel & Resort — in-depth report`], [`${dayLabel(d.from)} to ${dayLabel(d.to)}`, d.label], []]
    const add = (title: string, head: string[], rows: any[][]) => { out.push([title]); out.push(head); for (const r of rows) out.push(r); out.push([]) }
    add('Whole property vs Garden vs Botanica', ['', 'Rooms', 'Rent', 'Fee income', 'Fees on top of rent %', 'Revenue as shown', 'Room nights', 'Occupancy %', 'ADR rent only', 'ADR with fees', 'RevPAR as shown', 'Stays', 'Avg stay', 'Cancelled', 'Cancel %', 'Balance owed'], d.split.map((x: any) => [x.label, x.rooms, x.rent, x.fees, x.feePct, x.revenue, x.nights, x.occupancy, x.adrRent, x.adrAll, x.revpar, x.stays, x.avgStay, x.cancelled, x.cancelRate, x.owed]))
    const core = (r: any) => [r.revenue, r.nights, r.occupancy ?? '', r.adr ?? '', r.revpar ?? '']
    const H = ['Revenue', 'Room nights', 'Occupancy %', 'ADR', 'RevPAR']
    add('By month', ['Month', ...H], d.byMonth.map((r: any) => [r.month, ...core(r)]))
    add('By day of week', ['Day', ...H], d.byDow.map((r: any) => [r.day, ...core(r)]))
    add('By wing', ['Wing', 'Rooms', ...H], d.byWing.map((r: any) => [r.wing, r.rooms, ...core(r)]))
    add('By room type', ['Room type', 'Rooms', ...H], d.byType.map((r: any) => [r.type, r.rooms, ...core(r)]))
    add('By channel', ['Channel', 'Revenue', 'Rent', 'Fee income', 'Share %', 'Room nights', 'Stays', 'ADR', 'Booked ahead (days)', 'Cancelled', 'Cancel %'], d.byChannel.map((r: any) => [r.channel, r.revenue, r.rent, r.fees, r.share, r.nights, r.stays, r.adr ?? '', r.lead ?? '', r.cancelled, r.cancelRate]))
    add('By length of stay', ['Length', 'Stays', 'Room nights', 'Revenue', 'ADR'], d.byLos.map((r: any) => [r.label, r.stays, r.nights, r.revenue, r.adr ?? '']))
    add('By how far ahead it was booked', ['Booked', 'Stays', 'Room nights', 'Revenue', 'ADR'], d.byLead.map((r: any) => [r.label, r.stays, r.nights, r.revenue, r.adr ?? '']))
    add('By room', ['Room', 'Type', 'Side', 'Blocked in Cloudbeds', ...H, 'Stays'], d.byRoom.map((r: any) => [r.room, r.type, r.segment, r.blocked ? 'yes' : '', ...core(r), r.stays]))
    add('Balances owed', [shared ? 'Reservation' : 'Guest', 'Room', 'Check-in', 'Check-out', 'Channel', 'Total', 'Balance'], d.owed.map((r: any) => [shared ? r.id : r.guest, r.rooms.join(' '), r.checkIn, r.checkOut, r.channel, r.total, r.balance]))
    const csv = out.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `garden-report-${scope}-${d.from}-to-${d.to}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const JUMP: [string, string][] = [['gd-month', 'Month'], ['gd-dow', 'Day of week'], ['gd-wing', 'Wing'], ['gd-type', 'Room type'], ['gd-channel', 'Channel'], ['gd-los', 'Length of stay'], ['gd-lead', 'Booking window'], ['gd-rooms', 'Every room'], ...(d.owed.length ? [['gd-owed', 'Balances owed'] as [string, string]] : [])]
  return (
    <div id="gdepth">
      <style dangerouslySetInnerHTML={{ __html: '@media print { body * { visibility: hidden } #gdepth, #gdepth * { visibility: visible } #gdepth { position: absolute; left: 0; top: 0; width: 100%; padding: 16px } #gdepth .np { display: none !important } }' }} />
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div>
          <div className="gh-display text-[18px] font-semibold text-ink">In-depth report · {d.label}</div>
          <div className="text-[12px] text-muted">{dayLabel(d.from)} to {dayLabel(d.to)} · {d.days} night{d.days === 1 ? '' : 's'} · {cur.rooms} rooms</div>
        </div>
        <span className="flex-1" />
        <button onClick={exportCsv} className="np inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app"><Download size={12} /> Export spreadsheet</button>
        <button onClick={() => window.print()} className="np inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app"><Printer size={12} /> Print</button>
      </div>

      <div className={splitAbove ? 'hidden print:block' : ''}><GardenSplit d={d} scope={scope} onScope={onScope} /></div>
      {cur.nights ? <div className="np flex items-center gap-1.5 flex-wrap mb-4"><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mr-1">Jump to</span>{JUMP.map(([id, l]) => <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line bg-white text-muted hover:text-ink">{l}</button>)}<span className="text-[11.5px] text-muted ml-1">Click any column heading to sort; use the box on a table to filter it.</span></div> : null}

      {!cur.nights ? <LeanEmpty>No stays for {d.label} in this period.</LeanEmpty> : (<>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
          <Table id="gd-month" title="By month" cols={[{ h: 'Month', v: r => monthLabel(r.month), left: true, s: r => r.month }, ...CORE]} rows={d.byMonth} />
          <Table id="gd-dow" title="By day of the week" note="which nights fill and what they sell for" cols={[{ h: 'Night', v: r => r.day, left: true }, ...CORE]} rows={d.byDow} />
          <Table id="gd-wing" title="By wing" note="rooms grouped by the first digit of the room number" cols={[{ h: 'Wing', v: r => r.wing, left: true }, { h: 'Rooms', v: r => r.rooms }, ...CORE]} rows={d.byWing} />
          <Table id="gd-type" title="By room type" cols={[{ h: 'Room type', v: r => r.type, left: true }, { h: 'Rooms', v: r => r.rooms }, ...CORE]} rows={d.byType} />
        </div>
        <Table id="gd-channel" title="By channel" cols={[{ h: 'Channel', v: r => r.channel, left: true }, { h: 'Revenue', v: r => r.revenue, f: money, bar: true }, { h: 'Share', v: r => r.share, f: pct }, { h: 'Rent', v: r => r.rent, f: money }, { h: 'Fees', v: r => r.fees, f: money }, { h: 'Fees on rent', v: r => r.feePct, f: v => v == null ? '—' : '+' + v + '%' }, { h: 'Room nights', v: r => r.nights, f: int }, { h: 'Stays', v: r => r.stays, f: int }, { h: 'ADR', v: r => r.adr, f: money }, { h: 'Booked ahead', v: r => r.lead, f: v => v == null ? '—' : v + ' days' }, { h: 'Cancelled', v: r => r, f: (r: any) => `${r.cancelled} (${r.cancelRate}%)`, s: r => r.cancelRate }]} rows={d.byChannel} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
          <Table id="gd-los" title="By length of stay" cols={[{ h: 'Length', v: r => r.label, left: true }, { h: 'Stays', v: r => r.stays, f: int }, { h: 'Room nights', v: r => r.nights, f: int }, { h: 'Revenue', v: r => r.revenue, f: money, bar: true }, { h: 'ADR', v: r => r.adr, f: money }]} rows={d.byLos} />
          <Table id="gd-lead" title="By how far ahead it was booked" cols={[{ h: 'Booked', v: r => r.label, left: true }, { h: 'Stays', v: r => r.stays, f: int }, { h: 'Room nights', v: r => r.nights, f: int }, { h: 'Revenue', v: r => r.revenue, f: money, bar: true }, { h: 'ADR', v: r => r.adr, f: money }]} rows={d.byLead} />
        </div>
        <Table id="gd-rooms" title="Every room" note="best earners first" max={15} chips={[{ label: 'All', test: () => true }, { label: 'Garden', test: r => r.segment !== 'botanica' }, { label: 'Botanica', test: r => r.segment === 'botanica' }, { label: 'Sold', test: r => r.nights > 0 }, { label: 'Nothing sold', test: r => !r.nights }, { label: 'Blocked', test: r => !!r.blocked }]} cols={[{ h: 'Room', v: r => r.room, left: true }, { h: 'Type', v: r => r.type, left: true }, { h: 'Side', v: r => r.segment === 'botanica' ? 'Botanica' : 'Garden', left: true }, { h: 'Revenue', v: r => r.revenue, f: money, bar: true }, { h: 'Nights', v: r => r.nights, f: int }, { h: 'Occupancy', v: r => r.occupancy, f: pct }, { h: 'ADR', v: r => r.adr, f: money }, { h: 'Stays', v: r => r.stays, f: int }, { h: '', v: r => r.blocked ? 'blocked in Cloudbeds' : '', left: true }]} rows={d.byRoom} />
        {d.unassigned?.nights ? <p className="text-[12px] text-muted -mt-3 mb-5 px-1">{int(d.unassigned.nights)} room nights ({money(d.unassigned.revenue)}) are on bookings with no room assigned yet, so they are in the totals but not on a room.</p> : null}
        {d.owed.length ? <Table id="gd-owed" title="Balances owed" note="largest first" max={12} chips={[{ label: 'All', test: () => true }, { label: 'Cloudbeds', test: r => r.origin !== 'guesty' }, { label: 'Guesty', test: r => r.origin === 'guesty' }, { label: 'Already checked out', test: r => r.checkOut < new Date().toISOString().slice(0, 10) }]} cols={[{ h: shared ? 'Reservation' : 'Guest', v: r => shared ? String(r.id).replace(/^gy:/, '').slice(0, 14) : r.guest, left: true }, { h: 'Room', v: r => r.rooms.join(', ') || '—', left: true }, { h: 'Stay', v: r => `${r.checkIn} → ${r.checkOut}`, left: true }, { h: 'Channel', v: r => r.channel, left: true }, { h: 'Total', v: r => r.total, f: money }, { h: 'Balance', v: r => r.balance, f: money, bar: true }]} rows={d.owed} /> : null}
      </>)}
    </div>
  )
}
