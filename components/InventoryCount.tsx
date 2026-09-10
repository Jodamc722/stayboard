'use client'
// THE COUNTING SHEET — what somebody standing in a storeroom sees on their phone.
//
// Jon, 2026-09-10: "should be easier to count… they add a count of each item and overwrites what we
// have in stock, it should show who did the count." And: "make it simple, easy and not complicated."
//
// So there is nothing on this page but the job: your name, which storeroom you are in, and a number
// next to each thing. No login, no ops chrome, no settings. Three decisions made deliberately:
//
//   · A BLANK IS NOT A ZERO. Untouched rows are left exactly as they are, so counting half a shelf
//     is a normal thing to do rather than a way to wipe the other half. Typing a real 0 is how you
//     say "there are none" — and the row says so back to you.
//   · THE OLD NUMBER IS SHOWN, NOT PREFILLED. Prefilling gets you the old number confirmed back;
//     an empty box gets you a count. But hiding what we thought we had makes a typo invisible, so
//     it sits next to the box, quietly, and a big swing is flagged before submitting.
//   · NOTHING IS SAVED UNTIL SUBMIT. One press, one record, one line in the log.
import { useCallback, useEffect, useMemo, useState } from 'react'

type Shelf = { scope: string; label: string; items: number }
type Item = { id: string; name: string; category: string; size: string | null; unit: string | null; image: string | null; onHand: number; lowAt: number; countedAt: string | null; countedBy: string | null }
type Line = { itemId: string; name: string; before: number; after: number; delta: number }

const ink = '#1B1A17'
const accent = '#1F5C46'
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const field = 'w-full rounded-2xl border border-neutral-300 px-4 py-3 text-[16px] bg-white focus:outline-none focus:ring-2 focus:ring-black/10'

