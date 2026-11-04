'use client'
// GARDEN REVENUE & DISTRIBUTION (lib/garden/revenue): today from Cloudbeds, on the books, the next
// N days from the multi-calendar, and the channels. Every number says where it comes from.
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { LeanEmpty, Pill, Tag } from '@/components/lean'

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const pct = (n: number | null | undefined) => n == null ? '—' : n + '%'
const dayLabel = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums text-ink leading-tight mt-0.5">{value}</div>
      {sub ? <div className="text-[11.5px] text-muted mt-0.5 truncate">{sub}</div> : null}
    </div>
  )
}
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline gap-2 mb-2"><h2 className="text-[15px] font-semibold text-ink">{title}</h2>{note ? <span className="text-[12px] text-muted">{note}</span> : null}</div>
      {children}
    </section>
  )
}

export function GardenRevenue() {
  const [ahead, setAhead] = useState(60)
  const [d, setD] = useState<any>(null)
  useEffect(() => { setD(null); fetch(`/api/garden/revenue?ahead=${ahead}`, { cache: 'no-store' }).then(r => r.json()).then(setD).catch(e => setD({ ok: false, error: String(e) })) }, [ahead])
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <LeanEmpty>{d.error}</LeanEmpty>
  const fwdMax = Math.max(1, ...d.forward.map((x: any) => x.rate || 0))
  return (
    <div>
      {/* Today, straight from Cloudbeds */}
      {d.today ? (
        <Section title="Today" note="live from Cloudbeds">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Occupancy" value={pct(d.today.occupancy)} sub={`${d.today.occupied} of ${d.today.capacity || d.rooms} rooms`} />
            <Stat label="Arrivals" value={String(d.today.arrivals)} />
            <Stat label="Departures" value={String(d.today.departures)} />
            <Stat label="In house" value={String(d.today.inHouse)} sub={`${d.today.guests} guests`} />
            <Stat label="Booked today" value={String(d.today.bookings)} sub={`${d.today.cancellations} cancelled`} />
            <Stat label="Out of service" value={String(d.today.blocked)} />
          </div>
        </Section>
      ) : null}

      {/* On the books */}
      <Section title="On the books" note={`stays ${dayLabel(d.from)} → ${dayLabel(d.to)}`}>
        {d.books.bookings ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="Room revenue" value={money(d.books.revenue)} />
            <Stat label="Room nights" value={d.books.nights.toLocaleString()} />
            <Stat label="ADR" value={money(d.books.adr)} />
            <Stat label="Occupancy" value={pct(d.books.occupancy)} sub={`${d.rooms} rooms`} />
            <Stat label="RevPAR" value={money(d.books.revpar)} />
            <Stat label="Booked last 7 days" value={String(d.books.pickup7.bookings)} sub={money(d.books.pickup7.revenue)} />
          </div>
        ) : <LeanEmpty>No reservations in Cloudbeds yet. Revenue, ADR, occupancy and pickup fill in here from the first booking.</LeanEmpty>}
      </Section>

      {d.byChannel.length ? (
        <Section title="Revenue by channel" note="share of room revenue, ADR, lead time, length of stay, cancellations">
          <div className="rounded-2xl border border-line bg-white overflow-x-auto">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{['Channel', 'Share', 'Revenue', 'Nights', 'Bookings', 'ADR', 'Lead', 'LOS', 'Cancel'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (h === 'Channel' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
              <tbody>{d.byChannel.map((c: any) => (
                <tr key={c.channel} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-semibold text-ink">{c.channel}</td>
                  <td className="px-3 py-2 text-right"><div className="inline-flex items-center gap-2"><div className="w-24 h-1.5 rounded bg-app overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: c.share + '%' }} /></div>{c.share}%</div></td>
                  <td className="px-3 py-2 text-right">{money(c.revenue)}</td><td className="px-3 py-2 text-right">{c.nights}</td><td className="px-3 py-2 text-right">{c.bookings}</td>
                  <td className="px-3 py-2 text-right">{money(c.adr)}</td><td className="px-3 py-2 text-right">{c.lead == null ? '—' : c.lead + ' d'}</td><td className="px-3 py-2 text-right">{c.los ?? '—'}</td><td className="px-3 py-2 text-right">{c.cancelRate}%</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {/* Forward, from the multi-calendar */}
      <Section title="The next days, from the multi-calendar" note="units left to sell and the rate on the shelf (base rate plans)">
        <div className="flex items-center gap-1.5 mb-2">
          {[30, 60, 90].map(n => <Pill key={n} tone={ahead === n ? 'emerald' : 'slate'} onClick={() => setAhead(n)}>{n} days</Pill>)}
          <span className="text-[12px] text-muted ml-2">Average occupancy implied {pct(d.forwardSummary.occupancy)} · average rate {money(d.forwardSummary.rate)}</span>
        </div>
        {d.forward.length ? (
          <div className="rounded-2xl border border-line bg-white p-3 overflow-x-auto">
            <div className="flex items-end gap-[3px] h-40 min-w-max">
              {d.forward.map((x: any) => (
                <div key={x.date} className="flex flex-col items-center justify-end h-full w-4" title={`${dayLabel(x.date)} · ${x.left} of ${x.units} left · occupancy ${pct(x.occupancy)} · rate ${money(x.rate)}${x.closedTypes ? ` · ${x.closedTypes} room types closed` : ''}`}>
                  <div className="w-full rounded-t bg-emerald-600/80" style={{ height: `${Math.round(((x.rate || 0) / fwdMax) * 100)}%` }} />
                  <div className="w-full h-1 mt-0.5 rounded" style={{ background: x.occupancy == null ? '#e5e7eb' : `rgba(220,38,38,${Math.min(1, (x.occupancy || 0) / 100 + 0.08)})` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10.5px] text-muted mt-1"><span>{dayLabel(d.forward[0].date)}</span><span>bar = rate · strip = occupancy (darker = fuller)</span><span>{dayLabel(d.forward[d.forward.length - 1].date)}</span></div>
          </div>
        ) : <LeanEmpty>No calendar mirrored yet — it fills on the next Cloudbeds sync.</LeanEmpty>}
      </Section>

      <Section title="Room types" note={`${d.types.length} types · rate range over the next ${ahead} days`}>
        <div className="rounded-2xl border border-line bg-white overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted sticky top-0 bg-white"><tr className="border-b border-line">{['Room type', 'Units', 'Low', 'Average', 'High', 'Min stay', 'Closed days'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (h === 'Room type' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{d.types.map((t: any) => (
              <tr key={t.id} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-1.5 text-ink">{t.name}</td><td className="px-3 py-1.5 text-right">{t.units || '—'}</td>
                <td className="px-3 py-1.5 text-right">{money(t.rateLow)}</td><td className="px-3 py-1.5 text-right font-semibold">{money(t.rateAvg)}</td><td className="px-3 py-1.5 text-right">{money(t.rateHigh)}</td>
                <td className="px-3 py-1.5 text-right">{t.minStay ?? '—'}</td><td className="px-3 py-1.5 text-right">{t.closedDays || ''}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Section>

      <Section title="Distribution" note={`${d.channels.length} channels Cloudbeds sells through`}>
        <div className="flex flex-wrap gap-1.5">
          {d.channels.map((c: any) => <Tag key={c.id} tone={!c.on ? 'slate' : c.kind === 'ota' ? 'sky' : 'emerald'} title={`${c.kind === 'ota' ? 'Third party' : 'Direct'}${c.on ? '' : ' · off'}${c.bookings ? ` · ${c.bookings} bookings` : ''}`}>{c.name}{c.bookings ? ` · ${c.bookings}` : ''}</Tag>)}
        </div>
        <p className="text-[11.5px] text-muted mt-2">Blue = third party (OTA) · green = direct · grey = off.</p>
      </Section>

      <Section title="Money collected" note="Cloudbeds Payments, last 30 days">
        {d.collected.count ? (
          <div className="flex gap-1.5 flex-wrap"><Pill tone="emerald">{money(d.collected.charges)} collected</Pill><Pill tone="rose">{money(d.collected.refunds)} refunded</Pill><Pill>{d.collected.count} transactions</Pill></div>
        ) : <LeanEmpty>No payments in Cloudbeds yet.</LeanEmpty>}
      </Section>
    </div>
  )
}
