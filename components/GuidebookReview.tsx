'use client'
// PAGE-BY-PAGE GUIDEBOOK REVIEW (Jon, 2026-11-06). Left: the review pages with a tick and their flag
// counts. Middle: the live guest guide (/g/<id>) in a phone frame, scrolled to that page — or the printed
// manual for the "Printed manual" page. Right: that page's flags, "Looks good → next page", a note.
// Top: Guest view · Printable view · Magazine · Edit · Check photos · Approve & push to Guesty.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ExternalLink, Loader2, Pencil, Printer, BookOpen, Smartphone, Images, RotateCw, ShieldCheck } from 'lucide-react'
import { REVIEW_PAGES, type Flag, type ReviewState } from '@/lib/guidebook-audit'

const ANCHOR: Record<string, string> = { cover: '', essentials: 'g-essentials', arrival: 'g-arrival', howto: 'g-howto', rules: 'g-rules', local: 'g-explore', checkout: 'g-checkout', help: 'g-help' }
const LEVEL: Record<Flag['level'], { label: string; cls: string }> = {
  block: { label: 'Missing', cls: 'bg-rose-50 text-rose-800 ring-rose-200' },
  ask: { label: 'Confirm', cls: 'bg-amber-50 text-amber-900 ring-amber-200' },
  tidy: { label: 'Tidy', cls: 'bg-slate-50 text-slate-700 ring-slate-200' },
}

