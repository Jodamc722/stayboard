'use client'
import { useEffect, useState } from 'react'
import { X, AlertTriangle, Star, ClipboardCheck, Loader2 } from 'lucide-react'

type Ops = {
  unit: string
  inspection: { recommended: boolean; reasons: string[] }
  lastFeedback: { rating: number | null; guest: string | null; date: string; excerpt: string } | null
  checklist: string[]
  openInspection: { taskId: string; reportUrl: string | null } | null
}
type Person = { id: number; name: string }

export default function ListingOpsPanel({
  listingId,
  unitName,
  date,
  onClose,
}: {
  listingId: string
  unitName?: string
  date?: string
  onClose: () => void
}) {
  const [ops, setOps] = useState<Ops | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [supId, setSupId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetch('/api/schedule/listing-ops?listingId=' + encodeURIComponent(listingId) + (date ? '&date=' + date : '')).then((r) => r.json()).catch(() => null),
      fetch('/api/breezeway/people?department=inspection').then((r) => r.json()).catch(() => ({ people: [] })),
    ]).then(([o, p]) => {
      if (!alive) return
      setOps(o && !o.error ? o : null)
      const list = Array.isArray(p) ? p : p.people || p.data || []
      setPeople(list.map((x: any) => ({ id: Number(x.id), name: String(x.name || x.full_name || '') })).filter((x: Person) => x.id && x.name))
      if (o?.openInspection?.reportUrl) setCreatedUrl(o.openInspection.reportUrl)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [listingId, date])

  async function createAndAssign() {
    setBusy(true)
    setMsg('')
    try {
      const title = 'Inspection - ' + (ops?.unit || unitName || 'Unit')
      const parts: string[] = []
      if (ops?.inspection?.reasons?.length) parts.push('Why: ' + ops.inspection.reasons.join('; '))
      if (ops?.lastFeedback) parts.push('Last feedback (' + (ops.lastFeedback.rating ?? '?') + '/5): ' + ops.lastFeedback.excerpt)
      if (ops?.checklist?.length) parts.push('Check: ' + ops.checklist.join('; '))
      const description = parts.join('  |  ')
      const cr = await fetch('/api/sentiment/create-qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, date, department: 'inspection', priority: 'high', title, description, issueType: 'inspection' }),
      }).then((r) => r.json())
      if (!cr?.ok || !cr.taskId) {
        setMsg(cr?.error || 'Could not create task')
        setBusy(false)
        return
      }
      if (supId) {
        await fetch('/api/breezeway/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: cr.taskId, assigneeIds: [Number(supId)] }),
        })
      }
      setCreatedUrl(cr.reportUrl || null)
      const who = people.find((p) => String(p.id) === supId)
      setMsg('Inspection created' + (who ? ' and assigned to ' + who.name : '') + '.')
    } catch (e: any) {
      setMsg('Error: ' + (e?.message || 'failed'))
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold text-neutral-900 truncate">{ops?.unit || unitName || 'Listing'}</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !ops ? (
          <div className="p-4 text-sm text-neutral-500">No ops data for this listing.</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            <div className={'rounded-lg p-3 ' + (ops.inspection.recommended ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200')}>
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className={'w-4 h-4 ' + (ops.inspection.recommended ? 'text-amber-600' : 'text-emerald-600')} />
                {ops.inspection.recommended ? 'Inspection recommended' : 'No inspection flagged'}
              </div>
              {ops.inspection.reasons.length > 0 && (
                <ul className="mt-1.5 ml-6 list-disc text-neutral-700 space-y-0.5">
                  {ops.inspection.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">Last guest feedback</div>
              {ops.lastFeedback ? (
                <div className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-center gap-2 text-neutral-600 mb-1">
                    {ops.lastFeedback.rating != null && (
                      <span className="inline-flex items-center gap-0.5 font-medium">
                        <Star className="w-3.5 h-3.5 text-amber-500" />
                        {ops.lastFeedback.rating}/5
                      </span>
                    )}
                    <span className="text-neutral-400">{(ops.lastFeedback.guest || 'Guest') + ' - ' + ops.lastFeedback.date}</span>
                  </div>
                  <div className="text-neutral-700">{ops.lastFeedback.excerpt || '-'}</div>
                </div>
              ) : (
                <div className="text-neutral-400">No reviews yet.</div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">Things to check</div>
              <ul className="space-y-1">
                {ops.checklist.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ClipboardCheck className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0" />
                    <span className="text-neutral-700">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!loading && ops && (
          <div className="border-t p-4 space-y-2">
            {createdUrl ? (
              <a href={createdUrl} target="_blank" rel="noreferrer" className="block text-center rounded-lg bg-emerald-600 text-white py-2 text-sm font-medium">
                Open inspection task
              </a>
            ) : (
              <>
                <select value={supId} onChange={(e) => setSupId(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-2 py-2 text-sm">
                  <option value="">Assign to supervisor...</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button disabled={busy} onClick={createAndAssign} className="w-full rounded-lg bg-neutral-900 text-white py-2 text-sm font-medium disabled:opacity-50">
                  {busy ? 'Creating...' : supId ? 'Create inspection & assign' : 'Create inspection'}
                </button>
              </>
            )}
            {msg && <div className="text-xs text-neutral-500">{msg}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
