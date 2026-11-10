'use client'
// THE TRANSITIONS BROWSER AND THE GRAPHICS BROWSER (Jon, 2026-11-10: "build transitions between scenes like Final
// Cut Pro … enhance and improve graphics … being able to add to all scenes"). Both used to be walls of text buttons —
// Iris, Diamond, Blinds, Bokeh, Scanlines — where the only way to learn what one did was to press it and play the ad.
// Here each one is a live tile of YOUR scenes, drawn by the same renderer as the player and the export: still until
// you point at it, then it plays, the way Final Cut's browser skims. A picked transition or graphic can go on this
// scene or on every scene in one tap.
import { useEffect, useRef, useState } from 'react'
import { type AdProject, type AdScene, type AdAssets, type AdTransition, FORMATS, FX, TRANSITION_META, timeline, drawFrame } from '@/lib/ad-engine'

const UI = { panel: '#151A21', panel2: '#1B222B', line: '#262E39', ink: '#E8EBEF', mut: '#8C96A3', sel: '#FFFFFF', blue: '#4C8DF6' }

/** A canvas that shows one frame at rest and loops `span` while the pointer is on it. */
function LiveTile({ proj, at, span, assets, hot, sig }: { proj: AdProject; at: number; span: [number, number]; assets: () => AdAssets; hot: boolean; sig: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [FW, FH] = FORMATS[proj.format]
  const w = 176, h = Math.round(w * Math.min(1.25, FH / FW))
  // (a graphic's tile shows this scene's photo as a plain cinematic frame, a shade darker, so the graphic is what
  // you see rather than the layout)
  // kept in refs so a hover elsewhere (a parent re-render) does not redraw every tile
  const P = useRef(proj); P.current = proj
  const T = useRef(timeline(proj)); T.current = timeline(proj)
  const draw = (t: number) => {
    const cv = ref.current; if (!cv) return
    const c2 = document.createElement('canvas')
    c2.width = Math.round(400 * FW / Math.max(FW, FH)); c2.height = Math.round(400 * FH / Math.max(FW, FH))
    const g = c2.getContext('2d'); if (!g) return
    try { drawFrame(g, P.current, T.current, Math.max(0, Math.min(T.current.total - 0.02, t)), assets()) } catch { return }
    const x = cv.getContext('2d'); if (!x) return
    const s = Math.max(cv.width / c2.width, cv.height / c2.height)
    x.drawImage(c2, (cv.width - c2.width * s) / 2, (cv.height - c2.height * s) / 2, c2.width * s, c2.height * s)
  }
  useEffect(() => {
    if (!hot) {
      const ids = [setTimeout(() => draw(at), 40), setTimeout(() => draw(at), 1200), setTimeout(() => draw(at), 2800)]
      return () => ids.forEach(clearTimeout)
    }
    let raf = 0, t0 = performance.now()
    const loop = (now: number) => {
      const len = span[1] - span[0]
      draw(span[0] + (((now - t0) / 1000) % (len + 0.35)))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [hot, at, span[0], span[1], sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={w * 2} height={h * 2} style={{ width: '100%', aspectRatio: `${w}/${h}`, display: 'block', background: '#000' }} />
}

function Shell({ title, sub, display, scope, onScope, total, onClose, children }: {
  title: string; sub: string; display: string; scope: 'one' | 'all'; onScope: (s: 'one' | 'all') => void; total: number; onClose: () => void; children: React.ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1080px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, color: UI.ink }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid ' + UI.line, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: display, fontWeight: 800, fontSize: 19 }}>{title}</span>
          <span style={{ fontSize: 12.5, color: UI.mut }}>{sub}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }} title="Where your pick goes">
            {total > 1 ? (['one', 'all'] as const).map(k => (
              <button key={k} type="button" onClick={() => onScope(k)}
                style={{ background: scope === k ? '#FFFFFF' : 'transparent', color: scope === k ? '#0E1116' : UI.mut, border: '1px solid ' + (scope === k ? '#FFFFFF' : UI.line), borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {k === 'one' ? 'This scene' : 'All ' + total + ' scenes'}
              </button>
            )) : null}
            <button type="button" onClick={onClose} style={{ marginLeft: 6, background: 'transparent', border: '1px solid ' + UI.line, color: UI.mut, borderRadius: 8, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Close</button>
          </span>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 18px 18px' }}>{children}</div>
      </div>
    </div>
  )
}

const tileBtn = (on: boolean): React.CSSProperties => ({ padding: 0, border: '2px solid ' + (on ? UI.sel : UI.line), borderRadius: 9, overflow: 'hidden', cursor: 'pointer', background: UI.panel2, color: UI.ink, textAlign: 'left', position: 'relative' })
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }
const groupHead: React.CSSProperties = { margin: '14px 0 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.ink }
const quiet = (s: AdScene): AdScene => ({ ...s, vo: '', sfx: '' })

export function TransitionPicker({ proj, from, to, current, assets, display, scope, onScope, onPick, onClose }: {
  proj: AdProject; from: AdScene; to: AdScene; current: AdTransition; assets: () => AdAssets; display: string
  scope: 'one' | 'all'; onScope: (s: 'one' | 'all') => void; onPick: (k: AdTransition) => void; onClose: () => void
}) {
  const [hot, setHot] = useState('')
  // Two scenes, two seconds each: the cut lands at 2 s. The tile rests a third of the way through the hand-over
  // (both pictures visible) and plays from just before the cut to just after it.
  const mini = (k: AdTransition): AdProject => ({ ...proj, captions: false, voice: null, scenes: [
    { ...quiet(from), id: 'a', dur: 2, fx: [], fxo: {} },
    { ...quiet(to), id: 'b', dur: 2.2, tr: k, trs: to.trs, trd: to.trd, fx: [], fxo: {} },
  ] })
  const groups = ['Dissolves', 'Movements', 'Wipes', 'Lights', 'Stylized'] as const
  return (
    <Shell title="Transitions" sub="Point at one to see it play. Click to use it." display={display} scope={scope} onScope={onScope} total={proj.scenes.length - 1} onClose={onClose}>
      {groups.map(g => (
        <div key={g}>
          <p style={groupHead}>{g}</p>
          <div style={grid}>
            {TRANSITION_META.filter(x => x.group === g).map(x => (
              <button key={x.key} type="button" title={x.hint} onClick={() => onPick(x.key)} onMouseEnter={() => setHot(x.key)} onMouseLeave={() => setHot('')} style={tileBtn(current === x.key)}>
                <LiveTile proj={mini(x.key)} sig={x.key + (to.trs || '') + (to.trd || '') + proj.look + proj.format} at={x.key === 'cut' ? 2.4 : 2.25} span={[1.5, 3.4]} assets={assets} hot={hot === x.key} />
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, padding: '5px 8px 1px' }}>{current === x.key ? '✓ ' : ''}{x.label}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: UI.mut, padding: '0 8px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Shell>
  )
}

/** Graphics grouped by what they are for. */
const FX_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Light and atmosphere', keys: ['bokeh', 'rays', 'sparkle', 'glowline', 'orb', 'scan'] },
  { title: 'Frames and lines', keys: ['frame', 'corners', 'stripes', 'waves', 'grid', 'rope'] },
  { title: 'Information', keys: ['stars', 'pin', 'badge', 'swipe'] },
  { title: 'Seasons and events', keys: ['snow', 'lights', 'tree', 'garland', 'fireworks', 'confetti', 'balloons', 'hearts', 'leaves', 'palms', 'eq'] },
]

export function GraphicsPicker({ proj, scene, on, assets, display, scope, onScope, onToggle, onClose }: {
  proj: AdProject; scene: AdScene; on: string[]; assets: () => AdAssets; display: string
  scope: 'one' | 'all'; onScope: (s: 'one' | 'all') => void; onToggle: (k: string) => void; onClose: () => void
}) {
  const [hot, setHot] = useState('')
  // A tall ad is previewed at 4:5 here so the whole frame fits the tile — edges, corners and borders included.
  const mini = (k: string): AdProject => ({ ...proj, format: proj.format === '9:16' ? '4:5' : proj.format, captions: false, voice: null, scenes: [{ ...quiet(scene), id: 'g', dur: 4, kind: 'cinema', cu: { ...(scene.cu || {}), shade: 'dark' }, fx: [k], fxo: scene.fxo && scene.fxo[k] ? { [k]: scene.fxo[k] } : {} }] })
  const shown = new Set(FX_GROUPS.flatMap(g => g.keys))
  const rest = FX.filter(f => !shown.has(f.key)).map(f => f.key)
  const groups = rest.length ? FX_GROUPS.concat([{ title: 'More', keys: rest }]) : FX_GROUPS
  return (
    <Shell title="Graphics" sub={(on.length ? on.length + ' on · ' : '') + 'Point at one to see it move. Click to add or remove — up to six.'} display={display} scope={scope} onScope={onScope} total={proj.scenes.length} onClose={onClose}>
      {groups.map(g => (
        <div key={g.title}>
          <p style={groupHead}>{g.title}</p>
          <div style={grid}>
            {g.keys.map(k => { const f = FX.find(x => x.key === k); if (!f) return null; const has = on.indexOf(k) >= 0
              return (
                <button key={k} type="button" title={f.hint} onClick={() => onToggle(k)} onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot('')} style={tileBtn(has)}>
                  <LiveTile proj={mini(k)} sig={k + proj.look + proj.format + scene.id} at={1.8} span={[0.4, 3.6]} assets={assets} hot={hot === k} />
                  {has ? <span style={{ position: 'absolute', top: 6, right: 6, background: '#fff', color: '#0E1116', borderRadius: 10, fontSize: 10.5, fontWeight: 800, padding: '2px 7px' }}>✓ On</span> : null}
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 700, padding: '5px 8px 1px' }}>{f.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: UI.mut, padding: '0 8px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.hint}</span>
                </button>
              ) })}
          </div>
        </div>
      ))}
    </Shell>
  )
}
