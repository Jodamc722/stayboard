'use client'
// WHAT THE OWNER SEES. One link, on a phone, on hotel wifi.
//
// Jon, 2026-08-12: "should be easy to show owner an order once we pick the furniture replacement
// links... Owner can approve in the link."
//
// DESIGN RULES, because this is the one screen a person outside the company ever sees:
//   • Every line starts as a yes. Approving forty pieces should be one tap, and saying no to the
//     one they do not want should be the effort — not the other way round.
//   • The total updates as they tap. An owner deciding on $40,000 of furniture should never have to
//     work out what their own choices cost.
//   • Nothing internal leaks: no other owner, no other order, no staff names, no cost basis.
//   • A piece already ordered is shown, marked, and not clickable. Money has been spent; pretending
//     they can still cancel it would be a lie the screen tells on our behalf.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, X, Loader2, Package, ExternalLink, Sofa } from 'lucide-react'

type Line = {
  id: string; code: string | null; product: string | null; itemEn: string; itemEs: string
  placement: string | null; spec: string | null; imageUrl: string | null; url: string | null
  qty: number; unitCost: number | null; lineTotal: number | null
  stage: string; locked: boolean; ownerChoice: string | null
  priority?: 'must' | 'recommended' | 'nice' | null; priorityReason?: string | null
}
type Room = { room: string; en: string; es: string; lines: Line[] }
type Unit = { listingId: string; unitName: string; building: string; rooms: Room[]; count: number; subtotal: number }
type Data = {
  ok: boolean
  order: { orderNo: string; title: string | null; ownerName: string | null; status: string; note: string | null; ownerNote: string | null; decidedAt: string | null; decidedBy: string | null; aiBrief?: string | null }
  units: Unit[]
  totals: { units: number; lines: number; priced: number; unpriced: number; total: number }
  closed: boolean
  error?: string
}
type Lang = 'en' | 'es'

const T = {
  approve: { en: 'Approve this order', es: 'Aprobar este pedido' },
  approving: { en: 'Sending…', es: 'Enviando…' },
  yours: { en: 'Your total', es: 'Su total' },
  keep: { en: 'Yes', es: 'Sí' },
  drop: { en: 'No', es: 'No' },
  each: { en: 'each', es: 'c/u' },
  tbc: { en: 'price to come', es: 'precio por confirmar' },
  ordered: { en: 'Already ordered', es: 'Ya pedido' },
  note: { en: 'Anything you want us to know (optional)', es: 'Algo que quiera decirnos (opcional)' },
  name: { en: 'Your name', es: 'Su nombre' },
  thanks: { en: 'Thank you — we have it.', es: 'Gracias — lo recibimos.' },
  selected: { en: 'pieces selected', es: 'piezas seleccionadas' },
  declinedNote: { en: 'You said no to', es: 'Dijo que no a' },
  done: { en: 'This order has been sent back to the team.', es: 'Este pedido ya fue enviado al equipo.' },
  reopen: { en: 'You can change your answers and send again until we place the order.', es: 'Puede cambiar sus respuestas y enviar de nuevo hasta que hagamos el pedido.' },
  saved: { en: 'Answers saved', es: 'Respuestas guardadas' },
  saving: { en: 'Saving…', es: 'Guardando…' },
  saveLater: { en: 'No signal — your answers are safe and will save', es: 'Sin señal — sus respuestas están guardadas y se enviarán' },
  brief: { en: 'The short version', es: 'En resumen' },
}

// The team's recommendation on each line — the one question an owner asks per piece is "how strongly
// are you telling me to buy this?", so the answer sits right on the line, in their language.
const TIER_T: Record<string, { en: string; es: string; cls: string }> = {
  must: { en: 'Needs replacing', es: 'Necesita reemplazo', cls: 'bg-rose-100 text-rose-700' },
  recommended: { en: 'We recommend', es: 'Lo recomendamos', cls: 'bg-sky-100 text-sky-700' },
  nice: { en: 'Nice to have', es: 'Opcional', cls: 'bg-neutral-100 text-neutral-500' },
}

