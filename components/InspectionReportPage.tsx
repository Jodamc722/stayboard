'use client'
// HER INSPECTION REPORT, ON HER PHONE (Jon, 2026-11-06: "be able to share the inspection reports with
// the girls" — "Personal link shared by supervisor or managers"). /ir/<code>: no login, the link is
// the key. Her last five HK Post Clean inspections in HER language (one tap to switch, remembered):
// the score, what went well, what to fix with the photos, her supervisor's notes, her training, and
// a thank-you. Nothing about anyone else, no money, no guests. Same look as /learn/<code>.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Star, Check, AlertCircle, MessageCircle, Play, Heart, Sparkles } from 'lucide-react'

type Lang = 'en' | 'es'
type Miss = { section: string; section_es: string | null; en: string; es: string | null; photos: string[] }
type Insp = { unit: string | null; date: string | null; score: number | null; pass_rate: number | null; misses: Miss[]; coaching: string | null; perfect: boolean }
type Summary = {
  count: number; avgScore: number | null; avgPassRate: number | null
  wentWell: { section: string; section_es: string | null }[]
  coaching: { text: string; unit: string | null; date: string | null }[]
  praise: { unit: string | null; date: string | null }[]
  inspections: Insp[]
}
type Report = {
  firstName: string; lang: Lang; createdAt: string; periodFrom: string | null; periodTo: string | null
  summary: Summary; note: string | null; training: { code: string; pending: { en: string; es: string | null }[]; done: number } | null
}

const T = {
  en: {
    hello: 'Hi', intro: (n: number) => `Your report from your last ${n} inspections.`, score: 'Average score', outOf: 'out of 5',
    pass: (p: number) => `${p}% of the checklist was right`, perfect: 'Perfect clean', well: 'What went well', wellNone: 'Keep going — every section counts.',
    fix: 'What to fix', fixNone: 'Nothing to fix in these inspections. Great work!', notes: 'Notes from your supervisor', note: 'A note for you',
    training: 'Your training', trainingBtn: 'Open my training', trainingDone: (n: number) => `${n} done`, list: 'The inspections',
    close: 'Thank you for your work. Every detail you get right is what our guests notice first.', team: '— The Stay Hospitality team',
    bad: 'This link is not valid. Ask your supervisor for a new one.', photo: 'Photo', noScore: 'No score',
  },
  es: {
    hello: 'Hola', intro: (n: number) => `Tu reporte de tus últimas ${n} inspecciones.`, score: 'Puntaje promedio', outOf: 'de 5',
    pass: (p: number) => `${p}% de la lista estuvo bien`, perfect: 'Limpieza perfecta', well: 'Lo que salió bien', wellNone: 'Sigue así — cada sección cuenta.',
    fix: 'Lo que hay que mejorar', fixNone: 'Nada que mejorar en estas inspecciones. ¡Excelente trabajo!', notes: 'Notas de tu supervisora', note: 'Una nota para ti',
    training: 'Tu capacitación', trainingBtn: 'Abrir mi capacitación', trainingDone: (n: number) => `${n} hechas`, list: 'Las inspecciones',
    close: 'Gracias por tu trabajo. Cada detalle que haces bien es lo primero que notan nuestros huéspedes.', team: '— El equipo de Stay Hospitality',
    bad: 'Este enlace no es válido. Pide uno nuevo a tu supervisora.', photo: 'Foto', noScore: 'Sin puntaje',
  },
}
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const day = (iso: string | null, lang: Lang) => iso ? new Date(iso).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : ''
const sec = (s: { section: string; section_es: string | null }, lang: Lang) => (lang === 'es' && s.section_es) ? s.section_es : s.section
const line = (m: { en: string; es: string | null }, lang: Lang) => (lang === 'es' && m.es) ? m.es : m.en

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map(i => <Star key={i} size={22} className={i <= Math.round(value) ? 'text-amber-400 fill-amber-400' : 'text-neutral-300'} />)}
    </span>
  )
}

