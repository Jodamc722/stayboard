'use client'
// FF&E HUB — one owner link that opens every unit under it (Jon, 2026-08-11).
//
//   "It should have one owner link, that link then opens to a page with each unit, with its own
//    link... where they can go in and out of links, mark them complete, that way it's easier for
//    them to track. It should also show if vacant or checkout today / checkin today."
//
// This is the page the team actually lives on. One link gets shared once; from here they tap into a
// unit, fill it, and come back — the unit form has a Back link to exactly this page, so nobody has
// to hunt for the URL again. Each unit also carries its own copyable link for handing to one person.
//
// TODAY'S STATUS IS THE FIRST THING ON EACH ROW because it decides whether the unit can be walked
// at all: occupied means do not knock, checkout means now is the moment, check-in means finish
// before the guest lands.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sofa, Copy, Check, RefreshCw, Loader2, ChevronRight } from 'lucide-react'

type Unit = {
  id: string; name: string; bedrooms: number | null; building: string
  ownerName: string; code: string
  total: number; answered: number; toOrder: number
  completedAt: string | null; today: string
}
type Data = {
  ok: boolean
  scope: { kind: 'owner' | 'building'; name: string; code: string }
  units: Unit[]
  totals: { units: number; total: number; answered: number; toOrder: number; complete: number }
  error?: string
}
type Lang = 'en' | 'es'

const T = {
  title: { en: 'FF&E Audit', es: 'Auditoría FF&E' },
  intro: {
    en: 'Tap a unit to walk it. Your answers save as you go — you can leave and come back.',
    es: 'Toque una unidad para recorrerla. Sus respuestas se guardan solas — puede salir y volver.',
  },
  units: { en: 'Units', es: 'Unidades' },
  complete: { en: 'Complete', es: 'Completas' },
  toOrder: { en: 'To order', es: 'Por pedir' },
  answered: { en: 'answered', es: 'respondidas' },
  open: { en: 'Open', es: 'Abrir' },
  copy: { en: 'Copy link', es: 'Copiar enlace' },
  copied: { en: 'Copied', es: 'Copiado' },
  done: { en: 'Done', es: 'Lista' },
}
const STATUS: Record<string, { en: string; es: string; cls: string }> = {
  vacant:   { en: 'Vacant',        es: 'Vacía',            cls: 'bg-emerald-100 text-emerald-700' },
  checkout: { en: 'Checkout today', es: 'Salida hoy',      cls: 'bg-blue-100 text-blue-700' },
  checkin:  { en: 'Check-in today', es: 'Entrada hoy',     cls: 'bg-amber-100 text-amber-800' },
  turn:     { en: 'Same-day turn',  es: 'Cambio el mismo día', cls: 'bg-rose-100 text-rose-700' },
  occupied: { en: 'Occupied',      es: 'Ocupada',          cls: 'bg-neutral-200 text-neutral-700' },
}

