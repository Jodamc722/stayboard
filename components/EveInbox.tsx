'use client'
// THE ONE INBOX (2026-11-10) — every thing Eve needs from a person, one queue, ranked.
//
// Reads GET /api/eve/inbox (lib/eve/inbox.ts) and decides through POST /api/eve/inbox, which hands
// each decision to the same function and the same gate the old page used. One row per item: the
// primary action is the button on the row; the rest sit under "more" with the context (what she will
// do, why, links). A queue, so the keyboard works: j / k move, a = the primary action, d = dismiss,
// o or Enter opens the row. Out-of-date rows can be cleared in one go. Her thoughts ("would have
// done") are only under their own filter.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, Loader2, ExternalLink, RefreshCw, ChevronDown, Keyboard } from 'lucide-react'
import { Tag, LeanEmpty } from '@/components/lean'
import { LinkChips } from '@/components/EveBrain'
import { StayPanel } from '@/components/StayPanel'
import { INBOX_URL, KIND_LABEL, KIND_PLURAL, KIND_TONE, decideInbox, primaryOf, ageLabel, type InboxItem, type InboxKind, type InboxAction, type InboxSummary, type InboxResponse } from '@/components/EveInboxCore'

export { INBOX_URL, KIND_LABEL, KIND_TONE, decideInbox, primaryOf, ageLabel }
export type { InboxItem, InboxKind, InboxAction, InboxSummary, InboxResponse }
const ORDER: InboxKind[] = ['approve', 'review_draft', 'loop', 'answer', 'plan', 'note']

const LEVEL_DOT: Record<string, string> = { now: 'bg-rose-500', today: 'bg-amber-400', week: 'bg-sky-300', later: 'bg-slate-200' }
const BTN = 'inline-flex items-center gap-1 rounded-lg px-2.5 min-h-[32px] text-[12px] font-semibold whitespace-nowrap disabled:opacity-50'
const BTN_PRIMARY = BTN + ' bg-ink text-white hover:opacity-90'
const BTN_SECONDARY = BTN + ' border border-line bg-white text-ink hover:bg-app'
const BTN_DANGER = BTN + ' border border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
const btnClass = (s: InboxAction['style']) => (s === 'primary' ? BTN_PRIMARY : s === 'danger' ? BTN_DANGER : BTN_SECONDARY)

export function ActionButton({ a, busy, onRun }: { a: InboxAction; busy?: boolean; onRun: (a: InboxAction) => void }) {
  if (a.href) {
    const ext = /^https?:/.test(a.href)
    return <a href={a.href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined} className={btnClass(a.style)}>{a.label}{ext ? <ExternalLink size={11} /> : null}</a>
  }
  return (
    <button onClick={() => onRun(a)} disabled={busy} className={btnClass(a.style)}>
      {busy && a.style === 'primary' ? <Loader2 size={11} className="animate-spin" /> : a.style === 'primary' ? <Check size={11} /> : a.style === 'danger' ? <X size={11} /> : null} {a.label}
    </button>
  )
}

