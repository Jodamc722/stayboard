'use client'
// A PERSON'S TRAINING, ON THEIR PHONE (Jon, 2026-10-26). /learn/<code>: no login — the link is the
// key. The videos and FAQs assigned to them, in English or Spanish (one tap to switch, remembered),
// each with a Done button. Pending first, then done. Nothing else on the page.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, Play, BookOpen, FileText, ChevronDown } from 'lucide-react'

type Lang = 'en' | 'es'
type Item = {
  id: string; kind: 'video' | 'faq' | 'doc'; title: { en: string; es: string | null }; summary: { en: string | null; es: string | null }; body: { en: string | null; es: string | null }
  durationSec: number | null; required: boolean; url: { en: string | null; es: string | null }
  assignment: { dueOn: string | null; completedAt: string | null } | null
}
type Bundle = { person: { name: string; lang: Lang }; items: Item[]; today: string }

const T = {
  en: { hello: 'Hi', intro: 'Your training from Stay Hospitality.', pending: 'To do', done: 'Done', watch: 'Watch', read: 'Read', markDone: 'Mark as done', doneOn: 'Done', due: 'Due', late: 'Late', empty: 'Nothing assigned right now.', bad: 'This link is not valid. Ask your supervisor for a new one.', min: 'min', noVideo: 'The video is not available in this language yet.', open: 'Open the video' },
  es: { hello: 'Hola', intro: 'Tu capacitación de Stay Hospitality.', pending: 'Por hacer', done: 'Hecho', watch: 'Ver', read: 'Leer', markDone: 'Marcar como hecho', doneOn: 'Hecho', due: 'Para', late: 'Vencido', empty: 'No tienes nada asignado ahora.', bad: 'Este enlace no es válido. Pide uno nuevo a tu supervisor.', min: 'min', noVideo: 'El video aún no está disponible en este idioma.', open: 'Abrir el video' },
}
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const mmss = (s: number | null) => s == null ? '' : `${Math.max(1, Math.round(s / 60))}`
const dayShort = (ymd: string | null, lang: Lang) => ymd ? new Date(ymd.slice(0, 10) + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric' }) : ''
const tx = (i: Item, lang: Lang) => ({ title: lang === 'es' && i.title.es ? i.title.es : i.title.en, summary: lang === 'es' && i.summary.es ? i.summary.es : i.summary.en, body: lang === 'es' && i.body.es ? i.body.es : i.body.en })

export function LearnPage({ code }: { code: string }) {
  const [data, setData] = useState<Bundle | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const t = T[lang]

  const post = useCallback(async (body: Record<string, any>) => {
    const r = await fetch('/api/public/training/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }, [code])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/training/' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
      setLang(j.person?.lang === 'es' ? 'es' : 'en')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [code])
  useEffect(() => { load() }, [load])

  const pickLang = async (l: Lang) => { setLang(l); try { await post({ action: 'lang', lang: l }) } catch {} }
  const markDone = async (item: Item) => {
    setBusy(item.id)
    try {
      await post({ action: 'complete', itemId: item.id, lang })
      setData(d => d ? { ...d, items: d.items.map(i => i.id === item.id ? { ...i, assignment: { dueOn: i.assignment?.dueOn || null, completedAt: new Date().toISOString() } } : i) } : d)
    } catch (e: any) { alert(e?.message || String(e)) } finally { setBusy(null) }
  }
  const logView = (item: Item) => { post({ action: 'view', itemId: item.id, lang }).catch(() => {}) }

  if (loading) return <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center text-neutral-500"><Loader2 className="animate-spin" /></div>
  if (err || !data) return <div className="min-h-screen bg-[#f6f4ef] px-6 py-16 text-center text-[15px] text-neutral-700">{T.en.bad}<br /><span className="text-neutral-500">{T.es.bad}</span></div>

  const pending = data.items.filter(i => !i.assignment?.completedAt)
  const done = data.items.filter(i => i.assignment?.completedAt)

  const Row = ({ item }: { item: Item }) => {
    const x = tx(item, lang)
    const isOpen = open === item.id
    const url = item.url[lang] || item.url.en || item.url.es
    const usingOther = !item.url[lang] && !!url
    const isExternal = !!url && !/supabase\.co\/storage/.test(url) && !/\.(mp4|m4v|mov|webm)(\?|$)/i.test(url)
    const late = !!item.assignment?.dueOn && !item.assignment?.completedAt && item.assignment.dueOn < data.today
    const finished = !!item.assignment?.completedAt
    return (
      <li className="rounded-2xl bg-white border border-neutral-200 overflow-hidden">
        <button type="button" onClick={() => setOpen(isOpen ? null : item.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
          <span className={`shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center ${finished ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-900 text-white'}`}>{finished ? <Check size={18} /> : item.kind === 'video' ? <Play size={17} /> : item.kind === 'faq' ? <BookOpen size={17} /> : <FileText size={17} />}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold text-neutral-900 leading-snug">{x.title}</span>
            <span className="block text-[12.5px] text-neutral-500 mt-0.5">
              {item.kind === 'video' && item.durationSec ? `${mmss(item.durationSec)} ${t.min} · ` : ''}
              {finished ? `${t.doneOn} ${dayShort(item.assignment!.completedAt, lang)}` : late ? <span className="text-rose-600 font-semibold">{t.late} · {dayShort(item.assignment!.dueOn, lang)}</span> : item.assignment?.dueOn ? `${t.due} ${dayShort(item.assignment.dueOn, lang)}` : x.summary || ''}
            </span>
          </span>
          <ChevronDown size={18} className={`text-neutral-400 transition ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen ? (
          <div className="px-3 pb-3 space-y-3">
            {item.kind === 'video' ? (
              <div className="rounded-xl overflow-hidden bg-black">
                {url ? (isExternal
                  ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => logView(item)} className="block p-6 text-center text-white text-[14px] underline">{t.open} ↗</a>
                  : <video key={url} controls playsInline preload="metadata" onPlay={() => logView(item)} className="w-full bg-black" src={url} />)
                  : <div className="p-5 text-center text-white/80 text-[13px]">{t.noVideo}</div>}
                {usingOther ? <div className="px-3 py-1.5 text-[11.5px] text-white/70">{t.noVideo}</div> : null}
              </div>
            ) : null}
            {x.body ? <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3 text-[14px] text-neutral-800 whitespace-pre-wrap leading-relaxed">{x.body}</div> : null}
            {!finished ? (
              <button type="button" disabled={busy === item.id} onClick={() => markDone(item)} className="w-full rounded-2xl bg-emerald-600 text-white py-3 text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {busy === item.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t.markDone}
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-neutral-900">
      <div className="max-w-md mx-auto px-4 py-6 pb-16">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-[26px] font-bold leading-tight" style={serif}>{t.hello}, {data.person.name.split(' ')[0]}</h1>
            <p className="text-[13px] text-neutral-500 mt-0.5">{t.intro}</p>
          </div>
          <div className="inline-flex rounded-xl border border-neutral-300 overflow-hidden text-[12.5px] font-bold shrink-0">
            {(['en', 'es'] as Lang[]).map(l => <button key={l} type="button" onClick={() => pickLang(l)} className={`px-3 py-1.5 ${lang === l ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500'}`}>{l === 'en' ? 'EN' : 'ES'}</button>)}
          </div>
        </div>
        {!data.items.length ? <p className="text-[14px] text-neutral-500 text-center py-10">{t.empty}</p> : null}
        {pending.length ? <>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2 px-1">{t.pending} · {pending.length}</h2>
          <ul className="space-y-2 mb-6">{pending.map(i => <Row key={i.id} item={i} />)}</ul>
        </> : null}
        {done.length ? <>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2 px-1">{t.done} · {done.length}</h2>
          <ul className="space-y-2">{done.map(i => <Row key={i.id} item={i} />)}</ul>
        </> : null}
      </div>
    </div>
  )
}
