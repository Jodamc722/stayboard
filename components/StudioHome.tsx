'use client'
// The front door of Ad Studio (Jon, 2026-11-04: "how to create a new ad should start from fresh … it's all a bit
// clunky … a smart calendar that is aware of upcoming dates and makes suggestions … quick delete"). Four things to
// make, what is coming up on the calendar, and your work — thumbnails, open, delete.
import { useMemo, useState } from 'react'
import { comingUp, whenLabel, type Moment } from '@/lib/marketing-calendar'
import { LOOKS, type AdKindOf } from '@/lib/ad-engine'

export type HomeRow = { id: string; name: string; updatedAt: string; scenes: number; format: string; status?: string; kind?: string; look?: string; thumb?: string; moment?: string }

const UI = { bg: '#0B0F16', panel: '#121824', panel2: '#182131', line: 'rgba(255,255,255,0.09)', ink: '#F1F3F7', mut: '#8E9AAE', gold: '#D2B077', red: '#E06C6C', green: '#4CC488' }
const proxied = (u: string) => (!u ? '' : u.startsWith('/') ? u : /guesty|cloudinary|muscache|pexels|unsplash|staticflickr|rawpixel|wikimedia|openverse|stocksnap|nappy/i.test(u) ? '/api/img-proxy?url=' + encodeURIComponent(u) : u)

export const KIND_META: Record<AdKindOf, { label: string; plural: string; blurb: string; icon: string; out: string }> = {
  flyer: { label: 'Flyer', plural: 'Flyers', blurb: 'One designed page — an Instagram post, a Story, or a Letter PDF for print.', icon: '▣', out: 'PNG · PDF' },
  post: { label: 'Animated post', plural: 'Animated posts', blurb: 'A 4–8 second loop with motion and music, for the feed and Stories.', icon: '◐', out: 'MP4 · GIF' },
  video: { label: 'Video ad', plural: 'Video ads', blurb: 'A scripted spot with voice, captions and music — Reels, TikTok, YouTube.', icon: '▶', out: 'MP4 with voice' },
  story: { label: 'Owner story', plural: 'Owner stories', blurb: 'Our story, welcome aboard, the first 90 days, the team — for owners and partners.', icon: '✦', out: 'MP4 with voice' },
}

