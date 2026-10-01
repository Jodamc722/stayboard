// UNPAID — the picture on the Reservations page (Jon, 2026-10-01: "a bit more visual in the
// reservations tab"). One rose card: four tiles (in the unit · arriving today · next 7 days · later
// this month) with the count and the money in each, a bar showing where the money sits, and the
// first rows — the ones that bite soonest — as one-liners. Direct / VRBO / Google stays only; the
// full board with statuses and notes is one click away.
import Link from 'next/link'
import { loadUnpaid, shiftDay, ymdET, type UnpaidRow } from '@/lib/unpaid'
import { Tag } from '@/components/lean'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const CH: Record<string, string> = { vrbo: 'VRBO', homeaway: 'VRBO', manual: 'Direct', direct: 'Direct', 'be-api': 'Website', website: 'Website', google: 'Google' }
const channel = (s: string) => CH[String(s || '').toLowerCase()] || (s || '—')
const STATUS: Record<string, { label: string; tone: 'slate' | 'sky' | 'amber' | 'rose' | 'violet' }> = {
  open: { label: 'not contacted', tone: 'slate' }, contacted: { label: 'contacted', tone: 'sky' }, promised: { label: 'promised', tone: 'amber' }, disputed: { label: 'disputed', tone: 'rose' }, waived: { label: 'waived', tone: 'violet' },
}
const BUCKET: Record<UnpaidRow['bucket'], { label: string; hint: string; hot: boolean }> = {
  in_house: { label: 'In the unit', hint: 'Guest inside, still owing — collect before checkout', hot: true },
  today: { label: 'Arriving today', hint: 'Collect before the door code goes out', hot: true },
  week: { label: 'Next 7 days', hint: 'Chase now so the week is clean', hot: false },
  later: { label: 'Later this month', hint: 'On the radar — days 8 to 30', hot: false },
}
const ORDER: UnpaidRow['bucket'][] = ['in_house', 'today', 'week', 'later']

