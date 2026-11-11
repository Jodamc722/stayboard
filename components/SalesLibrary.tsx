'use client'
// THE PROJECTIONS LIBRARY ON THE SALES TAB (Jon, 2026-11-11: "a section where we can add our projections
// for units… like a database. From there, when creating a new sales magazine, we should be able to
// select the building"). Every building we have run comps for, its floor plans and their ranges.
// Edit one here and every NEW deck that starts from it gets the update; decks already sent keep theirs.
// "New deck" hands the building to the generator at the top of the page (ReportsDesk listens for it).
import { useEffect, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, Sparkles, Building2 } from 'lucide-react'
import { SalesCmaEditor } from '@/components/SalesCmaEditor'

type Row = { id: string; name: string; area: string; photo?: string; plans: number; comps: number; range: [number, number] | null; updatedAt: string; updatedBy?: string | null }
const k = (n: number) => '$' + (n >= 100000 ? Math.round(n / 1000) : (n / 1000).toFixed(1)) + 'K'
export const START_FROM_EVENT = 'sales:start-from'

export function SalesLibrary() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<{ id: string | null; name?: string } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const load = () => fetch('/api/sales/buildings', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.ok) setRows(d.buildings); else setErr(d?.error || 'Could not load the library.') }).catch(() => setErr('Could not load the library.'))
  useEffect(() => { load() }, [])

  async function remove(id: string) {
    const r = await fetch('/api/sales/buildings?id=' + encodeURIComponent(id), { method: 'DELETE' })
    const d = await r.json().catch(() => null)
    setConfirmDel(null)
    if (!d?.ok) setErr(d?.error || 'Could not remove it.'); else load()
  }
  const shown = (rows || []).filter(r => !q.trim() || (r.name + ' ' + r.area).toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <section id="projections-library" className="mt-6 rounded-2xl border border-line bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 size={16} className="text-ink" />
        <h2 className="text-[15px] font-bold text-ink">Projections library</h2>
        <span className="text-[12.5px] text-muted mr-auto">Each building’s comparable set and floor-plan projections. New decks start from a copy.</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a building" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-ink w-44" />
        <button type="button" onClick={() => setOpen({ id: null })} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold"><Plus size={13} /> Add a building</button>
      </div>
      {err && <p role="status" className="text-[12.5px] text-red-700">{err}</p>}
      {open && <SalesCmaEditor library={open} onClose={() => setOpen(null)} onSaved={load} />}
      {!rows ? <p className="text-[13px] text-muted"><Loader2 size={13} className="inline animate-spin mr-1.5" />Loading…</p> : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(r => (
            <div key={r.id} className="rounded-xl border border-line p-3 flex flex-col gap-2">
              <div>
                <p className="text-[14px] font-semibold text-ink">{r.name}</p>
                <p className="text-[12px] text-muted">{[r.area, r.plans + ' floor plan' + (r.plans === 1 ? '' : 's'), r.comps + ' comp' + (r.comps === 1 ? '' : 's'), r.range ? k(r.range[0]) + '–' + k(r.range[1]) + ' comp range' : ''].filter(Boolean).join(' · ')}</p>
                {r.updatedAt && <p className="text-[11px] text-muted mt-0.5">Updated {new Date(r.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{r.updatedBy ? ' by ' + r.updatedBy.split('@')[0] : ''}</p>}
              </div>
              <div className="flex gap-1.5 flex-wrap mt-auto">
                <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent(START_FROM_EVENT, { detail: { id: r.id, name: r.name } })); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 text-white px-2.5 py-1 text-[12px] font-semibold"><Sparkles size={12} /> New deck</button>
                <button type="button" onClick={() => setOpen({ id: r.id, name: r.name })} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app"><Pencil size={12} /> Edit</button>
                {confirmDel === r.id
                  ? <><button type="button" onClick={() => remove(r.id)} className="rounded-lg bg-red-600 text-white px-2.5 py-1 text-[12px] font-semibold">Remove {r.name}</button><button type="button" onClick={() => setConfirmDel(null)} className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink">Keep</button></>
                  : <button type="button" onClick={() => setConfirmDel(r.id)} aria-label={'Remove ' + r.name} className="rounded-lg border border-line px-2 py-1 text-muted hover:text-red-700"><Trash2 size={12} /></button>}
              </div>
            </div>
          ))}
          {!shown.length && <p className="text-[13px] text-muted">No building matches.</p>}
        </div>
      )}
    </section>
  )
}

/** On the Sales desk: the library is its own page now (/sales/projections). */
export function SalesLibraryLink() {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => { fetch('/api/sales/buildings', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.ok) setRows(d.buildings) }).catch(() => setRows([])) }, [])
  return (
    <a href="/sales/projections" className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-white p-4 hover:border-ink/40">
      <Building2 size={20} className="text-ink" />
      <div className="mr-auto">
        <p className="font-serif text-[22px] leading-none text-ink">Projections library</p>
        <p className="text-[12.5px] text-muted mt-1">{rows ? rows.length + ' building' + (rows.length === 1 ? '' : 's') + ' · ' + rows.reduce((a, r) => a + r.plans, 0) + ' floor plans' : 'Every building’s floor plans and projections'} · add, import and edit them; new decks start from them.</p>
      </div>
      <div className="flex -space-x-3">{(rows || []).slice(0, 5).map(r => <span key={r.id} className="w-11 h-11 rounded-full border-2 border-white bg-app bg-cover bg-center" style={r.photo ? { backgroundImage: `url("${r.photo}")` } : undefined} title={r.name} />)}</div>
      <span className="rounded-xl bg-ink text-white px-3.5 py-2 text-[13px] font-semibold">Open the library</span>
    </a>
  )
}