export default function StudioHome({ rows, canEdit, canDelete, busy, display, onMake, onMoment, onOpen, onDelete, onDuplicate }: {
  rows: HomeRow[]; canEdit: boolean; canDelete: boolean; busy: string; display: string
  onMake: (kind: AdKindOf) => void
  onMoment: (m: Moment, kind: AdKindOf) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
}) {
  const [filter, setFilter] = useState<'all' | AdKindOf>('all')
  const [q, setQ] = useState('')
  const [allDates, setAllDates] = useState(false)
  const soon = useMemo(() => comingUp(new Date(), allDates ? 40 : 8), [allDates])
  const shown = rows.filter(r => (filter === 'all' || (r.kind || 'video') === filter) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())))
  const lookOf = (k?: string) => LOOKS.find(l => l.key === k) || LOOKS[0]

  return (
    <div style={{ padding: '26px 28px 40px', maxWidth: 1380, margin: '0 auto', color: UI.ink }}>
      {/* ── make something ── */}
      <p style={{ fontFamily: display, fontWeight: 800, fontSize: 24, margin: '0 0 4px', letterSpacing: '-0.01em' }}>What are you making?</p>
      <p style={{ fontSize: 13, color: UI.mut, margin: '0 0 14px' }}>Every piece starts fresh, in the house look, with photos from our library. Change anything after.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        {(Object.keys(KIND_META) as AdKindOf[]).map(k => {
          const m = KIND_META[k]
          return (
            <button key={k} type="button" disabled={!canEdit || !!busy} onClick={() => onMake(k)}
              style={{ textAlign: 'left', background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '16px 16px 14px', cursor: canEdit ? 'pointer' : 'default', color: UI.ink, opacity: canEdit ? 1 : 0.6, transition: 'border-color .15s' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = UI.gold)} onMouseLeave={e => (e.currentTarget.style.borderColor = UI.line)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(210,176,119,0.14)', color: UI.gold, display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 800 }}>{m.icon}</span>
                <span style={{ fontFamily: display, fontWeight: 800, fontSize: 16 }}>{m.label}</span>
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: UI.mut, lineHeight: 1.5, marginTop: 10 }}>{m.blurb}</span>
              <span style={{ display: 'block', fontSize: 11, color: UI.gold, marginTop: 8, fontWeight: 700, letterSpacing: '0.06em' }}>{m.out}</span>
            </button>
          )
        })}
      </div>

      {/* ── coming up ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '30px 0 10px' }}>
        <p style={{ fontFamily: display, fontWeight: 800, fontSize: 20, margin: 0 }}>Coming up</p>
        <span style={{ fontSize: 12.5, color: UI.mut }}>The calendar knows the dates — pick a moment and the piece is written and dressed for it.</span>
        <button type="button" onClick={() => setAllDates(!allDates)} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 8, border: '1px solid ' + UI.line, background: 'transparent', color: UI.mut, cursor: 'pointer' }}>{allDates ? 'Next up only' : 'Whole year'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
        {soon.map(m => {
          const lk = lookOf(m.look)
          return (
            <div key={m.key} style={{ background: UI.panel, border: '1px solid ' + (m.open ? 'rgba(210,176,119,0.45)' : UI.line), borderRadius: 14, padding: '14px 14px 12px', position: 'relative', overflow: 'hidden' }}>
              <span style={{ position: 'absolute', right: 0, top: 0, width: 90, height: 90, background: `radial-gradient(circle at 80% 20%, ${lk.c.gold}33, transparent 70%)` }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>{m.emoji}</span>
                <span style={{ fontFamily: display, fontWeight: 800, fontSize: 15, lineHeight: 1.15 }}>{m.name}</span>
              </div>
              <p style={{ fontSize: 12, color: UI.mut, margin: '6px 0 0' }}>
                {whenLabel(m)} · {m.daysTo <= 0 ? 'now' : m.daysTo === 1 ? 'tomorrow' : 'in ' + m.daysTo + ' days'}
                {m.open ? <span style={{ color: UI.gold, fontWeight: 700 }}> · post now</span> : null}
              </p>
              <p style={{ fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.45 }}>{m.headline.replace(/\*\*/g, '')}</p>
              <p style={{ fontSize: 11, color: UI.mut, margin: '3px 0 10px' }}>{m.audience === 'owners' ? 'For owners' : m.audience === 'both' ? 'Guests and owners' : 'For guests'} · {lk.label} look</p>
              {canEdit ? (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {(['flyer', 'post', 'video'] as AdKindOf[]).map(k => (
                    <button key={k} type="button" disabled={!!busy} onClick={() => onMoment(m, k)}
                      style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 9px', borderRadius: 8, border: '1px solid ' + UI.line, background: k === 'flyer' ? UI.gold : UI.panel2, color: k === 'flyer' ? '#0B0F16' : UI.ink, cursor: 'pointer' }}>
                      {KIND_META[k].label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* ── your work ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '30px 0 10px', flexWrap: 'wrap' }}>
        <p style={{ fontFamily: display, fontWeight: 800, fontSize: 20, margin: 0 }}>Your work</p>
        <span style={{ fontSize: 12.5, color: UI.mut }}>{rows.length} piece{rows.length === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['all', 'flyer', 'post', 'video', 'story'] as const).map(k => (
            <button key={k} type="button" onClick={() => setFilter(k)} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 8, border: '1px solid ' + UI.line, background: filter === k ? UI.ink : 'transparent', color: filter === k ? '#0B0F16' : UI.mut, cursor: 'pointer' }}>
              {k === 'all' ? 'All' : KIND_META[k].plural}
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ marginLeft: 6, background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '5px 9px', fontSize: 12, width: 150 }} />
        </span>
      </div>
      {shown.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          {shown.map(r => {
            const lk = lookOf(r.look)
            const k = (r.kind || 'video') as AdKindOf
            const tall = r.format === '9:16' || r.format === '4:5' || r.format === 'letter'
            return (
              <div key={r.id} style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
                <button type="button" onClick={() => onOpen(r.id)} title="Open" style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: UI.ink }}>
                  <div style={{ height: 118, background: r.thumb ? `linear-gradient(rgba(${lk.c.tint},0.35), rgba(${lk.c.tint},0.75)), url(${proxied(r.thumb)}) center/cover` : `linear-gradient(135deg, ${lk.c.navy2}, ${lk.c.deep})`, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: 9, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: lk.c.gold, textTransform: 'uppercase' }}>{KIND_META[k].label}</span>
                    <span style={{ position: 'absolute', right: 10, top: 8, fontSize: 10.5, color: '#fff', opacity: 0.85 }}>{tall ? '▯' : '▭'} {r.format}</span>
                    {r.status === 'approved' ? <span style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 10.5, fontWeight: 700, color: UI.green }}>✓ Approved</span> : r.status === 'review' ? <span style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 10.5, fontWeight: 700, color: UI.gold }}>In review</span> : null}
                  </div>
                  <div style={{ padding: '9px 10px 10px' }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: UI.mut, marginTop: 2 }}>{r.scenes} scene{r.scenes === 1 ? '' : 's'} · {new Date(r.updatedAt).toLocaleDateString()}</span>
                  </div>
                </button>
                {canEdit ? (
                  <span style={{ position: 'absolute', right: 6, bottom: 8, display: 'flex', gap: 4 }}>
                    <button type="button" onClick={() => onDuplicate(r.id)} title="Duplicate" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid ' + UI.line, background: UI.panel2, color: UI.ink, cursor: 'pointer', fontSize: 12 }}>⧉</button>
                    {canDelete ? <button type="button" onClick={() => onDelete(r.id)} title="Delete" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid rgba(224,108,108,0.4)', background: 'rgba(224,108,108,0.12)', color: UI.red, cursor: 'pointer', fontSize: 12 }}>✕</button> : null}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : <p style={{ fontSize: 13, color: UI.mut }}>Nothing here yet{q ? ' for that search' : ''}. Pick something to make above.</p>}
    </div>
  )
}
