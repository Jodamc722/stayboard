// Approve (= charge) or decline a guest order from the Slack DM, on a phone, without logging in.
// Sits under /approve/ (public in middleware). The token is the authorisation and burns on use —
// but because approving moves money, this page SHOWS the basket and asks once instead of acting
// on the GET like the outbox link does.
import { getOrderByToken, fmtDay, STATUS_LABEL } from '@/lib/guest-orders'
import { OrderDecide } from '@/components/OrderDecide'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Approve this order?', robots: { index: false, follow: false } }

const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2)

export default async function ApproveOrderPage({ params }: { params: { token: string } }) {
  const token = String(params.token || '')
  const order = /^[a-f0-9]{48}$/.test(token) ? await getOrderByToken(token) : null

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {!order ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
            <div className="text-3xl">⏳</div>
            <h1 className="text-xl font-bold mt-2 text-amber-800">Nothing to do</h1>
            <p className="text-sm text-neutral-600 mt-1.5">This link was already used, or the order was handled from the board.</p>
            <a href="/guest-orders" className="block text-center text-[13px] font-semibold text-brand-700 hover:underline mt-4">Open Guest Orders</a>
          </div>
        ) : (
          <>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Guest order · {order.building || ''}</div>
            <h1 className="text-2xl font-bold text-neutral-900 mt-1">{order.unit || 'Unit'} · {money(order.total_usd)}</h1>
            <p className="text-sm text-neutral-600 mt-1">{order.guest_name || 'Guest'} · {fmtDay(order.check_in)} → {fmtDay(order.check_out)}</p>
            <div className="rounded-2xl border border-neutral-200 bg-white mt-4 divide-y divide-neutral-100">
              {order.items.map((l, i) => (
                <div key={i} className="flex justify-between px-4 py-2.5 text-[14px]"><span><b>{l.qty}×</b> {l.name}</span><span className="tabular-nums">{money(l.line_total_usd)}</span></div>
              ))}
              {order.tax_usd ? <div className="flex justify-between px-4 py-2 text-[13px] text-neutral-600"><span>Sales tax</span><span className="tabular-nums">{money(order.tax_usd)}</span></div> : null}
              <div className="flex justify-between px-4 py-3 text-[15px] font-semibold"><span>Total to charge</span><span className="tabular-nums">{money(order.total_usd)}</span></div>
            </div>
            {order.guest_note ? <div className="mt-3 rounded-xl bg-neutral-100 px-4 py-3 text-[13.5px] italic text-neutral-700">“{order.guest_note}”</div> : null}
            {order.status !== 'submitted' ? (
              <div className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">Already handled — <b>{STATUS_LABEL[order.status] || order.status}</b>.</div>
            ) : (
              <OrderDecide token={token} total={money(order.total_usd)} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
