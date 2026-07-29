'use client'
// OWNER REVIEW SHEET - what an owner opens from their share link.
//
// The old page was a price list with Approve / Decline. Owners declined because a price with no
// context is only ever a cost. This sheet argues the case for each line: the photos, why it is
// recommended, the guest review behind it, how long it has been flagged and how many times we have
// already repaired it, PRICE OPTIONS instead of one number, and what it costs to do nothing.
//
// Two lenses on the same sheet: BY UNIT (walk the property one unit at a time) and ACROSS THE
// PROPERTY (the total, split buys versus labour, with repeat items grouped so four cutting boards
// in four kitchens are ONE decision that ships once and prices better).
//
// The decision is four-way: Approve / I will supply / Not now / No. Everything written here lands
// straight on the order desk, so nothing is re-keyed.
import { useEffect, useState } from 'react'

type Opt = { key: string; label: string; price: number | null; link: string; note: string }
type Decision = { choice: string; supply: string | null; link: string; note: string; option: string; at: string }
type Item = {
  id: string; listingId: string; unit: string; building: string; room: string; kind: string
  tag: string; recommendation: boolean; restock: boolean; urgent: boolean
  title: string; qty: number; note: string; why: string
  photos: string[]; link: string | null; est: number | null; lineTotal: number | null; status: string
  options: Opt[]
  doNothing: { text: string; cost: number | null } | null
  history: { months: number; repairs: number; flaggedAt: string }
  review: { quote: string; rating: number | null; date: string } | null
  decision: Decision | null
  questions: { q: string; at: string }[]
  answers: { a: string; at: string }[]
}
type Labour = { unit: string; room: string; kind: string; title: string; urgent: boolean }
type Draft = { choice: string; supply: string; link: string; note: string; option: string }

const CHOICE_LABEL: Record<string, string> = { approve: 'Approved', supply: 'You are supplying', later: 'Not now', no: 'Declined' }
const CHOICE_CLS: Record<string, string> = {
  approve: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  supply: 'bg-sky-50 text-sky-800 border-sky-200',
  later: 'bg-amber-50 text-amber-800 border-amber-200',
  no: 'bg-neutral-100 text-neutral-500 border-neutral-200',
}
const SUPPLY_LABEL: Record<string, string> = { link: 'Send me a link and I will buy it', self: 'I am buying it myself', ordered: 'Already ordered' }
const OPT_LABEL: Record<string, string> = { like: 'Like-for-like', upgrade: 'Upgrade', repair: 'Repair only' }

