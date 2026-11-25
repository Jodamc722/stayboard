'use client'
// A PERSON'S OWN PAGE, ON THEIR PHONE (Jon, 2026-10-26; grown 2026-11-25). /learn/<code>: no login —
// the link they get by email is the key. Onboarding (apps, training + quizzes, the handbook), their
// schedule once it is pushed, hours, tasks, the inspections a supervisor has sent them, and their
// profile. English or Spanish, one tap, remembered.
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MemberProfile, type Profile, type Lang } from '@/components/MemberProfile'

const BAD = { en: 'This link is not valid. Ask your supervisor for a new one.', es: 'Este enlace no es válido. Pide uno nuevo a tu supervisor.' }
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }

export function LearnPage({ code }: { code: string }) {
  const [data, setData] = useState<Profile | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const url = '/api/public/training/' + encodeURIComponent(code)

  const act = useCallback(async (body: Record<string, any>) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }, [url])

  const load = useCallback(async (first = false) => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
      if (first) setLang(j.person?.lang === 'es' ? 'es' : 'en')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [url])
  useEffect(() => { load(true) }, [load])

  const pickLang = (l: Lang) => { setLang(l); act({ action: 'lang', lang: l }).catch(() => {}) }

  if (loading) return <div className="min-h-[100dvh] bg-[#f6f4ef] flex items-center justify-center text-neutral-500"><Loader2 className="animate-spin" /></div>
  if (err || !data) return <div className="min-h-[100dvh] bg-[#f6f4ef] px-6 py-16 text-center text-[15px] text-neutral-700">{BAD.en}<br /><span className="text-neutral-500">{BAD.es}</span></div>

  return (
    <div className="min-h-[100dvh] bg-[#f6f4ef] text-neutral-900">
      <div className="max-w-md mx-auto px-4 py-6 pb-16">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight" style={serif}>{lang === 'es' ? 'Hola' : 'Hi'}, {data.person.name.split(' ')[0]}</h1>
            <p className="text-[13px] text-neutral-500 mt-0.5">{[data.onboarding.trackLabel, data.person.market].filter(Boolean).join(' · ') || 'Stay Hospitality'}</p>
          </div>
          <div className="inline-flex rounded-xl border border-neutral-300 overflow-hidden text-[12.5px] font-bold shrink-0">
            {(['en', 'es'] as Lang[]).map(l => <button key={l} type="button" onClick={() => pickLang(l)} className={`px-3 py-1.5 ${lang === l ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500'}`}>{l === 'en' ? 'EN' : 'ES'}</button>)}
          </div>
        </div>
        <MemberProfile data={data} lang={lang} mode="self" act={act} onChanged={() => load()} />
      </div>
    </div>
  )
}
