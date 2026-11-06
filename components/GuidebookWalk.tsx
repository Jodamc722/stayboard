'use client'
// GUIDEBOOK WALK — Admin desk › Guidebooks (Jon, 2026-11-06: "admin should have guidebook review and
// approve, go through it one by one without having to click into it: approve, then approve guest one,
// then next unit, one by one by property" … "have a way to mark need to fix and add note").
//
// Property by property (Surfside, then Salato, then A–Z), unit by unit:
//   STEP 1  the printed manual on screen → Approve printable
//   STEP 2  the guest guide in a phone frame → Approve guest & push to Guesty → the next unit opens
// At any point: Needs fix + a note (goes back to the team, shown in the queue), Skip, or Edit in a new tab.
// "Run unit check" runs the photo check (collages, text, maps as page photos) on every unchecked book of
// the property, three at a time, and refreshes the flags.
import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, Loader2, Pencil, Printer, Smartphone, SkipForward, Wrench, ShieldCheck, Images, ArrowLeft } from 'lucide-react'

type Flag = { level: 'block' | 'ask' | 'tidy'; page: string; text: string }
type Item = { id: string; building: string; unit: string; name: string; stage: 'draft' | 'approved' | 'live'; flags: Flag[]; printOk: boolean; needsFix: { note: string; at: string; by: string } | null; note: string; photosChecked: boolean; pushError: string }

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-50'
const go = 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50'

