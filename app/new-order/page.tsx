'use client'
// FIELD ORDER REQUEST — the open link the team uses to report what a unit needs.
//
// Built for a phone held one-handed in a doorway: building, unit, what is needed, photo, send.
// Nothing to log into, nothing to read, no way to see anyone else's data. Each send lands on the
// order desk as a normal order line, so it is priced, approved and bought like everything else.
//
// It stays on the form after sending because the person is usually standing in the same unit with a
// second thing to report, and every send produces a RECEIPT they can copy into Slack — so the crew
// has proof they reported it and the office has a reference to search, instead of "I told someone".
import { useEffect, useRef, useState } from 'react'

type Unit = { id: string; name: string; building: string }
type Receipt = { ref: string; text: string }

// ORDER is the umbrella for anything that COSTS MONEY; picking it reveals which kind of buy it is.
// Fix and Clean are team work with nothing to purchase, so they sit ALONGSIDE Order, not under it.
// Replace is preselected, so the common case is still zero extra taps.
const BUYS: { k: string; label: string; hint: string }[] = [
  { k: 'replace', label: 'Replace', hint: 'it is here but worn out, broken or wrong' },
  { k: 'add', label: 'Add', hint: 'the unit does not have it, or needs more of them' },
]
const WORK: { k: string; label: string; hint: string }[] = [
  { k: 'maintenance', label: 'Fix', hint: 'it needs repairing, nothing to buy' },
  { k: 'clean', label: 'Clean', hint: 'a cleanliness problem — stain, smell, left dirty' },
]
const KINDS = BUYS.concat(WORK)
const kindLabel = (k: string) => (KINDS.find(x => x.k === k) || BUYS[0]).label
const isBuy = (k: string) => BUYS.some(x => x.k === k)

