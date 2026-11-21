'use client'
// AD STUDIO — THE TIMELINE (Jon, 2026-11-21: "Make the edit feature amazing and similar to the best editing tools";
// "want to be able to add video, shorten the video, cut the video").
//
// The piece laid out in time, the way an editing program shows it: a ruler, a playhead, and every scene as a clip as
// wide as it is long, with its own picture on it.
//   · drag the playhead (or click the ruler) to move through the piece, frame by frame
//   · drag a clip's RIGHT edge to shorten or lengthen it; drag its LEFT edge to trim its start (a video clip then
//     starts later in its file, so you keep exactly the part you want). The picture follows as you drag.
//   · drag a clip sideways to move it earlier or later
//   · Cut splits the clip under the playhead in two; Duplicate and Delete work on that clip
//   · zoom in for fine cuts; the song runs underneath
// Nothing here calls a model. Every gesture is one step of undo. The cuts themselves are lib/adx/edit.ts (tested);
// this file is only the hands.
import { useEffect, useRef, useState } from 'react'
import type { Composition } from '@/lib/adx/composition'
import { restTime } from '@/lib/adx/player'
import * as E from '@/lib/adx/edit'
import { UI } from './BriefWizard'

const TAIL = 28, RULER = 22, CLIPS = 60, SONG = 20
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8]
const TR_NAME: Record<string, string> = { dissolve: 'dissolve', dip: 'dip to colour', push: 'push', slide: 'slide', wipe: 'wipe' }
export const clock = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + '.' + Math.floor((s % 1) * 10)
const tb = (on = false, disabled = false, primary = false): React.CSSProperties => ({ fontSize: 12, fontWeight: 800, padding: '7px 10px', borderRadius: 8, border: primary ? 0 : '1px solid ' + (on ? UI.gold : UI.line), background: primary ? UI.gold : on ? 'rgba(210,176,119,0.16)' : UI.panel2, color: primary ? '#0B0F16' : on ? UI.gold : UI.ink, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.42 : 1, whiteSpace: 'nowrap', lineHeight: 1.1 })

type Gesture =
  | { kind: 'scrub'; pps: number }
  | { kind: 'end' | 'start'; pps: number; sid: string; x0: number; base: Composition; next: Composition; by: number }
  | { kind: 'move'; pps: number; sid: string; x0: number; base: Composition; dx: number; moved: boolean; from: number; to: number; clickT: number }

