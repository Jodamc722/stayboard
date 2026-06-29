import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { customFieldNameMap } from '@/lib/custom-fields'

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

  const cfMap = await customFieldNameMap()
  const idOf = (cf: any) => String(cf?.fieldId?._id || cf?.fieldId || cf?.field?._id || cf?._id || '')
  const labelOf = (cf: any) => String(cf?.fieldName || cf?.name || cfMap[idOf(cf)] || '').trim().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <Shell>
      <Link href="/reservations" className="text-xs text-slate-500 hover:text-slate-900">← All reservations</Link>

      <header className="mt-3 mb-6 flex items-end justify-between">
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
          <a href={`https://app.guesty.com/reservations/${params.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-600 hover:text-brand-700 mt-1 inline-block">Open in Guesty ↗</a>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Tracking</h2>
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
                    <div>{m.body}</div>
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
