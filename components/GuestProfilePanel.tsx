'use client'
// WHO IS ARRIVING — the understanding log on a reservation (Jon, 2026-10-14).
//
// Three things in one panel, in the order somebody needs them: the tags and the repeat flag at a
// glance, the questions with their answers, and the exact brief the field team will read. The
// brief is shown rather than hidden on purpose — a brief you cannot see is a brief you cannot
// correct, and this one lands on a cleaner's task.
//
// EVERY ANSWER CARRIES ITS PROVENANCE. A dot next to a field says whether a person heard it or a
// model read it off a transcript. The difference decides whether you put a crib in a room.
import { useCallback, useEffect, useState } from 'react'
import { Tag } from '@/components/lean'
import { UNDERSTANDING_FIELDS, type Understanding } from '@/lib/guest-profile'
import { Send, Check, RefreshCw, UserRound } from 'lucide-react'

type Loaded = {
  stay: Understanding
  profile: { data: Understanding; tags: string[]; stays: number; first_seen: string | null; last_seen: string | null } | null
  tags: string[]
  stays: number
  repeat: boolean
  brief: string
  targets: { id: string; name: string | null }[]
  pushed: { bz_task_id: string; pushed_at: string }[]
  source: string | null
}

export function GuestProfilePanel({ reservationId }: { reservationId: string }) {
  const [d, setD] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState<Understanding>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/guest-profile?reservation=${encodeURIComponent(reservationId)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.message || j.error || 'Could not load')
      setD(j); setDraft(j.stay || {}); setDirty(false); setErr(null)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [reservationId])
  useEffect(() => { load() }, [load])

  const set = (k: string, v: any) => { setDraft(p => ({ ...p, [k]: v })); setDirty(true) }

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/guest-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, data: draft }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.message || j.error || 'Could not save')
      setDirty(false); setMsg('Saved.')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setBusy(false) }
  }

  const push = async () => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      if (dirty) await save()
      const r = await fetch('/api/guest-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', reservationId }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Push failed')
      setMsg(j.report?.pushed ? `Sent to ${j.report.pushed} Breezeway task${j.report.pushed === 1 ? '' : 's'}.` : 'Nothing to send — the brief on those tasks is already current.')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setBusy(false) }
  }

  if (err && !d) return <div className="text-[12.5px] text-rose-600">{err}</div>
  if (!d) return <div className="text-[12.5px] text-slate-500">Loading…</div>

  const heard = (k: string) => d.stay.heard?.[k] || d.profile?.data?.heard?.[k]
  const known = (k: string) => (d.profile?.data as any)?.[k]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5"><UserRound size={15} /> Who is arriving</h2>
        {d.repeat && <Tag tone="violet" title={`${d.stays} stays with us${d.profile?.first_seen ? ` since ${d.profile.first_seen}` : ''}`}>Returning · stay {d.stays}</Tag>}
        {d.tags.filter(t => !/^(Repeat guest|First stay|Regular)$/.test(t)).map(t => <Tag key={t} tone="sky">{t}</Tag>)}
        {d.source && <span className="text-[11px] text-slate-400">{d.source === 'call' ? 'from the call' : d.source === 'mixed' ? 'call + typed' : 'typed'}</span>}
        <button onClick={load} title="Reload" className="ml-auto text-slate-400 hover:text-slate-700"><RefreshCw size={13} /></button>
      </div>

      {msg && <div className="rounded-lg bg-emerald-50 text-emerald-700 text-[12.5px] px-3 py-2 border border-emerald-200">{msg}</div>}
      {err && <div className="rounded-lg bg-rose-50 text-rose-700 text-[12.5px] px-3 py-2 border border-rose-200">{err}</div>}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {UNDERSTANDING_FIELDS.map(f => {
          const k = String(f.key)
          const v = (draft as any)[k]
          const how = heard(k)
          const fromBefore = v === undefined && known(k) !== undefined ? known(k) : null
          return (
            <label key={k} className="block" title={f.help}>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1">
                {f.label}
                {how && <span title={how === 'said' ? 'The guest said this' : 'Read from a call transcript — worth confirming'}
                  className={`w-1.5 h-1.5 rounded-full ${how === 'said' ? 'bg-emerald-500' : 'bg-amber-400'}`} />}
              </span>
              {f.type === 'area' ? (
                <textarea rows={2} value={v ?? ''} onChange={e => set(k, e.target.value)}
                  placeholder={fromBefore ? String(fromBefore) : ''}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]" />
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={Array.isArray(v) ? v.join(', ') : (v ?? '')}
                  onChange={e => set(k, e.target.value)}
                  placeholder={fromBefore ? (Array.isArray(fromBefore) ? fromBefore.join(', ') : String(fromBefore)) : f.type === 'list' ? 'comma separated' : ''}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]" />
              )}
              {fromBefore != null && v === undefined && <span className="block text-[10.5px] text-slate-400 mt-0.5">From a previous stay</span>}
            </label>
          )
        })}
      </div>

      {/* Exactly what a cleaner will read, before it is sent. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="text-[12px] font-semibold text-slate-700">What the field team sees</span>
          <span className="text-[11px] text-slate-500">
            {d.targets.length
              ? `${d.targets.length} task${d.targets.length === 1 ? '' : 's'}: ${d.targets.map(t => t.name || t.id).join(' · ')}`
              : 'No arrival clean or inspection found on this unit yet'}
          </span>
          {d.pushed.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><Check size={11} /> sent</span>}
        </div>
        <pre className="text-[12.5px] text-slate-800 whitespace-pre-wrap font-sans leading-snug">{d.brief || 'Nothing worth telling them yet.'}</pre>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={busy || !dirty}
          className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40">
          {dirty ? 'Save' : 'Saved'}
        </button>
        <button onClick={push} disabled={busy || !d.targets.length}
          title={d.targets.length ? 'Write this brief onto the arrival clean and inspections in Breezeway' : 'Nothing to push to yet'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-600 text-brand-700 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40">
          <Send size={13} /> Send to Breezeway
        </button>
        <span className="text-[11px] text-slate-400">It also goes out on its own every half hour — this is for when you want it there now.</span>
      </div>
    </div>
  )
}
