'use client'
// The front door of Ad Studio (Jon, 2026-11-04: "how to create a new ad should start from fresh … it's all a bit
// clunky … a smart calendar that is aware of upcoming dates and makes suggestions … quick delete"). Four things to
// make, what is coming up on the calendar, your work, and the finished videos.
//
// 2026-11-10 (Jon: "audit and fix the ad studio to make it easier to use"): pick up where you left off at the top;
// select several pieces and delete them together; "Edit this video" opens the editable copy you already have
// instead of making another; the Videos library (sales videos + every export) lives here, not in a side tab.
import { useMemo, useState } from 'react'
import { comingUp, whenLabel, type Moment } from '@/lib/marketing-calendar'
import { LOOKS, type AdKindOf } from '@/lib/ad-engine'
import { AREA_LABEL, buildingsIn } from '@/lib/ad-places'

export type HomeRow = { id: string; name: string; updatedAt: string; scenes: number; format: string; status?: string; kind?: string; look?: string; thumb?: string; moment?: string }
export type HomeVideo = { key: string; name: string; url: string; thumb: string; dur: number; format: string; builtin: boolean; createdAt: string; path?: string }

const UI = { bg: '#0B0F16', panel: '#121824', panel2: '#182131', line: 'rgba(255,255,255,0.09)', ink: '#F1F3F7', mut: '#8E9AAE', gold: '#D2B077', red: '#E06C6C', green: '#4CC488' }
const proxied = (u: string) => (!u ? '' : u.startsWith('/') ? u : /guesty|cloudinary|muscache|pexels|unsplash|staticflickr|rawpixel|wikimedia|openverse|stocksnap|nappy/i.test(u) ? '/api/img-proxy?url=' + encodeURIComponent(u) : u)
const mmss = (s: number) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0')
const ago = (iso: string) => { const d = Math.round((Date.now() - Date.parse(iso)) / 86400_000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? d + ' days ago' : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

export const KIND_META: Record<AdKindOf, { label: string; plural: string; blurb: string; icon: string; out: string }> = {
  flyer: { label: 'Photo post', plural: 'Photo posts', blurb: 'One designed photo for Instagram and Facebook — with its caption written for you. Also prints as a flyer.', icon: '▣', out: 'PNG · PDF · caption' },
  post: { label: 'Animated post', plural: 'Animated posts', blurb: 'A 4–8 second loop with motion and music, for the feed and Stories.', icon: '◐', out: 'MP4 · GIF' },
  video: { label: 'Video ad', plural: 'Video ads', blurb: 'A scripted spot with voice, captions and music — Reels, TikTok, YouTube.', icon: '▶', out: 'MP4 with voice' },
  story: { label: 'Owner story', plural: 'Owner stories', blurb: 'Our story, welcome aboard, the first 90 days, the team — for owners and partners.', icon: '✦', out: 'MP4 with voice' },
}
const H2 = ({ children, display }: { children: React.ReactNode; display: string }) => <p style={{ fontFamily: display, fontWeight: 800, fontSize: 20, margin: 0 }}>{children}</p>
const ghost: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 8, border: '1px solid ' + UI.line, background: 'transparent', color: UI.mut, cursor: 'pointer', whiteSpace: 'nowrap' }

export default function StudioHome({ rows, canEdit, canDelete, busy, display, last, onMake, onMoment, onOpen, onDelete, onDeleteMany, onDuplicate, library = [], onEditVideo, onWatch, onDeleteVideo, onUploadVideo }: {
  rows: HomeRow[]; canEdit: boolean; canDelete: boolean; busy: string; display: string
  /** id of the piece opened last on this computer */ last?: string
  /** The Videos library: the built-in sales videos and every kept export. */
  library?: HomeVideo[]
  /** Opens a sales video scene by scene. `fresh` makes a new copy even when an editable one exists. */
  onEditVideo?: (key: string, existingId?: string) => void
  onWatch?: (v: HomeVideo) => void
  onDeleteVideo?: (v: HomeVideo) => void
  onUploadVideo?: (f: File) => void
  onMake: (kind: AdKindOf) => void
  onMoment: (m: Moment, kind: AdKindOf) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onDeleteMany: (ids: string[]) => void
  onDuplicate: (id: string) => void
}) {
  const [filter, setFilter] = useState<'all' | AdKindOf>('all')
  const [q, setQ] = useState('')
  const [allDates, setAllDates] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const soon = useMemo(() => comingUp(new Date(), allDates ? 40 : 4), [allDates])
  const shown = rows.filter(r => (filter === 'all' || (r.kind || 'video') === filter) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())))
  const lookOf = (k?: string) => LOOKS.find(l => l.key === k) || LOOKS[0]
  const lastRow = last ? rows.find(r => r.id === last) : rows[0]
  const toggle = (id: string) => setPicked(ps => (ps.indexOf(id) >= 0 ? ps.filter(x => x !== id) : ps.concat([id])))
  const stopSelecting = () => { setSelecting(false); setPicked([]) }
  const counts = (k: AdKindOf) => rows.filter(r => (r.kind || 'video') === k).length

  return (
    <div style={{ padding: '22px 28px 40px', maxWidth: 1380, margin: '0 auto', color: UI.ink }}>
      {/* ── pick up where you left off ── */}
      {lastRow ? (
        <button type="button" onClick={() => onOpen(lastRow.id)} title="Open it in the editor"
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: UI.panel, border: '1px solid rgba(210,176,119,0.35)', borderRadius: 12, padding: '8px 12px 8px 8px', margin: '0 0 22px', cursor: 'pointer', color: UI.ink }}>
          <span style={{ width: 64, height: 44, borderRadius: 8, flex: 'none', background: lastRow.thumb ? `url(${proxied(lastRow.thumb)}) center/cover` : `linear-gradient(135deg, ${lookOf(lastRow.look).c.navy2}, ${lookOf(lastRow.look).c.deep})` }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.gold }}>Pick up where you left off</span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastRow.name} <span style={{ fontWeight: 500, color: UI.mut, fontSize: 12 }}>· {KIND_META[(lastRow.kind || 'video') as AdKindOf].label} · {lastRow.format} · edited {ago(lastRow.updatedAt)}</span></span>
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0B0F16', background: UI.gold, borderRadius: 8, padding: '7px 13px', whiteSpace: 'nowrap' }}>Open →</span>
        </button>
      ) : null}

      {/* ── make something ── */}
      <p style={{ fontFamily: display, fontWeight: 800, fontSize: 24, margin: '0 0 4px', letterSpacing: '-0.01em' }}>What are you making?</p>
      <p style={{ fontSize: 13, color: UI.mut, margin: '0 0 14px' }}>Every piece starts fresh, in the house look, with photos from our library. Nothing is saved until it is built.</p>
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
        <H2 display={display}>Coming up</H2>
        <span style={{ fontSize: 12.5, color: UI.mut }}>The calendar knows the dates — pick a moment and the piece is written and dressed for it.</span>
        <button type="button" onClick={() => setAllDates(!allDates)} style={{ ...ghost, marginLeft: 'auto' }}>{allDates ? 'Next up only' : 'Whole year'}</button>
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
              {m.where && m.where.length ? <p title={'Photos from: ' + buildingsIn(m.where).join(', ')} style={{ fontSize: 11, color: UI.gold, margin: '-6px 0 10px' }}>📍 {m.where.map(k => AREA_LABEL[k]).join(' · ')} — {buildingsIn(m.where).slice(0, 4).join(', ')}{buildingsIn(m.where).length > 4 ? '…' : ''}</p> : null}
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
        <H2 display={display}>Your work</H2>
        <span style={{ fontSize: 12.5, color: UI.mut }}>{rows.length} piece{rows.length === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {selecting ? (<>
            <span style={{ fontSize: 12, color: UI.gold, fontWeight: 700 }}>{picked.length} selected</span>
            <button type="button" onClick={() => setPicked(picked.length === shown.length ? [] : shown.map(r => r.id))} style={ghost}>{picked.length === shown.length ? 'None' : 'All shown'}</button>
            <button type="button" disabled={!picked.length} onClick={() => { onDeleteMany(picked); stopSelecting() }}
              style={{ ...ghost, border: '1px solid rgba(224,108,108,0.5)', background: picked.length ? 'rgba(224,108,108,0.16)' : 'transparent', color: UI.red, opacity: picked.length ? 1 : 0.5 }}>✕ Delete {picked.length || ''}</button>
            <button type="button" onClick={stopSelecting} style={ghost}>Done</button>
          </>) : (<>
            {(['all', 'flyer', 'post', 'video', 'story'] as const).map(k => (k === 'all' || counts(k) ? (
              <button key={k} type="button" onClick={() => setFilter(k)} style={{ ...ghost, background: filter === k ? UI.ink : 'transparent', color: filter === k ? '#0B0F16' : UI.mut }}>
                {k === 'all' ? 'All' : KIND_META[k].plural + ' · ' + counts(k)}
              </button>
            ) : null))}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ marginLeft: 6, background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '5px 9px', fontSize: 12, width: 150 }} />
            {canDelete && rows.length > 1 ? <button type="button" onClick={() => setSelecting(true)} title="Tick several pieces, then delete them together" style={ghost}>Select</button> : null}
          </>)}
        </span>
      </div>
      {shown.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          {shown.map(r => {
            const lk = lookOf(r.look)
            const k = (r.kind || 'video') as AdKindOf
            const tall = r.format === '9:16' || r.format === '4:5' || r.format === 'letter'
            const on = picked.indexOf(r.id) >= 0
            return (
              <div key={r.id} style={{ background: UI.panel, border: '1px solid ' + (on ? UI.red : UI.line), borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
                <button type="button" onClick={() => (selecting ? toggle(r.id) : onOpen(r.id))} title={selecting ? 'Tick to delete' : 'Open'} style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: UI.ink }}>
                  <div style={{ height: 118, background: r.thumb ? `linear-gradient(rgba(8,11,16,0.45), rgba(8,11,16,0) 38%, rgba(8,11,16,0) 62%, rgba(8,11,16,0.5)), url(${proxied(r.thumb)}) center/cover` : `linear-gradient(135deg, ${lk.c.navy2}, ${lk.c.deep})`, position: 'relative', opacity: selecting && !on ? 0.7 : 1 }}>
                    <span style={{ position: 'absolute', left: 10, top: 9, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: '#fff', textTransform: 'uppercase', textShadow: '0 1px 3px rgba(0,0,0,.7)' }}>{KIND_META[k].label}</span>
                    <span style={{ position: 'absolute', right: 10, top: 8, fontSize: 10.5, color: '#fff', opacity: 0.9, textShadow: '0 1px 3px rgba(0,0,0,.7)' }}>{tall ? '▯' : '▭'} {r.format}</span>
                    {r.status === 'approved' ? <span style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 10.5, fontWeight: 700, color: UI.green, textShadow: '0 1px 3px rgba(0,0,0,.8)' }}>✓ Approved</span> : r.status === 'review' ? <span style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 10.5, fontWeight: 700, color: UI.gold, textShadow: '0 1px 3px rgba(0,0,0,.8)' }}>In review</span> : null}
                    {selecting ? <span style={{ position: 'absolute', right: 8, bottom: 8, width: 22, height: 22, borderRadius: 6, border: '2px solid ' + (on ? UI.red : '#fff'), background: on ? UI.red : 'rgba(0,0,0,.35)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>{on ? '✓' : ''}</span> : null}
                  </div>
                  <div style={{ padding: '9px 10px 10px' }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>{r.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: UI.mut, marginTop: 2 }}>{r.scenes} scene{r.scenes === 1 ? '' : 's'} · {ago(r.updatedAt)}</span>
                  </div>
                </button>
                {canEdit && !selecting ? (
                  <span style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', gap: 4 }}>
                    <button type="button" onClick={() => onDuplicate(r.id)} title="Duplicate" style={{ width: 24, height: 22, borderRadius: 6, border: '1px solid ' + UI.line, background: UI.panel2, color: UI.ink, cursor: 'pointer', fontSize: 12 }}>⧉</button>
                    {canDelete ? <button type="button" onClick={() => onDelete(r.id)} title="Delete" style={{ width: 24, height: 22, borderRadius: 6, border: '1px solid rgba(224,108,108,0.4)', background: 'rgba(224,108,108,0.12)', color: UI.red, cursor: 'pointer', fontSize: 12 }}>✕</button> : null}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : <p style={{ fontSize: 13, color: UI.mut }}>Nothing here yet{q ? ' for that search' : ''}. Pick something to make above.</p>}

      {/* ── the videos library: the sales videos and every kept export ── */}
      {library.length || (canEdit && onUploadVideo) ? (<>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '30px 0 10px', flexWrap: 'wrap' }}>
          <H2 display={display}>Finished videos</H2>
          <span style={{ fontSize: 12.5, color: UI.mut }}>The two sales videos and every MP4 you export. Watch, download, or open a sales video scene by scene to edit it.</span>
          {canEdit && onUploadVideo ? (
            <label style={{ ...ghost, marginLeft: 'auto' }}>
              + Upload a video
              <input type="file" accept="video/mp4,video/quicktime,video/webm" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onUploadVideo(f); e.target.value = '' }} />
            </label>
          ) : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
          {library.map(v => {
            const copy = v.builtin ? rows.find(r => r.name === v.name + ' (editable)') : undefined
            return (
              <div key={v.key} style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, overflow: 'hidden' }}>
                <button type="button" onClick={() => onWatch && onWatch(v)} title="Watch" style={{ display: 'block', width: '100%', aspectRatio: '16/9', border: 0, padding: 0, cursor: 'pointer', background: '#000 center/cover no-repeat', backgroundImage: v.thumb ? `url(${v.thumb})` : 'none', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 11, fontWeight: 700, background: 'rgba(0,0,0,.65)', color: '#fff', padding: '2px 7px', borderRadius: 5 }}>▶ {mmss(v.dur)}</span>
                  {v.builtin ? <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', background: UI.gold, color: '#0B0F16', padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase' }}>Sales video</span> : null}
                </button>
                <div style={{ padding: '9px 12px 11px' }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: UI.mut, margin: '2px 0 8px' }}>{v.builtin ? 'The original stays here' : (v.format || 'video') + (v.createdAt ? ' · ' + ago(v.createdAt) : '')}</span>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                    {canEdit && v.builtin && onEditVideo ? (<>
                      <button type="button" disabled={!!busy} onClick={() => onEditVideo(v.key, copy?.id)} title={copy ? 'Opens the editable copy you already have' : 'Opens this video scene by scene — every word, number, photo and timing editable. Makes a copy; the original stays here.'}
                        style={{ fontSize: 11.5, fontWeight: 800, padding: '6px 11px', borderRadius: 8, border: 0, background: UI.gold, color: '#0B0F16', cursor: 'pointer', whiteSpace: 'nowrap' }}>{busy === 'import' ? 'Opening…' : copy ? '✎ Open your editable copy' : '✎ Edit this video'}</button>
                      {copy ? <button type="button" disabled={!!busy} onClick={() => onEditVideo(v.key)} title="Start again from the original" style={ghost}>Fresh copy</button> : null}
                    </>) : null}
                    <a href={v.url} download style={{ ...ghost, textDecoration: 'none' }}>Download</a>
                    {!v.builtin && canDelete && onDeleteVideo ? <button type="button" onClick={() => onDeleteVideo(v)} title="Delete from the library" style={{ ...ghost, color: UI.red }}>✕</button> : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>) : null}
    </div>
  )
}
