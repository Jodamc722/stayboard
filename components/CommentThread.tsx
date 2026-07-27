'use client'
// SHARED comment thread. Attaches to ANY entity via (type, id) and drives the system-wide
// notification bell: teammates you tag get a "tagged you" notification, and everyone who has
// already commented on the thread gets a "replied" notification - so a comment left on a task
// comes back to the people who care without anyone re-opening the board.
// Optional: mirror the comment onto the Breezeway task so the field crew sees it.
import { useEffect, useState } from 'react'

export default function CommentThread({ type, id, label, link, taskId, onCount }: { type: string; id: string; label?: string; link?: string; taskId?: string; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<any[]>([])
  const [team, setTeam] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagQ, setTagQ] = useState('')
  const [toBz, setToBz] = useState(false)
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
        setItems(list); setTeam(Array.isArray(j.team) ? j.team : []); setLoaded(true)
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
        body: JSON.stringify({ type, id, body: body.trim(), mentions: tags, label: label || '', link: link || '', taskId: toBz ? (taskId || '') : '', toBreezeway: toBz })
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not post') }
      else {
        setBody(''); setTags([]); setTick(t => t + 1)
        const n = Array.isArray(j.notified) ? j.notified.length : 0
        setNote((n ? 'Notified ' + n + (n === 1 ? ' teammate' : ' teammates') : 'Posted') + (j.breezeway === true ? ' · added to the Breezeway task' : j.breezeway === false ? ' · Breezeway note failed' : ''))
      }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const addTag = (v: string) => { const e2 = v.trim().toLowerCase(); if (e2 && team.indexOf(e2) >= 0 && tags.indexOf(e2) < 0) setTags(prev => prev.concat([e2])); setTagQ('') }
  const who = (e2: string) => String(e2 || '').split('@')[0]
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  const uid = type + '-' + id

  return (
    <div className="rounded-lg border border-line bg-app/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Comments{loaded ? ' (' + items.length + ')' : ''}</div>
      <div className="space-y-1 max-h-44 overflow-y-auto">
        {items.map(cm => (
          <div key={cm.id} className="bg-white border border-line rounded-md px-2 py-1.5">
            <div className="text-[10px] text-muted"><span className="font-semibold text-ink">{who(cm.author_email)}</span> {'·'} {when(cm.created_at)}{(cm.mentions || []).length > 0 && <span> {'·'} tagged {(cm.mentions || []).map(who).join(', ')}</span>}</div>
            <div className="text-[12px] text-ink whitespace-pre-wrap">{cm.body}</div>
          </div>
        ))}
        {loaded && items.length === 0 && <div className="text-[11px] text-muted">No comments yet.</div>}
      </div>
      <div className="mt-1.5 space-y-1">
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={'Add a comment… (@name in the text also tags)'} rows={2} className="w-full text-xs border border-line rounded-md px-2 py-1.5 bg-white" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <input list={'cmt-team-' + uid} value={tagQ} onChange={e => { setTagQ(e.target.value); if (team.indexOf(e.target.value.trim().toLowerCase()) >= 0) addTag(e.target.value) }} placeholder={'Tag teammate…'} className="text-[11px] border border-line rounded-md px-2 py-1 bg-white w-44" />
          <datalist id={'cmt-team-' + uid}>{team.map(t => <option key={t} value={t} />)}</datalist>
          {tags.map(t2 => <span key={t2} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 inline-flex items-center gap-1">@{who(t2)}<button onClick={() => setTags(prev => prev.filter(x => x !== t2))} className="hover:text-rose-600">{'×'}</button></span>)}
          {taskId && <label className="text-[10px] text-muted inline-flex items-center gap-1 cursor-pointer" title="Also append this comment onto the Breezeway task so the field crew sees it in their app"><input type="checkbox" checked={toBz} onChange={e => setToBz(e.target.checked)} className="accent-brand-600" />Send to Breezeway</label>}
          <button onClick={post} disabled={busy || !body.trim()} className="ml-auto text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-ink text-white disabled:opacity-40">{busy ? 'Posting…' : 'Comment'}</button>
        </div>
        {note && <div className="text-[11px] text-emerald-700">{note}</div>}
        {err && <div className="text-[11px] text-rose-700">{err}</div>}
      </div>
    </div>
  )
}
