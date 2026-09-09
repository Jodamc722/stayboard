// RECOVERY — the units still waiting for a good review, and who is booked there next.
//
// Moved here from the Calls desk on 2026-09-09 (Jon: "move review recovery to review section
// unless it falls into actual welcome call"). Recovery is a reputation fact — the unit's last low
// review has not been answered by a 4.5+ one — so it reads with the reviews. The Calls desk keeps
// only the arrivals inside its 72-hour window; those are marked "on the calls desk" here and link
// straight to it. Everything further out is the runway: the manager sees weeks ahead which burned
// units have guests coming, and can fix the thing the last guest wrote about before they land.
//
// Server component: a plain list with the review text behind a <details>, nothing to click that
// needs state. Rules for entering and leaving recovery are at the top of lib/call-desk.ts.
import { HeartHandshake, PhoneCall, Check, CalendarDays, AlertTriangle, Star } from 'lucide-react'
import type { RecoveryBoard as Board } from '@/lib/call-desk'

const shortDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return ymd } }
const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''

export function RecoveryBoard({ board }: { board: Board }) {
  const { today, units, failed, horizonDays } = board
  const nextDay = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
  const when = (d: string) => d === today ? 'Today' : d === nextDay(today) ? 'Tomorrow' : shortDay(d)
  const withArrivals = units.filter(u => u.arrivals.length).length
  const onDesk = units.reduce((n, u) => n + u.arrivals.filter(a => a.onDesk && !a.called).length, 0)

  return (
    <section id="recovery" className="mb-5 scroll-mt-4">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5"><HeartHandshake size={12} /> Recovery · {failed ? '—' : units.length} unit{units.length === 1 ? '' : 's'} waiting for a good review</h2>
          <p className="text-[12px] text-muted mt-0.5 max-w-2xl">A unit is in recovery from its last review of 3 stars or under until a 4.5+ review lands after it. Every arrival at one of these units gets a mandatory welcome call; the ones inside the next 72 hours are on the <a href="/welcome-calls" className="font-semibold text-brand-700 hover:underline">Calls desk</a>{onDesk ? ` (${onDesk} open there now)` : ''}. The rest, out to {horizonDays} days, are here so the fix can happen before the guest does.</p>
        </div>
      </div>

      {failed ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>The review scan came back short, so recovery could not be worked out on this load — this is <b>not</b> a sign that no unit is in recovery. Reload in a minute.</span>
        </div>
      ) : units.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">No units in recovery — every unit with a low review has earned a good one since.</div>
      ) : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {units.map(u => {
            const next = u.arrivals[0]
            return (
              <li key={u.listingId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{u.listing}</span>
                      {u.building && u.building !== u.listing && <span className="text-[11px] text-muted">{u.building}</span>}
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-0.5"><Star size={10} /> {u.rating.toFixed(1)}★{u.channel ? ` · ${u.channel}` : ''}</span>
                      <span className="text-[11px] text-muted">{u.openDays} {u.openDays === 1 ? 'day' : 'days'} without a good review{u.reviewsSince ? ` · ${u.reviewsSince} since, none 4.5+` : ''}</span>
                    </div>
                    {u.content && (
                      <details className="mt-1 group">
                        <summary className="text-[12px] text-muted cursor-pointer list-none inline-flex items-center gap-1 hover:text-ink">What {u.guest ? u.guest.split(' ')[0] : 'the guest'} wrote on {shortDay(u.at)} <span className="text-[11px] group-open:hidden">· show</span><span className="text-[11px] hidden group-open:inline">· hide</span></summary>
                        <p className="text-[12px] text-ink/80 mt-1 max-w-2xl border-l-2 border-rose-200 pl-2.5">{u.content}</p>
                      </details>
                    )}
                  </div>
                  <div className="text-right text-[12px] shrink-0">
                    {next
                      ? <span className={`inline-flex items-center gap-1 font-semibold ${next.onDesk ? 'text-rose-700' : 'text-ink'}`}><CalendarDays size={12} /> Next arrival {when(next.check_in)}</span>
                      : <span className="text-muted">No arrival in the next {horizonDays} days</span>}
                  </div>
                </div>
                {u.arrivals.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {u.arrivals.map(a => (
                      <li key={a.id} className={`text-[12px] rounded-lg border px-2 py-1 inline-flex items-center gap-1.5 ${a.called ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : a.onDesk ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-line bg-white text-ink'}`}>
                        <span className="font-semibold">{when(a.check_in)}</span>
                        <span>{a.guest || 'Guest'}</span>
                        {a.nights ? <span className="text-muted">· {a.nights}n</span> : null}
                        {a.value ? <span className="text-muted">· {money(a.value)}</span> : null}
                        {a.called
                          ? <span className="inline-flex items-center gap-0.5 font-semibold"><Check size={11} /> called</span>
                          : a.onDesk
                            ? <a href="/welcome-calls" className="inline-flex items-center gap-0.5 font-semibold hover:underline"><PhoneCall size={11} /> on the calls desk</a>
                            : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted mt-1.5">{withArrivals} of {units.length} unit{units.length === 1 ? '' : 's'} {withArrivals === 1 ? 'has' : 'have'} a guest booked in the next {horizonDays} days. Soonest arrival first; units with nobody booked follow, longest-waiting first.</p>
    </section>
  )
}
