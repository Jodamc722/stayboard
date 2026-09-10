'use client'
// COUPON CODES — the team's side of "have a code?" on the guest form (Jon, 2026-09-10).
// Make a code, send it to a guest however you like (booking message, email, a card in the unit);
// the guest types it on the order form and the server decides what it is worth. Everyone with
// edit access can see the codes; making or changing one needs full access, because a code is money.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Ticket, Copy, Check } from 'lucide-react'

type Coupon = {
  id: string; code: string; label: string | null; percent_off: number | null; amount_off_usd: number | null; min_subtotal_usd: number
  buildings: string[] | null; starts_at: string | null; expires_at: string | null; max_uses: number | null; used: number; active: boolean; created_by: string | null; created_at: string
}
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0)
const worth = (c: Coupon) => c.percent_off ? c.percent_off + '% off' : c.amount_off_usd ? money(c.amount_off_usd) + ' off' : '—'
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const state = (c: Coupon, now = Date.now()) => !c.active ? 'off' : c.expires_at && new Date(c.expires_at).getTime() < now ? 'expired' : c.max_uses !== null && c.used >= c.max_uses ? 'used up' : c.starts_at && new Date(c.starts_at).getTime() > now ? 'not yet' : 'live'

export function CouponsPanel({ canEdit, canMoney, buildings }: { canEdit: boolean; canMoney: boolean; buildings: string[] }) {
  const [list, setList] = useState<Coupon[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [draft, setDraft] = useState({ code: '', label: '', kind: 'percent' as 'percent' | 'amount', value: '', min: '', maxUses: '', expires: '', buildings: [] as string[] })
  const load = useCallback(async () => {
    try { const j = await fetch('/api/guest-orders/coupons', { cache: 'no-store' }).then(r => r.json()); if (j.ok) setList(j.coupons); else setErr(j.error || 'Could not load codes') }
    catch { setErr('Could not load codes') }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    if (busy) return
    setBusy(true); setErr('')
    const body: any = { code: draft.code, label: draft.label, min_subtotal_usd: draft.min || 0, max_uses: draft.maxUses || null, expires_at: draft.expires ? draft.expires + 'T23:59:59' : null, buildings: draft.buildings }
    if (draft.kind === 'percent') body.percent_off = Number(draft.value); else body.amount_off_usd = Number(draft.value)
    try {
      const j = await fetch('/api/guest-orders/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      if (!j.ok) setErr(j.error || 'Could not create the code'); else { setList(j.coupons); setDraft({ code: '', label: '', kind: 'percent', value: '', min: '', maxUses: '', expires: '', buildings: [] }) }
    } catch { setErr('Could not create the code') }
    setBusy(false)
  }
  async function toggle(c: Coupon) {
    if (busy) return
    setBusy(true)
    try { const j = await fetch('/api/guest-orders/coupons', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, active: !c.active }) }).then(r => r.json()); if (j.ok) setList(j.coupons); else setErr(j.error || 'Could not change the code') }
    catch { setErr('Could not change the code') }
    setBusy(false)
  }
  function copy(c: Coupon) { try { navigator.clipboard.writeText(c.code); setCopied(c.id); setTimeout(() => setCopied(''), 1200) } catch { /* no clipboard */ } }

  const box = 'rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] bg-white'
  const lab = 'flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold'
  return (
    <div className="space-y-4">
      {canMoney ? (
        <div className="rounded-2xl bg-white ring-1 ring-line p-4">
          <div className="flex items-center gap-2 text-[13.5px] font-bold text-ink"><Ticket size={15} /> New code</div>
          <p className="text-[12px] text-muted mt-1">Send it to the guest in their booking message or on a card in the unit. They type it on the order form; the discount comes off after any spend-and-save.</p>
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <label className={lab}>Code<input value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32) }))} placeholder="WELCOME15" className={box + ' w-36 mt-0.5 font-mono tracking-wide'} /></label>
            <label className={lab}>What the guest reads<input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value.slice(0, 80) }))} placeholder="Welcome back — 15% off" className={box + ' w-52 mt-0.5'} /></label>
            <label className={lab}>Worth
              <div className="flex mt-0.5">
                <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as any }))} className={box + ' rounded-r-none'}><option value="percent">% off</option><option value="amount">$ off</option></select>
                <input type="number" min={0} step={draft.kind === 'percent' ? 1 : 0.01} value={draft.value} onChange={e => setDraft(d => ({ ...d, value: e.target.value }))} placeholder={draft.kind === 'percent' ? '15' : '10'} className={box + ' w-20 rounded-l-none border-l-0'} />
              </div>
            </label>
            <label className={lab}>Min order $<input type="number" min={0} value={draft.min} onChange={e => setDraft(d => ({ ...d, min: e.target.value }))} placeholder="0" className={box + ' w-20 mt-0.5'} /></label>
            <label className={lab}>Max uses<input type="number" min={1} value={draft.maxUses} onChange={e => setDraft(d => ({ ...d, maxUses: e.target.value }))} placeholder="∞" className={box + ' w-20 mt-0.5'} /></label>
            <label className={lab}>Expires<input type="date" value={draft.expires} onChange={e => setDraft(d => ({ ...d, expires: e.target.value }))} className={box + ' w-36 mt-0.5'} /></label>
            <button onClick={create} disabled={busy || draft.code.length < 3 || !(Number(draft.value) > 0)} className="h-8 inline-flex items-center gap-1 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create</button>
          </div>
          {buildings.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted mr-1">Only at:</span>
              {buildings.map(b => { const on = draft.buildings.indexOf(b) >= 0; return <button key={b} onClick={() => setDraft(d => ({ ...d, buildings: on ? d.buildings.filter(x => x !== b) : [...d.buildings, b] }))} className={'text-[11px] font-semibold px-2 py-0.5 rounded-full border ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{b}</button> })}
              <span className="text-[11px] text-muted">{draft.buildings.length ? '' : '(none picked = every building)'}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{err}</div> : null}
      <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
        {!list ? <div className="p-6 text-center text-[13px] text-muted"><Loader2 size={14} className="animate-spin inline mr-1.5" /> Loading codes…</div>
          : !list.length ? <div className="p-8 text-center text-[13px] text-muted">No codes yet.{canMoney ? ' Make one above.' : ''}</div>
          : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-app/60 text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="text-left px-3 py-2">Code</th><th className="text-left px-3 py-2">Worth</th><th className="text-left px-3 py-2">Rules</th><th className="text-left px-3 py-2">Used</th><th className="text-left px-3 py-2">State</th><th className="px-3 py-2"></th></tr></thead>
              <tbody className="divide-y divide-line">
                {list.map(c => { const st = state(c); return (
                  <tr key={c.id} className={c.active ? '' : 'opacity-60'}>
                    <td className="px-3 py-2"><div className="font-mono font-bold tracking-wide text-ink">{c.code}</div>{c.label ? <div className="text-[11.5px] text-muted">{c.label}</div> : null}</td>
                    <td className="px-3 py-2 font-semibold text-ink tabular-nums">{worth(c)}</td>
                    <td className="px-3 py-2 text-muted">{[c.min_subtotal_usd > 0 ? 'min ' + money(c.min_subtotal_usd) : null, c.buildings ? c.buildings.join(', ') : 'every building', c.expires_at ? 'until ' + day(c.expires_at) : null].filter(Boolean).join(' · ')}</td>
                    <td className="px-3 py-2 tabular-nums text-ink">{c.used}{c.max_uses !== null ? ' / ' + c.max_uses : ''}</td>
                    <td className="px-3 py-2"><span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + (st === 'live' ? 'bg-emerald-50 text-emerald-700' : st === 'off' ? 'bg-app text-muted' : 'bg-amber-50 text-amber-800')}>{st}</span></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => copy(c)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink mr-2">{copied === c.id ? <Check size={12} /> : <Copy size={12} />} {copied === c.id ? 'Copied' : 'Copy'}</button>
                      {canMoney ? <button onClick={() => toggle(c)} disabled={busy} className="text-[11.5px] font-semibold text-muted hover:text-ink">{c.active ? 'Switch off' : 'Switch on'}</button> : null}
                    </td>
                  </tr>
                ) })}
              </tbody>
            </table>
          )}
      </div>
      {!canEdit ? null : <p className="text-[11px] text-muted">A code never stacks with another code; it does stack with spend-and-save and with an item's own offer or bulk price.</p>}
    </div>
  )
}
