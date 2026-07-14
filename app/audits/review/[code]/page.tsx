'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Item = { id: string; room: string; kind: string; title?: string | null; note?: string | null; photo_url?: string | null; qty?: number; details?: any; severity?: string | null; status: string }

export default function AuditReviewPage() {
  const params = useParams() as any
  const code = String((params && params.code) || '')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  function load() {
    fetch('/api/audit?code=' + encodeURIComponent(code)).then(r => r.json()).then(j => { setData(j); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { if (code) load() }, [code])

  if (loading) return <div className="max-w-4xl mx-auto p-8 text-neutral-400 text-sm">Loading audit...</div>
  if (!data || !data.listing) return <div className="max-w-4xl mx-auto p-8 text-neutral-400 text-sm">Audit not found.</div>

  const items: Item[] = data.items || []
  const listing: any = data.listing
  const audit: any = data.audit || {}
  const isOnboarding = audit.auditType === 'onboarding'
  const bldgTags = items.filter(i => i.kind === 'tag' && i.room === 'Building')
  const roomTags = (room: string) => items.filter(i => i.kind === 'tag' && i.room === room)
  const inv = (room: string) => items.filter(i => i.room === room && i.kind !== 'tag')
  const roomNames: string[] = []
  for (const it of items) { if (it.room && it.room !== 'Building' && roomNames.indexOf(it.room) < 0) roomNames.push(it.room) }
  const realCount = items.filter(i => i.kind !== 'tag').length

  return (
    <div className="max-w-4xl mx-auto px-5 py-6 space-y-5">
      <div>
        <a href="/audits" className="text-xs text-neutral-400 hover:text-neutral-600">&larr; All audits</a>
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mt-2">{isOnboarding ? 'Onboarding audit' : 'Quality audit'}</div>
        <h1 className="text-2xl font-bold text-neutral-900">{listing.title || listing.name || 'Unit'}</h1>
        <div className="text-sm text-neutral-500 mt-0.5">{realCount} items{'  '}&middot;{'  '}{audit.status === 'completed' ? 'Completed' : 'Open'}</div>
      </div>

      {bldgTags.length ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-2">Building amenities</div>
          <div className="flex flex-wrap gap-1.5">{bldgTags.map(t => (<span key={t.id} className="text-xs font-medium px-2 py-1 rounded-full bg-teal-100 text-teal-700">{t.title}{(t.qty || 0) > 1 ? ' ×' + t.qty : ''}</span>))}</div>
        </div>
      ) : null}

      {roomNames.length === 0 ? (<div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-400">Nothing captured yet on this audit.</div>) : null}

      {roomNames.map(room => (
        <div key={room} className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <div className="text-sm font-semibold text-neutral-900">{room}</div>
            {roomTags(room).length ? (<div className="flex flex-wrap gap-1 mt-1.5">{roomTags(room).map(t => (<span key={t.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600">{t.title}{(t.qty || 0) > 1 ? ' ×' + t.qty : ''}</span>))}</div>) : null}
          </div>
          <div className="divide-y divide-neutral-100">
            {inv(room).length ? inv(room).map(it => (
              <div key={it.id} className="flex gap-3 p-3 items-start">
                {it.photo_url ? (<img src={it.photo_url} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />) : (<div className="w-16 h-16 rounded-lg bg-neutral-100 shrink-0" />)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-neutral-900">{it.title || 'Item'}{(it.qty || 0) > 1 ? ' ×' + it.qty : ''}</div>
                  {it.details && it.details.brand ? (<div className="text-xs text-neutral-500 mt-0.5">{it.details.brand}{it.details.size ? ' · ' + it.details.size : ''}</div>) : null}
                  {it.details && it.details.howTo ? (<div className="text-xs text-emerald-700 mt-1">{it.details.howTo}</div>) : null}
                  {it.note ? (<div className="text-xs text-neutral-400 mt-0.5">{it.note}</div>) : null}
                </div>
              </div>
            )) : (<div className="p-3 text-xs text-neutral-400">No items captured in this room.</div>)}
          </div>
        </div>
      ))}

      <div className="pt-2">
        <a href={'/audit/' + code} className="text-sm font-semibold text-indigo-600">Open capture form to edit &rarr;</a>
      </div>
    </div>
  )
}
