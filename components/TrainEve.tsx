'use client'
// TRAIN EVE ON TODAY (Jon, 2026-11-26). Drawn only for admins, managers and the named trainers
// (/api/eve/train says who). One section, always in the same spot, everything visible:
//   · calls she is not sure of — "I flagged this as safety. Was it?" Yes / No
//   · questions she has raised — answer in place
//   · one box to teach her a sentence
import { useState } from 'react'
import Link from 'next/link'
import { Loader2, GraduationCap, Check } from 'lucide-react'
import { Tag } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'

type Check = { key: string; at: string; unit: string; guest: string; kind: string; headline: string; issues: string[]; link: string | null }
type Question = { id: string; question: string; why?: string | null }
type Resp = { ok: boolean; can: boolean; checks: Check[]; questions: Question[] }

const URL = '/api/eve/train'
const BTN = 'inline-flex items-center gap-1 rounded-lg px-2.5 min-h-[30px] text-[12px] font-semibold whitespace-nowrap disabled:opacity-50'
const DARK = BTN + ' bg-ink text-white'
const LIGHT = BTN + ' border border-line text-ink hover:bg-app/60'
const INPUT = 'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted'

async function post(body: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    return { ok: !!j?.ok, error: j?.error || (r.ok ? undefined : 'Could not save.') }
  } catch { return { ok: false, error: 'Could not reach the server.' } }
}

export function TrainEve() {
  const { data } = useCachedFetch<Resp>(URL, { ttl: 120_000, persist: false })
  const [gone, setGone] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [why, setWhy] = useState<Record<string, string>>({})
  const [ans, setAns] = useState<Record<string, string>>({})
  const [teach, setTeach] = useState('')
  const [saved, setSaved] = useState(false)
  if (!data?.ok || !data.can) return null
  const checks = (data.checks || []).filter(c => !gone['c:' + c.key])
  const questions = (data.questions || []).filter(q => !gone['q:' + q.id])
  const n = checks.length + questions.length

  const run = async (id: string, body: any) => {
    setBusy(id); setErr('')
    const r = await post(body)
    setBusy('')
    if (!r.ok) { setErr(r.error || 'Could not save.'); return false }
    setGone(g => ({ ...g, [id]: true })); invalidateCache(URL)
    return true
  }
  const doTeach = async () => {
    if (!teach.trim()) return
    setBusy('teach'); setErr(''); setSaved(false)
    const r = await post({ op: 'teach', text: teach })
    setBusy('')
    if (!r.ok) { setErr(r.error || 'Could not save.'); return }
    setTeach(''); setSaved(true)
  }

  return (
    <section>
      <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 flex items-center gap-2 text-muted">
        <GraduationCap size={13} /> Train Eve <span className="tabular-nums">{n}</span>
        <Link href="/eve?tab=inbox" className="ml-auto normal-case tracking-normal font-medium hover:text-ink">Eve inbox</Link>
      </h2>
      <div className="rounded-2xl border border-line bg-white divide-y divide-line">
        {checks.map(c => {
          const id = 'c:' + c.key
          const b = busy === id
          return (
            <div key={id} className="px-3 py-2">
              <div className="flex items-start gap-2 min-w-0">
                <Tag tone="rose" title="Eve flagged this as a safety or security matter">Safety?</Tag>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink"><b>{c.unit || 'Unknown unit'}</b>{c.guest ? <span className="text-muted"> · {c.guest}</span> : null}</p>
                  <p className="text-[12px] text-muted">{c.issues.length ? c.issues.join(' · ') : c.headline}</p>
                </div>
                {c.link ? <a href={c.link} className="text-[12px] text-muted hover:text-ink shrink-0">Open</a> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button className={DARK} disabled={b} onClick={() => run(id, { op: 'safety', key: c.key, safety: false, why: why[id] || '' })}>{b ? <Loader2 size={11} className="animate-spin" /> : null}Not safety</button>
                <button className={LIGHT} disabled={b} onClick={() => run(id, { op: 'safety', key: c.key, safety: true, why: why[id] || '' })}>Yes, safety</button>
                <input className={INPUT + ' flex-1 min-w-[160px]'} placeholder="Why (optional) — she learns from this" value={why[id] || ''} onChange={e => setWhy(w => ({ ...w, [id]: e.target.value }))} />
              </div>
            </div>
          )
        })}
        {questions.map(q => {
          const id = 'q:' + q.id
          const b = busy === id
          return (
            <div key={id} className="px-3 py-2">
              <div className="flex items-start gap-2 min-w-0">
                <Tag tone="amber" title="Eve does not know this and it changes what she does">Asks</Tag>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink">{q.question}</p>
                  {q.why ? <p className="text-[12px] text-muted">{q.why}</p> : null}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <input className={INPUT + ' flex-1 min-w-[180px]'} placeholder="Your answer" value={ans[id] || ''} onChange={e => setAns(a => ({ ...a, [id]: e.target.value }))} />
                <button className={DARK} disabled={b || !(ans[id] || '').trim()} onClick={() => run(id, { op: 'answer', id: q.id, answer: ans[id] || '' })}>{b ? <Loader2 size={11} className="animate-spin" /> : null}Answer</button>
                <button className={LIGHT} disabled={b} onClick={() => run(id, { op: 'dismiss', id: q.id })}>Skip</button>
              </div>
            </div>
          )
        })}
        {n === 0 ? <p className="px-3 py-2 text-[12px] text-muted">Nothing she is unsure of right now.</p> : null}
        <div className="px-3 py-2 flex flex-wrap items-center gap-1.5">
          <input className={INPUT + ' flex-1 min-w-[200px]'} placeholder="Teach Eve one thing — e.g. At Elser, building security cannot enter a private unit." value={teach}
            onChange={e => { setTeach(e.target.value); setSaved(false) }} onKeyDown={e => { if (e.key === 'Enter') doTeach() }} />
          <button className={DARK} disabled={busy === 'teach' || !teach.trim()} onClick={doTeach}>{busy === 'teach' ? <Loader2 size={11} className="animate-spin" /> : null}Teach</button>
          {saved ? <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Saved with your name</span> : null}
        </div>
        {err ? <p className="px-3 py-2 text-[12px] text-rose-700">{err}</p> : null}
      </div>
    </section>
  )
}
