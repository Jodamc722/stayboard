'use client'
// FF&E FIXES — the board for what needs doing (Jon, 2026-08-12).
//
//   "...then add what needs to be done. This is only for furniture... it can be communicated there,
//    and send to team. This would not need to be shared with owner unless it's 350 or more to fix."
//
// The $350 line is drawn on the screen, not just in the code. A fix under it is the team's to get
// on with and the owner is never asked; a fix at or over it carries a badge and an explicit button
// that is the ONLY way it can reach an owner. Nobody has to remember the rule — the row says it.
//
// Costed last, deliberately. Somebody in a hallway types "drawer runner broken, master" in four
// seconds; whoever prices it does that later at a desk. Making the estimate required at capture
// would mean half of these never get written down.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Wrench, Check, Send, DollarSign, User, ChevronRight, AlertCircle, Building2, X,
} from 'lucide-react'
import { money, FIX_OWNER_THRESHOLD, FIX_STATUS_LABEL } from '@/lib/ffe-catalog'

type Fix = {
  id: string; listing_id: string; unit_name: string | null; building: string | null; ownerName: string | null
  room: string | null; title: string; note: string | null; est_cost: number | null
  status: string; assigned_to: string | null; order_id: string | null
  needsOwner: boolean; created_by: string | null; created_at: string
}
type Person = { email: string; name: string }

const STATUS_CLS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  doing: 'bg-blue-100 text-blue-700',
  done: 'bg-emerald-100 text-emerald-700',
  dropped: 'bg-neutral-200 text-neutral-500',
}