export function GuidebookReview({ id, unit, name, stage: stage0, review: review0, flags, nextId }: {
  id: string; unit: string; name: string; stage: 'draft' | 'approved' | 'live'; review: ReviewState; flags: Flag[]; nextId: string
}) {
  const [page, setPage] = useState(REVIEW_PAGES[0].key)
  const [review, setReview] = useState<ReviewState>(review0 || {})
  const [stage, setStage] = useState(stage0)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [note, setNote] = useState(review0?.note || '')
  const [frameKey, setFrameKey] = useState(0)
  const [missingSection, setMissingSection] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const pages = review.pages || {}
  const byPage = useMemo(() => { const m: Record<string, Flag[]> = {}; for (const f of flags) (m[f.page] = m[f.page] || []).push(f); return m }, [flags])
  const blockers = flags.filter(f => f.level === 'block')
  const ticked = REVIEW_PAGES.filter(p => pages[p.key]).length
  const isPrint = page === 'print'

  // Scroll the phone frame to the page being reviewed.
  const scrollFrame = () => {
    const w = frame.current?.contentWindow as any
    if (!w || !w.document) return
    const a = ANCHOR[page]
    if (!a) { w.scrollTo(0, 0); setMissingSection(false); return }
    const el = w.document.getElementById(a)
    setMissingSection(!el)
    if (el) w.scrollTo({ top: el.getBoundingClientRect().top + w.scrollY - 62 })
  }
  useEffect(() => { if (!isPrint) scrollFrame() }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: any) {
    const r = await fetch('/api/guidebook/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
    return j
  }
  async function tick(key: string, ok: boolean, advance = false) {
    setBusy('page')
    try {
      const j = await post({ action: 'page', page: key, ok })
      setReview(j.review || review)
      if (advance) { const i = REVIEW_PAGES.findIndex(p => p.key === key); if (i >= 0 && i < REVIEW_PAGES.length - 1) setPage(REVIEW_PAGES[i + 1].key) }
    } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  async function saveNote() {
    if ((review.note || '') === note) return
    try { const j = await post({ action: 'note', note }); setReview(j.review || review) } catch (e: any) { setMsg(String(e.message || e)) }
  }
  async function approve() {
    const left = REVIEW_PAGES.length - ticked
    const warn = [blockers.length ? blockers.length + ' missing item' + (blockers.length === 1 ? '' : 's') + ' still flagged' : '', left ? left + ' page' + (left === 1 ? '' : 's') + ' not ticked' : ''].filter(Boolean).join(' and ')
    if (!window.confirm((warn ? warn + '.\n\n' : '') + 'Approve this guidebook and push its guest link to Guesty?')) return
    setBusy('approve'); setMsg('')
    try {
      const j = await post({ action: 'approve' })
      setReview(j.review || review); setStage(j.status)
      setMsg(j.pushed ? 'Approved and pushed to Guesty.' : 'Approved — but the Guesty push failed: ' + (j.pushError || 'unknown') + '. Try "Approve" again or use Push to Guesty on Guidebooks.')
    } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  async function needsFix() {
    const n = window.prompt('What needs fixing on ' + (unit || name) + '?', review.needsFix?.note || '')
    if (n == null) return
    if (!n.trim()) { try { const j = await post({ action: 'fix', clear: true }); setReview(j.review || review); setMsg('"Needs fix" cleared.') } catch (e: any) { setMsg(String(e.message || e)) } return }
    try { const j = await post({ action: 'fix', note: n.trim() }); setReview(j.review || review); setStage('draft'); setMsg('Marked "needs fix" — it shows on the queue and on Admin › Guidebooks.') } catch (e: any) { setMsg(String(e.message || e)) }
  }
  async function unapprove() {
    setBusy('approve')
    try { const j = await post({ action: 'unapprove' }); setReview(j.review || review); setStage('draft'); setMsg('Back to draft. (The link already in Guesty stays until you approve again or clear it there.)') } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  async function checkPhotos() {
    setBusy('photos'); setMsg('Checking every photo — about a minute…')
    try {
      const j = await post({ action: 'photos' })
      setMsg('Checked ' + j.checked + ' photos: ' + (j.collages || 0) + ' collage' + (j.collages === 1 ? '' : 's') + ' found' + (j.swapped?.length ? ', replaced on ' + j.swapped.join(', ') : ', nothing to replace') + '. Reload to see the flags update.')
      setFrameKey(k => k + 1)
    } catch (e: any) { setMsg(String(e.message || e)) }
    setBusy('')
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-app'
  const here = byPage[page] || []

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2.5">
          <Link href="/guidebooks/review" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={15} /> Review queue</Link>
          <div className="min-w-0 flex-1 px-2">
            <p className="truncate text-[15px] font-bold text-ink">{unit || name}</p>
            {unit ? <p className="truncate text-[12px] text-muted">{name}</p> : null}
          </div>
          <span className={'rounded-md px-2 py-1 text-[11px] font-bold ' + (stage === 'live' ? 'bg-emerald-100 text-emerald-700' : stage === 'approved' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800')}>{stage === 'live' ? 'Live in Guesty' : stage === 'approved' ? 'Approved' : 'Draft'}</span>
          <a href={'/g/' + id} target="_blank" rel="noreferrer" className={btn}><Smartphone size={13} /> Guest view</a>
          <a href={'/g/' + id + '?printview=1'} target="_blank" rel="noreferrer" className={btn}><Printer size={13} /> Printable view</a>
          <a href={'/g/' + id + '?book=1'} target="_blank" rel="noreferrer" className={btn}><BookOpen size={13} /> Magazine</a>
          <a href={'/guidebooks/' + id} target="_blank" rel="noreferrer" className={btn}><Pencil size={13} /> Edit</a>
          <button onClick={checkPhotos} disabled={!!busy} className={btn + ' disabled:opacity-50'} title="Find collages and photos with text; replace them on any page">{busy === 'photos' ? <Loader2 size={13} className="animate-spin" /> : <Images size={13} />} Check photos</button>
          <button onClick={needsFix} className={btn + (review.needsFix ? ' !border-rose-400 !text-rose-700' : '')} title={review.needsFix ? 'Needs fix: ' + review.needsFix.note : 'Send back to the team with a note'}>{review.needsFix ? 'Needs fix ✎' : 'Needs fix'}</button>
          {stage === 'draft'
            ? <button onClick={approve} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Approve &amp; push to Guesty</button>
            : <>
                {stage === 'approved' ? <button onClick={approve} disabled={!!busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Retry push</button> : null}
                <button onClick={unapprove} disabled={!!busy} className={btn}>Back to draft</button>
              </>}
          {nextId ? <Link href={'/guidebooks/review/' + nextId} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold text-white">Next book →</Link> : null}
        </div>
        {review.needsFix ? <div className="mx-auto max-w-[1400px] px-4 pb-2 text-[12.5px] font-semibold text-rose-700">Needs fix: {review.needsFix.note}</div> : null}
        {msg ? <div className="mx-auto max-w-[1400px] px-4 pb-2 text-[12.5px] text-ink">{msg}</div> : null}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
        {/* PAGES */}
        <nav className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          <p className="hidden px-1 text-[11px] font-bold uppercase tracking-wider text-muted lg:block">Pages · {ticked}/{REVIEW_PAGES.length} reviewed</p>
          {REVIEW_PAGES.map((p, i) => {
            const f = byPage[p.key] || [], b = f.filter(x => x.level === 'block').length, a = f.filter(x => x.level === 'ask').length
            return (
              <button key={p.key} onClick={() => setPage(p.key)} className={'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] ' + (page === p.key ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-white/70 border border-line')}>
                <span className={'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ' + (pages[p.key] ? 'bg-emerald-500 text-white' : page === p.key ? 'bg-white/20' : 'bg-app')}>{pages[p.key] ? <Check size={12} /> : i + 1}</span>
                <span className="flex-1 whitespace-nowrap">{p.label}</span>
                {b ? <span className="rounded bg-rose-500 px-1.5 text-[10px] font-bold text-white">{b}</span> : null}
                {a ? <span className="rounded bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{a}</span> : null}
              </button>
            )
          })}
        </nav>

        {/* PREVIEW */}
        <div className="flex flex-col items-center">
          <div className="mb-2 flex w-full items-center justify-between text-[12px] text-muted">
            <span>{isPrint ? 'What prints for this unit — the magazine or the 1-pager (set in Admin › Guidebooks)' : 'The guest guide exactly as guests see it'}</span>
            <button onClick={() => setFrameKey(k => k + 1)} className="inline-flex items-center gap-1 font-semibold hover:text-ink"><RotateCw size={12} /> Reload after editing</button>
          </div>
          {isPrint ? (
            <iframe key={'p' + frameKey} src={'/g/' + id + '?printview=1'} className="h-[78vh] w-full rounded-xl border border-line bg-white" title="Printable view" />
          ) : (
            <div className="rounded-[34px] border-[10px] border-neutral-900 bg-neutral-900 shadow-xl">
              <iframe key={'g' + frameKey} ref={frame} src={'/g/' + id} onLoad={() => setTimeout(scrollFrame, 350)} className="h-[74vh] max-h-[780px] w-[390px] max-w-[86vw] rounded-[24px] bg-white" title="Guest view" />
            </div>
          )}
          {missingSection && !isPrint ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200">This page is not in the guide — it is empty or hidden. Add it in Edit if guests need it.</p> : null}
        </div>

        {/* FLAGS + ACTIONS */}
        <aside className="space-y-3">
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{REVIEW_PAGES.find(p => p.key === page)?.label}</p>
            {here.length ? (
              <ul className="mt-2 space-y-2">
                {here.map((f, i) => <li key={i} className={'rounded-lg px-3 py-2 text-[13px] leading-snug ring-1 ' + LEVEL[f.level].cls}><b className="mr-1">{LEVEL[f.level].label}:</b>{f.text}</li>)}
              </ul>
            ) : <p className="mt-2 text-[13px] text-emerald-700">Nothing flagged on this page — read it through, then tick it.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {pages[page]
                ? <button onClick={() => tick(page, false)} disabled={!!busy} className={btn}>Untick</button>
                : <button onClick={() => tick(page, true, true)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50"><Check size={14} /> Looks good — next page</button>}
              <a href={'/guidebooks/' + id} target="_blank" rel="noreferrer" className={btn}><ExternalLink size={13} /> Fix in Edit</a>
            </div>
            {pages[page] ? <p className="mt-2 text-[11.5px] text-muted">Reviewed {String(pages[page]).split(' ').slice(1).join(' ') || ''} · {new Date(String(pages[page]).split(' ')[0]).toLocaleString()}</p> : null}
          </div>

          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Whole book · {blockers.length} missing · {flags.filter(f => f.level === 'ask').length} to confirm</p>
            <ul className="mt-2 max-h-[220px] space-y-1 overflow-auto text-[12.5px]">
              {flags.length ? flags.map((f, i) => (
                <li key={i}><button onClick={() => setPage(f.page)} className="text-left hover:underline"><span className={'mr-1.5 inline-block h-2 w-2 rounded-full ' + (f.level === 'block' ? 'bg-rose-500' : f.level === 'ask' ? 'bg-amber-400' : 'bg-slate-300')} />{f.text}</button></li>
              )) : <li className="text-emerald-700">No flags.</li>}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Note for the team</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote} rows={3} placeholder="e.g. waiting on the owner for the pool hours" className="mt-2 w-full rounded-lg border border-line p-2 text-[13px]" />
            {review.approvedAt ? <p className="mt-2 text-[11.5px] text-muted">Approved {new Date(review.approvedAt).toLocaleString()}{review.approvedBy ? ' by ' + review.approvedBy : ''}{review.pushedAt ? ' · in Guesty ' + new Date(review.pushedAt).toLocaleString() : ''}</p> : null}
            {review.pushError ? <p className="mt-1 text-[11.5px] text-rose-700">Last Guesty push failed: {review.pushError}</p> : null}
          </div>
        </aside>
      </div>
    </div>
  )
}