export function EveInbox({ onCount }: { onCount?: (n: number) => void }) {
  const [kind, setKind] = useState<InboxKind | null>(null)
  const [data, setData] = useState<InboxResponse | null>(null)
  const [all, setAll] = useState<InboxSummary | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [gone, setGone] = useState<Record<string, true>>({})
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [text, setText] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ id: string; text: string; bad: boolean } | null>(null)
  const [bulk, setBulk] = useState('')
  const [keys, setKeys] = useState(false)
  const listRef = useRef<HTMLUListElement | null>(null)
  // Held in a ref so a parent passing a fresh function each render does not re-read the inbox.
  const countRef = useRef(onCount)
  countRef.current = onCount

  const load = useCallback(async (k: InboxKind | null) => {
    setLoading(true)
    try {
      const r: InboxResponse = await fetch(INBOX_URL + '?limit=200' + (k ? '&kind=' + k : ''), { cache: 'no-store' }).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load'); setData(null) }
      else {
        setErr(''); setData(r); setGone({})
        if (!k && r.summary) { setAll(r.summary); countRef.current?.(r.summary.total) }
      }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load(kind) }, [kind, load])

  const live = useMemo(() => (data?.items || []).filter(i => !gone[i.id]), [data, gone])
  const stale = useMemo(() => live.filter(i => i.stale && i.canAct), [live])
  const groups = useMemo(() => {
    const by: Record<string, InboxItem[]> = {}
    for (const i of live) if (i.group && i.canAct && i.kind === 'approve') (by[i.group.key] = by[i.group.key] || []).push(i)
    return Object.values(by).filter(xs => xs.length > 1)
  }, [live])
  useEffect(() => { if (sel >= live.length) setSel(Math.max(0, live.length - 1)) }, [live.length, sel])

  const drop = useCallback((i: InboxItem) => {
    setGone(g => ({ ...g, [i.id]: true }))
    setAll(s => {
      if (!s) return s
      const counts = { ...s.counts, [i.kind]: Math.max(0, (s.counts[i.kind] || 0) - 1) }
      const total = i.kind === 'decide' || i.stale ? s.total : Math.max(0, s.total - 1)
      countRef.current?.(total)
      return { ...s, counts, total, stale: i.stale ? Math.max(0, s.stale - 1) : s.stale }
    })
  }, [])

  const run = useCallback(async (i: InboxItem, a: InboxAction, opts: { quiet?: boolean } = {}): Promise<boolean> => {
    if (a.href) { window.open(a.href, /^https?:/.test(a.href) ? '_blank' : '_self'); return false }
    if (a.input === 'answer' && !(text[i.id] || '').trim()) { setOpen(o => ({ ...o, [i.id]: true })); setMsg({ id: i.id, text: 'Write the answer first.', bad: true }); return false }
    if (!opts.quiet && a.confirm && !window.confirm(a.confirm)) return false
    setBusy(i.id)
    const t = a.input === 'draft' ? (text[i.id] ?? i.draft ?? '') : a.input === 'answer' ? text[i.id] : undefined
    const r = await decideInbox(i, a, { text: t, note: notes[i.id] })
    setBusy('')
    // A row that left cannot carry its own message, so that one is said above the list.
    if (!opts.quiet || !r.ok) setMsg({ id: r.gone ? '' : i.id, text: r.msg, bad: !r.ok })
    if (r.gone) drop(i)
    return r.ok
  }, [text, notes, drop])

  const clearStale = async () => {
    if (!stale.length || !window.confirm(`Clear ${stale.length} out-of-date item${stale.length === 1 ? '' : 's'}? Each is declined / discarded the way its own button would.`)) return
    let done = 0, failed = 0
    for (const i of stale) {
      setBulk(`${done + failed + 1}/${stale.length}`)
      const a = i.actions.find(x => x.key === i.dismissKey)
      if (!a) { failed++; continue }
      const ok = await run(i, a, { quiet: true })
      if (ok) done++; else failed++
    }
    setBulk('')
    setMsg({ id: '', text: failed ? `${done} cleared, ${failed} did not — they are still in the list.` : `${done} cleared.`, bad: failed > 0 })
  }
  const runGroup = async (xs: InboxItem[], key: 'approve' | 'reject') => {
    if (!window.confirm(`${key === 'approve' ? 'Approve' : 'Decline'} all ${xs.length}? Each one is ${key === 'approve' ? 'carried out' : 'declined'} on its own.`)) return
    let done = 0
    for (const i of xs) {
      setBulk(`${done + 1}/${xs.length}`)
      const a = i.actions.find(x => x.key === key)
      if (a && await run(i, a, { quiet: true })) done++
    }
    setBulk('')
    setMsg({ id: '', text: `${done} of ${xs.length} ${key === 'approve' ? 'approved' : 'declined'}.`, bad: done < xs.length })
  }

  // THE KEYBOARD — a queue is worked from the keys. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (!live.length) return
      const cur = live[Math.min(sel, live.length - 1)]
      if (e.key === 'j') { e.preventDefault(); setSel(s => Math.min(live.length - 1, s + 1)) }
      else if (e.key === 'k') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
      else if (e.key === 'o' || (e.key === 'Enter' && !(t && (t.tagName === 'BUTTON' || t.tagName === 'A')))) { e.preventDefault(); setOpen(o => ({ ...o, [cur.id]: !o[cur.id] })) }
      else if (e.key === 'a') { const p = primaryOf(cur); if (p && cur.canAct && busy !== cur.id) { e.preventDefault(); run(cur, p) } }
      else if (e.key === 'd') { const d = cur.actions.find(x => x.key === cur.dismissKey); if (d && busy !== cur.id) { e.preventDefault(); run(cur, d) } }
      else if (e.key === '?') setKeys(k => !k)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, sel, busy, run])
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-ix="${sel}"]`) as HTMLElement | null
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const counts = all?.counts
  const chips: { k: InboxKind | null; label: string; n: number | null }[] = [{ k: null, label: 'All', n: all ? all.total : null }]
  for (const k of ORDER) if ((counts && counts[k]) || kind === k) chips.push({ k, label: KIND_PLURAL[k], n: counts ? counts[k] : null })
  if (data?.viewer?.thoughts || kind === 'decide') chips.push({ k: 'decide', label: KIND_PLURAL.decide, n: counts ? counts.decide : null })

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {chips.map(c => (
          <button key={c.k || 'all'} onClick={() => { setKind(c.k); setSel(0) }}
            className={`rounded-lg px-2.5 min-h-[30px] text-[12px] font-semibold border ${kind === c.k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>
            {c.label}{c.n != null ? <span className="tabular-nums ml-1 opacity-80">{c.n}</span> : null}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          {stale.length ? (
            <button onClick={clearStale} disabled={!!bulk} className={BTN_SECONDARY} title="Declines / discards every out-of-date row, each the way its own button would">
              {bulk ? <><Loader2 size={11} className="animate-spin" /> {bulk}</> : <>Clear {stale.length} out of date</>}
            </button>
          ) : null}
          <button onClick={() => setKeys(k => !k)} className="hidden sm:inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink px-1 min-h-[30px]" title="Keyboard shortcuts"><Keyboard size={13} /> keys</button>
          <button onClick={() => load(kind)} className="inline-flex items-center text-muted hover:text-ink p-1.5" aria-label="Refresh the inbox"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </span>
      </div>
      {keys ? <p className="text-[11.5px] text-muted mb-2 px-1"><b>j</b> / <b>k</b> move · <b>a</b> the row&apos;s main button · <b>d</b> dismiss · <b>o</b> or <b>Enter</b> open · <b>?</b> this line</p> : null}
      {kind === 'decide' ? <p className="text-[12px] text-muted mb-2 px-1">What she would have done and did not — she was only observing. Do it once, tell her not this (your reason becomes a rule), or have that watch ask you next time.</p> : null}
      {data?.partial ? <p className="text-[11.5px] text-amber-800 mb-2 px-1">Some of it could not be read just now — this list may be short.</p> : null}
      {msg && !msg.id ? <p className={`text-[12px] mb-2 px-1 ${msg.bad ? 'text-rose-700' : 'text-emerald-700'}`}>{msg.text}</p> : null}

      {groups.map(xs => (
        <div key={xs[0].group!.key} className="mb-2 rounded-xl border border-line bg-white px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-ink flex-1 min-w-[200px]">{xs.length} × {xs[0].group!.label}</span>
          <span className="text-[11.5px] text-muted">{Array.from(new Set(xs.map(x => x.unit).filter(Boolean))).slice(0, 4).join(', ')}</span>
          <button onClick={() => runGroup(xs, 'approve')} disabled={!!bulk} className={BTN_PRIMARY}><Check size={11} /> Approve all</button>
          <button onClick={() => runGroup(xs, 'reject')} disabled={!!bulk} className={BTN_DANGER}><X size={11} /> Decline all</button>
        </div>
      ))}

      {err && !data ? <LeanEmpty>{err}</LeanEmpty>
        : !data ? <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading what she needs from you…</LeanEmpty>
        : !live.length ? <LeanEmpty>{kind === 'decide' ? 'No open thoughts.' : kind ? 'Nothing of this kind waiting.' : 'Nothing needs you. No approvals, drafts, questions, plans or late loops.'}</LeanEmpty>
        : (
          <ul ref={listRef} className="rounded-2xl border border-line bg-white divide-y divide-line/70">
            {live.map((i, ix) => (
              <InboxRow key={i.id} i={i} ix={ix} selected={ix === sel} open={!!open[i.id]} busy={busy === i.id}
                onSelect={() => setSel(ix)} onToggle={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))}
                text={text[i.id]} setText={v => setText(t => ({ ...t, [i.id]: v }))}
                note={notes[i.id] || ''} setNote={v => setNotes(n => ({ ...n, [i.id]: v }))}
                msg={msg && msg.id === i.id ? msg : null} run={a => run(i, a)} />
            ))}
          </ul>
        )}
    </div>
  )
}

