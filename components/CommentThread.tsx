'use client'
// SHARED comment thread with FULL CLARITY across all three systems.
// Attaches to ANY entity via (type, id):
//   * APP      - app_comments, drives the notification bell (@tags + thread followers get pinged)
//   * BREEZEWAY- the task description the field crew reads (optional write, always shown)
//   * GUESTY   - the reservation_notes custom field (optional write, always shown)
// One box, pick where it goes, and see everything that is already written in each place.
import { useEffect, useState } from 'react'

type Props = { type: string; id: string; label?: string; link?: string; taskId?: string; reservationId?: string; onCount?: (n: number) => void }

export default function CommentThread({ type, id, label, link, taskId, reservationId, onCount }: Props) {
  const [items, setItems] = useState<any[]>([])
  const [team, setTeam] = useState<string[]>([])
  const [bz, setBz] = useState<any>(null)
  const [gz, setGz] = useState<any>(null)
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagQ, setTagQ] = useState('')
  const [toBz, setToBz] = useState(false)
  const [toGz, setToGz] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/comments?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(r => r.json()).then(j => {
        if (!alive || !j || !j.ok) return
        const list = Array.isArray(j.comments) ? j.comments : []
        setItems(list); setTeam(Array.isArray(j.team) ? j.team : [])
        setBz(j.breezeway || null); setGz(j.guesty || null); setLoaded(true)
        if (onCount) onCount(list.length)
      }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, tick])

  const post = async () => {
    if (!body.trim()) return
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, id, body: body.trim(), mentions: tags, label: label || '', link: link || '',
          taskId: taskId || (type === 'task' ? id : ''), toBreezeway: toBz,
          toGuesty: toGz, reservationId: reservationId || (gz && gz.reservationId) || '',
        })
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not post') }
      else {
        setBody(''); setTags([]); setTick(t => t + 1)
        const n = Array.isArray(j.notified) ? j.notified.length : 0
        const bits: string[] = []
        bits.push(n ? 'Notified ' + n + (n === 1 ? ' teammate' : ' teammates') : 'Posted in the app')
        if (j.breezeway === true) bits.push('added to Breezeway')
        if (j.breezeway === false) bits.push('Breezeway write FAILED')
        if (j.guesty === true) bits.push('added to Guesty notes')
        if (j.guesty === false) bits.push('Guesty write FAILED')
        setNote(bits.join(' · '))
      }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const addTag = (v: string) => { const e2 = v.trim().toLowerCase(); if (e2 && team.indexOf(e2) >= 0 && tags.indexOf(e2) < 0) setTags(prev => prev.concat([e2])); setTagQ('') }
  const who = (e2: string) => String(e2 || '').split('@')[0]
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  const uid = type + '-' + id
  const lines = (s: string) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean)
  // Breezeway now returns its own comment thread; the description is only a fallback for tasks
  // where nobody has commented yet (older notes were stamped into the description).
  const bzComments: any[] = (bz && Array.isArray(bz.comments)) ? bz.comments : []
  const bzLines = bzComments.length ? bzComments.map((x: any) => x.body) : lines(bz && bz.description)
  const gzLines = lines(gz && gz.notes)
  const shownApp = expanded ? items : items.slice(-3)
  const shownBz = expanded ? bzLines : bzLines.slice(0, 3)
  const shownGz = expanded ? gzLines.slice().reverse() : gzLines.slice().reverse().slice(0, 3)
  const hidden = (items.length - shownApp.length) + (bzLines.length - shownBz.length) + (gzLines.length - shownGz.length)

  return (
    <div className="rounded-lg border border-line bg-app/40 p-2">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Notes &amp; comments</div>
        <div className="flex items-center gap-1 text-[9px] font-semibold">
          <span className="px-1.5 py-0.5 rounded-full bg-white border border-line text-muted" title="Comments inside Lighthouse - these drive the notification bell">App {items.length}</span>
          {bz && <span className="px-1.5 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700" title="Lines on the Breezeway task description - what the field crew reads in their app">Breezeway {bzLines.length}</span>}
          {gz && <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700" title="Reservation notes on the Guesty reservation">Guesty {gzLines.length}</span>}
        </div>
        <button onClick={() => setExpanded(!expanded)} className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-md border border-line bg-white text-muted hover:text-ink hover:bg-app">{expanded ? 'Collapse' : hidden > 0 ? 'Expand (' + hidden + ' more)' : 'Expand'}</button>
      </div>

      <div className={'space-y-2 overflow-y-auto ' + (expanded ? 'max-h-[26rem]' : 'max-h-56')}>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted mb-0.5">In the app</div>
          <div className="space-y-1">
            {shownApp.map(cm => (
              <div key={cm.id} className="bg-white border border-line rounded-md px-2 py-1.5">
                <div className="text-[10px] text-muted"><span className="font-semibold text-ink">{who(cm.author_email)}</span> {'·'} {when(cm.created_at)}{(cm.mentions || []).length > 0 && <span> {'·'} tagged {(cm.mentions || []).map(who).join(', ')}</span>}</div>
                <div className="text-[12px] text-ink whitespace-pre-wrap">{cm.body}</div>
              </div>
            ))}
            {loaded && items.length === 0 && <div className="text-[11px] text-muted">No comments yet.</div>}
          </div>
        </div>

        {bz && (
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-brand-700 mb-0.5 flex items-center gap-1">{bzComments.length ? 'Breezeway thread (field crew)' : 'On the Breezeway task'}{bz.url && <a href={bz.url} target="_blank" rel="noreferrer" className="font-medium underline decoration-dotted hover:text-brand-600">open</a>}</div>
            <div className="space-y-1">
              {shownBz.map((ln, i) => <div key={i} className="bg-white border border-brand-200/70 rounded-md px-2 py-1 text-[11px] text-ink whitespace-pre-wrap">{ln}</div>)}
              {bzLines.length === 0 && <div className="text-[11px] text-muted">No Breezeway comments yet {'\u00b7'} anything you post with Breezeway ticked lands in the crew&rsquo;s thread.</div>}
            </div>
          </div>
        )}

        {gz && (
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-700 mb-0.5">In Guesty {'·'} reservation notes{gz.guestName ? ' (' + gz.guestName + ')' : ''}</div>
            <div className="space-y-1">
              {shownGz.map((ln, i) => <div key={i} className="bg-white border border-emerald-200/70 rounded-md px-2 py-1 text-[11px] text-ink whitespace-pre-wrap">{ln}</div>)}
              {gzLines.length === 0 && <div className="text-[11px] text-muted">No reservation notes yet.</div>}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 space-y-1">
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={'Add a note… (@name in the text also tags)'} rows={2} className="w-full text-xs border border-line rounded-md px-2 py-1.5 bg-white" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <input list={'cmt-team-' + uid} value={tagQ} onChange={e => { setTagQ(e.target.value); if (team.indexOf(e.target.value.trim().toLowerCase()) >= 0) addTag(e.target.value) }} placeholder={'Tag teammate…'} className="text-[11px] border border-line rounded-md px-2 py-1 bg-white w-40" />
          <datalist id={'cmt-team-' + uid}>{team.map(t => <option key={t} value={t} />)}</datalist>
          {tags.map(t2 => <span key={t2} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 inline-flex items-center gap-1">@{who(t2)}<button onClick={() => setTags(prev => prev.filter(x => x !== t2))} className="hover:text-rose-600">{'×'}</button></span>)}
          {(taskId || type === 'task') && <label className="text-[10px] font-medium text-brand-700 inline-flex items-center gap-1 cursor-pointer" title="Post this as a comment on the Breezeway task - the field crew sees it in their app and can reply, and their reply comes back here"><input type="checkbox" checked={toBz} onChange={e => setToBz(e.target.checked)} className="accent-brand-600" />Breezeway</label>}
          {(reservationId || (gz && gz.reservationId)) && <label className="text-[10px] font-medium text-emerald-700 inline-flex items-center gap-1 cursor-pointer" title="Also append this to the reservation notes in Guesty"><input type="checkbox" checked={toGz} onChange={e => setToGz(e.target.checked)} className="accent-emerald-600" />Guesty</label>}
          <button onClick={post} disabled={busy || !body.trim()} className="ml-auto text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-ink text-white disabled:opacity-40">{busy ? 'Posting…' : 'Post'}</button>
        </div>
        {note && <div className="text-[11px] text-emerald-700">{note}</div>}
        {err && <div className="text-[11px] text-rose-700">{err}</div>}
      </div>
    </div>
  )
}
