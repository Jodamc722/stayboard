'use client'
// THE NEW HIRE FORM — what the person sees at /hire/<code> (Jon, 2026-11-25: "a shareable link where
// they can fill out a form, only sent after hiring… full name, email, phone number, etc."). A phone
// page first: most hires open it from a text. English or Spanish, every choice a button, and the one
// thing it promises is true: nothing happens until a manager approves it.
import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { HIRE_TRACKS, HIRE_MARKETS, MARKET_WORD, HIRE_TEXT, type Lang, type HireError } from '@/lib/hire-rules'

const serif = { fontFamily: 'var(--font-display, Georgia, serif)' }
const FIELD = 'w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-[16px] text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300'
const LABEL = 'block text-[12px] font-semibold uppercase tracking-wider text-neutral-500 mb-1'
const choice = (on: boolean) => `rounded-xl border px-3 py-2.5 text-[14px] font-semibold text-left ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-800'}`

export function HireForm({ code }: { code: string }) {
  const [lang, setLang] = useState<Lang>('es')
  const [valid, setValid] = useState<boolean | null>(null)
  const [f, setF] = useState({ name: '', email: '', phone: '', track: '', market: '', startDate: '', emergencyName: '', emergencyPhone: '', note: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<HireError | null>(null)
  const [done, setDone] = useState(false)
  const t = HIRE_TEXT[lang]
  const set = (k: keyof typeof f, v: string) => { setF(s => ({ ...s, [k]: v })); if (err && err.field === k) setErr(null) }

  useEffect(() => {
    // A browser set to English starts in English; everyone else starts in Spanish and can switch.
    try { if ((navigator.language || '').toLowerCase().startsWith('en')) setLang('en') } catch { /* stays Spanish */ }
    fetch('/api/public/hire?code=' + encodeURIComponent(code), { cache: 'no-store' }).then(r => r.json()).then(j => setValid(!!j.valid)).catch(() => setValid(false))
  }, [code])

  const send = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/public/hire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, lang, ...f }) })
      const j = await r.json().catch(() => null)
      if (r.ok && j && j.ok) { setDone(true); window.scrollTo({ top: 0 }) }
      else {
        const e: HireError = j && j.error && j.error.en ? j.error : { field: 'form', en: HIRE_TEXT.en.failed, es: HIRE_TEXT.es.failed }
        setErr(e)
        if (e.field !== 'form') document.getElementById('hire-' + e.field)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    } catch { setErr({ field: 'form', en: HIRE_TEXT.en.failed, es: HIRE_TEXT.es.failed }) }
    setBusy(false)
  }
  const bad = (k: string) => (err && err.field === k ? <p className="text-[13px] text-rose-700 mt-1">{err[lang]}</p> : null)
  const ring = (k: string) => (err && err.field === k ? ' !border-rose-500' : '')

  return (
    <div className="min-h-[100dvh] bg-[#f6f4ef] text-neutral-900">
      <div className="max-w-md mx-auto px-4 py-6 pb-16">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-500">{t.eyebrow}</p>
            <h1 className="text-[26px] font-bold leading-tight mt-1" style={serif}>{valid === false ? t.closedTitle : done ? t.doneTitle : t.title}</h1>
          </div>
          <div className="inline-flex rounded-xl border border-neutral-300 overflow-hidden text-[12.5px] font-bold shrink-0">
            {(['en', 'es'] as Lang[]).map(l => <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`px-3 py-1.5 ${lang === l ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500'}`}>{l === 'en' ? 'EN' : 'ES'}</button>)}
          </div>
        </div>

        {valid === null ? <p className="text-[14px] text-neutral-500 inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /></p>
          : valid === false ? <p className="text-[15px] text-neutral-700">{t.closed}</p>
          : done ? (
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white inline-flex items-center justify-center mb-3"><Check size={20} /></div>
              <p className="text-[15px] leading-relaxed text-neutral-800">{t.done}</p>
            </div>
          ) : (
            <>
              <p className="text-[14.5px] leading-relaxed text-neutral-700 mb-5">{t.lead}</p>
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-4">
                <div id="hire-name"><label className={LABEL} htmlFor="hf-name">{t.name}</label><input id="hf-name" autoComplete="name" value={f.name} onChange={e => set('name', e.target.value)} className={FIELD + ring('name')} />{bad('name')}</div>
                <div id="hire-email"><label className={LABEL} htmlFor="hf-email">{t.email} <span className="normal-case tracking-normal font-normal">· {t.emailHint}</span></label><input id="hf-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={f.email} onChange={e => set('email', e.target.value)} className={FIELD + ring('email')} />{bad('email')}</div>
                <div id="hire-phone"><label className={LABEL} htmlFor="hf-phone">{t.phone}</label><input id="hf-phone" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={e => set('phone', e.target.value)} className={FIELD + ring('phone')} />{bad('phone')}</div>
                <div id="hire-track"><span className={LABEL}>{t.track}</span><div className="grid grid-cols-1 gap-2">{HIRE_TRACKS.map(x => <button key={x.key} type="button" onClick={() => set('track', x.key)} aria-pressed={f.track === x.key} className={choice(f.track === x.key)}>{x[lang]}</button>)}</div>{bad('track')}</div>
                <div id="hire-market"><span className={LABEL}>{t.market}</span><div className="grid grid-cols-3 gap-2">{HIRE_MARKETS.map(m => <button key={m} type="button" onClick={() => set('market', m)} aria-pressed={f.market === m} className={choice(f.market === m) + ' !text-center'}>{MARKET_WORD[m][lang]}</button>)}</div>{bad('market')}</div>
                <div id="hire-startDate"><label className={LABEL} htmlFor="hf-start">{t.start} <span className="normal-case tracking-normal font-normal">· {t.startHint}</span></label><input id="hf-start" type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} className={FIELD + ring('startDate')} />{bad('startDate')}</div>
                <div id="hire-emergencyPhone">
                  <span className={LABEL}>{t.emergency}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input aria-label={t.emergencyName} placeholder={t.emergencyName} value={f.emergencyName} onChange={e => set('emergencyName', e.target.value)} className={FIELD} />
                    <input aria-label={t.emergencyPhone} placeholder={t.emergencyPhone} type="tel" inputMode="tel" value={f.emergencyPhone} onChange={e => set('emergencyPhone', e.target.value)} className={FIELD + ring('emergencyPhone')} />
                  </div>
                  {bad('emergencyPhone')}
                </div>
                <div><label className={LABEL} htmlFor="hf-note">{t.note} <span className="normal-case tracking-normal font-normal">· {t.noteHint}</span></label><textarea id="hf-note" rows={2} value={f.note} onChange={e => set('note', e.target.value)} className={FIELD} /></div>
                {/* A box people never see. A robot that fills every field fills this one, and what it sent is not kept. */}
                <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={e => set('website', e.target.value)} className="hidden" name="website" />
                {err && err.field === 'form' ? <p className="text-[13.5px] text-rose-700">{err[lang]}</p> : null}
                <button type="button" onClick={send} disabled={busy} className="w-full rounded-xl bg-neutral-900 text-white text-[15px] font-bold py-3 inline-flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <><Loader2 size={16} className="animate-spin" /> {t.sending}</> : t.send}</button>
              </div>
              <p className="text-[12.5px] text-neutral-500 mt-3 leading-relaxed">{t.privacy}</p>
            </>
          )}
      </div>
    </div>
  )
}