export default function AdxTimeline(p: {
  doc: Composition; t: number; playing: boolean; ready: boolean; canEdit: boolean
  /** Scene id → a small picture of it. */
  thumbs: Record<string, string>
  /** The clip a person last clicked in the timeline (Delete removes it). */
  sceneSel: string | null
  song: string
  canUndo: boolean; canRedo: boolean; guides: boolean
  onSeek: (t: number) => void; onTogglePlay: () => void; onUndo: () => void; onRedo: () => void; onGuides: () => void
  onPickScene: (sid: string, t: number) => void
  /** While an edge is dragged: the piece as it would be, and the moment to show. null when the drag ends. */
  onPreview: (next: Composition | null, showT?: number) => void
  /** A finished trim or move: one step of undo. */
  onEdit: (next: Composition, sid: string, kind: 'trim' | 'move') => void
  onSplit: () => void; onDuplicate: () => void; onDelete: () => void; onAddScene: () => void; onAddVideo: () => void; onSong: () => void
}) {
  const { doc, t, playing, canEdit } = p
  const wrap = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null)
  const gRef = useRef<Gesture | null>(null)
  const [g, setG] = useState<Gesture | null>(null)
  const [width, setWidth] = useState(640)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const el = wrap.current; if (!el) return
    const read = () => setWidth(Math.max(200, el.clientWidth))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read); ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // while an edge is dragged the clips are drawn as they would be, at the scale the drag began at
  const shown = g && (g.kind === 'end' || g.kind === 'start') ? g.next : doc
  const dur = shown.canvas.duration
  const pps = g ? g.pps : Math.max(3, ((width - TAIL) / Math.max(0.5, doc.canvas.duration)) * zoom)
  const inner = Math.max(width, Math.ceil(dur * pps + TAIL))
  const si = Math.max(0, shown.scenes.findIndex((s, i) => t >= s.start && (i === shown.scenes.length - 1 || t < shown.scenes[i + 1].start)))
  const cur = shown.scenes[si]

  // the playhead stays in view while the piece plays zoomed in
  useEffect(() => {
    const el = wrap.current; if (!el || !playing) return
    const x = t * pps
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2)
  }, [t, playing, pps])

  // ── the gestures ──
  const xAt = (e: { clientX: number }) => e.clientX - (track.current ? track.current.getBoundingClientRect().left : 0)
  const begin = (e: React.PointerEvent, ge: Gesture) => {
    e.preventDefault(); e.stopPropagation()
    try { track.current?.setPointerCapture(e.pointerId) } catch { /* the drag still works without capture */ }
    gRef.current = ge; setG(ge)
  }
  const set = (ge: Gesture) => { gRef.current = ge; setG(ge) }
  const sceneOf = (d: Composition, sid: string) => d.scenes.find(s => s.id === sid)
  const onMove = (e: React.PointerEvent) => {
    const ge = gRef.current; if (!ge) return
    if (ge.kind === 'scrub') { p.onSeek(xAt(e) / ge.pps); return }
    const dx = e.clientX - ge.x0
    if (ge.kind === 'end') {
      const s0 = sceneOf(ge.base, ge.sid); if (!s0) return
      const next = E.setSceneDur(ge.base, ge.sid, s0.dur + dx / ge.pps), s1 = sceneOf(next, ge.sid) || s0
      set({ ...ge, next, by: s1.dur - s0.dur })
      p.onPreview(next, s1.start + s1.dur - 1 / 30)                 // the last frame of the clip, as it is cut
    } else if (ge.kind === 'start') {
      const s0 = sceneOf(ge.base, ge.sid); if (!s0) return
      const next = E.trimSceneStart(ge.base, ge.sid, dx / ge.pps), s1 = sceneOf(next, ge.sid) || s0
      set({ ...ge, next, by: s0.dur - s1.dur })
      // a video shows the frame it will now open on; a designed scene shows itself arrived
      const mix = Math.min(s1.transitionIn.dur || 0, s1.dur / 2)
      p.onPreview(next, E.videoOf(next, s1) ? s1.start + mix + 0.001 : s1.start + Math.min(restTime(s1) - s1.start, s1.dur - 1 / 30))
    } else if (ge.kind === 'move') {
      const moved = ge.moved || Math.abs(dx) > 6
      const at = xAt(e) / ge.pps
      const to = ge.base.scenes.filter(s => s.id !== ge.sid && s.start + s.dur / 2 < at).length
      set({ ...ge, dx, moved, to })
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const ge = gRef.current; gRef.current = null; setG(null)
    try { track.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (!ge) return
    if (ge.kind === 'end' || ge.kind === 'start') { p.onPreview(null); if (Math.abs(ge.by) > 0.01) p.onEdit(ge.next, ge.sid, 'trim') }
    else if (ge.kind === 'move') { if (!ge.moved) p.onPickScene(ge.sid, ge.clickT); else if (ge.to !== ge.from) p.onEdit(E.moveSceneTo(ge.base, ge.sid, ge.to), ge.sid, 'move') }
  }

  // ── the ruler ──
  const step = [0.5, 1, 2, 5, 10, 15, 30].find(s => s * pps >= 54) || 30
  const ticks: number[] = []
  for (let x = 0; x <= dur + 1e-6; x += step) ticks.push(Math.round(x * 100) / 100)
  const fine = step > 1 && pps >= 9 ? Array.from({ length: Math.floor(dur) + 1 }, (_, i) => i).filter(x => x % step !== 0) : []

  const trimming = g && (g.kind === 'end' || g.kind === 'start') ? g : null
  const moving = g && g.kind === 'move' && g.moved ? g : null
  const shiftFrom = trimming && trimming.kind === 'start' ? shown.scenes.findIndex(s => s.id === trimming.sid) : -1
  const xOf = (i: number) => shown.scenes[i].start * pps + (shiftFrom >= 0 && i >= shiftFrom ? (trimming ? trimming.by * pps : 0) : 0)
  const zi = ZOOMS.indexOf(zoom)
  const fadeOut = doc.assets.audio.music.fadeOut || 0
  const splitOk = canEdit && !!cur && E.canSplit(doc, cur.id, t - cur.start)
  const room = E.canAddScene(doc)
  let dropX = -1
  if (moving) { const S = moving.base.scenes; dropX = (moving.to <= moving.from ? S[moving.to].start : S[moving.to].start + S[moving.to].dur) * pps }

  return (
    <div style={{ margin: '12px auto 0', maxWidth: 980, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '9px 10px 8px' }}>
      {/* ── the tools ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={p.onTogglePlay} disabled={!p.ready} title="Play or pause (Space)" style={{ ...tb(false, !p.ready, true), minWidth: 70 }}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <span style={{ fontSize: 12, color: UI.ink, fontVariantNumeric: 'tabular-nums', fontWeight: 700, minWidth: 96 }}>{clock(t)} <span style={{ color: UI.mut, fontWeight: 500 }}>/ {clock(dur)}</span></span>
        {canEdit ? (<>
          <button type="button" onClick={p.onSplit} disabled={!splitOk} title="Cut the clip in two at the playhead (S)" style={tb(false, !splitOk)}>✂ Cut</button>
          <button type="button" onClick={p.onDuplicate} disabled={!room} title="The same scene again, straight after (⌘D)" style={tb(false, !room)}>Duplicate</button>
          <button type="button" onClick={p.onDelete} disabled={doc.scenes.length < 2} title="Delete the clip under the playhead" style={{ ...tb(false, doc.scenes.length < 2), color: UI.red }}>Delete</button>
          <span style={{ width: 1, alignSelf: 'stretch', background: UI.line, margin: '2px 2px' }} />
          <button type="button" onClick={p.onAddScene} disabled={!room} title="A new scene after this one" style={tb(false, !room)}>+ Scene</button>
          <button type="button" onClick={p.onAddVideo} disabled={!room} title="A video clip after this scene: from the library or your computer" style={tb(false, !room)}>+ Video</button>
        </>) : null}
        <span style={{ flex: 1 }} />
        {canEdit ? (<>
          <button type="button" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (⌘Z)" style={tb(false, !p.canUndo)}>↶ Undo</button>
          <button type="button" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo" style={tb(false, !p.canRedo)}>↷</button>
        </>) : null}
        <button type="button" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])} disabled={zi <= 0} title="Zoom out" aria-label="Zoom out" style={tb(false, zi <= 0)}>−</button>
        <button type="button" onClick={() => setZoom(1)} title="Show the whole piece" style={tb(zoom === 1)}>Fit</button>
        <button type="button" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} disabled={zi >= ZOOMS.length - 1} title="Zoom in for a fine cut" aria-label="Zoom in" style={tb(false, zi >= ZOOMS.length - 1)}>+</button>
        <button type="button" onClick={p.onGuides} aria-pressed={p.guides} title="Shows the area the platform's own buttons leave clear" style={tb(p.guides)}>Safe area</button>
      </div>

      {/* ── the track ── */}
      <div ref={wrap} style={{ marginTop: 8, overflowX: 'auto', overflowY: 'hidden', borderRadius: 8, background: UI.bg, border: '1px solid ' + UI.line }}>
        <div ref={track} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ position: 'relative', width: inner, height: RULER + CLIPS + SONG + 10, userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}>
          {/* the ruler: click or drag to move through the piece */}
          <div onPointerDown={e => { const ge: Gesture = { kind: 'scrub', pps }; begin(e, ge); p.onSeek(xAt(e) / pps) }} title="Drag to move through the piece"
            style={{ position: 'absolute', left: 0, top: 0, width: inner, height: RULER, cursor: 'ew-resize', borderBottom: '1px solid ' + UI.line }}>
            {fine.map(x => <span key={'f' + x} style={{ position: 'absolute', left: x * pps, bottom: 0, width: 1, height: 4, background: 'rgba(255,255,255,0.18)' }} />)}
            {ticks.map(x => (
              <span key={x} style={{ position: 'absolute', left: x * pps, top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.22)', paddingLeft: 4, fontSize: 10, lineHeight: RULER - 4 + 'px', color: UI.mut, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>{x % 1 ? x.toFixed(1) : x}s</span>
            ))}
          </div>

          {/* the clips */}
          {shown.scenes.map((s, i) => {
            const w = Math.max(6, s.dur * pps - 2), x = xOf(i), on = i === si, picked = p.sceneSel === s.id
            const vid = E.videoOf(shown, s), drag = moving && moving.sid === s.id
            const hw = Math.min(10, w / 3)
            const tr = i > 0 && TR_NAME[s.transitionIn.type] ? TR_NAME[s.transitionIn.type] : ''
            const tip = `${i + 1} · ${s.name} · ${s.dur.toFixed(1)} s${tr ? ' · comes in with a ' + tr : ''}${vid ? ' · video from ' + clock(vid.clip?.start || 0) : ''}`
            return (
              <div key={s.id} title={tip} aria-label={tip}
                onPointerDown={e => { if (!canEdit) { p.onPickScene(s.id, xAt(e) / pps); return } begin(e, { kind: 'move', pps, sid: s.id, x0: e.clientX, base: doc, dx: 0, moved: false, from: i, to: i, clickT: xAt(e) / pps }) }}
                style={{ position: 'absolute', left: x, top: RULER + 4, width: w, height: CLIPS, borderRadius: 7, overflow: 'hidden', boxSizing: 'border-box', cursor: canEdit ? 'grab' : 'pointer',
                  border: (on || picked ? '2px solid ' : '1px solid ') + (on || picked ? UI.gold : 'rgba(255,255,255,0.16)'), background: UI.panel2,
                  backgroundImage: p.thumbs[s.id] ? `url(${p.thumbs[s.id]})` : undefined, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x',
                  transform: drag ? `translateX(${moving!.dx}px)` : undefined, zIndex: drag ? 6 : trimming && trimming.sid === s.id ? 4 : 1, opacity: drag ? 0.85 : 1, boxShadow: drag ? '0 8px 22px rgba(0,0,0,.6)' : 'none' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0) 46%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.62))', pointerEvents: 'none' }} />
                {w > 34 ? <span style={{ position: 'absolute', left: 7, right: 7, top: 4, fontSize: 11, fontWeight: 800, color: on ? UI.gold : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>{i + 1} · {s.name}</span> : null}
                {w > 34 ? <span style={{ position: 'absolute', left: 7, right: 7, bottom: 4, fontSize: 10.5, color: '#fff', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,.8)', overflow: 'hidden', whiteSpace: 'nowrap' }}>{s.dur.toFixed(1)} s{vid && w > 96 ? ' · video' + ((vid.clip?.speed || 1) !== 1 ? ' ' + vid.clip!.speed + '×' : '') + (vid.clip?.sound ? ' · sound' : '') : ''}</span> : null}
                {canEdit ? (<>
                  <span onPointerDown={e => begin(e, { kind: 'start', pps, sid: s.id, x0: e.clientX, base: doc, next: doc, by: 0 })} title="Drag to trim the start of this clip"
                    style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: hw, cursor: 'ew-resize', background: on || picked ? 'rgba(210,176,119,0.9)' : 'rgba(255,255,255,0.28)', borderRight: '1px solid rgba(0,0,0,0.5)' }} />
                  <span onPointerDown={e => begin(e, { kind: 'end', pps, sid: s.id, x0: e.clientX, base: doc, next: doc, by: 0 })} title="Drag to shorten or lengthen this clip"
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: hw, cursor: 'ew-resize', background: on || picked ? 'rgba(210,176,119,0.9)' : 'rgba(255,255,255,0.28)', borderLeft: '1px solid rgba(0,0,0,0.5)' }} />
                </>) : null}
              </div>
            )
          })}
          {/* how each scene comes in: a small mark on the join */}
          {shown.scenes.map((s, i) => (i > 0 && TR_NAME[s.transitionIn.type] && !moving ? <span key={'tr' + s.id} style={{ position: 'absolute', left: xOf(i) - 6, top: RULER + 4 + CLIPS / 2 - 5, width: 10, height: 10, transform: 'rotate(45deg)', background: UI.gold, border: '1.5px solid #0B0F16', zIndex: 3, pointerEvents: 'none' }} /> : null))}
          {dropX >= 0 ? <span style={{ position: 'absolute', left: Math.max(0, dropX - 2), top: RULER, width: 3, height: CLIPS + 8, background: UI.gold, borderRadius: 2, zIndex: 7, pointerEvents: 'none' }} /> : null}
          {trimming ? (() => { const s = sceneOf(trimming.next, trimming.sid); if (!s) return null; const i = shown.scenes.indexOf(s), at = trimming.kind === 'end' ? xOf(i) + s.dur * pps : xOf(i); return <span style={{ position: 'absolute', left: Math.max(2, Math.min(inner - 70, at - 30)), top: 2, zIndex: 9, background: UI.gold, color: '#0B0F16', fontSize: 10.5, fontWeight: 800, padding: '2px 6px', borderRadius: 5, pointerEvents: 'none', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{s.dur.toFixed(1)} s</span> })() : null}

          {/* the song */}
          <button type="button" onClick={p.onSong} disabled={!canEdit} title={p.song ? 'The song — click to change it, its volume or where it starts' : 'No song — click to pick one'}
            style={{ position: 'absolute', left: 0, top: RULER + CLIPS + 8, width: Math.max(40, dur * pps - 2), height: SONG, borderRadius: 5, border: '1px ' + (p.song ? 'solid rgba(76,196,136,0.45)' : 'dashed ' + UI.line), padding: '0 7px', textAlign: 'left', cursor: canEdit ? 'pointer' : 'default', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 10.5, fontWeight: 700, color: p.song ? UI.green : UI.mut,
              background: p.song ? `linear-gradient(90deg, rgba(76,196,136,0.16) 0, rgba(76,196,136,0.16) calc(100% - ${Math.round(fadeOut * pps)}px), rgba(76,196,136,0.02) 100%)` : 'transparent' }}>
            {p.song ? '♪ ' + p.song : 'No song'}
          </button>

          {/* the playhead */}
          <span style={{ position: 'absolute', left: t * pps + (shiftFrom >= 0 && trimming ? trimming.by * pps : 0) - 1, top: 0, width: 2, height: RULER + CLIPS + SONG + 10, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)', zIndex: 8, pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: -5, top: 0, width: 12, height: 10, background: '#fff', borderRadius: '2px 2px 6px 6px', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)' }} />
          </span>
        </div>
      </div>
      {canEdit ? <p style={{ margin: '7px 2px 0', fontSize: 11, color: UI.mut }}>Drag a clip’s edge to trim it, drag a clip to move it. Space plays · S cuts at the playhead · ← → step a frame · ⌘D duplicates · ⌘Z undoes.</p> : null}
    </div>
  )
}