export function FfeHub({ code }: { code: string }) {
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/audit/ffe?hub=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Link not found')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [code])
  useEffect(() => { load() }, [load])

  const t = <K extends { en: string; es: string }>(x: K) => x[lang]
  const urlFor = (c: string) => (typeof window !== 'undefined' ? window.location.origin : '') + '/audit/ffe/' + c
  const copy = async (c: string) => {
    try { await navigator.clipboard.writeText(urlFor(c)); setCopied(c); setTimeout(() => setCopied(''), 1600) } catch { /* blocked */ }
  }

  // Units that can be walked right now float up; finished ones sink. A walker opening this on site
  // should see what they can actually do first.
  const units = useMemo(() => {
    const rank = (u: Unit) => (u.completedAt ? 3 : u.today === 'occupied' ? 2 : 0)
    return (data?.units || []).slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [data])

  if (err) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="rounded-2xl border border-rose-200 bg-white px-5 py-6 text-center max-w-sm">
        <p className="text-sm font-bold text-rose-700">This link is not valid.</p>
        <p className="text-[12.5px] text-neutral-500 mt-1">Este enlace no es válido.</p>
      </div>
    </div>
  )
  if (!data) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <p className="text-sm text-neutral-400">Loading…</p>
    </div>
  )

  const pct = data.totals.total ? Math.round((data.totals.answered / data.totals.total) * 100) : 0

  return (
    <div className="min-h-screen bg-neutral-50 pb-10">
      <div className="sticky top-0 z-10 bg-neutral-900 text-white px-4 py-3 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-400 font-bold">{t(T.title)}</p>
            <h1 className="text-lg font-bold leading-tight truncate">{data.scope.name}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={load} className="text-neutral-300 p-1" aria-label="Refresh">
              <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
            </button>
            <div className="flex items-center rounded-lg overflow-hidden border border-neutral-700">
              {(['en', 'es'] as Lang[]).map(L => (
                <button key={L} onClick={() => setLang(L)}
                  className={'px-2.5 py-1 text-[11px] font-bold ' + (lang === L ? 'bg-white text-neutral-900' : 'text-neutral-300')}>
                  {L.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-neutral-700 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: pct + '%' }} />
          </div>
          <span className="text-[11px] text-neutral-300 tabular-nums shrink-0">
            {data.totals.complete}/{data.totals.units} {t(T.complete).toLowerCase()}
          </span>
        </div>
      </div>

      <div className="px-3 pt-3">
        <p className="text-[12.5px] text-neutral-600 px-1">{t(T.intro)}</p>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { l: t(T.units), v: String(data.totals.units) },
            { l: t(T.complete), v: data.totals.complete + '/' + data.totals.units },
            { l: t(T.toOrder), v: String(data.totals.toOrder) },
          ].map(x => (
            <div key={x.l} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-center">
              <div className="text-[9.5px] uppercase tracking-wider text-neutral-400 font-bold">{x.l}</div>
              <div className="text-lg font-bold text-neutral-900 tabular-nums">{x.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-2">
        {units.map(u => {
          const st = STATUS[u.today] || STATUS.vacant
          const upct = u.total ? Math.round((u.answered / u.total) * 100) : 0
          return (
            <div key={u.id} className={'rounded-2xl border bg-white overflow-hidden ' + (u.completedAt ? 'border-emerald-200' : 'border-neutral-200')}>
              <a href={'/audit/ffe/' + u.code} className="block px-4 py-3 active:bg-neutral-50">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-bold text-neutral-900">{u.name}</span>
                      <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + st.cls}>{t(st)}</span>
                      {u.completedAt ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-600 text-white">{t(T.done)}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1.5 flex-1 max-w-[140px] rounded-full bg-neutral-100 overflow-hidden">
                        <div className={'h-full ' + (u.completedAt ? 'bg-emerald-500' : 'bg-neutral-400')} style={{ width: upct + '%' }} />
                      </div>
                      <span className="text-[11px] text-neutral-400 tabular-nums">{u.answered}/{u.total} {t(T.answered)}</span>
                      {u.toOrder > 0 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{u.toOrder}</span>
                      ) : null}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-300 shrink-0" />
                </div>
              </a>
              <div className="px-4 pb-2.5 -mt-1">
                <button onClick={() => copy(u.code)}
                  className="text-[11.5px] font-semibold text-blue-600 inline-flex items-center gap-1">
                  {copied === u.code ? <><Check className="w-3 h-3" /> {t(T.copied)}</> : <><Copy className="w-3 h-3" /> {t(T.copy)}</>}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="px-4 pt-4 text-[11px] text-neutral-400 flex items-start gap-1.5">
        <Sofa size={12} className="mt-0.5 shrink-0" />
        {lang === 'en'
          ? 'This is a furniture list, not a work order — nothing here creates a maintenance task.'
          : 'Esta es una lista de muebles, no una orden de trabajo — nada aquí crea una tarea de mantenimiento.'}
      </p>
    </div>
  )
}