export function FfeOwnerOrder({ code }: { code: string }) {
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [picks, setPicks] = useState<Record<string, 'yes' | 'no'>>({})
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(0)          // taps not yet acknowledged by the server
  const [offline, setOffline] = useState(false)
  // Focus on one recommendation tier. The total bar below always counts EVERY line regardless of
  // focus, so narrowing the reading never quietly changes the money.
  const [tierView, setTierView] = useState<'' | 'must' | 'recommended' | 'nice'>('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/audit/ffe/order?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'This link is not valid.')
      setData(j)
      // Whatever they said last time is where the page starts, so re-opening a half-finished review
      // shows their own answers back rather than silently resetting everything to yes.
      const p: Record<string, 'yes' | 'no'> = {}
      for (const u of j.units || []) for (const rm of u.rooms) for (const l of rm.lines) {
        if (l.ownerChoice === 'no' || l.stage === 'declined') p[l.id] = 'no'
        else if (l.ownerChoice === 'yes') p[l.id] = 'yes'
      }
      setPicks(p)
      setName(j.order?.decidedBy || j.order?.ownerName || '')
      if (j.order?.ownerNote) setNote(j.order.ownerNote)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [code])
  useEffect(() => { load() }, [load])

  // ── EVERY TAP IS SAVED, NOT HELD IN THE PAGE ─────────────────────────────────────────────────
  // Jon, 2026-08-12: "make sure if you click something it saves if you refresh... in case loose
  // connection, phone dies etc." An owner working through forty pieces on hotel wifi must not lose
  // the first thirty-nine. Each tap goes up on its own; if it fails it is queued and retried, and
  // the screen says so rather than pretending. Submit is the only thing that MOVES the order.
  const queueRef = useState<{ q: { id: string; choice: 'yes' | 'no' }[]; running: boolean }>({ q: [], running: false })[0]

  const flush = useCallback(async () => {
    if (queueRef.running) return
    queueRef.running = true
    while (queueRef.q.length) {
      const job = queueRef.q[0]
      try {
        const r = await fetch('/api/audit/ffe/order', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'draft', code, lineId: job.id, choice: job.choice }),
        })
        if (!r.ok) throw new Error('save failed')
        queueRef.q.shift()
        setPending(queueRef.q.length)
        setOffline(false)
      } catch {
        // Leave it on the queue and come back — a lost signal is not a lost answer.
        setOffline(true)
        queueRef.running = false
        setTimeout(() => { flush() }, 4000)
        return
      }
    }
    queueRef.running = false
  }, [code, queueRef])

  const choose = (id: string, choice: 'yes' | 'no') => {
    setPicks(p => ({ ...p, [id]: choice }))
    // Last tap on a line wins — an owner flipping yes/no/yes should send one answer, not three.
    queueRef.q = queueRef.q.filter(j => j.id !== id).concat([{ id, choice }])
    setPending(queueRef.q.length)
    flush()
  }

  // Their name and their message are saved the same way, on blur.
  const saveNote = useCallback(async (n: string, who: string) => {
    try {
      await fetch('/api/audit/ffe/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draftNote', code, note: n, name: who }),
      })
    } catch { /* the submit below carries it too */ }
  }, [code])

  const t = <K extends { en: string; es: string }>(x: K) => x[lang]

  // How many lines carry each tier, and what they add up to — the first thing an owner wants to
  // know about a long order is "how much of this is actually urgent?".
  const tierRoll = useMemo(() => {
    const r: Record<string, { n: number; v: number }> = { must: { n: 0, v: 0 }, recommended: { n: 0, v: 0 }, nice: { n: 0, v: 0 } }
    for (const u of data?.units || []) for (const rm of u.rooms) for (const l of rm.lines) {
      if (l.priority && r[l.priority]) { r[l.priority].n += 1; if (l.lineTotal != null) r[l.priority].v += l.lineTotal }
    }
    return r
  }, [data])
  const hasTiers = tierRoll.must.n + tierRoll.recommended.n + tierRoll.nice.n > 0
  const inView = (l: Line) => !tierView || l.priority === tierView

  const { total, yes, no } = useMemo(() => {
    let total = 0, yes = 0, no = 0
    for (const u of data?.units || []) for (const rm of u.rooms) for (const l of rm.lines) {
      if (picks[l.id] === 'no' && !l.locked) { no += 1; continue }
      yes += l.qty
      if (l.lineTotal != null) total += l.lineTotal
    }
    return { total, yes, no }
  }, [data, picks])

  const submit = async () => {
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, lines: picks, note, name, requestChanges: !!note.trim() }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'That did not send — please try again.')
      setSent(true)
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setSending(false)
  }

  if (err && !data) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="rounded-2xl border border-rose-200 bg-white px-5 py-6 text-center max-w-sm">
        <p className="text-sm font-bold text-rose-700">{err}</p>
        <p className="text-[12.5px] text-neutral-500 mt-1">Este enlace no es válido.</p>
      </div>
    </div>
  )
  if (!data) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <p className="text-sm text-neutral-400">Loading…</p>
    </div>
  )

  const usd = (n: number | null) => n == null ? t(T.tbc)
    : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  return (
    <div className="min-h-screen bg-neutral-50 pb-40">
      <div className="sticky top-0 z-10 bg-neutral-900 text-white px-4 py-3 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-400 font-bold">
              FF&amp;E {data.order.orderNo}
            </p>
            <h1 className="text-lg font-bold leading-tight truncate">{data.order.title || data.order.ownerName}</h1>
          </div>
          <div className="flex items-center rounded-lg overflow-hidden border border-neutral-700 shrink-0">
            {(['en', 'es'] as Lang[]).map(L => (
              <button key={L} onClick={() => setLang(L)}
                className={'px-2.5 py-1 text-[11px] font-bold ' + (lang === L ? 'bg-white text-neutral-900' : 'text-neutral-300')}>
                {L.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11.5px] text-neutral-300 mt-1 flex items-center gap-1.5 flex-wrap">
          <span>
            {data.totals.units} unit{data.totals.units === 1 ? '' : 's'} · {data.totals.lines} line{data.totals.lines === 1 ? '' : 's'}
            {data.totals.unpriced ? ' · ' + data.totals.unpriced + ' ' + t(T.tbc) : ''}
          </span>
          {/* Say what is true about their answers rather than leaving them to wonder. */}
          {offline
            ? <span className="text-amber-300 font-semibold">{t(T.saveLater)}</span>
            : pending
              ? <span className="text-neutral-400">{t(T.saving)}</span>
              : <span className="text-emerald-400">{t(T.saved)}</span>}
        </p>
      </div>

      {/* The order at a glance: how strongly we recommend what, and what each bucket costs. A tap
          focuses the list on one tier; "Show all" is always one tap away. */}
      {hasTiers ? (
        <div className="mx-3 mt-3 flex flex-wrap gap-1.5">
          {(['must', 'recommended', 'nice'] as const).map(k => tierRoll[k].n ? (
            <button key={k} onClick={() => setTierView(v => v === k ? '' : k)}
              className={'text-[11px] font-bold px-2.5 py-1.5 rounded-xl ' + TIER_T[k].cls + (tierView === k ? ' ring-2 ring-neutral-800' : '')}>
              {TIER_T[k][lang]} · {tierRoll[k].n}{tierRoll[k].v ? ' · ' + usd(tierRoll[k].v) : ''}
            </button>
          ) : null)}
          {tierView ? (
            <button onClick={() => setTierView('')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-neutral-800 text-white">
              {lang === 'en' ? 'Show all' : 'Ver todo'}
            </button>
          ) : null}
        </div>
      ) : null}

      {data.order.aiBrief ? (
        <div className="mx-3 mt-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-neutral-400">{t(T.brief)}</p>
          <p className="text-[13px] text-neutral-800 whitespace-pre-wrap mt-1">{data.order.aiBrief}</p>
        </div>
      ) : null}
      {data.order.note ? (
        <div className="mx-3 mt-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-[13px] text-neutral-800 whitespace-pre-wrap">{data.order.note}</p>
        </div>
      ) : null}

      {sent ? (
        <div className="mx-3 mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-[13px] font-bold text-emerald-800">{t(T.thanks)}</p>
          <p className="text-[12px] text-emerald-700 mt-0.5">{t(T.reopen)}</p>
        </div>
      ) : null}
      {err ? <div className="mx-3 mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-rose-700">{err}</div> : null}

      <div className="px-3 pt-3 space-y-3">
        {data.units.filter(u => u.rooms.some(rm => rm.lines.some(inView))).map(u => (
          <div key={u.listingId} className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
              <p className="text-[14px] font-bold text-neutral-900">{u.unitName}</p>
              <p className="text-[11px] text-neutral-500">{u.building}</p>
            </div>
            {u.rooms.filter(rm => rm.lines.some(inView)).map(rm => (
              <div key={rm.room}>
                <p className="px-4 pt-2.5 pb-1 text-[10.5px] uppercase tracking-wider font-bold text-neutral-400">
                  {lang === 'en' ? rm.en : rm.es}
                </p>
                <div className="divide-y divide-neutral-100">
                  {rm.lines.filter(inView).map(l => {
                    const off = picks[l.id] === 'no' && !l.locked
                    return (
                      <div key={l.id} className={'px-4 py-2.5 flex items-center gap-3 ' + (off ? 'opacity-45' : '')}>
                        {l.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={l.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-neutral-200 shrink-0" />
                          : <div className="w-12 h-12 rounded-lg bg-neutral-100 border border-neutral-200 shrink-0 grid place-items-center"><Package className="w-4 h-4 text-neutral-400" /></div>}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={'text-[13.5px] font-semibold text-neutral-900 ' + (off ? 'line-through' : '')}>
                              {l.product || (lang === 'en' ? l.itemEn : l.itemEs)}
                            </span>
                            {l.code ? <span className="text-[10px] font-mono text-neutral-400">{l.code}</span> : null}
                            {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="text-neutral-400"><ExternalLink className="w-3 h-3" /></a> : null}
                            {l.priority && TIER_T[l.priority] ? (
                              <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + TIER_T[l.priority].cls}>
                                {TIER_T[l.priority][lang]}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11.5px] text-neutral-500">
                            {lang === 'en' ? l.itemEn : l.itemEs}
                            {l.spec ? ' · ' + l.spec : ''}
                            {l.qty > 1 ? ' × ' + l.qty : ''}
                            {l.unitCost != null && l.qty > 1 ? ' · ' + usd(l.unitCost) + ' ' + t(T.each) : ''}
                          </div>
                          {/* Why we're saying so — the reason travels with the recommendation, so
                              the owner never has to text us "what's wrong with the old one?" */}
                          {l.priorityReason && l.priority !== 'nice' ? (
                            <p className="text-[11px] text-neutral-500 italic mt-0.5">{l.priorityReason}</p>
                          ) : null}
                          {l.locked ? (
                            <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                              {t(T.ordered)}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[13px] font-bold text-neutral-900 tabular-nums">{usd(l.lineTotal)}</div>
                          {!l.locked ? (
                            <div className="mt-1 inline-flex items-center rounded-lg overflow-hidden border border-neutral-200">
                              <button onClick={() => choose(l.id, 'yes')}
                                className={'px-2 py-1 text-[11px] font-bold ' + (!off ? 'bg-emerald-600 text-white' : 'text-neutral-400')}>
                                <Check className="w-3 h-3" />
                              </button>
                              <button onClick={() => choose(l.id, 'no')}
                                className={'px-2 py-1 text-[11px] font-bold ' + (off ? 'bg-neutral-800 text-white' : 'text-neutral-400')}>
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="px-3 pt-3 space-y-2">
        <input value={name} onChange={e => setName(e.target.value)} onBlur={() => saveNote(note, name)} placeholder={t(T.name)}
          className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[13px]" />
        <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => saveNote(note, name)} rows={3} placeholder={t(T.note)}
          className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[13px]" />
      </div>

      <p className="px-4 pt-4 text-[11px] text-neutral-400 flex items-start gap-1.5">
        <Sofa size={12} className="mt-0.5 shrink-0" />
        {lang === 'en'
          ? 'Prices are per piece and exclude delivery, installation and tax unless stated. Approving orders furniture — it does not create any maintenance work.'
          : 'Los precios son por pieza y no incluyen envío, instalación ni impuestos salvo que se indique. Aprobar pide los muebles — no genera ningún trabajo de mantenimiento.'}
      </p>

      {/* the decision bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-neutral-200 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider text-neutral-400 font-bold">{t(T.yours)}</p>
            <p className="text-xl font-bold text-neutral-900 tabular-nums leading-tight">
              ${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[11px] text-neutral-500">
              {yes} {t(T.selected)}{no ? ' · ' + t(T.declinedNote) + ' ' + no : ''}
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={submit} disabled={sending}
            className="rounded-xl bg-neutral-900 text-white px-5 py-3 text-[13px] font-bold disabled:opacity-50 inline-flex items-center gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {sending ? t(T.approving) : t(T.approve)}
          </button>
        </div>
      </div>
    </div>
  )
}