export async function UnpaidStrip({ rows: rowsMax = 5 }: { rows?: number }) {
  let rep: Awaited<ReturnType<typeof loadUnpaid>>
  try { rep = await loadUnpaid({ from: ymdET(new Date()), to: shiftDay(ymdET(new Date()), 30) }) } catch { return null }
  const live = rep.rows.filter(r => r.tracking.status !== 'waived')
  if (!live.length) {
    return (
      <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 flex items-center gap-2 text-[12px]">
        <span className="font-semibold text-emerald-800">Unpaid balances · none</span>
        <span className="text-muted">Every direct, VRBO and Google stay in the next 30 days is paid.</span>
        <Link href="/reservations/unpaid" className="ml-auto text-[11.5px] font-semibold text-brand-700 hover:underline">Board →</Link>
      </div>
    )
  }
  const total = live.reduce((a, r) => a + r.balance, 0)
  const by = (b: UnpaidRow['bucket']) => live.filter(r => r.bucket === b)
  const sum = (xs: UnpaidRow[]) => xs.reduce((a, r) => a + r.balance, 0)
  const hot = by('in_house').length + by('today').length
  const chased = live.filter(r => r.tracking.status !== 'open').length
  const top = live.slice(0, rowsMax)

  return (
    <section className="mb-3 rounded-2xl border border-rose-200 bg-rose-50/50 overflow-hidden" aria-label="Unpaid balances">
      <div className="px-3 pt-2.5 pb-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Unpaid balances</span>
        <span className="text-[13px] font-bold tabular-nums text-ink">{money(total)}</span>
        <span className="text-[11.5px] text-muted">owed on {live.length} {live.length === 1 ? 'stay' : 'stays'} in the next 30 days</span>
        {hot ? <Tag tone="rose" title="A guest inside or arriving today who still owes money">{hot} to collect today</Tag> : <Tag tone="emerald" title="Nobody inside or arriving today owes money">clear today</Tag>}
        {chased ? <Tag tone="sky" title="Stays with a status or note on the board">{chased} in progress</Tag> : null}
        <span className="ml-auto text-[11px] text-muted hidden sm:inline">Direct · VRBO · Google only — every other channel is paid by the channel</span>
        <Link href="/reservations/unpaid" className="text-[11.5px] font-semibold text-rose-700 hover:underline">Open the board →</Link>
      </div>

      {/* where the money sits */}
      <div className="px-3 pb-2">
        <div className="h-2 rounded-full overflow-hidden flex bg-white border border-rose-100" title="Share of the money owed, by how soon it bites">
          {ORDER.map(b => { const v = sum(by(b)); if (!v) return null; return <div key={b} style={{ width: (v / total * 100).toFixed(1) + '%' }} className={BUCKET[b].hot ? 'bg-rose-500' : b === 'week' ? 'bg-amber-400' : 'bg-slate-300'} title={BUCKET[b].label + ' · ' + money(v)} /> })}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-rose-100 border-t border-rose-100">
        {ORDER.map(b => {
          const xs = by(b), v = sum(xs)
          return (
            <Link key={b} href={'/reservations/unpaid' + (b === 'later' ? '?range=30' : '')} prefetch={false} title={BUCKET[b].hint}
              className={'bg-white px-3 py-2 min-w-0 hover:bg-rose-50/60 ' + (xs.length && BUCKET[b].hot ? 'border-t-2 border-rose-500' : xs.length && b === 'week' ? 'border-t-2 border-amber-400' : 'border-t-2 border-transparent')}>
              <div className="text-[10.5px] uppercase tracking-wider font-bold text-muted truncate">{BUCKET[b].label}</div>
              <div className="flex items-baseline gap-1.5">
                <span className={'text-[18px] font-bold tabular-nums leading-tight ' + (xs.length ? (BUCKET[b].hot ? 'text-rose-700' : 'text-ink') : 'text-muted/60')}>{xs.length}</span>
                <span className={'text-[12px] font-semibold tabular-nums ' + (xs.length ? 'text-ink' : 'text-muted/60')}>{xs.length ? money(v) : '—'}</span>
              </div>
            </Link>
          )
        })}
      </div>

      <ul className="divide-y divide-rose-100 border-t border-rose-100 bg-white">
        {top.map(r => {
          const st = STATUS[r.tracking.status] || STATUS.open
          const b = BUCKET[r.bucket]
          return (
            <li key={r.id} className="px-3 py-1.5 flex items-center gap-2 text-[12.5px] min-w-0">
              <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (b.hot ? 'bg-rose-500' : r.bucket === 'week' ? 'bg-amber-400' : 'bg-slate-300')} title={b.label} />
              <span className="font-semibold text-ink truncate">{r.unit}</span>
              <span className="text-muted truncate">{r.guest}</span>
              <span className="text-muted tabular-nums whitespace-nowrap hidden sm:inline">{day(r.checkIn)} → {day(r.checkOut)}</span>
              <Tag tone="slate" title={'Booked on ' + (r.source || '—')}>{channel(r.source)}</Tag>
              {r.tracking.status !== 'open' && <Tag tone={st.tone} title={'Follow-up status' + (r.tracking.updatedBy ? ' · ' + r.tracking.updatedBy : '')}>{st.label}</Tag>}
              <span className="ml-auto font-bold tabular-nums text-rose-700 whitespace-nowrap" title={'Paid ' + money(r.paid) + ' of ' + money(r.total)}>{money(r.balance)}</span>
              <span className="text-[11px] text-muted tabular-nums whitespace-nowrap hidden md:inline">{r.paid > 0 ? 'of ' + money(r.total) : 'nothing paid'}</span>
            </li>
          )
        })}
        {live.length > top.length && (
          <li className="px-3 py-1.5 text-[11.5px] text-muted"><Link href="/reservations/unpaid?range=30" className="font-semibold text-brand-700 hover:underline">+{live.length - top.length} more on the board →</Link></li>
        )}
      </ul>
    </section>
  )
}
