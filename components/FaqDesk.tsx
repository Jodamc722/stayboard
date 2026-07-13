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
    <div className="space-y-5">
      <select value={pick} onChange={e => setPick(e.target.value)} className="text-sm rounded-lg border border-line px-2.5 py-2 bg-white min-w-[280px]">
        <option value="">Pick a listing…</option>
        {listings.map(l => <option key={l.id} value={l.id}>{l.name}{l.building ? ' · ' + l.building : ''}</option>)}
      </select>

      {loading ? <div className="text-sm text-muted">Loading…</div> : null}
      {!pick ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">Pick a listing to see its facts, how-tos, and FAQ.</div> : null}

      {pick && data ? (
        <div className="space-y-5">
          <section className="rounded-2xl border border-line bg-white p-4">
            <h2 className="text-sm font-bold text-ink mb-2">Unit facts <span className="text-[10px] font-normal text-muted">· auto from Guesty</span></h2>
            {facts.length === 0 ? <div className="text-xs text-muted">No facts found for this unit.</div> : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {facts.map((f, i) => <div key={i} className="text-sm"><dt className="text-[11px] uppercase tracking-wide text-muted">{f.label}</dt><dd className="text-ink">{f.value}</dd></div>)}
              </dl>
            )}
          </section>

          {highlights.length > 0 ? (
            <section className="rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-bold text-ink mb-2">Highlights <span className="text-[10px] font-normal text-muted">· from onboarding</span></h2>
              <div className="flex flex-wrap gap-1.5">
                {highlights.map(h => <span key={h.id} className="text-[11px] px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{h.title}{h.brand ? ' · ' + h.brand : ''}</span>)}
              </div>
            </section>
          ) : null}

          {howtos.length > 0 ? (
            <section className="rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-bold text-ink mb-2">How-Tos to review <span className="text-[10px] font-normal text-muted">· captured in audits</span></h2>
              <div className="space-y-2">
                {howtos.map(h => (
                  <div key={h.id} className="flex gap-2.5 rounded-lg border border-line p-2">
                    {h.photo_url ? <img src={h.photo_url} alt="" className="w-12 h-12 rounded object-cover shrink-0" /> : null}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">{h.title}{h.room ? <span className="text-[10px] text-muted ml-1.5">{h.room}</span> : null}</div>
                      <div className="text-xs text-muted">{h.howTo}</div>
                    </div>
                    <button onClick={() => approve(h)} disabled={busy} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-neutral-900 text-white shrink-0 h-fit disabled:opacity-40">Approve</button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-line bg-white p-4">
            <h2 className="text-sm font-bold text-ink mb-2">FAQ &amp; How-To</h2>
            {entries.length === 0 ? <div className="text-xs text-muted mb-3">No entries yet.</div> : (
              <div className="space-y-2 mb-3">
                {entries.map(e => (
                  <div key={e.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {e.category ? <span className="text-[10px] uppercase tracking-wide text-muted">{e.category}</span> : null}
                        <div className="text-sm font-semibold text-ink">{e.question}</div>
                        <div className="text-sm text-muted whitespace-pre-wrap">{e.answer}</div>
                      </div>
                      <button onClick={() => del(e.id)} disabled={busy} className="text-[11px] text-rose-600 shrink-0">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2 border-t border-line pt-3">
              <input value={cat} onChange={e => setCat(e.target.value)} placeholder="Category (optional) e.g. Parking" className="w-full text-sm rounded-lg border border-line px-2.5 py-1.5" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Question / title" className="w-full text-sm rounded-lg border border-line px-2.5 py-1.5" />
              <textarea value={a} onChange={e => setA(e.target.value)} placeholder="Answer" rows={3} className="w-full text-sm rounded-lg border border-line px-2.5 py-1.5" />
              <button onClick={addEntry} disabled={busy || !q.trim()} className="text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">Add FAQ entry</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
