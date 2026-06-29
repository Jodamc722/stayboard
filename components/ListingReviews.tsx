'use client'
// Per-listing reviews with inline public replies. Reuses the same AI draft + post-to-channel
// endpoints as the Command Center (/api/reviews/draft, /api/reviews/reply). No-fault tone is
// enforced server-side in the draft route; the host's typed instruction stays authoritative.
// Reviews whose listing isn't mapped on its channel CAN'T be replied to here — we surface that
// up front (no draft/post UI) instead of letting the host write a reply that fails on post.
import { useState } from 'react'
import { Star, MessageSquare, Send, Wand2, Check, Ban } from 'lucide-react'

type R = {
  id: string
  rating: number | null
  content: string | null
  channel: string | null
  guest_name: string | null
  hostReply: string | null
  has_reply: boolean
  excluded?: boolean
}

export function ListingReviews({ reviews, listingName }: { reviews: R[]; listingName?: string }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [posted, setPosted] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [orphan, setOrphan] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState<Record<string, string>>({})

  function setDraft(id: string, v: string) { setDrafts(s => ({ ...s, [id]: v })) }

  async function rewrite(r: R, instruction?: string) {
    setBusy(b => ({ ...b, [r.id]: true })); setErr(e => ({ ...e, [r.id]: '' }))
    try {
      const res = await fetch('/api/reviews/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: r.content, rating: r.rating, listing_name: listingName, guest: r.guest_name, channel: r.channel, instruction, currentDraft: drafts[r.id] || '' }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setDraft(r.id, d.draft || '')
    } catch (e: any) { setErr(x => ({ ...x, [r.id]: e?.message || String(e) })) }
    finally { setBusy(b => ({ ...b, [r.id]: false })) }
  }

  async function post(r: R) {
    const text = (drafts[r.id] || '').trim()
    if (!text) return
    setBusy(b => ({ ...b, [r.id]: true })); setErr(e => ({ ...e, [r.id]: '' }))
    try {
      const res = await fetch('/api/reviews/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: r.id, reviewReply: text }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && !d.error) { setPosted(p => ({ ...p, [r.id]: text })); return }
      // Listing not mapped on its channel — can't post here. Flip to the can't-reply state.
      if (d.orphaned) { setOrphan(o => ({ ...o, [r.id]: true })); setOpen(o => ({ ...o, [r.id]: false })); return }
      throw new Error(d.error || `HTTP ${res.status}`)
    } catch (e: any) { setErr(x => ({ ...x, [r.id]: e?.message || String(e) })) }
    finally { setBusy(b => ({ ...b, [r.id]: false })) }
  }

  if (reviews.length === 0) return <div className="text-sm text-muted italic">No reviews synced for this unit yet.</div>

  return (
    <div className="space-y-2.5">
      {reviews.map(r => {
        const existing = posted[r.id] || r.hostReply
        const replied = !!existing
        const cannotReply = !!r.excluded || !!orphan[r.id]
        const showEditor = open[r.id] && !posted[r.id] && !cannotReply
        return (
          <div key={r.id} className="border border-line rounded-lg px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5">
                {r.rating != null && <span className="inline-flex items-center gap-0.5 font-semibold text-ink"><Star size={11} className="text-amber-500 fill-amber-500" />{r.rating}</span>}
                <span className="text-muted">{r.channel || '—'}</span>
                {r.guest_name && <span className="text-muted">· {r.guest_name}</span>}
              </span>
              {cannotReply ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 inline-flex items-center gap-1"><Ban size={10} /> Can&apos;t reply</span>
              ) : (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${replied ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{replied ? 'Replied' : 'No reply'}</span>
              )}
            </div>

            {r.content && <div className="text-[13px] text-ink mt-1 leading-snug whitespace-pre-wrap">{String(r.content)}</div>}

            {existing && (
              <div className="mt-2 pl-2.5 border-l-2 border-brand-200 bg-brand-50/40 rounded-r py-1.5 pr-2">
                <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold mb-0.5 inline-flex items-center gap-1"><MessageSquare size={10} /> Your public response</div>
                <div className="text-[12px] text-ink leading-snug whitespace-pre-wrap">{String(existing)}</div>
              </div>
            )}

            {cannotReply && !existing && (
              <div className="mt-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 inline-flex items-start gap-1.5">
                <Ban size={12} className="mt-0.5 flex-shrink-0 text-slate-500" />
                <span>This listing isn&apos;t mapped on its channel, so a reply can&apos;t post from here — reply directly in the channel if needed. This review is <b>excluded from your scores</b> (it isn&apos;t helping or hurting).</span>
              </div>
            )}

            {!replied && !cannotReply && !showEditor && (
              <button onClick={() => { setOpen(o => ({ ...o, [r.id]: true })); if (!drafts[r.id]) rewrite(r) }}
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                <Wand2 size={13} /> Draft a reply
              </button>
            )}

            {showEditor && (
              <div className="mt-2">
                <textarea value={drafts[r.id] ?? ''} onChange={e => setDraft(r.id, e.target.value)} rows={4}
                  placeholder={busy[r.id] ? 'Writing the AI reply…' : 'Write a reply, or use Rewrite with AI.'}
                  className="w-full resize-y text-[13px] text-ink bg-app border border-line rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                {err[r.id] && <div className="text-[11px] text-rose-600 mt-1">{err[r.id]}</div>}
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <button onClick={() => post(r)} disabled={busy[r.id] || !(drafts[r.id] || '').trim()}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg bg-brand-600 text-white px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50">
                    <Send size={13} /> Post reply
                  </button>
                  <button onClick={() => rewrite(r)} disabled={busy[r.id]}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-line text-ink px-2.5 py-1.5 hover:bg-app disabled:opacity-50">
                    <Wand2 size={13} /> Rewrite with AI
                  </button>
                  <button onClick={() => { const i = window.prompt('How should the AI adjust this reply? (e.g. warmer, shorter, more professional, or: let them know we resolved the issue)'); if (i && i.trim()) rewrite(r, i.trim()) }} disabled={busy[r.id]}
                    className="text-[12px] text-muted hover:text-ink underline underline-offset-2">Adjust…</button>
                </div>
              </div>
            )}

            {posted[r.id] && <div className="mt-1.5 text-[11px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Reply posted to {r.channel || 'the channel'}.</div>}
          </div>
        )
      })}
    </div>
  )
}
