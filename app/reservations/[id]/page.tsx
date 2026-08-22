import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { customFieldNameMap } from '@/lib/custom-fields'
import { STAGE_LABEL, money, daysUntil, clockRunning } from '@/lib/claims'

export const dynamic = 'force-dynamic'

export default async function ReservationDetail({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: r } = await supabase
    .from('guesty_reservations')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (!r) notFound()

  const messages = r.conversation_id
    ? (await supabase
        .from('guesty_messages')
        .select('*')
        .eq('conversation_id', r.conversation_id)
        .order('sent_at', { ascending: true })
        .limit(200)).data ?? []
    : []

  // Has the building been told this guest is coming? Reservation notices are the record of that,
  // and this is where anyone actually looking at a booking would expect to see it — rather than
  // having to remember there is a separate desk. Missing table or RLS hiccup must not 500 the page,
  // so a failure just reads as "no notice on file".
  let notice: any = null
  try {
    const { data } = await supabase
      .from('reservation_notices')
      .select('id, property_id, unit_no, arrival_date, sent_at, sent_by, doc_name, created_at')
      .eq('reservation_id', params.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    notice = Array.isArray(data) && data.length ? data[0] : null
  } catch { notice = null }

  // DAMAGE CLAIMS ON THIS STAY. The claim is the reason money moved after the guest left, so it
  // belongs on the booking rather than only on its own board. Claims are service-role-only (RLS
  // with no policy), so this reads through the admin client; a failure reads as "no claims".
  let claims: any[] = []
  try {
    const { data } = await supabaseAdmin()
      .from('claims')
      .select('id, stage, outcome, amount_sought, amount_paid, deadline_on, submitted_on, channel')
      .eq('reservation_id', params.id).is('deleted_at', null)
      .order('created_at', { ascending: false })
    claims = Array.isArray(data) ? data : []
  } catch { claims = [] }

  const cfMap = await customFieldNameMap()
  const idOf = (cf: any) => String(cf?.fieldId?._id || cf?.fieldId || cf?.field?._id || cf?._id || '')
  const labelOf = (cf: any) => String(cf?.fieldName || cf?.name || cfMap[idOf(cf)] || '').trim().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <Shell>
      <Link href="/reservations" className="text-xs text-slate-500 hover:text-slate-900">← All reservations</Link>

      {/* Phone: a long guest name and the money block fought for the same row and neither could
          shrink, so the total was pushed off the right edge. It wraps below sm; on desktop there
          is room for both, so the row is unchanged (sm:gap-0 keeps the spacing byte-identical). */}
      <header className="mt-3 mb-6 flex items-end justify-between flex-wrap gap-x-4 gap-y-3 sm:gap-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{r.guest_name}</h1>
          <p className="text-sm text-slate-500">
            {r.listing_name} · {fmt(r.check_in)} → {fmt(r.check_out)} · {r.nights ?? '—'} nights
            {r.confirmation_code && <> · <span className="font-mono">{r.confirmation_code}</span></>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900 whitespace-nowrap">
            {r.money_total != null
              ? new Intl.NumberFormat('en-US', { style: 'currency', currency: r.money_currency || 'USD', maximumFractionDigits: 0 }).format(Number(r.money_total))
              : '—'}
          </div>
          <div className="text-xs uppercase text-slate-500">{r.source}</div>
          <a href={`https://app.guesty.com/reservations/${params.id}/summary`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-600 hover:text-brand-700 mt-1 inline-block">Open in Guesty ↗</a>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Building notified</h2>
          {notice ? (
            notice.sent_at ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                <div className="font-semibold">✓ Sent {fmt(notice.sent_at)}{notice.sent_by ? ' by ' + notice.sent_by : ''}</div>
                <div className="text-xs mt-0.5 text-emerald-700">
                  {String(notice.property_id || '').toUpperCase()} {notice.unit_no}
                  {notice.doc_name ? ' · registration form filed' : ''}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <div className="font-semibold">Not sent yet</div>
                <div className="text-xs mt-0.5">
                  Arriving {fmt(notice.arrival_date)} · {String(notice.property_id || '').toUpperCase()} {notice.unit_no}
                </div>
                <Link href="/reservation-emails" className="text-xs font-semibold underline mt-1 inline-block">Open reservation emails →</Link>
              </div>
            )
          ) : (
            // No row at all: either the building doesn't require notice, or it isn't switched on yet.
            <p className="text-xs text-slate-400">
              No arrival notice on file — this building either doesn&apos;t need one or isn&apos;t switched on in{' '}
              <Link href="/reservation-emails" className="underline">reservation emails</Link>.
            </p>
          )}

          <h2 className="text-sm font-semibold text-slate-900 mt-6 mb-3">Damage claims</h2>
          {claims.length === 0 ? (
            <p className="text-xs text-slate-400">
              No claim on this stay.{' '}
              <Link href="/claims" className="underline">Start one</Link> if something was damaged or taken.
            </p>
          ) : (
            <div className="space-y-2">
              {claims.map((c: any) => {
                const left = clockRunning(String(c.stage)) ? daysUntil(c.deadline_on) : null
                const late = left !== null && left < 0
                const tight = left !== null && left >= 0 && left <= 3
                return (
                  <Link key={c.id} href={'/claims/' + c.id}
                    className={'block rounded-xl border px-3 py-2.5 text-sm hover:shadow-sm transition ' + (late ? 'border-rose-300 bg-rose-50' : tight ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{STAGE_LABEL[String(c.stage)] || c.stage}</span>
                      <span className="font-bold text-slate-900 tabular-nums">{money(c.amount_sought)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {c.channel || 'channel'}
                      {c.outcome ? ' · ' + String(c.outcome) : ''}
                      {c.amount_paid != null ? ' · ' + money(c.amount_paid) + ' recovered' : ''}
                      {left !== null && (late ? ' · window closed' : ' · ' + left + 'd to file')}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          <h2 className="text-sm font-semibold text-slate-900 mt-6 mb-3">Tracking</h2>
          {(() => {
            const cleaned = (Array.isArray(r.custom_fields) ? r.custom_fields : [])
              .filter((cf: any) => {
                const label = labelOf(cf)
                if (!label || !label.trim() || label.trim() === '—') return false
                const v = cf.value
                if (v === null || v === undefined || v === '' || v === false) return false
                if (typeof v === 'string' && !v.trim()) return false
                return true
              })
            if (cleaned.length === 0) {
              return <p className="text-xs text-slate-400">No tracking fields set yet.</p>
            }
            return (
              <dl className="space-y-2">
                {cleaned.map((cf: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="text-slate-500">{labelOf(cf)}</dt>
                    <dd className="text-right"><CFValue cf={cf} /></dd>
                  </div>
                ))}
              </dl>
            )
          })()}

          <h2 className="text-sm font-semibold text-slate-900 mt-6 mb-3">Guest</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Email" value={r.guest_email} />
            <Row label="Phone" value={r.guest_phone} />
            <Row label="Status" value={(r.status || '').replace('_', ' ')} />
          </dl>
        </section>

        <section className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Conversation</h2>
            {r.conversation_id && (
              <Link href={`/messages/${r.conversation_id}`} className="text-xs text-brand-600 hover:underline">Open full thread →</Link>
            )}
          </div>
          {messages.length === 0 ? (
            <p className="text-xs text-slate-400">No messages cached for this reservation yet.</p>
          ) : (
            <div className="space-y-3">
              {messages.map((m: any) => (
                <div key={m.id} className={`flex ${m.sender === 'guest' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.sender === 'guest' ? 'bg-slate-100 text-slate-900' : 'bg-brand-500 text-white'}`}>
                    <div className={`text-[10px] uppercase tracking-wide mb-0.5 ${m.sender === 'guest' ? 'text-slate-500' : 'text-white/70'}`}>{m.sender_name || m.sender}</div>
                    {/* A pasted booking link or a long guest email in a message body has no break
                        opportunity and pushed the bubble past the card on a phone. */}
                    <div className="break-words sm:break-normal">{m.body}</div>
                    <div className={`text-[10px] mt-0.5 ${m.sender === 'guest' ? 'text-slate-400' : 'text-white/70'}`}>{m.sent_at ? new Date(m.sent_at).toLocaleString() : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}

function CFValue({ cf }: { cf: any }) {
  const v = cf.value
  if (cf.type === 'boolean') {
    return v === true || v === 'true'
      ? <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">✓ Yes</span>
      : <span className="text-slate-400">—</span>
  }
  if (v === null || v === undefined || v === '') return <span className="text-slate-400">—</span>
  // Clean trailing whitespace and newline literals
  const text = String(v).replace(/[↵\n\r]+/g, ' ').trim()
  return <span className="text-slate-800 break-words">{text}</span>
}
function Row({ label, value }: { label: string; value?: string | null }) {
  return <div className="flex items-start justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-slate-900">{value || '—'}</dd></div>
}
function fmt(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
