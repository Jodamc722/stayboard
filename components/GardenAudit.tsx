'use client'
// CLOUDBEDS AUDIT + REAL TIME — on Cloudbeds & feeds. What the key can read (lib/garden/audit) and
// whether Cloudbeds pushes events to Lighthouse (lib/garden/realtime).
import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, Zap } from 'lucide-react'
import { Tag } from '@/components/lean'

const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'
const AREA: Record<string, string> = { property: 'Property', reservations: 'Reservations', guests: 'Guests', revenue: 'Revenue', distribution: 'Distribution', operations: 'Operations', messages: 'Messages', realtime: 'Real time' }

export function GardenAudit({ canEdit }: { canEdit: boolean }) {
  const [a, setA] = useState<any>(null)
  const [hook, setHook] = useState<any>(null)
  const [busy, setBusy] = useState<'' | 'audit' | 'hook'>('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch('/api/garden/audit', { cache: 'no-store' }).then(r => r.json()).then(j => setA(j.audit || null)).catch(() => {})
    fetch('/api/garden/cloudbeds/webhook', { cache: 'no-store' }).then(r => r.json()).then(setHook).catch(() => {})
  }, [])
  const run = async () => { setBusy('audit'); const j = await fetch('/api/garden/audit', { method: 'POST' }).then(r => r.json()).catch(() => ({})); setA(j.audit || a); setBusy('') }
  const sub = async () => {
    setBusy('hook'); setMsg('')
    const j = await fetch('/api/garden/cloudbeds/webhook', { method: 'PUT' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    setMsg(j.ok ? `Subscribed ${j.added.length} events${j.existing ? ` (${j.existing} already on)` : ''}${j.failed.length ? ` · ${j.failed.length} refused: ${j.failed.join('; ')}` : ''}` : j.error)
    setBusy('')
  }
  const areas = a ? Array.from(new Set(a.probes.map((p: any) => p.area))) as string[] : []
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap size={16} className="text-amber-600" />
          <h3 className="text-[14px] font-semibold text-ink">Real-time updates</h3>
          <span className="text-[12px] text-muted">{hook?.events ? `${hook.events} events received · last ${when(hook.lastEventAt)}` : 'No events received yet — Lighthouse polls Cloudbeds every 20 minutes.'}</span>
          <div className="flex-1" />
          {canEdit ? <button onClick={sub} disabled={!!busy} className="h-8 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'hook' ? <Loader2 size={13} className="animate-spin" /> : null} Subscribe to Cloudbeds events</button> : null}
        </div>
        <p className="text-[12px] text-muted mt-1.5">New bookings, cancellations, date changes, payments, room condition and out-of-service blocks arrive the moment they happen in Cloudbeds.</p>
        {msg ? <p className="text-[12px] mt-1.5 text-ink">{msg}</p> : null}
      </div>

      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldCheck size={16} className="text-emerald-700" />
          <h3 className="text-[14px] font-semibold text-ink">Connection audit</h3>
          <span className="text-[12px] text-muted">{a ? `last run ${when(a.at)}` : 'not run yet'}</span>
          <div className="flex-1" />
          {canEdit ? <button onClick={run} disabled={!!busy} className="h-8 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'audit' ? <Loader2 size={13} className="animate-spin" /> : null} Run audit</button> : null}
        </div>
        {a ? (<>
          {a.findings?.length ? <ul className="mt-2 space-y-1 text-[12.5px] text-ink list-disc pl-5">{a.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul> : null}
          <div className="mt-3 rounded-xl border border-line overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{['Area', 'What', 'Read', 'In Cloudbeds', 'Lands in Lighthouse'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>{areas.flatMap(area => a.probes.filter((p: any) => p.area === area).map((p: any, i: number) => (
                <tr key={p.key} className="border-b border-line/60 last:border-0 align-top">
                  <td className="px-3 py-1.5 text-muted whitespace-nowrap">{i === 0 ? AREA[area] || area : ''}</td>
                  <td className="px-3 py-1.5"><div className="font-semibold text-ink">{p.label}</div><div className="text-muted">{p.note}</div></td>
                  <td className="px-3 py-1.5">{p.ok ? <Tag tone="emerald">readable</Tag> : <Tag tone={p.area === 'messages' ? 'slate' : 'rose'} title={p.error || ''}>{p.area === 'messages' ? 'no API' : 'blocked'}</Tag>}</td>
                  <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{p.ok ? (p.total ?? p.count ?? '—') : <span className="text-muted">{(p.error || '').slice(0, 60)}</span>}</td>
                  <td className="px-3 py-1.5 text-muted">{p.mirrored || '—'}</td>
                </tr>)))}</tbody>
            </table>
          </div>
        </>) : null}
      </div>
    </div>
  )
}