export default function NewOrderPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [buildings, setBuildings] = useState<string[]>([])
  const [bldg, setBldg] = useState('')
  const [unitId, setUnitId] = useState('')
  const [kind, setKind] = useState('replace')
  const [title, setTitle] = useState('')
  const [room, setRoom] = useState('')
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [who, setWho] = useState('')
  const [sev, setSev] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [upBusy, setUpBusy] = useState(false)
  const [err, setErr] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [copied, setCopied] = useState(false)
  const camRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fetch('/api/orders/request').then(r => r.json()).then(j => {
      if (j && j.ok) { setUnits(j.units || []); setBuildings(j.buildings || []) }
      else setErr('Could not load the unit list — reload to retry.')
    }).catch(() => setErr('Network error — reload to retry.'))
    // The name field starts EMPTY, deliberately. This is a shared link — cleaners, vendors and
    // office staff all open it, often on the same phone or tablet. Remembering the last person's
    // name would quietly file the next report under the wrong human, and attribution is the whole
    // point of asking. Everyone types their own name, every time.
  }, [])

  // Photos upload against the unit's audit share code, so pick the unit first and fetch the code.
  useEffect(() => {
    setCode('')
    if (!unitId) return
    fetch('/api/orders/request', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: unitId }) })
      .then(r => r.json()).then(j => { if (j && j.ok) setCode(j.code) }).catch(() => {})
  }, [unitId])

  const mine = units.filter(u => !bldg || u.building === bldg)
  const unit = units.find(u => u.id === unitId) || null

  async function onPhoto(e: any) {
    const f = e.target.files && e.target.files[0]
    if (!f || !code) return
    setUpBusy(true)
    try {
      const fd = new FormData(); fd.append('code', code); fd.append('file', f); fd.append('noai', '1')
      const r = await fetch('/api/audit/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (j && j.url) setPhotos(p => p.concat([String(j.url)]).slice(0, 4))
    } catch {}
    setUpBusy(false)
  }

  async function send() {
    if (busy) return
    if (!unitId) { setErr('Pick the unit first.'); return }
    if (!title.trim()) { setErr('Say what is needed.'); return }
    setBusy(true); setErr(''); setReceipt(null); setCopied(false)
    try {
      const r = await fetch('/api/orders/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: unitId, kind, title, room, qty: Number(qty) || 1, note, requestedBy: who, severity: sev, photos }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) setErr(j.error || 'Could not send it — retry.')
      else {
        // Plain text on purpose: it has to survive a paste into Slack, WhatsApp or a text message
        // with no formatting, and still read cleanly to whoever picks it up.
        const ref = String(j.ref || '').toUpperCase()
        const lines = [
          (isBuy(kind) ? 'ORDER REQUEST ' : 'WORK REQUEST ') + ref,
          'Unit: ' + (unit ? unit.name : '') + (unit && unit.building ? ' (' + unit.building + ')' : ''),
          'Need: ' + (isBuy(kind) ? 'Order · ' : '') + kindLabel(kind) + ' — ' + title + (Number(qty) > 1 ? ' ×' + Number(qty) : ''),
        ]
        if (room.trim()) lines.push('Room: ' + room.trim())
        if (sev === 'high') lines.push('Priority: URGENT — guest affected')
        if (note.trim()) lines.push('Notes: ' + note.trim())
        if (photos.length) lines.push('Photos: ' + photos.join(' '))
        lines.push('Reported by: ' + (who.trim() || 'not given') + ' · ' + new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))
        lines.push('On the Stay order desk now.')
        setReceipt({ ref, text: lines.join('\n') })
        setTitle(''); setRoom(''); setQty('1'); setNote(''); setSev(''); setPhotos([])
      }
    } catch { setErr('Network error — retry.') }
    setBusy(false)
  }

  async function copyReceipt() {
    if (!receipt) return
    try { await navigator.clipboard.writeText(receipt.text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setErr('Could not copy automatically — select the text above and copy it.') }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-md px-4 py-5">
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-400 font-semibold">Stay Hospitality</div>
          <h1 className="text-2xl font-bold text-neutral-900 mt-0.5">Report what a unit needs</h1>
          <p className="text-[13px] text-neutral-500 mt-1">Broken, worn out or missing &mdash; tell us here and it goes straight to the order desk. One thing per send.</p>
        </div>

        {receipt ? (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-emerald-900">Sent &middot; {receipt.ref}</span>
              <div className="flex-1" />
              <button onClick={copyReceipt} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white">{copied ? 'Copied ✓' : 'Copy receipt'}</button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-snug text-emerald-900 bg-white rounded-lg border border-emerald-100 p-2 font-sans">{receipt.text}</pre>
            <div className="mt-1.5 text-[11px] text-emerald-600">Paste it into Slack so the team has a record. Spotted more? Add it below.</div>
          </div>
        ) : null}
        {err ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-medium text-rose-700">{err}</div> : null}

        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">Where</div>
            <select value={bldg} onChange={e => { setBldg(e.target.value); setUnitId('') }} className="w-full text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2.5 bg-white">
              <option value="">All buildings</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={unitId} onChange={e => setUnitId(e.target.value)} className="mt-2 w-full text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2.5 bg-white">
              <option value="">{units.length ? 'Pick the unit…' : 'Loading units…'}</option>
              {mine.map(u => <option key={u.id} value={u.id}>{u.name}{bldg ? '' : ' — ' + u.building}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">What</div>
            <div className="flex gap-1.5">
              <button onClick={() => { if (!isBuy(kind)) setKind('replace') }} className={'flex-1 text-[13px] font-semibold px-2 py-2 rounded-lg border ' + (isBuy(kind) ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200')}>Order</button>
              {WORK.map(k => (
                <button key={k.k} onClick={() => setKind(k.k)} className={'flex-1 text-[13px] font-semibold px-2 py-2 rounded-lg border ' + (kind === k.k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200')}>{k.label}</button>
              ))}
            </div>
            {isBuy(kind) ? (
              <div className="flex gap-1.5 mt-1.5 pl-3 border-l-2 border-neutral-900">
                {BUYS.map(k => (
                  <button key={k.k} onClick={() => setKind(k.k)} className={'flex-1 text-[13px] font-semibold px-2 py-1.5 rounded-lg border ' + (kind === k.k ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-neutral-600 border-neutral-200')}>{k.label}</button>
                ))}
              </div>
            ) : null}
            <div className="mt-1 text-[11px] text-neutral-400">{(KINDS.find(k => k.k === kind) || BUYS[0]).hint}</div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What is it? e.g. King mattress, shower curtain rod" className="mt-2 w-full text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2.5" />
            <div className="mt-2 flex gap-2">
              <input value={room} onChange={e => setRoom(e.target.value)} placeholder="Which room?" className="flex-1 text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2.5" />
              <input value={qty} onChange={e => setQty(e.target.value)} inputMode="numeric" placeholder="Qty" className="w-20 text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2.5" />
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Anything the office should know — size, colour, how bad it is" className="mt-2 w-full text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2" />
            <div className="mt-2 flex gap-1.5">
              {[['', 'Normal'], ['high', 'Urgent — guest affected']].map(([v, l]) => (
                <button key={v} onClick={() => setSev(v)} className={'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (sev === v ? (v ? 'bg-rose-600 text-white border-rose-600' : 'bg-neutral-900 text-white border-neutral-900') : 'bg-white text-neutral-500 border-neutral-200')}>{l}</button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">Photo <span className="normal-case tracking-normal font-normal text-neutral-400">&mdash; a picture saves a phone call</span></div>
            <div className="flex items-center gap-2 flex-wrap">
              {photos.map((p, i) => <img key={i} src={p} alt="" className="h-14 w-14 rounded-lg object-cover" />)}
              <button onClick={() => { if (camRef.current) { camRef.current.value = ''; camRef.current.click() } }} disabled={!code || upBusy || photos.length >= 4}
                className="h-14 w-14 rounded-lg border border-dashed border-neutral-300 text-neutral-400 text-xl disabled:opacity-40">{upBusy ? '…' : '+'}</button>
              {!unitId ? <span className="text-[11px] text-neutral-400">pick the unit first</span> : null}
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">Who is reporting it</div>
            <input value={who} onChange={e => setWho(e.target.value)} placeholder="Your name" className="w-full text-[15px] rounded-lg border border-neutral-200 px-2.5 py-2.5" />
          </div>

          <button onClick={send} disabled={busy || !unitId || !title.trim()} className="w-full rounded-xl bg-emerald-600 text-white text-[15px] font-bold py-3.5 disabled:opacity-40">{busy ? 'Sending…' : 'Send to the order desk'}</button>
          <div className="text-center text-[10px] text-neutral-300 pt-2 pb-6">Stay Hospitality &middot; requests reach the office immediately</div>
        </div>
      </div>
    </div>
  )
}
