'use client'
import { useEffect, useState } from 'react'

type Fact = { label: string; value: string }
type Entry = { id: string; category?: string | null; question?: string | null; answer?: string | null; photo_url?: string | null; source?: string }
type Howto = { id: string; room?: string; title: string; howTo: string; photo_url?: string | null }
type Highlight = { id: string; room?: string; title: string; brand?: string; tier?: string; features?: string[] }
type Opt = { id: string; name: string; building: string }

export function FaqDesk() {
  const [listings, setListings] = useState<Opt[]>([])
  const [pick, setPick] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [cat, setCat] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { (async () => { try { const r = await fetch('/api/faq'); const j = await r.json(); setListings((j && j.listings) || []) } catch {} })() }, [])

  async function load(id: string) {
    if (!id) { setData(null); return }
    setLoading(true)
    try { const r = await fetch('/api/faq?listingId=' + encodeURIComponent(id)); const j = await r.json(); setData(j) } catch {}
    setLoading(false)
  }
  useEffect(() => { load(pick) }, [pick])

  async function post(body: any) {
    setBusy(true)
    try { await fetch('/api/faq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await load(pick) } catch {}
    setBusy(false)
  }
  async function addEntry() {
    if (!q.trim() || !pick) return
    await post({ action: 'addEntry', listingId: pick, category: cat, question: q, answer: a })
    setQ(''); setA(''); setCat('')
  }
  function approve(h: Howto) { post({ action: 'approveHowto', listingId: pick, category: 'How-To', question: h.title, answer: h.howTo, photoUrl: h.photo_url }) }
  function del(id: string) { post({ action: 'deleteEntry', id }) }

  const facts: Fact[] = (data && data.facts) || []
  const entries: Entry[] = (data && data.entries) || []
  const howtos: Howto[] = (data && data.howtos) || []
  const highlights: Highlight[] = (data && data.highlights) || []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={pick} onChange={e => setPick(e.target.value)} className="text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500 min-w-[300px]">
          <option value="">Pick a listing…</option>
          {listings.map(l => <option key={l.id} value={l.id}>{l.name}{l.building ? ' · ' + l.building : ''}</option>)}
        </select>
      </div>

      {loading ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">Loading…</div> : null}
      {!pick && !loading ? <div className="rounded-2xl border border-line bg-white px-6 py-20 text-center text-sm text-muted">Pick a listing to see its facts, how-tos, and FAQ.</div> : null}

      {pick && data ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h2 className="text-[11px] uppercase tracking-wider text-muted font-semibold">Unit facts</h2>
              <span className="text-[11px] text-muted">auto from Guesty</span>
            </div>
            <div className="px-4">
              {facts.length === 0 ? <div className="py-6 text-sm text-muted text-center">No facts found for this unit.</div> : facts.map((f, i) => (
                <div key={i} className="py-2.5 border-b border-line last:border-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{f.label}</div>
                  <div className="text-sm text-ink mt-0.5 whitespace-pre-wrap">{f.value}</div>
                </div>
              ))}
            </div>
          </section>

          {highlights.length > 0 ? (
            <section className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <h2 className="text-[11px] uppercase tracking-wider text-muted font-semibold">Highlights</h2>
                <span className="text-[11px] text-muted">from onboarding</span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-1.5">
                {highlights.map(h => <span key={h.id} className="text-[12px] px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{h.title}{h.brand ? ' · ' + h.brand : ''}</span>)}
              </div>
            </section>
          ) : null}

          {howtos.length > 0 ? (
            <section className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <h2 className="text-[11px] uppercase tracking-wider text-muted font-semibold">How-Tos to review</h2>
                <span className="text-[11px] text-muted">captured in audits</span>
              </div>
              <div className="p-3 space-y-2">
                {howtos.map(h => (
                  <div key={h.id} className="flex gap-3 rounded-xl border border-line p-2.5">
                    {h.photo_url ? <img src={h.photo_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" /> : null}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">{h.title}{h.room ? <span className="text-[11px] text-muted ml-1.5">{h.room}</span> : null}</div>
                      <div className="text-[13px] text-muted mt-0.5">{h.howTo}</div>
                    </div>
                    <button onClick={() => approve(h)} disabled={busy} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-neutral-900 text-white shrink-0 h-fit disabled:opacity-40">Approve</button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <h2 className="text-[11px] uppercase tracking-wider text-muted font-semibold">FAQ &amp; How-To</h2>
            </div>
            <div className="p-4 space-y-3">
              {entries.length === 0 ? <div className="text-sm text-muted">No entries yet.</div> : (
                <div className="space-y-2">
                  {entries.map(e => (
                    <div key={e.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {e.category ? <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{e.category}</div> : null}
                          <div className="text-sm font-semibold text-ink mt-0.5">{e.question}</div>
                          <div className="text-[13px] text-muted mt-0.5 whitespace-pre-wrap">{e.answer}</div>
                        </div>
                        <button onClick={() => del(e.id)} disabled={busy} className="text-[11px] text-rose-600 shrink-0">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2 border-t border-line pt-3">
                <input value={cat} onChange={e => setCat(e.target.value)} placeholder="Category (optional) e.g. Parking" className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Question / title" className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
                <textarea value={a} onChange={e => setA(e.target.value)} placeholder="Answer" rows={3} className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
                <button onClick={addEntry} disabled={busy || !q.trim()} className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">Add FAQ entry</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
