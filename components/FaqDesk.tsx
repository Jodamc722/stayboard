'use client'
import { useEffect, useState } from 'react'

type Fact = { label: string; value: string }
type Entry = { id: string; category?: string | null; question?: string | null; answer?: string | null; photo_url?: string | null; source?: string }
type Howto = { id: string; room?: string; title: string; howTo: string; photo_url?: string | null }
type Highlight = { id: string; room?: string; title: string; brand?: string; tier?: string; features?: string[] }
type Opt = { id: string; name: string; building: string }

export function FaqDesk({ listingId }: { listingId?: string } = {}) {
  const [listings, setListings] = useState<Opt[]>([])
  const [pick, setPick] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [cat, setCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [showList, setShowList] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => { (async () => { try { const r = await fetch('/api/faq'); const j = await r.json(); setListings((j && j.listings) || []) } catch {} })() }, [])

  async function load(id: string) {
    if (!id) { setData(null); return }
    setLoading(true)
    try { const r = await fetch('/api/faq?listingId=' + encodeURIComponent(id)); const j = await r.json(); setData(j) } catch {}
    setLoading(false)
  }
  useEffect(() => { load(pick) }, [pick])
  useEffect(() => { if (listingId) setPick(listingId) }, [listingId])

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
  const otaLinks: any[] = (data && data.otaLinks) || []
  const keyDetails: any[] = (data && data.keyDetails) || []

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: any }) {
    const open = !!collapsed[id]
    return (
      <section className="rounded-2xl border border-line bg-white overflow-hidden">
        <button onClick={() => setCollapsed(c => ({ ...c, [id]: !c[id] }))} className="w-full px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-wider text-muted font-semibold">{title}</h2>
          <span className="flex items-center gap-2">{note ? <span className="text-[11px] text-muted">{note}</span> : null}<span className="text-muted">{open ? '▾' : '▸'}</span></span>
        </button>
        {open ? <div className="px-4">{children}</div> : null}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {!listingId ? (
        <div className="relative max-w-md">
          <input value={search} onChange={e => { setSearch(e.target.value); setShowList(true) }} onFocus={() => setShowList(true)} onBlur={() => setTimeout(() => setShowList(false), 150)} placeholder={pick ? (((listings.find(l => l.id === pick) || {}) as any).name || 'Search a listing…') : 'Search a listing…'} className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
          {showList ? (
            <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-line bg-white shadow-soft">
              {listings.filter(l => (l.name + ' ' + l.building).toLowerCase().includes(search.toLowerCase())).slice(0, 60).map(l => (
                <button key={l.id} onMouseDown={() => { setPick(l.id); setSearch(''); setShowList(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50">{l.name}{l.building ? <span className="text-muted"> · {l.building}</span> : null}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">Loading…</div> : null}
      {!pick && !loading && !listingId ? <div className="rounded-2xl border border-line bg-white px-6 py-20 text-center text-sm text-muted">Pick a listing to see its facts, how-tos, and FAQ.</div> : null}

      {pick && data ? (
        <div className="space-y-4">
          {(otaLinks.length > 0 || !listingId) ? (
            <div className="flex flex-wrap items-center gap-2">
              {!listingId ? <a href={'/listings/' + pick} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50">Open unit in app →</a> : null}
              {otaLinks.map((o: any) => <a key={o.name} href={o.url} target="_blank" rel="noreferrer" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50">{o.name} ↗</a>)}
            </div>
          ) : null}

          <Section id="facts" title="Unit facts" note="auto from Guesty">
            {facts.length === 0 ? <div className="py-6 text-sm text-muted text-center">No facts found for this unit.</div> : facts.map((f, i) => (
              <div key={i} className="py-2.5 border-b border-line last:border-0">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{f.label}</div>
                <div className="text-sm text-ink mt-0.5 whitespace-pre-wrap">{f.value}</div>
              </div>
            ))}
          </Section>

          {keyDetails.length > 0 ? (
            <Section id="keydetails" title="Key details" note="from audit inventory">
              {keyDetails.map((k: any, i: number) => (
                <div key={i} className="py-2 border-b border-line last:border-0 flex items-center justify-between gap-2">
                  <span className="text-sm text-ink">{k.item}{k.room ? <span className="text-[11px] text-muted ml-1.5">{k.room}</span> : null}</span>
                  <span className="text-sm font-semibold text-ink shrink-0">{k.size}</span>
                </div>
              ))}
            </Section>
          ) : null}

          {highlights.length > 0 ? (
            <Section id="highlights" title="Highlights" note="from onboarding">
              <div className="py-3 flex flex-wrap gap-1.5">
                {highlights.map(h => <span key={h.id} className="text-[12px] px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{h.title}{h.brand ? ' · ' + h.brand : ''}</span>)}
              </div>
            </Section>
          ) : null}

          {howtos.length > 0 ? (
            <Section id="howtos" title="How-Tos to review" note="captured in audits">
              <div className="py-2 space-y-2">
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
            </Section>
          ) : null}

          <Section id="faq" title="FAQ and How-To">
            {entries.length === 0 ? <div className="py-3 text-sm text-muted">No entries yet.</div> : (
              <div className="py-3 space-y-2">
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
            <div className="space-y-2 border-t border-line pt-3 pb-3">
              <input value={cat} onChange={e => setCat(e.target.value)} placeholder="Category (optional) e.g. Parking" className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Question / title" className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
              <textarea value={a} onChange={e => setA(e.target.value)} placeholder="Answer" rows={3} className="w-full text-sm rounded-lg border border-line bg-white px-3 py-2 focus:outline-none focus:border-brand-500" />
              <button onClick={addEntry} disabled={busy || !q.trim()} className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">Add FAQ entry</button>
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  )
}