function money(n: any): string { const v = Number(n); return '$' + Math.round(Number.isFinite(v) ? v : 0).toLocaleString('en-US') }
function nrm(x: string): string { return String(x || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() }
function ageLabel(h: Item['history']): string {
  if (!h) return ''
  if (h.months >= 12) { const y = Math.floor(h.months / 12); return 'flagged ' + y + (y === 1 ? ' year' : ' years') + ' ago' }
  if (h.months >= 1) return 'flagged ' + h.months + (h.months === 1 ? ' month' : ' months') + ' ago'
  return 'flagged this month'
}
function isLive(it: Item): boolean { return ['ordered', 'arriving', 'task_created', 'done'].indexOf(it.status) < 0 }
function decided(it: Item): string { return it.decision && it.decision.choice ? it.decision.choice : '' }

export default function OwnerOrdersPage() {
  const [s, setS] = useState('')
  const [k, setK] = useState('')
  const [label, setLabel] = useState('')
  const [unitCount, setUnitCount] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [labour, setLabour] = useState<Labour[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [view, setView] = useState<'unit' | 'property'>('unit')
  const [openId, setOpenId] = useState('')
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [supplyFor, setSupplyFor] = useState('')
  const [askFor, setAskFor] = useState('')
  const [askText, setAskText] = useState('')
  const [groupBusy, setGroupBusy] = useState('')
  // Printing a collapsed sheet would print headlines with none of the argument, which is exactly
  // the document this page exists to replace - so Print opens every line first.
  const [expandAll, setExpandAll] = useState(false)
  function printSheet() {
    setExpandAll(true)
    setTimeout(() => { window.print(); setExpandAll(false) }, 350)
  }

  async function load(ss: string, kk: string) {
    try {
      setErr('')
      const r = await fetch('/api/public/owner-orders?s=' + encodeURIComponent(ss) + '&k=' + encodeURIComponent(kk), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'This link is not valid.'); setLoading(false); return }
      setLabel(j.label || '')
      setUnitCount(Number(j.unitCount) || 0)
      setItems(j.items || [])
      setLabour(j.labour || [])
    } catch { setErr('Network error - reload to retry.') }
    setLoading(false)
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const ss = p.get('s') || ''
    const kk = p.get('k') || ''
    setS(ss); setK(kk)
    if (!ss || !kk) { setErr('This link is not valid.'); setLoading(false); return }
    load(ss, kk)
  }, [])

  function draftOf(it: Item): Draft {
    const d = draft[it.id]
    if (d) return d
    const dec = it.decision
    return {
      choice: dec ? dec.choice : '',
      supply: dec && dec.supply ? dec.supply : '',
      link: dec ? dec.link : '',
      note: dec ? dec.note : '',
      option: dec && dec.option ? dec.option : (it.options[0] ? it.options[0].key : ''),
    }
  }
  function setDraftFor(id: string, patch: Partial<Draft>) {
    setDraft(m => ({ ...m, [id]: { ...(m[id] || { choice: '', supply: '', link: '', note: '', option: '' }), ...patch } }))
  }

  async function post(bodyExtra: any): Promise<boolean> {
    try {
      const r = await fetch('/api/public/owner-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s, k, ...bodyExtra }) })
      const j = await r.json().catch(() => ({}))
      return !!(r.ok && j && j.ok)
    } catch { return false }
  }

  async function decide(it: Item, choice: string, extra?: Partial<Draft>) {
    if (busy) return
    const d = { ...draftOf(it), ...(extra || {}) }
    if (choice === 'supply' && !d.supply) { setSupplyFor(it.id); return }
    setBusy(it.id)
    const ok = await post({ itemId: it.id, choice, supply: choice === 'supply' ? d.supply : null, link: d.link, note: d.note, option: d.option })
    setBusy('')
    if (!ok) { setErr('That did not save - please try again.'); return }
    setSupplyFor('')
    await load(s, k)
  }

  async function decideGroup(list: Item[], choice: string, gkey: string) {
    if (groupBusy) return
    setGroupBusy(gkey)
    for (const it of list) {
      if (!isLive(it)) continue
      const d = draftOf(it)
      await post({ itemId: it.id, choice, supply: null, link: '', note: '', option: d.option })
    }
    setGroupBusy('')
    await load(s, k)
  }

  async function ask(it: Item) {
    const q = askText.trim()
    if (!q || busy) return
    setBusy(it.id)
    const ok = await post({ itemId: it.id, action: 'ask', q })
    setBusy('')
    if (!ok) { setErr('Your question did not send - please try again.'); return }
    setAskText(''); setAskFor('')
    await load(s, k)
  }

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-neutral-500">Loading your review sheet…</div>
  if (err && !items.length) return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-rose-600">{err}</div>

  // ---- money + counts ------------------------------------------------------------------------
  const open = items.filter(it => isLive(it) && !decided(it))
  const approved = items.filter(it => decided(it) === 'approve' || (!decided(it) && !isLive(it)))
  const supplying = items.filter(it => decided(it) === 'supply')
  const later = items.filter(it => decided(it) === 'later')
  const declined = items.filter(it => decided(it) === 'no')
  const sum = (list: Item[]) => list.reduce((n, it) => n + (it.lineTotal || 0), 0)
  const openTotal = sum(open)
  const openNoPrice = open.filter(it => !it.lineTotal).length
  const urgentOpen = open.filter(it => it.urgent).length

  const stat = (k2: string, v: string, sub: string, cls: string) => (
    <div className={'rounded-xl border px-3 py-2 ' + cls}>
      <div className="text-[10px] uppercase tracking-wider font-bold opacity-70">{k2}</div>
      <div className="text-base font-bold leading-tight">{v}</div>
      {sub ? <div className="text-[11px] opacity-70">{sub}</div> : null}
    </div>
  )

  // ---- per-item card -------------------------------------------------------------------------
  function itemCard(it: Item, showUnit: boolean) {
    const d = draftOf(it)
    const ch = decided(it)
    const isOpen = expandAll || openId === it.id
    const locked = !isLive(it)
    const opts = it.options
    const chosen = opts.filter(o => o.key === d.option)[0] || opts[0] || null
    const shown = chosen && chosen.price ? chosen.price * it.qty : it.lineTotal

    return (
      <div key={it.id} className={'border-t border-neutral-100 first:border-t-0 ' + (it.urgent ? 'border-l-2 border-l-rose-400' : '')}>
        <button onClick={() => setOpenId(isOpen ? '' : it.id)} className="w-full text-left px-4 py-3 hover:bg-neutral-50/70">
          <div className="flex flex-wrap items-center gap-2">
            <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (it.tag === 'Replace' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-sky-50 text-sky-800 border-sky-200')}>{it.tag}</span>
            {it.urgent ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-rose-600 text-white border-rose-600">Urgent</span> : null}
            {it.recommendation ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">Recommendation</span> : null}
            <span className="text-sm font-semibold text-neutral-900">{it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
            {showUnit ? <span className="text-[11px] font-semibold text-neutral-500">{it.unit}</span> : null}
            {it.room ? <span className="text-[11px] text-neutral-400">{it.room}</span> : null}
            <span className="ml-auto text-sm font-bold text-neutral-900 tabular-nums">{shown ? money(shown) : <span className="text-[11px] font-semibold text-neutral-300">price to come</span>}</span>
            <span className="text-neutral-300 text-xs">{isOpen ? '▴' : '▾'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {ch ? <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full border ' + (CHOICE_CLS[ch] || '')}>{CHOICE_LABEL[ch]}{ch === 'supply' && it.decision && it.decision.supply ? ' · ' + (SUPPLY_LABEL[it.decision.supply] || '') : ''}</span> : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-brand-50 text-brand-700 border-brand-200">Needs your decision</span>}
            {locked ? <span className="text-[10px] font-semibold text-neutral-400">already ordered</span> : null}
            {it.history && it.history.repairs > 0 ? <span className="text-[11px] text-neutral-500">repaired {it.history.repairs}× already</span> : null}
            {it.review ? <span className="text-[11px] text-amber-700 font-semibold">guest mentioned this</span> : null}
            {it.questions.length ? <span className="text-[11px] text-sky-700 font-semibold">question sent</span> : null}
          </div>
        </button>

        {isOpen ? (
          <div className="px-4 pb-4 space-y-3">
            {it.photos.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {it.photos.map((p, i) => (
                  <a key={i} href={p} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50">
                    <img src={p} alt="" className="w-full max-h-72 object-contain" />
                  </a>
                ))}
              </div>
            ) : null}

            {it.why || it.note ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-0.5">Why we are recommending it</div>
                <div className="text-sm text-neutral-700">{it.why || it.note}</div>
                {it.why && it.note ? <div className="text-[12px] text-neutral-500 mt-1">From the walk: {it.note}</div> : null}
              </div>
            ) : null}

            {it.review ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">What a guest said{it.review.rating ? ' · ' + it.review.rating + '★' : ''}{it.review.date ? ' · ' + it.review.date : ''}</div>
                <div className="text-sm text-amber-900 italic mt-0.5">{it.review.quote}</div>
              </div>
            ) : null}

            <div className="text-[12px] text-neutral-500">
              {ageLabel(it.history)}
              {it.history.repairs > 0 ? ' · repaired ' + it.history.repairs + (it.history.repairs === 1 ? ' time' : ' times') + ' since' : ''}
              {it.qty > 1 ? ' · ' + it.qty + ' needed' : ''}
            </div>

            {opts.length ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-1">Your options</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {opts.map(o => {
                    const on = d.option === o.key
                    return (
                      <div key={o.key} className={'rounded-lg border ' + (on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-neutral-200 bg-white')}>
                        <button disabled={locked} onClick={() => setDraftFor(it.id, { option: o.key })} className="w-full text-left px-3 pt-2 pb-1 disabled:opacity-60">
                          <div className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">{OPT_LABEL[o.key] || o.label}</div>
                          <div className="text-base font-bold text-neutral-900">{o.price ? money(o.price * it.qty) : '—'}</div>
                          {o.price && it.qty > 1 ? <div className="text-[11px] text-neutral-400">{money(o.price)} each</div> : null}
                          {o.note ? <div className="text-[11px] text-neutral-500 mt-0.5">{o.note}</div> : null}
                        </button>
                        {o.link ? <div className="px-3 pb-2"><a href={o.link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-brand-700">view product</a></div> : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {it.doNothing && (it.doNothing.text || it.doNothing.cost) ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-rose-700 font-bold">If we do nothing</div>
                <div className="text-sm text-rose-900 mt-0.5">{it.doNothing.text}</div>
                {it.doNothing.cost ? <div className="text-[12px] font-bold text-rose-800 mt-1">Likely cost later: {money(it.doNothing.cost)}{shown ? ' vs ' + money(shown) + ' now' : ''}</div> : null}
              </div>
            ) : null}

            {it.link && !opts.filter(o => o.link).length ? <a href={it.link} target="_blank" rel="noreferrer" className="inline-block text-[12px] font-semibold text-brand-700">view product</a> : null}

            {/* four-way decision */}
            {locked ? (
              <div className="text-[12px] font-semibold text-neutral-500">This one is already on order - nothing needed from you.</div>
            ) : (
              <div className="space-y-2">
                <div className="no-print flex flex-wrap gap-1.5">
                  <button onClick={() => decide(it, 'approve')} disabled={!!busy} className={'text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 ' + (ch === 'approve' ? 'bg-emerald-600 text-white' : 'border border-emerald-300 text-emerald-800 bg-emerald-50')}>{busy === it.id ? '…' : 'Approve'}</button>
                  <button onClick={() => { setSupplyFor(supplyFor === it.id ? '' : it.id); setDraftFor(it.id, {}) }} disabled={!!busy} className={'text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 ' + (ch === 'supply' ? 'bg-sky-600 text-white' : 'border border-sky-300 text-sky-800 bg-sky-50')}>I will supply it</button>
                  <button onClick={() => decide(it, 'later')} disabled={!!busy} className={'text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 ' + (ch === 'later' ? 'bg-amber-500 text-white' : 'border border-amber-300 text-amber-800 bg-amber-50')}>Not now</button>
                  <button onClick={() => decide(it, 'no')} disabled={!!busy} className={'text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 ' + (ch === 'no' ? 'bg-neutral-700 text-white' : 'border border-neutral-200 text-neutral-500')}>No</button>
                  <button onClick={() => { setAskFor(askFor === it.id ? '' : it.id); setAskText('') }} className="ml-auto text-xs font-semibold px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600">Ask a question</button>
                </div>

                {supplyFor === it.id ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-sky-700 font-bold">You are supplying this - which is it?</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['link', 'self', 'ordered'].map(m => (
                        <button key={m} onClick={() => setDraftFor(it.id, { supply: m })} className={'text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (d.supply === m ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-sky-800 border-sky-300')}>{SUPPLY_LABEL[m]}</button>
                      ))}
                    </div>
                    <input value={d.link} onChange={e => setDraftFor(it.id, { link: e.target.value })} placeholder="Link to the item, if you have one" className="w-full text-sm px-2.5 py-2 rounded-lg border border-sky-200 bg-white" />
                    <input value={d.note} onChange={e => setDraftFor(it.id, { note: e.target.value })} placeholder="Anything we should know (delivery date, who is bringing it…)" className="w-full text-sm px-2.5 py-2 rounded-lg border border-sky-200 bg-white" />
                    <div className="flex items-center gap-2">
                      <button onClick={() => decide(it, 'supply')} disabled={!!busy || !d.supply} className="text-xs font-semibold px-3 py-2 rounded-lg bg-sky-600 text-white disabled:opacity-50">{busy === it.id ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => setSupplyFor('')} className="text-xs font-semibold text-neutral-500">Cancel</button>
                      {!d.supply ? <span className="text-[11px] text-sky-700">Pick one so we know whether to send a link or stand down.</span> : null}
                    </div>
                  </div>
                ) : null}

                {ch === 'supply' && it.decision && supplyFor !== it.id ? (
                  <div className="text-[12px] text-sky-800">{SUPPLY_LABEL[it.decision.supply || ''] || ''}{it.decision.link ? ' · ' + it.decision.link : ''}{it.decision.note ? ' · ' + it.decision.note : ''}</div>
                ) : null}

                {askFor === it.id ? (
                  <div className="no-print rounded-lg border border-neutral-200 bg-white px-3 py-2.5 space-y-2">
                    <textarea value={askText} onChange={e => setAskText(e.target.value)} rows={2} placeholder="What would you like to know about this one?" className="w-full text-sm px-2.5 py-2 rounded-lg border border-neutral-200" />
                    <div className="flex items-center gap-2">
                      <button onClick={() => ask(it)} disabled={!!busy || !askText.trim()} className="text-xs font-semibold px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-50">Send question</button>
                      <button onClick={() => setAskFor('')} className="text-xs font-semibold text-neutral-500">Cancel</button>
                    </div>
                  </div>
                ) : null}

                {it.questions.length ? (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 space-y-1">
                    {it.questions.map((q, i) => <div key={i} className="text-[12px] text-neutral-600"><span className="font-semibold">You asked:</span> {q.q}</div>)}
                    {it.answers.map((a, i) => <div key={'a' + i} className="text-[12px] text-emerald-800"><span className="font-semibold">We replied:</span> {a.a}</div>)}
                    {!it.answers.length ? <div className="text-[11px] text-neutral-400">We will come back to you on this.</div> : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  // ---- BY UNIT -------------------------------------------------------------------------------
  const byUnit: Record<string, Item[]> = {}
  for (const it of items) { if (!byUnit[it.unit]) byUnit[it.unit] = []; byUnit[it.unit].push(it) }
  const unitNames = Object.keys(byUnit).sort()

  // ---- ACROSS THE PROPERTY -------------------------------------------------------------------
  // Identical needs in more than one unit are ONE decision: it ships once and prices better.
  const groups: Record<string, Item[]> = {}
  for (const it of items) {
    if (decided(it) === 'no') continue
    const key = nrm(it.title)
    if (!key) continue
    if (!groups[key]) groups[key] = []
    groups[key].push(it)
  }
  const repeatKeys = Object.keys(groups).filter(g => {
    const seen: Record<string, boolean> = {}
    let n = 0
    for (const it of groups[g]) { if (!seen[it.listingId]) { seen[it.listingId] = true; n++ } }
    return n > 1
  }).sort((a, b) => sum(groups[b]) - sum(groups[a]))
  const oneOffs = Object.keys(groups).filter(g => repeatKeys.indexOf(g) < 0).sort((a, b) => sum(groups[b]) - sum(groups[a]))

  function groupSaving(list: Item[]): number {
    // Honest saving only: if the same item is priced differently across units, ordering them
    // together at the best quoted price is a real, arithmetic saving. If every price matches,
    // there is no number to claim - so we claim none.
    let best = 0
    for (const it of list) { const e = it.est || 0; if (e > 0 && (best === 0 || e < best)) best = e }
    if (!best) return 0
    let full = 0, bulk = 0
    for (const it of list) { const e = it.est || 0; if (!e) continue; full += e * it.qty; bulk += best * it.qty }
    return Math.max(0, Math.round(full - bulk))
  }

  // What we would spend on your behalf: everything still in play minus what you declined and minus
  // what you told us you are supplying yourself.
  const buys = items.filter(it => decided(it) !== 'no' && decided(it) !== 'supply')
  const buysTotal = sum(buys)
  const labourUrgent = labour.filter(l => l.urgent).length

  return (
    <div className="owner-sheet max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Stay Hospitality</div>
          <h1 className="text-xl font-bold text-neutral-900 leading-tight">Owner review{label ? ' — ' + label : ''}</h1>
          <div className="text-xs text-neutral-500 mt-0.5">{unitCount > 1 ? unitCount + ' units · ' : ''}{items.length} item{items.length === 1 ? '' : 's'}. Every line shows why we are recommending it, what the options cost, and what happens if we leave it. Prices are estimates.</div>
        </div>
        <button onClick={printSheet} className="no-print text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-600">Print / PDF</button>
      </div>

      {err ? <div className="mt-3 text-xs font-semibold text-rose-600">{err}</div> : null}

      {/* summary rail */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat('Needs you', String(open.length), openTotal ? money(openTotal) + (openNoPrice ? ' + ' + openNoPrice + ' unpriced' : '') : (openNoPrice ? openNoPrice + ' unpriced' : 'nothing outstanding'), 'border-brand-200 bg-brand-50 text-brand-800')}
        {approved.length ? stat('Approved', money(sum(approved)), approved.length + ' line' + (approved.length === 1 ? '' : 's'), 'border-emerald-200 bg-emerald-50 text-emerald-800') : null}
        {supplying.length ? stat('You supply', String(supplying.length), money(sum(supplying)) + ' off our bill', 'border-sky-200 bg-sky-50 text-sky-800') : null}
        {later.length ? stat('Not now', String(later.length), money(sum(later)) + ' deferred', 'border-amber-200 bg-amber-50 text-amber-800') : null}
        {urgentOpen ? stat('Urgent', String(urgentOpen), 'affecting stays now', 'border-rose-300 bg-rose-50 text-rose-800') : null}
      </div>

      {/* lens toggle */}
      <div className="no-print mt-4 flex items-center gap-1.5">
        <button onClick={() => setView('unit')} className={'text-xs font-semibold px-3 py-1.5 rounded-lg border ' + (view === 'unit' ? 'bg-ink text-white border-ink' : 'border-neutral-200 text-neutral-600')}>By unit</button>
        <button onClick={() => setView('property')} className={'text-xs font-semibold px-3 py-1.5 rounded-lg border ' + (view === 'property' ? 'bg-ink text-white border-ink' : 'border-neutral-200 text-neutral-600')}>Across the property</button>
      </div>

      {items.length === 0 ? <div className="mt-6 text-sm text-neutral-500">Nothing needs your review right now.</div> : null}

      {view === 'unit' ? (
        <div className="mt-4 space-y-4">
          {unitNames.map(u => {
            const list = byUnit[u]
            const uOpen = list.filter(it => isLive(it) && !decided(it))
            return (
              <div key={u} className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
                <div className="px-4 py-2.5 border-b border-neutral-200 flex items-center gap-2">
                  <span className="text-sm font-bold text-neutral-900">{u}</span>
                  {uOpen.length ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">{uOpen.length} to decide</span> : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">all reviewed</span>}
                  <span className="ml-auto text-sm font-bold text-neutral-900 tabular-nums">{money(sum(list.filter(it => decided(it) !== 'no')))}</span>
                </div>
                <div>{list.map(it => itemCard(it, false))}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">Whole property</div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mt-1">
              <div>
                <div className="text-2xl font-bold text-neutral-900">{money(buysTotal)}</div>
                <div className="text-[11px] text-neutral-500">things to buy · {buys.length} lines{supplying.length ? ' · ' + supplying.length + ' you are supplying' : ''}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-neutral-900">{labour.length}</div>
                <div className="text-[11px] text-neutral-500">fix and clean jobs · handled by our team, no charge to you{labourUrgent ? ' · ' + labourUrgent + ' urgent' : ''}</div>
              </div>
            </div>
          </div>

          {repeatKeys.length ? (
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-neutral-200">
                <div className="text-sm font-bold text-neutral-900">The same thing in more than one unit</div>
                <div className="text-[11px] text-neutral-500">One decision each. We order once, it ships once, and it prices better.</div>
              </div>
              <div className="divide-y divide-neutral-100">
                {repeatKeys.map(g => {
                  const list = groups[g]
                  const units: string[] = []
                  for (const it of list) { if (units.indexOf(it.unit) < 0) units.push(it.unit) }
                  const qty = list.reduce((n, it) => n + it.qty, 0)
                  const total = sum(list)
                  const save = groupSaving(list)
                  const pending = list.filter(it => isLive(it) && !decided(it))
                  return (
                    <div key={g} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-neutral-900">{list[0].title}</span>
                        <span className="text-[11px] font-semibold text-neutral-500">{qty} across {units.length} units</span>
                        <span className="ml-auto text-sm font-bold text-neutral-900 tabular-nums">{total ? money(total) : '—'}</span>
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">{units.join(' · ')}</div>
                      {save > 0 ? <div className="text-[11px] font-semibold text-emerald-700 mt-0.5">Ordering these together at the best quoted price saves about {money(save)}.</div> : <div className="text-[11px] text-neutral-400 mt-0.5">One order, one delivery.</div>}
                      {pending.length ? (
                        <div className="no-print flex flex-wrap gap-1.5 mt-2">
                          <button onClick={() => decideGroup(pending, 'approve', g)} disabled={!!groupBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{groupBusy === g ? 'Saving…' : 'Approve all ' + pending.length}</button>
                          <button onClick={() => decideGroup(pending, 'later', g)} disabled={!!groupBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-800 bg-amber-50 disabled:opacity-50">Not now</button>
                          <button onClick={() => decideGroup(pending, 'no', g)} disabled={!!groupBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-500 disabled:opacity-50">No</button>
                          <button onClick={() => { setView('unit'); setOpenId(pending[0].id) }} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-600">See each one</button>
                        </div>
                      ) : <div className="text-[11px] font-semibold text-emerald-700 mt-1">All reviewed ✓</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {oneOffs.length ? (
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-neutral-200 text-sm font-bold text-neutral-900">One-offs</div>
              <div className="divide-y divide-neutral-100">
                {oneOffs.map(g => {
                  const it = groups[g][0]
                  return (
                    <button key={g} onClick={() => { setView('unit'); setOpenId(it.id) }} className="w-full text-left px-4 py-2.5 hover:bg-neutral-50 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-neutral-900">{it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
                      <span className="text-[11px] text-neutral-500">{it.unit}</span>
                      {decided(it) ? <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full border ' + (CHOICE_CLS[decided(it)] || '')}>{CHOICE_LABEL[decided(it)]}</span> : null}
                      <span className="ml-auto text-sm font-bold text-neutral-900 tabular-nums">{it.lineTotal ? money(it.lineTotal) : '—'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {labour.length ? (
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-neutral-200">
                <div className="text-sm font-bold text-neutral-900">Work we are handling</div>
                <div className="text-[11px] text-neutral-500">Fixes and deep cleans from the same walk. Labour, not purchases - nothing to decide.</div>
              </div>
              <div className="divide-y divide-neutral-100">
                {labour.slice(0, 60).map((l, i) => (
                  <div key={i} className="px-4 py-2 flex flex-wrap items-center gap-2">
                    <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (l.kind === 'Clean' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-amber-50 text-amber-800 border-amber-200')}>{l.kind}</span>
                    <span className="text-sm text-neutral-800">{l.title}</span>
                    <span className="text-[11px] text-neutral-500">{l.unit}{l.room ? ' · ' + l.room : ''}</span>
                    {l.urgent ? <span className="text-[10px] font-bold text-rose-600">urgent</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {declined.length ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5">
          <div className="text-[11px] font-bold text-neutral-500">Not moving forward ({declined.length})</div>
          <div className="text-[11px] text-neutral-400">{declined.map(it => it.title + ' (' + it.unit + ')').join(' · ')}</div>
        </div>
      ) : null}

      <div className="mt-6 text-[11px] text-neutral-400">Questions on anything here? Use Ask a question on the line itself so your question stays attached to it, or reply to your Stay Hospitality contact. Decisions post straight to our purchasing queue.</div>
    </div>
  )
}
