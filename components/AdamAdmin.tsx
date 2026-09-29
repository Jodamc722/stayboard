'use client'
// ADAM'S PAGE — what the Garden Hotel's agent knows, how he is told to sound, which model he runs
// on, and what he has been asked. The hotel's counterpart to Settings → Eve, kept on the hotel side.
import { useCallback, useEffect, useState } from 'react'
import { Hotel, Trash2, Loader2, Check, ThumbsUp, ThumbsDown, FileText } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'
import { openAdam } from '@/components/AdamFloat'
import { AgentFileDrop } from '@/components/AgentFileDrop'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json() }
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const TIER_LABEL: Record<string, string> = { fable: 'Fable 5.1', opus: 'Opus 4.8', sonnet: 'Sonnet 5', 'sonnet-prev': 'Sonnet 4.6', haiku: 'Haiku 4.5' }

// `only="voice"` renders just his name / direction / on-off inside Users & admin → Settings (the
// same place Eve's live); without it this is his tab — what he knows, files, questions, chats.
export function AdamAdmin({ owner, canEdit, only }: { owner: boolean; canEdit: boolean; only?: 'voice' }) {
  const [d, setD] = useState<any | null>(null)
  const [tab, setTab] = useState<'memory' | 'files' | 'questions' | 'shared' | 'chats' | 'voice'>(only || 'memory')
  const [lib, setLib] = useState<any | null>(null)
  const [fd, setFd] = useState<any>({ title: '', category: 'sop', body: '', source: '', file_path: '' })
  const [fmsg, setFmsg] = useState('')
  const loadLib = useCallback(async () => setLib(await j('/api/garden/adam/docs')), [])
  useEffect(() => { if (tab === 'files' && !lib) loadLib() }, [tab, lib, loadLib])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [share, setShare] = useState({ title: '', body: '' })
  const [teach, setTeach] = useState('')
  const [name, setName] = useState('')
  const [direction, setDirection] = useState('')
  const [saved, setSaved] = useState('')
  const load = useCallback(async () => { const r = await j('/api/garden/adam'); setD(r); if (r?.ok) { setName(r.settings.name); setDirection(r.settings.direction) } }, [])
  useEffect(() => { load() }, [load])

  const addTeach = async () => { if (!teach.trim()) return; await j('/api/garden/adam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teach: teach.trim() }) }); setTeach(''); load() }
  const forget = async (id: string) => { await j('/api/garden/adam', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); load() }
  const postJ = async (body: any) => { await j('/api/garden/adam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); load() }
  const save = async (patch: any) => { const r = await j('/api/garden/adam', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); setSaved(r?.ok ? 'Saved' : (r?.error || 'Could not save')); setTimeout(() => setSaved(''), 2000); load() }

  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Adam" icon={<Hotel size={20} className="text-emerald-700" />} /><LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 116_garden_adam.sql, then reload.' : d.error}</LeanEmpty></>
  const s = d.settings
  return (
    <>
      {!only ? <>
      <LeanHead title={s.name} icon={<Hotel size={20} className="text-emerald-700" />}>
        <Pill tone={s.enabled ? 'emerald' : 'slate'} title="On or off">{s.enabled ? 'on' : 'off'}</Pill>
        <Pill tone="brand" title="Model and voice — Users & admin → Settings">{TIER_LABEL[d.tier] || d.tier}</Pill>
        <Pill title="What he has been taught">{d.memories.length} memories</Pill>
        <Pill title="Questions answered">{d.chats.length} recent chats</Pill>
        <button onClick={() => openAdam()} className="rounded-lg bg-emerald-700 text-white px-2.5 h-7 text-[12px] font-semibold">Ask {s.name}</button>
      </LeanHead>
      <p className="text-[12.5px] text-muted mb-3">The Garden Hotel&apos;s own agent — his own memory, his own chat log, his own model. He knows nothing about the vacation rentals and Eve knows nothing about the hotel; that is by design.</p>
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'memory', label: 'What he knows', n: d.memories.length }, { key: 'files', label: 'Files', n: lib?.docs?.filter((x: any) => x.active).length }, { key: 'questions', label: 'His questions', n: (d.questions || []).filter((q: any) => q.status === 'open').length }, { key: 'shared', label: 'Shared from Stay', n: (d.shared || []).length }, { key: 'chats', label: 'Recent chats', n: d.chats.length }]} />
      </> : null}
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
      {tab === 'files' ? (<>
        <p className="text-[12.5px] text-muted mb-2">The hotel&apos;s written material — handbook files, SOPs, policies, training, reference. Upload a file, check the text, and file it: he reads it once and keeps the rules it states as memories, and can search and quote the whole thing any time.</p>
        {canEdit ? (
          <div className="rounded-2xl border border-line bg-white p-3 mb-3 space-y-2">
            <AgentFileDrop forWho="adam" onText={f => { setFd((x: any) => ({ ...x, body: f.text, source: f.name, file_path: f.path || '', title: x.title || f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') })); setFmsg(`Read ${f.name} (${f.method}) — ${f.words.toLocaleString()} words. Check it, then file it.`) }} />
            {fd.body ? (<>
              <div className="flex gap-2 flex-wrap">
                <input value={fd.title} onChange={e => setFd({ ...fd, title: e.target.value })} placeholder="Title — he quotes this name" className="flex-1 min-w-[12rem] rounded-xl border border-line bg-white px-3 py-2 text-sm" />
                <select value={fd.category} onChange={e => setFd({ ...fd, category: e.target.value })} className="rounded-xl border border-line bg-white px-3 py-2 text-sm">{(lib?.categories || ['handbook', 'sop', 'policy', 'training', 'reference']).map((c: string) => <option key={c} value={c}>{c}</option>)}</select>
              </div>
              <textarea value={fd.body} onChange={e => setFd({ ...fd, body: e.target.value })} rows={10} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-mono" />
              <div className="flex items-center gap-2">
                <button onClick={async () => { setFmsg('Filing and reading…'); const r = await j('/api/garden/adam/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) }); if (r?.ok) { setFmsg(`${r.replaced ? 'Replaced' : 'Filed'} "${r.title}" — ${r.sections} sections; learned ${r.learned.length} rules.`); setFd({ title: '', category: fd.category, body: '', source: '', file_path: '' }); loadLib(); load() } else setFmsg(r?.error || r?.message || 'Could not file it.') }} className="rounded-xl bg-ink text-white px-3 py-1.5 text-[12px] font-semibold">File it &amp; learn</button>
                <button onClick={() => { setFd({ title: '', category: fd.category, body: '', source: '', file_path: '' }); setFmsg('') }} className="rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold">Discard</button>
              </div>
            </>) : null}
            {fmsg ? <p className="text-[12px] text-emerald-800">{fmsg}</p> : null}
          </div>
        ) : null}
        {!lib ? <p className="text-[13px] text-muted">Loading…</p> : !lib.ok ? <LeanEmpty>{/does not exist|schema cache/i.test(lib.error || '') ? 'Run migration 136_agent_files.sql, then reload.' : lib.error}</LeanEmpty> : lib.docs.filter((x: any) => x.active).length ? (
          <LeanList>{lib.docs.filter((x: any) => x.active).map((x: any) => (
            <LeanRow key={x.id} name={x.title} meta={`${x.words.toLocaleString()} words · ${x.added_by || ''} · ${when(x.updated_at)}`}
              tags={<><Tag>{x.category}</Tag>{x.learned ? <Tag tone="emerald">{x.learned} learned</Tag> : null}</>}
              actions={<>
                {x.file_path ? <IconBtn title="Open the original" href={`/api/files/open?path=${encodeURIComponent(x.file_path)}`}><FileText size={14} /></IconBtn> : null}
                {canEdit ? <IconBtn title="Retire (he stops quoting it; memories stay until you forget them)" tone="bad" onClick={async () => { await j('/api/garden/adam/docs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id }) }); loadLib() }}><Trash2 size={14} /></IconBtn> : null}
              </>} />
          ))}</LeanList>
        ) : <LeanEmpty>No files yet. Upload the hotel&apos;s handbook, SOPs and policies — he learns from each one.</LeanEmpty>}
      </>) : null}
      {tab === 'questions' ? ((d.questions || []).length ? (
        <LeanList>{(d.questions || []).map((q: any) => (
          <LeanRow key={q.id} name={q.question} meta={`${q.subject ? q.subject + ' · ' : ''}${when(q.created_at)}`} defaultOpen={q.status === 'open'}
            tags={<Tag tone={q.status === 'open' ? 'amber' : q.status === 'answered' ? 'emerald' : 'slate'}>{q.status}</Tag>}>
            {q.context ? <p className="text-[12px] text-muted">{q.context}</p> : null}
            {q.status === 'open' && canEdit ? (
              <div className="flex gap-2">
                <input value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="The answer — it becomes one of his memories" className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm" />
                <button onClick={() => postJ({ answer: { id: q.id, text: answers[q.id] || '' } })} className="rounded-xl bg-ink text-white px-3 text-[12px] font-semibold">Answer</button>
                <button onClick={() => postJ({ answer: { id: q.id, dismiss: true } })} className="rounded-xl border border-line px-3 text-[12px] font-semibold">Dismiss</button>
              </div>
            ) : q.answer ? <p className="text-[12.5px] text-ink/85">{q.answer} <span className="text-muted">— {q.answered_by}</span></p> : null}
          </LeanRow>
        ))}</LeanList>
      ) : <LeanEmpty>No questions yet. When he meets a policy he has not been told, he asks here; your answer becomes a memory.</LeanEmpty>) : null}
      {tab === 'shared' ? (<>
        <p className="text-[12.5px] text-muted mb-2">The only bridge between the two brains: company-wide facts from the Stay Hospitality side that also apply to the hotel. Adam reads these; nothing else Eve knows reaches him.</p>
        {owner ? (
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={share.title} onChange={e => setShare({ ...share, title: e.target.value })} placeholder="Title, e.g. Company payroll day" className="w-56 rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            <input value={share.body} onChange={e => setShare({ ...share, body: e.target.value })} placeholder="What both agents should know" className="flex-1 min-w-[14rem] rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            <button onClick={async () => { await postJ({ share }); setShare({ title: '', body: '' }) }} className="rounded-xl bg-ink text-white px-3 text-[12px] font-semibold">Share</button>
          </div>
        ) : null}
        {(d.shared || []).length ? <LeanList>{(d.shared || []).map((k: any) => (
          <LeanRow key={k.id} name={k.title} meta={`${k.created_by || ''} · ${when(k.created_at)}`} actions={owner ? <IconBtn title="Stop sharing" tone="bad" onClick={() => postJ({ unshare: k.id })}><Trash2 size={14} /></IconBtn> : undefined}>
            <p className="text-[12.5px] text-ink/85">{k.body}</p>
          </LeanRow>
        ))}</LeanList> : <LeanEmpty>Nothing shared. Adam knows nothing of the vacation-rental side.</LeanEmpty>}
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