export function GuidebookWalk() {
  const [items, setItems] = useState<Item[]>([])
  const [missing, setMissing] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [prop, setProp] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [cur, setCur] = useState('')
  const [step, setStep] = useState<'print' | 'guest'>('print')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [fixOpen, setFixOpen] = useState(false)
  const [fixNote, setFixNote] = useState('')
  const [check, setCheck] = useState<{ done: number; total: number; swapped: number } | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])

  async function load(keep = true) {
    try {
      const r = await fetch('/api/guidebook/review', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
      setItems(j.items || []); setMissing(j.missing || {})
      if (!keep) setProp(p => p || ((j.items || []).find((x: Item) => x.stage !== 'live')?.building || ''))
    } catch (e: any) { setErr(String(e.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const props = useMemo(() => {
    const m: { name: string; total: number; open: number; fix: number }[] = []
    for (const it of items) {
      let p = m.find(x => x.name === it.building)
      if (!p) { p = { name: it.building, total: 0, open: 0, fix: 0 }; m.push(p) }
      p.total++; if (it.stage !== 'live') p.open++; if (it.needsFix) p.fix++
    }
    return m
  }, [items])
  const inProp = items.filter(x => x.building === prop)
  const queue = inProp.filter(x => showDone || (x.stage !== 'live' && !x.needsFix && skipped.indexOf(x.id) < 0))
  const item = items.find(x => x.id === cur) || queue[0] || null
  useEffect(() => { if (item && item.id !== cur) { setCur(item.id); setStep(item.printOk ? 'guest' : 'print'); setFixOpen(false); setFixNote(item.needsFix?.note || '') } }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: any) {
    const r = await fetch('/api/guidebook/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
    return j
  }
  const patch = (id: string, p: Partial<Item>) => setItems(xs => xs.map(x => (x.id === id ? { ...x, ...p } : x)))
  const nextAfter = (id: string) => {
    const q = inProp.filter(x => x.id !== id && x.stage !== 'live' && !x.needsFix && skipped.indexOf(x.id) < 0)
    const i = inProp.findIndex(x => x.id === id)
    return q.find(x => inProp.indexOf(x) > i) || q[0] || null
  }
  const advance = (id: string) => {
    const n = nextAfter(id)
    if (n) { setCur(n.id); setStep(n.printOk ? 'guest' : 'print') }
    else {
      setCur('')
      const np = props.find(p => p.name !== prop && items.some(x => x.building === p.name && x.stage !== 'live' && !x.needsFix))
      setMsg('All of ' + prop + ' is done.' + (np ? ' Next property: ' + np.name + '.' : ''))
      if (np) setProp(np.name)
    }
  }

  async function approvePrint() {
    if (!item) return
    setBusy('print'); setMsg('')
    try { await post({ id: item.id, action: 'page', page: 'print', ok: true }); patch(item.id, { printOk: true }); setStep('guest') } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  async function approveGuest() {
    if (!item) return
    const blocks = item.flags.filter(f => f.level === 'block').length
    if (blocks && !window.confirm(blocks + ' missing item' + (blocks === 1 ? ' is' : 's are') + ' still flagged on ' + item.unit + '. Approve and push to Guesty anyway?')) return
    setBusy('guest'); setMsg('')
    try {
      const j = await post({ id: item.id, action: 'approve' })
      patch(item.id, { stage: j.status, pushError: j.pushError || '', needsFix: null })
      setMsg(j.pushed ? item.unit + ' approved and pushed to Guesty.' : item.unit + ' approved — the Guesty push failed (' + (j.pushError || 'unknown') + '). It stays in the list to retry.')
      if (j.pushed) advance(item.id)
    } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  async function markFix() {
    if (!item) return
    if (!fixNote.trim()) { setMsg('Add a note saying what needs fixing.'); return }
    setBusy('fix')
    try {
      await post({ id: item.id, action: 'fix', note: fixNote.trim() })
      patch(item.id, { needsFix: { note: fixNote.trim(), at: new Date().toISOString(), by: '' }, stage: 'draft' })
      setMsg(item.unit + ' marked "needs fix".'); setFixOpen(false); advance(item.id)
    } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  async function clearFix(it: Item) {
    try { await post({ id: it.id, action: 'fix', clear: true }); patch(it.id, { needsFix: null }); setCur(it.id) } catch (e: any) { setMsg(String(e.message || e)) }
  }
  async function unitCheck() {
    const ids = inProp.filter(x => !x.photosChecked).map(x => x.id)
    if (!ids.length) { setMsg('Every book in ' + prop + ' has had its unit check.'); return }
    setCheck({ done: 0, total: ids.length, swapped: 0 })
    let i = 0
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++]
        try { const j = await post({ id, action: 'photos' }); setCheck(c => c && { ...c, swapped: c.swapped + ((j.swapped || []).length) }) } catch { /* counted as done; flags show it */ }
        setCheck(c => c && { ...c, done: c.done + 1 })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    await load()
    setMsg('Unit check finished for ' + prop + '.')
    setCheck(null)
  }

  if (loading) return <p className="py-8 text-sm text-muted">Loading guidebooks…</p>
  if (err) return <p className="py-8 text-sm text-rose-700">Could not load: {err}</p>

  const fixes = inProp.filter(x => x.needsFix)
  const blocks = item ? item.flags.filter(f => f.level !== 'tidy') : []

  return (
    <div className="space-y-3">
      {/* PROPERTIES */}
      <div className="flex flex-wrap items-center gap-1.5">
        {props.map(p => (
          <button key={p.name} onClick={() => { setProp(p.name); setCur(''); setMsg('') }} className={'rounded-lg px-2.5 py-1 text-[12px] font-semibold ' + (prop === p.name ? 'bg-ink text-white' : 'border border-line bg-white text-ink')}>
            {p.name} <span className="opacity-70 tabular-nums">{p.open ? p.open + ' left' : '✓'}</span>{p.fix ? <span className="ml-1 rounded bg-rose-500 px-1 text-[10px] text-white">{p.fix} fix</span> : null}
          </button>
        ))}
      </div>

      {prop ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px]">
          <b className="text-ink">{prop}</b>
          <span className="text-muted">{inProp.filter(x => x.stage === 'live').length}/{inProp.length} live in Guesty{missing[prop] ? ' · ' + missing[prop] + ' unit' + (missing[prop] === 1 ? '' : 's') + ' with no book' : ''}</span>
          <span className="flex-1" />
          {check ? <span className="inline-flex items-center gap-1 text-muted"><Loader2 size={13} className="animate-spin" /> Unit check {check.done}/{check.total} · {check.swapped} photo{check.swapped === 1 ? '' : 's'} replaced</span>
            : <button onClick={unitCheck} className={btn} title="Photo check on every unchecked book in this property: collages, photos with text and maps used as page photos are replaced"><Images size={13} /> Run unit check{inProp.some(x => !x.photosChecked) ? ' (' + inProp.filter(x => !x.photosChecked).length + ')' : ''}</button>}
          {missing[prop] ? <a href={'/guidebooks/bulk?building=' + encodeURIComponent(prop)} className={btn}>Create {missing[prop]} missing</a> : null}
          <label className="inline-flex items-center gap-1 text-muted"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show approved</label>
        </div>
      ) : null}

      {msg ? <p className="rounded-lg bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900 ring-1 ring-sky-200">{msg}</p> : null}

      {fixes.length ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Needs fix · {fixes.length}</p>
          <ul className="mt-1 space-y-1">
            {fixes.map(f => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <b>{f.unit}</b><span className="flex-1 text-rose-900">{f.needsFix?.note}</span>
                <a href={'/guidebooks/' + f.id} target="_blank" rel="noreferrer" className="font-semibold underline">Edit</a>
                <button onClick={() => clearFix(f)} className="font-semibold underline">Fixed — review again</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!item ? (
        <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">{prop ? 'Nothing left to review in ' + prop + '.' : 'Pick a property.'}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="rounded-xl border border-line bg-white p-3">
            {/* UNIT + STEPS */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-bold text-ink">{item.unit}</p>
                <p className="truncate text-[12px] text-muted">{item.name} · {queue.findIndex(x => x.id === item.id) + 1} of {queue.length} in {prop}</p>
              </div>
              <div className="flex overflow-hidden rounded-lg border border-line text-[12px] font-semibold">
                <button onClick={() => setStep('print')} className={'inline-flex items-center gap-1 px-3 py-1.5 ' + (step === 'print' ? 'bg-ink text-white' : 'bg-white text-ink')}>{item.printOk ? <Check size={13} /> : <Printer size={13} />} 1 · Printable</button>
                <button onClick={() => setStep('guest')} className={'inline-flex items-center gap-1 px-3 py-1.5 ' + (step === 'guest' ? 'bg-ink text-white' : 'bg-white text-ink')}>{item.stage === 'live' ? <Check size={13} /> : <Smartphone size={13} />} 2 · Guest guide</button>
              </div>
            </div>
            {step === 'print'
              ? <iframe key={'p' + item.id} src={'/g/' + item.id + '?printview=1'} className="h-[72vh] w-full rounded-lg border border-line bg-white" title="Printable" />
              : <div className="flex justify-center"><div className="rounded-[32px] border-[9px] border-neutral-900 bg-neutral-900 shadow-lg"><iframe key={'g' + item.id} src={'/g/' + item.id} className="h-[70vh] max-h-[760px] w-[380px] max-w-[84vw] rounded-[22px] bg-white" title="Guest guide" /></div></div>}
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-line bg-white p-3">
              {step === 'print'
                ? <button onClick={approvePrint} disabled={!!busy} className={go + ' w-full justify-center'}>{busy === 'print' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve printable → guest guide</button>
                : <button onClick={approveGuest} disabled={!!busy} className={go + ' w-full justify-center'}>{busy === 'guest' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Approve guest &amp; push to Guesty → next unit</button>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => setFixOpen(o => !o)} className={btn + (fixOpen ? ' !border-rose-400 !text-rose-700' : '')}><Wrench size={13} /> Needs fix</button>
                <button onClick={() => { setSkipped(s => s.concat(item.id)); advance(item.id) }} className={btn}><SkipForward size={13} /> Skip</button>
                <a href={'/guidebooks/' + item.id} target="_blank" rel="noreferrer" className={btn}><Pencil size={13} /> Edit</a>
                <a href={'/guidebooks/review/' + item.id} target="_blank" rel="noreferrer" className={btn}><ExternalLink size={13} /> Page by page</a>
              </div>
              {fixOpen ? (
                <div className="mt-2">
                  <textarea autoFocus value={fixNote} onChange={e => setFixNote(e.target.value)} rows={3} placeholder="What needs fixing? e.g. parking says garage — it's the side lot, spot 4" className="w-full rounded-lg border border-rose-300 p-2 text-[13px]" />
                  <button onClick={markFix} disabled={!!busy} className="mt-1 w-full rounded-lg bg-rose-600 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">{busy === 'fix' ? 'Saving…' : 'Mark needs fix → next unit'}</button>
                </div>
              ) : null}
              {item.pushError ? <p className="mt-2 text-[12px] text-rose-700">Last Guesty push failed: {item.pushError}</p> : null}
            </div>

            <div className="rounded-xl border border-line bg-white p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Check before approving · {blocks.length}</p>
              <ul className="mt-1.5 space-y-1.5 text-[12.5px] leading-snug">
                {blocks.length ? blocks.map((f, i) => <li key={i} className={'rounded-lg px-2.5 py-1.5 ' + (f.level === 'block' ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900')}><b className="mr-1">{f.level === 'block' ? 'Missing:' : 'Confirm:'}</b>{f.text}</li>) : <li className="text-emerald-700">Nothing missing or assumed.</li>}
              </ul>
              {!item.photosChecked ? <p className="mt-2 text-[11.5px] text-muted">Photos not checked yet — Run unit check above.</p> : null}
            </div>
          </aside>
        </div>
      )}
      <p className="text-[11.5px] text-muted"><ArrowLeft size={11} className="inline" /> The full queue with every flag lives at <a href="/guidebooks/review" className="underline">Guidebooks › Review &amp; approve</a>.</p>
    </div>
  )
}