export function InventoryCount({ code }: { code: string }) {
  const [pass, setPass] = useState('')
  const [needsPass, setNeedsPass] = useState(false)
  const [label, setLabel] = useState('Stock count')
  const [shelves, setShelves] = useState<Shelf[] | null>(null)
  const [scope, setScope] = useState('')
  const [shelfLabel, setShelfLabel] = useState('')
  const [items, setItems] = useState<Item[] | null>(null)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [counter, setCounter] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ counted: number; changed: number; by: string; lines: Line[] } | null>(null)
  const [review, setReview] = useState(false)

  const load = useCallback(async (sc: string, p: string) => {
    setErr('')
    try {
      const q = '/api/public/inventory-count?code=' + encodeURIComponent(code) + (p ? '&pass=' + encodeURIComponent(p) : '') + (sc ? '&scope=' + encodeURIComponent(sc) : '')
      const j = await fetch(q, { cache: 'no-store' }).then(r => r.json())
      if (j?.needsPasscode) { setNeedsPass(true); setLabel(j.label || 'Stock count'); return }
      if (!j?.ok) { setErr(j?.error || 'Could not load this sheet.'); return }
      setNeedsPass(false); setLabel(j.label || 'Stock count')
      if (sc) { setItems(j.items || []); setShelfLabel(j.shelf || '') } else { setShelves(j.shelves || []) }
    } catch { setErr('No connection — check signal and try again.') }
  }, [code])

  useEffect(() => { load('', '') }, [load])

  const typed = useMemo(() => Object.entries(counts).filter(([, v]) => v !== '' && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0), [counts])
  const lines: Line[] = useMemo(() => typed.map(([id, v]) => {
    const it = (items || []).find(i => i.id === id)!
    const after = Math.floor(Number(v))
    return { itemId: id, name: it ? it.name : '', before: it ? it.onHand : 0, after, delta: after - (it ? it.onHand : 0) }
  }).filter(l => l.name), [typed, items])
  const big = lines.filter(l => Math.abs(l.delta) >= 10 || (l.before > 0 && l.after === 0))

  async function submit() {
    if (busy || !lines.length) return
    if (!counter.trim()) { setErr('Please put your name on the count.'); return }
    setBusy(true); setErr('')
    try {
      const j = await fetch('/api/public/inventory-count', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, pass, scope, counter, note, counts: lines.map(l => ({ itemId: l.itemId, count: l.after })) }) }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not save the count.'); setBusy(false); return }
      setDone({ counted: j.counted, changed: j.changed, by: j.by, lines: j.lines || [] })
      setReview(false); setCounts({})
    } catch { setErr('No connection — the count was not saved. Try again.') }
    setBusy(false)
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#FBF7F0 0%,#F6F1E8 100%)', color: ink, fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <div className="max-w-lg mx-auto px-5 pb-40 pt-8">{children}</div>
    </div>
  )

  // ── passcode ────────────────────────────────────────────────────────────────────────────────
  if (needsPass) return shell(
    <div className="pt-16">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">Stay Hospitality</div>
      <h1 className="text-[30px] mt-3" style={serif}>{label}</h1>
      <p className="text-[15px] text-neutral-600 mt-2">Enter the passcode to start counting.</p>
      <input value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load('', pass) }} placeholder="Passcode" className={field + ' mt-5'} autoFocus />
      {err ? <div className="mt-3 text-[13px] text-rose-700">{err}</div> : null}
      <button onClick={() => load('', pass)} className="mt-4 w-full h-14 rounded-2xl text-white text-[16px] font-semibold" style={{ background: accent }}>Start</button>
    </div>)

  // ── the receipt ─────────────────────────────────────────────────────────────────────────────
  if (done) return shell(
    <div className="pt-12">
      <div className="rounded-3xl bg-white shadow-[0_20px_50px_-24px_rgba(27,26,23,.35)] p-7">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ background: '#E9F4EE' }}>✅</div>
        <h1 className="text-[26px] leading-tight mt-4 text-center" style={serif}>Count saved.</h1>
        <p className="text-[15px] text-neutral-600 mt-2 text-center">
          {done.counted} item{done.counted === 1 ? '' : 's'} counted on <b className="text-neutral-900">{shelfLabel}</b>{done.changed ? <>, {done.changed} of them changed</> : <>, nothing had moved</>}. Recorded against <b className="text-neutral-900">{done.by}</b>.
        </p>
        {done.lines.filter(l => l.delta !== 0).length ? (
          <div className="mt-5 rounded-2xl border border-neutral-200/80 divide-y divide-neutral-100">
            {done.lines.filter(l => l.delta !== 0).map(l => (
              <div key={l.itemId} className="flex justify-between items-baseline px-4 py-2.5 text-[14px]">
                <span>{l.name}</span>
                <span className="tabular-nums text-neutral-500">{l.before} → <b className={'text-[15px] ' + (l.delta < 0 ? 'text-neutral-900' : 'text-emerald-700')}>{l.after}</b></span>
              </div>
            ))}
          </div>
        ) : null}
        <button onClick={() => { setDone(null); setItems(null); setScope(''); setShelfLabel(''); load('', pass) }} className="mt-6 w-full h-12 rounded-2xl text-[15px] font-semibold border border-neutral-300">Count another shelf</button>
      </div>
    </div>)

  // ── pick a shelf ────────────────────────────────────────────────────────────────────────────
  if (!scope) return shell(<>
    <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">Stay Hospitality</div>
    <h1 className="text-[32px] leading-tight mt-3" style={serif}>{label}</h1>
    <p className="text-[15px] text-neutral-600 mt-2">Which storeroom are you standing in?</p>
    {err ? <div className="mt-4 rounded-2xl bg-rose-50 text-rose-800 px-4 py-3 text-[14px]">{err}</div> : null}
    <div className="mt-5 space-y-2.5">
      {(shelves || []).filter(s => s.items > 0).map(s => (
        <button key={s.scope} onClick={() => { setScope(s.scope); setItems(null); load(s.scope, pass) }}
          className="w-full text-left rounded-2xl bg-white border border-neutral-200/70 px-5 py-4 active:scale-[.99] transition shadow-[0_8px_24px_-18px_rgba(27,26,23,.35)]">
          <div className="text-[18px] font-semibold">{s.label}</div>
          <div className="text-[13px] text-neutral-500 mt-0.5">{s.items} item{s.items === 1 ? '' : 's'} to count</div>
        </button>
      ))}
      {shelves && !shelves.some(s => s.items > 0) ? <div className="text-[14px] text-neutral-600">No shelf has anything set up to count yet.</div> : null}
      {!shelves && !err ? <div className="text-[14px] text-neutral-500">Loading…</div> : null}
    </div>
  </>)

  // ── the sheet ───────────────────────────────────────────────────────────────────────────────
  const cats = Array.from(new Set((items || []).map(i => i.category)))
  return shell(<>
    <button onClick={() => { setScope(''); setItems(null); setCounts({}) }} className="text-[13px] font-semibold text-neutral-500">← another shelf</button>
    <h1 className="text-[30px] leading-tight mt-2" style={serif}>{shelfLabel}</h1>
    <p className="text-[14px] text-neutral-600 mt-1.5">Put a number next to what you can see. Anything you skip keeps the number it already has.</p>

    <input value={counter} onChange={e => setCounter(e.target.value)} placeholder="Your name" className={field + ' mt-4'} />

    {items === null ? <div className="mt-6 text-[14px] text-neutral-500">Loading the sheet…</div> : null}

    {cats.map(cat => (
      <section key={cat} className="mt-7">
        <h2 className="text-[13px] uppercase tracking-[0.14em] font-semibold text-neutral-500">{cat}</h2>
        <div className="mt-2 space-y-2">
          {(items || []).filter(i => i.category === cat).map(i => {
            const v = counts[i.id] ?? ''
            const n = v === '' ? null : Math.floor(Number(v))
            const delta = n === null ? null : n - i.onHand
            return (
              <div key={i.id} className={'rounded-2xl bg-white px-3.5 py-3 border ' + (n === null ? 'border-neutral-200/70' : 'border-neutral-900/20 shadow-[0_10px_26px_-18px_rgba(15,76,58,.5)]')}>
                <div className="flex items-center gap-3">
                  {i.image ? <img src={i.image} alt="" className="w-12 h-12 rounded-xl object-contain flex-shrink-0 bg-neutral-100" /> : <div className="w-12 h-12 rounded-xl bg-neutral-100 flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px] font-semibold leading-tight truncate">{i.name}</div>
                    <div className="text-[12px] text-neutral-500 mt-0.5 truncate">
                      {[i.size, i.unit].filter(Boolean).join(' · ') || ' '}
                    </div>
                  </div>
                  <input inputMode="numeric" pattern="[0-9]*" value={v} placeholder="—"
                    onChange={e => { const t = e.target.value.replace(/[^0-9]/g, '').slice(0, 5); setCounts(c => ({ ...c, [i.id]: t })) }}
                    className="w-[84px] text-center rounded-xl border border-neutral-300 px-2 py-3 text-[22px] font-semibold tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-black/10" />
                </div>
                <div className="flex items-center justify-between mt-1.5 pl-[60px]">
                  <span className="text-[12px] text-neutral-400">we had {i.onHand}{i.countedBy ? ' · last counted by ' + i.countedBy.split('@')[0] : ''}</span>
                  {delta === null ? null : delta === 0
                    ? <span className="text-[12px] text-neutral-500">matches</span>
                    : <span className={'text-[12px] font-semibold ' + (delta < 0 ? 'text-amber-700' : 'text-emerald-700')}>{delta > 0 ? '+' : ''}{delta}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    ))}

    {items && items.length ? (
      <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 600))} rows={2} placeholder="Anything worth saying? Damaged stock, something on order…" className={field + ' mt-7 resize-y text-[15px]'} />
    ) : null}
    {items && !items.length ? <div className="mt-6 text-[14px] text-neutral-600">Nothing is set up to count on this shelf yet.</div> : null}

    {err ? <div className="mt-4 rounded-2xl bg-rose-50 text-rose-800 px-4 py-3 text-[14px]">{err}</div> : null}

    {/* The bar is the progress report: how far through the shelf you are, and the way out. */}
    {items && items.length ? (
      <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 pointer-events-none">
        <div className="max-w-lg mx-auto pointer-events-auto">
          <button onClick={() => setReview(true)} disabled={!lines.length}
            className="w-full h-14 rounded-2xl text-white text-[16px] font-semibold flex items-center justify-between px-5 shadow-[0_18px_40px_-14px_rgba(15,76,58,.6)] active:scale-[.99] transition disabled:opacity-40" style={{ background: ink }}>
            <span>{lines.length} of {items.length} counted</span>
            <span>Review →</span>
          </button>
        </div>
      </div>
    ) : null}

    {review ? (
      <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" onClick={() => !busy && setReview(false)}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
        <div onClick={e => e.stopPropagation()} className="relative w-full bg-white rounded-t-3xl sm:rounded-3xl sm:max-w-md p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92%] overflow-y-auto">
          <h3 className="text-[24px]" style={serif}>Save this count?</h3>
          <p className="text-[13.5px] text-neutral-600 mt-1">
            {lines.length} of {items!.length} counted on {shelfLabel}.
            {lines.length < items!.length ? <> The other {items!.length - lines.length} keep the numbers they have.</> : null}
          </p>
          {big.length ? (
            <div className="mt-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-900">
              <b>Worth a second look</b>
              <div className="mt-1 space-y-0.5">
                {big.map(l => <div key={l.itemId}>{l.name}: {l.before} → <b>{l.after}</b>{l.after === 0 ? ' — goes off the guest form' : ''}</div>)}
              </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-2xl border border-neutral-200/80 divide-y divide-neutral-100 max-h-64 overflow-y-auto">
            {lines.map(l => (
              <div key={l.itemId} className="flex justify-between items-baseline px-4 py-2 text-[14px]">
                <span className="truncate pr-2">{l.name}</span>
                <span className="tabular-nums text-neutral-500 flex-shrink-0">{l.before} → <b className="text-neutral-900">{l.after}</b></span>
              </div>
            ))}
          </div>
          {!counter.trim() ? <div className="mt-3 text-[13px] text-rose-700">Put your name at the top of the sheet first.</div> : null}
          {err ? <div className="mt-3 text-[13px] text-rose-700">{err}</div> : null}
          <button onClick={submit} disabled={busy || !counter.trim()} className="mt-4 w-full h-14 rounded-2xl text-white text-[16px] font-semibold disabled:opacity-50" style={{ background: accent }}>
            {busy ? 'Saving…' : 'Save the count'}
          </button>
          <button onClick={() => setReview(false)} disabled={busy} className="mt-2 w-full h-11 rounded-2xl text-[14px] font-semibold text-neutral-600">Keep counting</button>
        </div>
      </div>
    ) : null}
  </>)
}
