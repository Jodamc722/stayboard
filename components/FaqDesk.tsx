'use client'
import { useEffect, useState } from 'react'
import { Check, X, Trash2, Plus } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanTabs, LeanList, LeanRow, LeanEmpty, IconBtn, Clamp } from '@/components/lean'

type Fact = { label: string; value: string }
type Entry = { id: string; category?: string | null; question?: string | null; answer?: string | null; photo_url?: string | null; source?: string }
type Howto = { id: string; room?: string; title: string; howTo: string; photo_url?: string | null }
type Highlight = { id: string; room?: string; title: string; brand?: string; tier?: string; features?: string[] }
type Opt = { id: string; name: string; building: string }

export function FaqDesk({ listingId, showHead }: { listingId?: string; showHead?: boolean } = {}) {
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
  const [tab, setTab] = useState<'facts' | 'faq' | 'drafts' | 'howtos' | 'details' | 'highlights'>('facts')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { (async () => { try { const r = await fetch('/api/faq'); const j = await r.json(); setListings((j && j.listings) || []) } catch {} })() }, [])

  async function load(id: string) {
    if (!id) { setData(null); return }
    setLoading(true)
    setErr('')
    try {
      const r = await fetch('/api/faq?listingId=' + encodeURIComponent(id)); const j = await r.json().catch(() => ({} as any))
      if (!r.ok || j.ok === false) { setErr(j.error || (r.status === 403 ? 'You do not have access to the Property FAQ.' : 'Could not load (' + r.status + ').')); setData(null) }
      else setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load(pick) }, [pick])
  useEffect(() => { if (listingId) setPick(listingId) }, [listingId])

  async function post(body: any) {
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/faq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || j.ok === false || j.error) setErr('Not saved: ' + (j.error || (r.status === 403 ? 'you do not have edit access to the Property FAQ.' : 'the server refused (' + r.status + ').')))
      await load(pick)
    } catch (e: any) { setErr('Not saved: ' + String(e?.message || e)) }
    setBusy(false)
  }
  async function addEntry() {
    if (!q.trim() || !pick) return
    await post({ action: 'addEntry', listingId: pick, category: cat, question: q, answer: a })
    setQ(''); setA(''); setCat('')
  }
  function approve(h: Howto) { post({ action: 'approveHowto', listingId: pick, category: 'How-To', question: h.title, answer: h.howTo, photoUrl: h.photo_url }) }
  function del(id: string) { post({ action: 'deleteEntry', id }) }
  function approveDraft(id: string) { post({ action: 'approveDraft', id }) }
  function dismissDraft(id: string) { post({ action: 'dismissDraft', id }) }

  const facts: Fact[] = (data && data.facts) || []
  const entries: Entry[] = (data && data.entries) || []
  const howtos: Howto[] = (data && data.howtos) || []
  const drafts: Entry[] = (data && (data as any).drafts) || []
  const highlights: Highlight[] = (data && data.highlights) || []
  const otaLinks: any[] = (data && data.otaLinks) || []
  const keyDetails: any[] = (data && data.keyDetails) || []

  type TabKey = 'facts' | 'faq' | 'drafts' | 'howtos' | 'details' | 'highlights'
  const tabs: { key: TabKey; label: string; n?: number | null }[] = [
    { key: 'facts', label: 'Facts', n: facts.length },
    { key: 'faq', label: 'FAQ', n: entries.length },
    ...(drafts.length ? [{ key: 'drafts' as TabKey, label: 'Drafts', n: drafts.length }] : []),
    ...(howtos.length ? [{ key: 'howtos' as TabKey, label: 'How-tos', n: howtos.length }] : []),
    ...(keyDetails.length ? [{ key: 'details' as TabKey, label: 'Key details', n: keyDetails.length }] : []),
    ...(highlights.length ? [{ key: 'highlights' as TabKey, label: 'Highlights', n: highlights.length }] : []),
  ]
  const cur: TabKey = tabs.some(t => t.key === tab) ? tab : 'facts'
  const pickedName = ((listings.find(l => l.id === pick) || {}) as any).name as string | undefined

  return (
    <div className="space-y-3">
      {showHead ? (
        <LeanHead title="Property FAQ">
          <Pill title="Listings you can open">{listings.length} units</Pill>
          {pick && data ? <Pill title="Published FAQ entries for this unit">{entries.length} FAQ</Pill> : null}
          {pick && data && drafts.length + howtos.length > 0 ? <Pill tone="amber" title="Captured in audits, waiting for approval">{drafts.length + howtos.length} to approve</Pill> : null}
        </LeanHead>
      ) : null}
      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{err}</div>}
      {(!listingId || (pick && data && otaLinks.length > 0)) ? (
        <div className="flex items-center gap-2 flex-wrap">
          {!listingId ? (
            <div className="relative w-full max-w-xs">
              <input value={search} onChange={e => { setSearch(e.target.value); setShowList(true) }} onFocus={() => setShowList(true)} onBlur={() => setTimeout(() => setShowList(false), 150)} placeholder={pick ? (pickedName || 'Search a listing…') : 'Search a listing…'} className="w-full text-[12.5px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:border-brand-500" />
              {showList ? (
                <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-line bg-white shadow-soft">
                  {listings.filter(l => (l.name + ' ' + l.building).toLowerCase().includes(search.toLowerCase())).slice(0, 60).map(l => (
                    <button key={l.id} onMouseDown={() => { setPick(l.id); setSearch(''); setShowList(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50">{l.name}{l.building ? <span className="text-muted"> · {l.building}</span> : null}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {pick && data && !listingId ? <a href={'/listings/' + pick} title="Open this unit's page in the app" className="text-[12px] font-semibold px-2 py-1 rounded-lg border border-line hover:bg-neutral-50">Unit ↗</a> : null}
          {pick && data ? otaLinks.map((o: any) => <a key={o.name} href={o.url} target="_blank" rel="noreferrer" title={'Open the ' + o.name + ' listing'} className="text-[12px] font-semibold px-2 py-1 rounded-lg border border-line hover:bg-neutral-50">{o.name} ↗</a>) : null}
        </div>
      ) : null}

      {loading ? <LeanEmpty>Loading…</LeanEmpty> : null}
      {!pick && !loading && !listingId ? <LeanEmpty>Pick a listing to see its facts, how-tos and FAQ.</LeanEmpty> : null}

      {pick && data ? (
        <div>
          <LeanTabs tabs={tabs} value={cur} onChange={setTab}
            right={cur === 'faq' ? <button onClick={() => setAdding(v => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-neutral-900 text-white"><Plus size={13} /> {adding ? 'Close' : 'Add entry'}</button> : null} />

          {cur === 'facts' ? (
            facts.length === 0 ? <LeanEmpty>No facts found for this unit.</LeanEmpty> : (
              <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70" title="Auto from Guesty">
                {facts.map((f, i) => (
                  <li key={i} className="px-3 sm:px-4 py-2 flex items-start gap-x-3 gap-y-0.5 flex-wrap sm:flex-nowrap">
                    <span className="text-[12px] text-muted w-full sm:w-36 shrink-0">{f.label}</span>
                    <span className="text-[13px] text-ink whitespace-pre-wrap min-w-0 flex-1">{f.value}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {cur === 'details' ? (
            <LeanList>
              {keyDetails.map((k: any, i: number) => (
                <LeanRow key={i} name={k.item} meta={k.room || undefined} tags={k.size ? <Tag tone="brand" title="From audit inventory">{k.size}</Tag> : null} />
              ))}
            </LeanList>
          ) : null}

          {cur === 'highlights' ? (
            <div className="rounded-2xl border border-line bg-white px-3 py-2.5 flex flex-wrap gap-1.5" title="From onboarding">
              {highlights.map(h => <Tag key={h.id} tone="amber">{h.title}{h.brand ? ' · ' + h.brand : ''}</Tag>)}
            </div>
          ) : null}

          {cur === 'drafts' ? (
            <LeanList>
              {drafts.map(d => (
                <LeanRow key={d.id} tint="amber" name={d.question} tags={d.category ? <Tag>{d.category}</Tag> : null}
                  actions={<>
                    <IconBtn title="Approve — publish to the FAQ" tone="ok" disabled={busy} onClick={() => approveDraft(d.id)}><Check size={15} /></IconBtn>
                    <IconBtn title="Dismiss this draft" disabled={busy} onClick={() => dismissDraft(d.id)}><X size={15} /></IconBtn>
                  </>}>
                  <div className="flex gap-3">
                    {d.photo_url ? <img src={d.photo_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" /> : null}
                    <div className="min-w-0 flex-1"><Clamp text={d.answer || ''} lines={3} /></div>
                  </div>
                </LeanRow>
              ))}
            </LeanList>
          ) : null}

          {cur === 'howtos' ? (
            <LeanList>
              {howtos.map(h => (
                <LeanRow key={h.id} name={h.title} meta={h.room || undefined} tags={<Tag tone="sky" title="Captured in an audit">Audit</Tag>}
                  actions={<IconBtn title="Approve — add to the FAQ as a How-To" tone="ok" disabled={busy} onClick={() => approve(h)}><Check size={15} /></IconBtn>}>
                  <div className="flex gap-3">
                    {h.photo_url ? <img src={h.photo_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" /> : null}
                    <div className="min-w-0 flex-1"><Clamp text={h.howTo || ''} lines={3} /></div>
                  </div>
                </LeanRow>
              ))}
            </LeanList>
          ) : null}

          {cur === 'faq' ? (
            <div className="space-y-2">
              {adding ? (
                <div className="rounded-2xl border border-line bg-white p-3 space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <input value={cat} onChange={e => setCat(e.target.value)} placeholder="Category (optional)" className="w-full sm:w-44 text-[12.5px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:border-brand-500" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Question / title" className="flex-1 min-w-[12rem] text-[12.5px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:border-brand-500" />
                  </div>
                  <textarea value={a} onChange={e => setA(e.target.value)} placeholder="Answer" rows={3} className="w-full text-[12.5px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:border-brand-500" />
                  <button onClick={addEntry} disabled={busy || !q.trim()} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-40">Add FAQ entry</button>
                </div>
              ) : null}
              {entries.length === 0 ? <LeanEmpty>No FAQ entries yet.</LeanEmpty> : (
                <LeanList>
                  {entries.map(e => (
                    <LeanRow key={e.id} name={e.question} tags={e.category ? <Tag>{e.category}</Tag> : null}
                      actions={<IconBtn title="Delete this entry" tone="bad" disabled={busy} onClick={() => del(e.id)}><Trash2 size={14} /></IconBtn>}>
                      {e.photo_url ? <img src={e.photo_url} alt="" className="w-16 h-16 rounded-lg object-cover" /> : null}
                      <Clamp text={e.answer || ''} lines={3} />
                    </LeanRow>
                  ))}
                </LeanList>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
