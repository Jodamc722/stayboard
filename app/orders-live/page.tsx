'use client'
// ORDERS LIVE — the field team's link. Today's guest orders by building → unit, who has each one,
// and one tap to mark it delivered. Same team password as the delivery plan / vendor boards.
// Phone-first: big type, big tap targets, no chrome.
import { useCallback, useEffect, useState } from 'react'

type Line = { name: string; qty: number; unit_label?: string | null }
type Row = { id: string; unit: string | null; building: string; guest: string; checkInLabel: string; inHouse: boolean; items: Line[]; note: string | null; status: string; deliveryDate: string | null; deliveryLabel: string; overdue: boolean; assignees: string[]; assignNote: string | null; taskId: string | null; deliveredAt: string | null; deliveredBy: string | null }
type Data = { today: string; todayLabel: string; due: Row[]; upcoming: Row[]; delivered: Row[] }

export default function OrdersLivePage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [who, setWho] = useState('')
  const [lang, setLang] = useState<'en' | 'es'>('en')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/orders-live', { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 || j.needsPassword) { setNeedsPw(true); return }
      if (!r.ok || !j.ok) { setErr(j.error || 'Failed to load'); return }
      setNeedsPw(false); setData(j)
    } catch { setErr('Network error — reload to retry.') }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 45_000); return () => clearInterval(t) }, [load])
  useEffect(() => { try { const w = localStorage.getItem('orders_live_who'); if (w) setWho(w) } catch { /* no storage */ } }, [])

  async function unlock() {
    if (!pw.trim()) return
    setPwErr('')
    try {
      const r = await fetch('/api/public/share-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); return }
      setPw(''); await load()
    } catch { setPwErr('Network error - retry') }
  }
  async function deliver(id: string) {
    if (busy) return
    setBusy(id)
    try {
      try { localStorage.setItem('orders_live_who', who) } catch { /* fine */ }
      await fetch('/api/public/orders-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, who }) })
      await load()
    } catch { /* reload shows the truth */ }
    setBusy(null)
  }

  const t = (en: string, es: string) => lang === 'es' ? es : en

  if (needsPw) return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-sm mx-auto px-4 py-16">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Stay Hospitality</div>
        <h1 className="text-xl font-bold text-neutral-900 mb-3">Guest orders · today</h1>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-sm text-neutral-600 mb-2">Enter the team password.</div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') unlock() }} placeholder="Team password" className="w-full text-base border border-neutral-200 rounded-xl px-3 py-2.5" />
          {pwErr ? <div className="text-xs text-rose-600 mt-1.5">{pwErr}</div> : null}
          <button onClick={unlock} disabled={!pw.trim()} className="mt-2 w-full text-sm font-semibold px-3 py-2.5 rounded-xl bg-neutral-900 text-white disabled:opacity-50">Open</button>
        </div>
      </div>
    </div>
  )
  if (err) return <div className="max-w-md mx-auto px-4 py-16 text-sm text-rose-700">{err}</div>
  if (!data) return <div className="max-w-md mx-auto px-4 py-16 text-sm text-neutral-500">Loading…</div>

  const group = (rows: Row[]) => {
    const by: Record<string, Row[]> = {}
    for (const r of rows) (by[r.building || 'Other'] = by[r.building || 'Other'] || []).push(r)
    return Object.keys(by).sort().map(b => ({ building: b, rows: by[b] }))
  }

  const Card = ({ r, done }: { r: Row; done?: boolean }) => (
    <div className={'rounded-2xl bg-white border p-4 ' + (r.overdue ? 'border-rose-300' : done ? 'border-neutral-200 opacity-70' : 'border-neutral-200 shadow-[0_8px_24px_-18px_rgba(0,0,0,.35)]')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[19px] font-bold text-neutral-900 leading-tight">{r.unit || 'Unit'}</div>
          <div className="text-[13px] text-neutral-500 mt-0.5">{r.guest} · {r.inHouse ? t('in-house', 'en la unidad') : t('arrives', 'llega') + ' ' + r.checkInLabel}</div>
        </div>
        <span className={'text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap ' + (done ? 'bg-emerald-600 text-white' : r.overdue ? 'bg-rose-100 text-rose-800' : 'bg-indigo-100 text-indigo-900')}>{done ? t('Delivered', 'Entregado') : r.deliveryLabel}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {r.items.map((l, i) => <li key={i} className="flex items-center gap-2.5 text-[16px] text-neutral-900"><span className="inline-flex items-center justify-center min-w-[30px] h-[30px] rounded-lg bg-neutral-900 text-white text-[14px] font-bold tabular-nums px-1.5">{l.qty}</span><span>{l.name}{l.unit_label ? <span className="text-neutral-400 text-[13px]"> · {l.unit_label}</span> : null}</span></li>)}
      </ul>
      {r.note ? <div className="mt-3 rounded-xl bg-amber-50 text-amber-900 text-[13.5px] px-3 py-2">💬 {r.note}</div> : null}
      <div className="mt-3 text-[12.5px] text-neutral-500">👤 {r.assignees.length ? r.assignees.join(' + ') : t('not assigned yet', 'sin asignar')}{r.assignNote ? <span className="text-neutral-400"> — {r.assignNote}</span> : null}{r.taskId ? <span className="text-neutral-400"> · Breezeway #{r.taskId}</span> : null}</div>
      {done ? (
        <div className="mt-2 text-[12px] text-emerald-700">✓ {r.deliveredBy || ''}{r.deliveredAt ? ' · ' + new Date(r.deliveredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''}</div>
      ) : (
        <button onClick={() => deliver(r.id)} disabled={busy === r.id} className="mt-4 w-full h-12 rounded-xl bg-emerald-600 text-white text-[15px] font-semibold disabled:opacity-60 active:scale-[.99]">{busy === r.id ? '…' : '✓ ' + t('Delivered', 'Entregado')}</button>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-neutral-50 pb-16">
      <div className="max-w-xl mx-auto px-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Stay Hospitality</div>
            <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">{t('Guest orders', 'Pedidos de huéspedes')} · {data.todayLabel}</h1>
          </div>
          <button onClick={() => setLang(l => l === 'en' ? 'es' : 'en')} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white">{lang === 'en' ? 'ES' : 'EN'}</button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input value={who} onChange={e => setWho(e.target.value)} placeholder={t('Your name (for the delivered stamp)', 'Tu nombre (para marcar entregado)')} className="flex-1 text-[14px] px-3 py-2 rounded-xl border border-neutral-200 bg-white" />
        </div>

        <section className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 font-bold mb-2">{t('Deliver today', 'Entregar hoy')} · {data.due.length}</div>
          {data.due.length === 0 ? <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-[14px] text-neutral-500">{t('Nothing to deliver today.', 'Nada que entregar hoy.')}</div> : null}
          {group(data.due).map(g => (
            <div key={g.building} className="mb-4">
              <div className="text-[13px] font-bold text-neutral-700 mb-2">{g.building}</div>
              <div className="space-y-3">{g.rows.map(r => <Card key={r.id} r={r} />)}</div>
            </div>
          ))}
        </section>

        {data.upcoming.length ? (
          <section className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 font-bold mb-2">{t('Coming up', 'Próximos')} · {data.upcoming.length}</div>
            {group(data.upcoming).map(g => (
              <div key={g.building} className="mb-4">
                <div className="text-[13px] font-bold text-neutral-700 mb-2">{g.building}</div>
                <div className="space-y-3">{g.rows.map(r => <Card key={r.id} r={r} />)}</div>
              </div>
            ))}
          </section>
        ) : null}

        {data.delivered.length ? (
          <section className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 font-bold mb-2">{t('Delivered', 'Entregados')} · {data.delivered.length}</div>
            <div className="space-y-3">{data.delivered.map(r => <Card key={r.id} r={r} done />)}</div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