export function FfeFixes() {
  const [fixes, setFixes] = useState<Fix[] | null>(null)
  const [totals, setTotals] = useState<any>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [setup, setSetup] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'open' | 'doing' | 'done' | 'all'>('open')
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [sendTo, setSendTo] = useState<Record<string, boolean>>({})
  const [showSend, setShowSend] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const [a, b] = await Promise.all([
        fetch('/api/audit/ffe/fixes', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/audit/ffe/fixes?people=1', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ people: [] })),
      ])
      if (a?.setupRequired) { setSetup(a.error); setFixes([]); return }
      if (!a?.ok) throw new Error(a?.error || 'Could not load fixes.')
      setFixes(a.fixes || []); setTotals(a.totals || null); setPeople(b?.people || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/fixes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'That did not save.')
      await load(); setBusy(false); return j
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); return null }
  }

  const shown = useMemo(() => (fixes || []).filter(f =>
    tab === 'all' ? true : tab === 'done' ? (f.status === 'done' || f.status === 'dropped') : f.status === tab), [fixes, tab])

  const selected = useMemo(() => shown.filter(f => sel[f.id]), [shown, sel])
  const selectedOverThreshold = selected.filter(f => f.needsOwner && !f.order_id)

  if (setup) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
      <p className="font-bold">Fixes are not switched on yet.</p>
      <p className="mt-1">{setup}</p>
    </div>
  )
  if (err && !fixes) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!fixes) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading fixes…</div>

  return (
    <div className="space-y-3">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      {msg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12.5px] text-emerald-800 flex items-center gap-2">
          {msg}<button onClick={() => setMsg('')} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      ) : null}

      <p className="text-[12.5px] text-muted">
        Furniture that needs <span className="font-semibold text-ink">fixing</span> rather than replacing — logged on the
        walk, worked by the team. Under <span className="font-semibold text-ink">${FIX_OWNER_THRESHOLD}</span> the owner is
        never asked. At or over it, the fix has to go onto that owner&apos;s FF&amp;E order for sign-off, and the button below
        is the only way it gets there. Nothing here creates a maintenance ticket.
      </p>

      {totals ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { l: 'To do', v: String(totals.open) },
            { l: 'In progress', v: String(totals.doing) },
            { l: 'Need owner sign-off', v: String(totals.needOwner) },
            { l: 'Open value', v: money(totals.value) },
          ].map(x => (
            <div key={x.l} className="rounded-xl border border-line bg-white px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wider text-muted font-bold">{x.l}</div>
              <div className="text-lg font-bold text-ink tabular-nums">{x.v}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="lh-actions flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-line overflow-hidden">
          {([['open', 'To do'], ['doing', 'In progress'], ['done', 'Finished'], ['all', 'All']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setSel({}) }}
              className={'px-3 py-1.5 text-[12px] font-semibold ' + (tab === k ? 'bg-ink text-white' : 'text-muted')}>{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowSend(s => !s)}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" /> Send the list to the team
        </button>
      </div>

      {showSend ? (
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft space-y-2">
          <p className="text-[12.5px] font-bold text-ink">Who should get the open list?</p>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {people.map(p => (
              <button key={p.email} onClick={() => setSendTo(s => ({ ...s, [p.email]: !s[p.email] }))}
                className={'rounded-lg px-2.5 py-1 text-[12px] font-semibold border ' +
                  (sendTo[p.email] ? 'bg-ink text-white border-ink' : 'border-line text-muted')}>
                {p.name}
              </button>
            ))}
            {!people.length ? <span className="text-[12px] text-muted">No active users found.</span> : null}
          </div>
          <button disabled={busy || !Object.values(sendTo).some(Boolean)}
            onClick={async () => {
              const j = await post({ action: 'notifyTeam', to: Object.keys(sendTo).filter(k => sendTo[k]) })
              if (j) { setMsg(`Sent to ${j.sent} ${j.sent === 1 ? 'person' : 'people'} — ${j.open} open.`); setShowSend(false); setSendTo({}) }
            }}
            className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      ) : null}

      {selected.length ? (
        <div className="sticky top-2 z-10 rounded-2xl border border-ink bg-ink text-white p-3 shadow-lg flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold">{selected.length} selected</span>
          <select defaultValue="" onChange={async e => { if (e.target.value) { await post({ action: 'assign', ids: selected.map(f => f.id), assignedTo: e.target.value }); setSel({}) } e.target.value = '' }}
            className="rounded-lg bg-white text-ink px-2 py-1.5 text-[12px]">
            <option value="">Assign to…</option>
            {people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
          <button onClick={async () => { await post({ action: 'update', id: selected[0].id, status: 'doing' }); setSel({}) }}
            disabled={selected.length !== 1}
            className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40">Start</button>
          <button onClick={async () => { for (const f of selected) await post({ action: 'update', id: f.id, status: 'done' }); setSel({}) }}
            className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> Done
          </button>
          <div className="flex-1" />
          <button disabled={busy || !selectedOverThreshold.length}
            title={selectedOverThreshold.length ? '' : `Nothing selected reaches $${FIX_OWNER_THRESHOLD}`}
            onClick={async () => {
              const j = await post({ action: 'toOrder', ids: selected.map(f => f.id) })
              if (j) { setMsg(`Added to ${j.orders.map((o: any) => o.orderNo).join(', ')} as a draft — open it to send.` + (j.note ? ' ' + j.note : '')); setSel({}) }
            }}
            className="rounded-lg bg-white text-ink px-2.5 py-1.5 text-[12px] font-bold disabled:opacity-40">
            Put {selectedOverThreshold.length || ''} on the owner&apos;s order
          </button>
          <button onClick={() => setSel({})} className="text-[12px] font-semibold text-white/70">Clear</button>
        </div>
      ) : null}

      {!shown.length ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <Wrench className="w-5 h-5 text-muted mx-auto mb-2" />
          <p className="text-sm font-semibold text-ink">Nothing here.</p>
          <p className="text-[12.5px] text-muted mt-1">
            Fixes are logged from the walk form — there is a &ldquo;Something needs fixing&rdquo; box at the bottom of every unit.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft divide-y divide-line">
          {shown.map(f => (
            <div key={f.id} className={'px-4 py-3 flex items-start gap-3 flex-wrap ' + (f.status === 'done' || f.status === 'dropped' ? 'opacity-60' : '')}>
              <input type="checkbox" className="mt-1" checked={!!sel[f.id]} onChange={e => setSel(s => ({ ...s, [f.id]: e.target.checked }))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-ink">{f.title}</span>
                  <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (STATUS_CLS[f.status] || STATUS_CLS.open)}>
                    {FIX_STATUS_LABEL[f.status] || f.status}
                  </span>
                  {f.needsOwner && !f.order_id ? (
                    <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> owner sign-off
                    </span>
                  ) : null}
                  {f.order_id ? (
                    <a href={'/ffe/order/' + f.order_id} className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 inline-flex items-center gap-1">
                      on an order <ChevronRight className="w-3 h-3" />
                    </a>
                  ) : null}
                </div>
                <div className="text-[11.5px] text-muted flex items-center gap-1.5 flex-wrap mt-0.5">
                  <Building2 className="w-3 h-3" />
                  {[f.unit_name, f.building, f.ownerName].filter(Boolean).join(' · ')}
                  {f.assigned_to ? <><User className="w-3 h-3 ml-1" />{f.assigned_to}</> : null}
                </div>
                {f.note ? <p className="text-[12px] text-muted mt-1">{f.note}</p> : null}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="relative">
                  <DollarSign className="w-3 h-3 text-muted absolute left-1.5 top-1/2 -translate-y-1/2" />
                  <input defaultValue={f.est_cost == null ? '' : String(f.est_cost)} placeholder="est."
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (f.est_cost == null ? '' : String(f.est_cost))) post({ action: 'update', id: f.id, estCost: v }) }}
                    className="w-20 rounded-lg border border-line pl-5 pr-1.5 py-1 text-[12px] text-right tabular-nums" inputMode="decimal" />
                </div>
                {f.status !== 'done' ? (
                  <button onClick={() => post({ action: 'update', id: f.id, status: f.status === 'doing' ? 'done' : 'doing' })}
                    className="rounded-lg border border-line px-2 py-1 text-[11.5px] font-semibold text-ink">
                    {f.status === 'doing' ? 'Done' : 'Start'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted">
        A fix with no estimate counts as under the line — not yet priced is not the same as expensive, and holding
        small work back waiting for a number nobody asked for is how it rots.
      </p>
    </div>
  )
}