function InboxRow({ i, ix, selected, open, busy, onSelect, onToggle, text, setText, note, setNote, msg, run }: {
  i: InboxItem; ix: number; selected: boolean; open: boolean; busy: boolean
  onSelect: () => void; onToggle: () => void
  text: string | undefined; setText: (v: string) => void; note: string; setNote: (v: string) => void
  msg: { text: string; bad: boolean } | null; run: (a: InboxAction) => void
}) {
  const primary = primaryOf(i)
  const rest = i.actions.filter(a => a !== primary)
  const needsAnswer = i.actions.some(a => a.input === 'answer')
  const editsDraft = i.actions.some(a => a.input === 'draft')
  const takesNote = i.actions.some(a => a.input === 'note')
  const meta = [i.unit || i.building || '', i.urgency.reason, i.source, ageLabel(i.urgency.ageHours)].filter(Boolean).join(' · ')
  return (
    <li data-ix={ix} onClick={onSelect} className={selected ? 'bg-brand-50/40 outline outline-1 outline-brand-200 -outline-offset-1' : ''}>
      <div className="flex items-center gap-x-2 gap-y-1.5 px-3 py-2 min-h-[48px] flex-wrap sm:flex-nowrap">
        <span title={i.urgency.level} className={`w-1.5 h-1.5 rounded-full shrink-0 ${i.stale ? 'bg-transparent' : LEVEL_DOT[i.urgency.level]}`} aria-hidden />
        <button onClick={e => { e.stopPropagation(); onSelect(); onToggle() }} aria-expanded={open} className="flex-1 min-w-[60%] sm:min-w-0 text-left">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13.5px] font-semibold text-ink leading-snug">{i.title}</span>
            <Tag tone={KIND_TONE[i.kind]}>{KIND_LABEL[i.kind]}</Tag>
            {i.urgency.guest ? <Tag tone="rose">guest</Tag> : null}
            {i.urgency.money ? <Tag tone="amber">money</Tag> : null}
            {i.urgency.due ? <Tag tone="brand">due {i.urgency.due.slice(5)}</Tag> : null}
            {i.stale ? <Tag tone="slate">out of date</Tag> : null}
            {i.dupes?.length ? <Tag tone="slate" title="She filed this same thing more than once; deciding this one clears the copies">filed {i.dupes.length + 1}×</Tag> : null}
            {i.also?.length ? <Tag tone="slate" title={'Also in: ' + i.also.map(a => KIND_LABEL[a.kind]).join(', ')}>+{i.also.length} same</Tag> : null}
          </span>
          <span className="block text-[11.5px] text-muted truncate">{meta}</span>
        </button>
        <span className="flex items-center gap-1 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
          {primary && (i.canAct || primary.href) ? <ActionButton a={primary} busy={busy} onRun={a => (a.input === 'answer' && !open ? onToggle() : run(a))} /> : null}
          <button onClick={onToggle} className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-0.5 px-1.5 min-h-[32px]" aria-label={open ? 'Less' : 'More'}>
            more <ChevronDown size={13} className={open ? 'rotate-180 transition' : 'transition'} />
          </button>
        </span>
      </div>
      {msg ? <p className={`px-3 -mt-1 pb-1.5 pl-6 text-[11.5px] font-semibold ${msg.bad ? 'text-rose-700' : 'text-emerald-700'}`}>{msg.text}</p> : null}
      {open && (
        <div className="px-3 pb-3 pl-6 space-y-2" onClick={e => e.stopPropagation()}>
          {i.why ? <p className="text-[12.5px] text-ink/85"><b>Why:</b> {i.why}</p> : null}
          {i.detail.filter(d => !(editsDraft && d.text === i.draft)).map((d, k) => (
            <div key={k}>
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-0.5">{d.label}</div>
              <div className="text-[13px] text-ink whitespace-pre-wrap rounded-lg px-3 py-2 bg-app border border-line">{d.text}</div>
            </div>
          ))}
          {editsDraft && i.canAct ? (
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-0.5">The reply — edit before it goes</div>
              <textarea value={text ?? i.draft ?? ''} onChange={e => setText(e.target.value)} rows={4} aria-label="Eve's draft"
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
          ) : null}
          {needsAnswer && i.canAct ? (
            <input autoFocus value={text || ''} onChange={e => setText(e.target.value)} placeholder="Tell her… (your answer becomes her memory, with your name on it)"
              onKeyDown={e => { if (e.key === 'Enter' && (text || '').trim() && primary) run(primary) }}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200" />
          ) : null}
          {takesNote && i.canAct ? (
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why not? (optional — she learns from it)"
              className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200" />
          ) : null}
          <LinkChips links={i.links} />
          {i.also?.length ? <p className="text-[11.5px] text-muted">Also showing up as: {i.also.map(a => `${KIND_LABEL[a.kind]} (${a.source})`).join(' · ')} — the same thing, listed once here.</p> : null}
          {i.reservationId ? <StayPanel reservationId={i.reservationId} compact /> : null}
          <div className="flex items-center gap-1.5 flex-wrap">
            {rest.filter(a => i.canAct || a.href).map(a => <ActionButton key={a.key} a={a} busy={busy} onRun={run} />)}
            {!i.canAct ? <span className="text-[11.5px] text-muted">Your role can see this but not decide it.</span> : null}
          </div>
        </div>
      )}
    </li>
  )
}
