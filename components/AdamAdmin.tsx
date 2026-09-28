'use client'
// ADAM'S PAGE — what the Garden Hotel's agent knows, how he is told to sound, which model he runs
// on, and what he has been asked. The hotel's counterpart to Settings → Eve, kept on the hotel side.
import { useCallback, useEffect, useState } from 'react'
import { Hotel, Trash2, Loader2, Check, ThumbsUp, ThumbsDown } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'
import { openAdam } from '@/components/AdamFloat'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json() }
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const TIER_LABEL: Record<string, string> = { fable: 'Fable 5.1', opus: 'Opus 4.8', sonnet: 'Sonnet 5', 'sonnet-prev': 'Sonnet 4.6', haiku: 'Haiku 4.5' }

export function AdamAdmin({ owner, canEdit }: { owner: boolean; canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [tab, setTab] = useState<'memory' | 'chats' | 'voice'>('memory')
  const [teach, setTeach] = useState('')
  const [name, setName] = useState('')
  const [direction, setDirection] = useState('')
  const [saved, setSaved] = useState('')
  const load = useCallback(async () => { const r = await j('/api/garden/adam'); setD(r); if (r?.ok) { setName(r.settings.name); setDirection(r.settings.direction) } }, [])
  useEffect(() => { load() }, [load])

  const addTeach = async () => { if (!teach.trim()) return; await j('/api/garden/adam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teach: teach.trim() }) }); setTeach(''); load() }
  const forget = async (id: string) => { await j('/api/garden/adam', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); load() }
  const save = async (patch: any) => { const r = await j('/api/garden/adam', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); setSaved(r?.ok ? 'Saved' : (r?.error || 'Could not save')); setTimeout(() => setSaved(''), 2000); load() }

  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Adam" icon={<Hotel size={20} className="text-emerald-700" />} /><LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 116_garden_adam.sql, then reload.' : d.error}</LeanEmpty></>
  const s = d.settings
  return (
    <>
      <LeanHead title={s.name} icon={<Hotel size={20} className="text-emerald-700" />}>
        <Pill tone={s.enabled ? 'emerald' : 'slate'} title="On or off">{s.enabled ? 'on' : 'off'}</Pill>
        <Pill tone="brand" title="Model — change it in Users & admin → Settings → AI models (task: Adam)">{TIER_LABEL[d.tier] || d.tier}</Pill>
        <Pill title="What he has been taught">{d.memories.length} memories</Pill>
        <Pill title="Questions answered">{d.chats.length} recent chats</Pill>
        <button onClick={() => openAdam()} className="rounded-lg bg-emerald-700 text-white px-2.5 h-7 text-[12px] font-semibold">Ask {s.name}</button>
      </LeanHead>
      <p className="text-[12.5px] text-muted mb-3">The Garden Hotel&apos;s own agent — his own memory, his own chat log, his own model. He knows nothing about the vacation rentals and Eve knows nothing about the hotel; that is by design.</p>
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'memory', label: 'What he knows', n: d.memories.length }, { key: 'chats', label: 'Recent chats', n: d.chats.length }, { key: 'voice', label: 'Voice & model' }]} />
      {tab === 'memory' ? (<>
        {canEdit ? (
          <div className="flex gap-2 mb-3">
            <input value={teach} onChange={e => setTeach(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTeach() }} placeholder="Teach him a rule or a fact about the hotel…" className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:border-brand-500" />
            <button onClick={addTeach} className="rounded-xl bg-ink text-white px-3 text-[12px] font-semibold">Remember</button>
          </div>
        ) : null}
        {d.memories.length ? (
          <LeanList>{d.memories.map((m: any) => (
            <LeanRow key={m.id} name={m.content} meta={`${m.subject ? m.subject + ' · ' : ''}${m.by_email || m.source} · ${when(m.created_at)}`}
              tags={<Tag tone={m.kind === 'correction' ? 'rose' : m.kind === 'rule' ? 'amber' : 'slate'}>{m.kind}</Tag>}
              actions={canEdit ? <IconBtn title="Forget this" tone="bad" onClick={() => forget(m.id)}><Trash2 size={14} /></IconBtn> : undefined} />
          ))}</LeanList>
        ) : <LeanEmpty>Nothing yet. Tell him how the hotel works — here, or in a chat — and it lands on this list.</LeanEmpty>}
      </>) : null}
      {tab === 'chats' ? (d.chats.length ? (
        <LeanList>{d.chats.map((c: any) => (
          <LeanRow key={c.id} name={c.question} meta={`${c.email || ''} · ${when(c.created_at)}${c.model ? ' · ' + c.model : ''}`}
            tags={<>{c.rating === 1 ? <Tag tone="emerald"><ThumbsUp size={10} /></Tag> : c.rating === -1 ? <Tag tone="rose"><ThumbsDown size={10} /></Tag> : null}{(c.tools || []).length ? <Tag>{(c.tools || []).join(' · ')}</Tag> : null}</>}>
            <p className="text-[12.5px] text-ink/85 whitespace-pre-wrap">{c.reply}</p>
            {c.note ? <p className="text-[12px] text-rose-700">Correction: {c.note}</p> : null}
          </LeanRow>
        ))}</LeanList>
      ) : <LeanEmpty>No chats yet.</LeanEmpty>) : null}
      {tab === 'voice' ? (
        <LeanSection title="How he is told to sound" right={saved ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> {saved}</span> : null}>
          <div className="rounded-2xl border border-line bg-white p-4 space-y-3 text-[13px]">
            <label className="block"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Name</span>
              <input value={name} onChange={e => setName(e.target.value)} disabled={!owner} className="mt-1 w-full max-w-xs rounded-lg border border-line bg-white px-3 py-2 disabled:opacity-60" /></label>
            <label className="block"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Direction</span>
              <textarea value={direction} onChange={e => setDirection(e.target.value)} disabled={!owner} rows={4} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 disabled:opacity-60" /></label>
            <div className="flex items-center gap-2 flex-wrap">
              {owner ? <button onClick={() => save({ name, direction })} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold">Save</button> : <span className="text-muted">An owner edits this.</span>}
              {owner ? <button onClick={() => save({ enabled: !s.enabled })} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold">{s.enabled ? `Switch ${s.name} off` : `Switch ${s.name} on`}</button> : null}
              <span className="text-muted">Model: <b className="text-ink">{TIER_LABEL[d.tier] || d.tier}</b> — pick another in Users &amp; admin → Settings → AI models → Garden Hotel.</span>
            </div>
          </div>
        </LeanSection>
      ) : null}
    </>
  )
}
