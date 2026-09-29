'use client'
// CLOUDBEDS HUB PAGES — Messages, Calendar & rates, Payments. Mirrors of what Cloudbeds runs for
// the hotel (lib/garden/hub). Read views for now; each shows its feed's last sync so it is plain
// what is live and what is still waiting on the connection.
import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, CalendarDays, CreditCard, Loader2, RefreshCw } from 'lucide-react'
import { LeanHead, LeanList, LeanRow, LeanEmpty, Tag, Pill } from '@/components/lean'

type View = 'messages' | 'calendar' | 'payments'
const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({})) }
const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const TITLE: Record<View, [string, any, string]> = {
  messages: ['Messages', MessageSquare, 'Cloudbeds integrated messaging — every guest conversation in one inbox.'],
  calendar: ['Calendar & rates', CalendarDays, 'Cloudbeds multi-calendar — availability, rates and restrictions by room type, and the channels it syncs to.'],
  payments: ['Payments', CreditCard, 'Cloudbeds Payments — charges, deposits and refunds.'],
}

export function GardenHub({ view, canEdit }: { view: View; canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [thread, setThread] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setD(await j(`/api/garden/hub?view=${view}&days=${view === 'calendar' ? 21 : 30}${thread ? '&thread=' + encodeURIComponent(thread) : ''}`)), [view, thread])
  useEffect(() => { load() }, [load])
  const [title, Icon, blurb] = TITLE[view]
  const head = (
    <LeanHead title={title} icon={<Icon size={20} className="text-emerald-700" />}>
      {d?.status?.filter((s: any) => s.entity === (view === 'calendar' ? 'calendar' : view)).map((s: any) => <Pill key={s.entity} tone={s.last_error ? 'rose' : 'emerald'} title={s.last_error || ''}>{s.last_error ? 'sync error' : `synced ${when(s.last_sync_at)}`}</Pill>)}
      {d && !d.connected ? <Pill tone="amber">Cloudbeds not connected</Pill> : null}
      {canEdit && view === 'calendar' ? <button disabled={busy} onClick={async () => { setBusy(true); await j('/api/garden/hub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'sync' }) }); setBusy(false); load() }} className="rounded-lg border border-line bg-white px-2.5 h-7 text-[12px] font-semibold inline-flex items-center gap-1"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Pull now</button> : null}
    </LeanHead>
  )
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <>{head}<LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 118_garden_unit.sql, then reload.' : (d.message || d.error)}</LeanEmpty></>
  return (
    <>
      {head}
      <p className="text-[12.5px] text-muted mb-3">{blurb}</p>
      {view === 'messages' ? (d.threads.length ? (
        <LeanList>{d.threads.map((t: any) => (
          <LeanRow key={t.id} name={t.guest_name || 'Guest'} meta={`${t.channel || ''} · ${when(t.last_message_at)}`} open={thread === t.id} onToggle={() => setThread(thread === t.id ? null : t.id)}
            tags={<>{t.unread ? <Tag tone="rose">{t.unread} new</Tag> : null}<Tag tone={t.status === 'open' ? 'amber' : t.status === 'closed' ? 'slate' : 'sky'}>{t.status}</Tag>{t.assigned_to ? <Tag>{t.assigned_to}</Tag> : null}</>}>
            {thread === t.id && d.messages ? d.messages.map((m: any) => (
              <div key={m.id} className={`rounded-xl px-3 py-2 text-[13px] max-w-[80%] ${m.direction === 'in' ? 'bg-app' : 'bg-emerald-50 ml-auto'}`}>
                <div className="text-[10.5px] text-muted mb-0.5">{m.author || (m.direction === 'in' ? 'Guest' : 'Hotel')} · {when(m.sent_at)}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            )) : <p className="text-[12.5px] text-muted">{t.last_snippet}</p>}
          </LeanRow>
        ))}</LeanList>
      ) : <LeanEmpty>No guest conversations mirrored yet. Cloudbeds messaging has no confirmed read endpoint, so threads will arrive through its webhook once the account is connected.</LeanEmpty>) : null}

      {view === 'calendar' ? (d.types.length ? (<>
        <div className="rounded-2xl border border-line bg-white overflow-x-auto">
          <table className="text-[11.5px] tabular-nums">
            <thead><tr><th className="sticky left-0 bg-white text-left px-3 py-2 font-semibold">Room type</th>{d.dates.map((x: string) => <th key={x} className="px-1.5 py-2 font-semibold text-muted whitespace-nowrap">{new Date(x + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', day: 'numeric', timeZone: 'UTC' })}</th>)}</tr></thead>
            <tbody>{d.types.map((t: any) => (
              <tr key={t.id} className="border-t border-line/70">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-semibold whitespace-nowrap">{t.name}</td>
                {d.dates.map((x: string) => { const c = d.cells.find((c: any) => c.room_type_id === t.id && c.date === x); return (
                  <td key={x} className={`px-1.5 py-1.5 text-center ${!c ? 'text-muted/40' : c.closed ? 'bg-slate-100 text-muted' : c.available === 0 ? 'bg-rose-50 text-rose-700' : ''}`} title={c ? `${c.available ?? '—'} left · ${c.rate != null ? money(c.rate) : '—'}${c.min_stay ? ' · min ' + c.min_stay : ''}` : ''}>
                    {c ? <><div className="font-semibold">{c.available ?? '—'}</div><div className="text-muted">{c.rate != null ? Math.round(c.rate) : ''}</div></> : '·'}
                  </td>) })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">{d.channels.map((c: any) => <Tag key={c.id} tone={c.status === 'off' ? 'slate' : 'emerald'}>{c.name}</Tag>)}</div>
      </>) : <LeanEmpty>No calendar mirrored yet. Once Cloudbeds is connected, the next 120 days of availability and rates per room type land here on every sync.</LeanEmpty>) : null}

      {view === 'payments' ? (d.payments.length ? (<>
        <div className="flex gap-1.5 mb-3 flex-wrap"><Pill tone="emerald">{money(d.totals.charge)} charged</Pill><Pill tone="sky">{money(d.totals.deposit)} deposits</Pill><Pill tone="rose">{money(d.totals.refund)} refunded</Pill><Pill>{d.totals.count} transactions · 30 days</Pill></div>
        <LeanList>{d.payments.map((p: any) => (
          <LeanRow key={p.id} name={`${money(p.amount)} · ${p.guest_name || 'Guest'}`} meta={`${p.method || ''} · ${when(p.paid_at)}`}
            tags={<><Tag tone={p.kind === 'refund' ? 'rose' : p.kind === 'deposit' ? 'sky' : 'emerald'}>{p.kind}</Tag>{p.status ? <Tag>{p.status}</Tag> : null}{p.reservation_id ? <Tag>res {p.reservation_id}</Tag> : null}</>} />
        ))}</LeanList>
      </>) : <LeanEmpty>No payments mirrored yet. Once Cloudbeds is connected, charges, deposits and refunds from Cloudbeds Payments land here on every sync.</LeanEmpty>) : null}
    </>
  )
}
