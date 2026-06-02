import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { getReservation, listMessages } from '@/lib/guesty'
import type { CustomFieldValue } from '@/types/guesty'

export const dynamic = 'force-dynamic'

export default async function ReservationDetail({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const r = await getReservation(params.id)
  if (!r) notFound()

  const messages = r.conversationId ? await listMessages(r.conversationId) : []

  return (
    <Shell>
      <Link href="/reservations" className="text-xs text-slate-500 hover:text-slate-900">← All reservations</Link>

      <header className="mt-3 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{r.guest.name}</h1>
          <p className="text-sm text-slate-500">
            {r.listingName} · {fmt(r.checkIn)} → {fmt(r.checkOut)} · {r.nights} nights
            {r.confirmationCode && <> · <span className="font-mono">{r.confirmationCode}</span></>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">${r.money.totalPaid.toLocaleString()}</div>
          <div className="text-xs uppercase text-slate-500">{r.source}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Custom fields */}
        <section className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Tracking</h2>
          {r.customFields && r.customFields.length > 0 ? (
            <dl className="space-y-2">
              {r.customFields.map(cf => (
                <div key={cf.fieldId} className="flex items-start justify-between gap-3 text-sm">
                  <dt className="text-slate-500">{cf.fieldName}</dt>
                  <dd><CFValue cf={cf} /></dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-slate-400">No custom fields on this reservation.</p>
          )}

          <h2 className="text-sm font-semibold text-slate-900 mt-6 mb-3">Guest</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Email" value={r.guest.email} />
            <Row label="Phone" value={r.guest.phone} />
            <Row label="Status" value={r.status.replace('_', ' ')} />
          </dl>
        </section>

        {/* Conversation */}
        <section className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Conversation</h2>
            {r.conversationId && (
              <Link href={`/messages/${r.conversationId}`} className="text-xs text-brand-600 hover:underline">
                Open full thread →
              </Link>
            )}
          </div>
          {messages.length === 0 ? (
            <p className="text-xs text-slate-400">No messages yet.</p>
          ) : (
            <div className="space-y-3">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.sender === 'guest' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.sender === 'guest' ? 'bg-slate-100 text-slate-900' : 'bg-brand-500 text-white'}`}>
                    <div className={`text-[10px] uppercase tracking-wide mb-0.5 ${m.sender === 'guest' ? 'text-slate-500' : 'text-white/70'}`}>{m.senderName}</div>
                    <div>{m.body}</div>
                    <div className={`text-[10px] mt-0.5 ${m.sender === 'guest' ? 'text-slate-400' : 'text-white/70'}`}>{new Date(m.sentAt).toLocaleString()}</div>
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

function CFValue({ cf }: { cf: CustomFieldValue }) {
  if (cf.type === 'boolean') {
    return cf.value
      ? <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">✓ Yes</span>
      : <span className="text-slate-400">—</span>
  }
  if (cf.value === null || cf.value === undefined || cf.value === '') return <span className="text-slate-400">—</span>
  if (cf.type === 'select') {
    const v = String(cf.value)
    const cls = v === 'high' ? 'bg-rose-50 text-rose-700 ring-rose-600/20'
              : v === 'medium' ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
              : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset ${cls}`}>{v}</span>
  }
  return <span className="text-slate-800">{String(cf.value)}</span>
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value || '—'}</dd>
    </div>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