export function InspectionReportPage({ code, preview }: { code: string; preview?: boolean }) {
  const [data, setData] = useState<Report | null>(null)
  const [lang, setLang] = useState<Lang>('es')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<string | null>(null)
  const t = T[lang]

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/inspection-report/' + encodeURIComponent(code) + (preview ? '?preview=1' : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
      setLang(j.lang === 'en' ? 'en' : 'es')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [code, preview])
  useEffect(() => { load() }, [load])

  const pickLang = (l: Lang) => {
    setLang(l)
    if (!preview) fetch('/api/public/inspection-report/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'lang', lang: l }) }).catch(() => {})
  }

  if (loading) return <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center text-neutral-500"><Loader2 className="animate-spin" /></div>
  if (err || !data) return <div className="min-h-screen bg-[#f6f4ef] px-6 py-16 text-center text-[15px] text-neutral-700">{T.en.bad}<br /><span className="text-neutral-500">{T.es.bad}</span></div>

  const s = data.summary
  const withMisses = s.inspections.filter(i => i.misses.length)
  const card = 'rounded-2xl bg-white border border-neutral-200 px-4 py-4'
  const h2 = 'text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2 px-1 flex items-center gap-1.5'

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-neutral-900">
      <div className="max-w-md mx-auto px-4 py-6 pb-16 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold leading-tight" style={serif}>{t.hello}{data.firstName ? `, ${data.firstName}` : ''}</h1>
            <p className="text-[13px] text-neutral-500 mt-0.5">{t.intro(s.count)}{data.periodFrom ? ` ${day(data.periodFrom, lang)} – ${day(data.periodTo, lang)}` : ''}</p>
          </div>
          <div className="inline-flex rounded-xl border border-neutral-300 overflow-hidden text-[12.5px] font-bold shrink-0">
            {(['en', 'es'] as Lang[]).map(l => <button key={l} type="button" onClick={() => pickLang(l)} className={`px-3 py-1.5 ${lang === l ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500'}`}>{l === 'en' ? 'EN' : 'ES'}</button>)}
          </div>
        </div>

        <section className={card + ' text-center'}>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">{t.score}</p>
          {s.avgScore != null ? <>
            <p className="text-[44px] font-bold leading-none mt-2 tabular-nums" style={serif}>{s.avgScore.toFixed(1)} <span className="text-[16px] font-semibold text-neutral-400">{t.outOf}</span></p>
            <div className="mt-2"><Stars value={s.avgScore} /></div>
          </> : <p className="text-[18px] font-semibold text-neutral-400 mt-2">{t.noScore}</p>}
          {s.avgPassRate != null ? <p className="text-[13.5px] text-neutral-600 mt-2">{t.pass(Math.round(s.avgPassRate * 100))}</p> : null}
          {s.praise.length ? (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {s.praise.map((p, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 text-[12px] font-semibold px-2.5 py-1"><Sparkles size={12} /> {t.perfect}{p.unit ? ` · ${p.unit}` : ''}</span>)}
            </div>
          ) : null}
        </section>

        {data.note ? (
          <section className={card + ' bg-amber-50 border-amber-200'}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1">{t.note}</p>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{data.note}</p>
          </section>
        ) : null}

        <section>
          <h2 className={h2}><Check size={13} className="text-emerald-600" /> {t.well}</h2>
          <div className={card}>
            {s.wentWell.length ? (
              <div className="flex flex-wrap gap-1.5">
                {s.wentWell.map(w => <span key={w.section} className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13px] font-semibold px-3 py-1">{sec(w, lang)}</span>)}
              </div>
            ) : <p className="text-[14px] text-neutral-600">{t.wellNone}</p>}
          </div>
        </section>

        <section>
          <h2 className={h2}><AlertCircle size={13} className="text-rose-600" /> {t.fix}</h2>
          {!withMisses.length ? <div className={card}><p className="text-[14px] text-neutral-700">{t.fixNone}</p></div> : (
            <ul className="space-y-2">
              {withMisses.map((i, k) => (
                <li key={k} className={card}>
                  <p className="text-[12.5px] font-semibold text-neutral-500 mb-2">{[i.unit, day(i.date, lang)].filter(Boolean).join(' · ')}</p>
                  <ul className="space-y-2.5">
                    {i.misses.map((m, j) => (
                      <li key={j}>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">{sec(m, lang)}</p>
                        <p className="text-[15px] leading-snug">{line(m, lang)}</p>
                        {m.photos.length ? (
                          <div className="flex gap-2 mt-1.5">
                            {m.photos.map((u, n) => (
                              <button key={n} type="button" onClick={() => setZoom(u)} className="w-20 h-20 rounded-xl overflow-hidden bg-neutral-100 border border-neutral-200">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={u} alt={t.photo} loading="lazy" className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {s.coaching.length ? (
          <section>
            <h2 className={h2}><MessageCircle size={13} /> {t.notes}</h2>
            <ul className="space-y-2">
              {s.coaching.map((c, k) => (
                <li key={k} className={card}>
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{c.text}</p>
                  <p className="text-[12px] text-neutral-500 mt-1">{[c.unit, day(c.date, lang)].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.training ? (
          <section>
            <h2 className={h2}><Play size={13} /> {t.training}</h2>
            <div className={card}>
              {data.training.pending.length ? (
                <ul className="space-y-1 mb-3">
                  {data.training.pending.map((p, k) => <li key={k} className="text-[14px] leading-snug">• {line(p, lang)}</li>)}
                </ul>
              ) : null}
              {data.training.done ? <p className="text-[12.5px] text-emerald-700 font-semibold mb-3">{t.trainingDone(data.training.done)}</p> : null}
              <a href={'/learn/' + data.training.code} className="block w-full text-center rounded-2xl bg-neutral-900 text-white py-3 text-[15px] font-bold">{t.trainingBtn}</a>
            </div>
          </section>
        ) : null}

        <section>
          <h2 className={h2}>{t.list}</h2>
          <ul className="rounded-2xl bg-white border border-neutral-200 divide-y divide-neutral-100">
            {s.inspections.map((i, k) => (
              <li key={k} className="px-4 py-2.5 flex items-center gap-3 text-[14px]">
                <span className="flex-1 min-w-0 truncate">{i.unit || '—'} <span className="text-neutral-400 text-[12.5px]">· {day(i.date, lang)}</span></span>
                {i.misses.length ? <span className="text-[12px] text-rose-700 font-semibold">{i.misses.length} ✗</span> : <span className="text-[12px] text-emerald-700 font-semibold">✓</span>}
                <span className="tabular-nums font-bold w-8 text-right">{i.score ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="text-center px-2 pt-2">
          <Heart size={18} className="mx-auto text-rose-400 mb-2" />
          <p className="text-[15px] leading-relaxed text-neutral-700" style={serif}>{t.close}</p>
          <p className="text-[13px] text-neutral-500 mt-1">{t.team}</p>
        </section>
      </div>
      {zoom ? (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt={t.photo} className="max-w-full max-h-full rounded-xl" />
        </button>
      ) : null}
    </div>
  )
}
