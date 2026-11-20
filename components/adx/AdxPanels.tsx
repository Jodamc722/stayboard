'use client'
// AD STUDIO EDITOR (Jon, 2026-11-20: "need to be able to change themes, songs, length of videos or scenes, transitions
// etc. Make it super interactive and easy to customize. Click into the video and change things, give you options,
// delete visuals, add photos, swap photo").
//
// THE OPTIONS BESIDE THE PICTURE. Click anything in the video and its options appear here: the words, the size, the
// colour, how it arrives, swap or delete. Under it, the scene on screen (length, transition, background, what is in
// it). "Look & sound" changes the whole piece at once: colour theme, headline type, the song, the total length.
// Every choice is a visible button — no drop-down menus — and every change is instant, free (no AI is called) and
// can be undone. The measured check runs again after each one.
import { useEffect, useRef, useState } from 'react'
import { MUSIC } from '@/lib/ad-engine'
import type { Composition, Layer, Scene, PhotoAsset, PhotoLayer, TextLayer, ButtonLayer, ShapeLayer, MotifLayer, Transition } from '@/lib/adx/composition'
import { resolveColor, TRANSITIONS, MOTIF_VARIANTS } from '@/lib/adx/composition'
import * as E from '@/lib/adx/edit'
import { groundOf, maxUpscale } from '@/lib/adx/player'
import { UI } from './BriefWizard'

export type Commit = (next: Composition, coalesce?: string) => void
export type Pool = { photos: Record<string, PhotoAsset>; thumbs: Record<string, string>; subjects: string[] }

export const chip = (on = false, disabled = false): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + (on ? UI.gold : UI.line), background: on ? 'rgba(210,176,119,0.16)' : UI.panel2, color: on ? UI.gold : UI.ink, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap' })
const danger: React.CSSProperties = { ...chip(), color: UI.red, borderColor: 'rgba(224,108,108,0.4)' }
const label: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.mut, margin: '12px 0 6px' }
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }
const area: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: UI.bg, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '7px 9px', fontSize: 13, lineHeight: 1.35, resize: 'vertical', fontFamily: 'inherit' }
const proxied = (u: string) => (!u ? '' : u.startsWith('/') || /supabase\.co\//.test(u) ? u : '/api/img-proxy?url=' + encodeURIComponent(u))

export function Sec({ title, right, children, accent }: { title: string; right?: React.ReactNode; children: React.ReactNode; accent?: boolean }) {
  return (
    <section style={{ background: UI.panel, border: '1px solid ' + (accent ? UI.gold : UI.line), borderRadius: 12, padding: '11px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        {right}
      </div>
      {children}
    </section>
  )
}

/** The piece's own colours as round buttons. */
export function Swatches({ doc, value, onPick, small }: { doc: Composition; value: string | null; onPick: (key: string) => void; small?: boolean }) {
  const n = small ? 20 : 24
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {Object.entries(doc.tokens.color).map(([k, hex]) => (
        <button key={k} type="button" title={k} aria-label={'Colour ' + k} aria-pressed={value === hex} onClick={() => onPick(k)}
          style={{ width: n, height: n, borderRadius: n, background: hex, border: '1px solid rgba(255,255,255,0.35)', boxShadow: value === hex ? '0 0 0 2px ' + UI.gold : 'none', cursor: 'pointer', padding: 0 }} />
      ))}
    </span>
  )
}

// ── one thing in the picture ────────────────────────────────────────────────────────────────────────────────────
export function LayerPanel({ doc, scene, layer, commit, wordsOf, setWords, onSwap, onDeselect }: {
  doc: Composition; scene: Scene; layer: Layer; commit: Commit
  wordsOf: (l: TextLayer | ButtonLayer) => string; setWords: (l: TextLayer | ButtonLayer, text: string) => void
  onSwap: (layerId: string) => void; onDeselect: () => void
}) {
  const id = layer.id
  const patch = (fn: (l: Layer) => Layer, key = '') => commit(E.patchLayer(doc, id, fn), key)
  const entrances = E.ENTRANCES[layer.type] || []
  const en = layer.in
  const W = doc.canvas.w, H = doc.canvas.h
  const photo = layer.type === 'photo' ? doc.assets.photos[layer.photo] : null
  const added = E.isAdded(doc, layer)
  const soft = layer.type === 'photo' && photo ? E.upscaleOf(doc, layer) > 1.005 : false
  const accent = layer.type === 'text' ? (layer.runs.find(r => !('br' in r) && r.color) as { color?: string } | undefined) : undefined
  return (
    <Sec accent title={E.layerName(doc, layer)} right={<button type="button" onClick={onDeselect} style={chip()}>Done</button>}>
      {layer.type === 'text' || layer.type === 'button' ? (<>
        <span style={label}>Words</span>
        <textarea rows={layer.type === 'button' ? 1 : 2} value={wordsOf(layer)} onChange={e => setWords(layer, e.target.value)} style={area} />
        {layer.type === 'text' ? <p style={{ margin: '4px 0 0', fontSize: 11, color: UI.mut }}>A new line breaks the line. *Stars* mark the accent words.</p> : null}
        <span style={label}>Size{layer.type === 'text' ? ' and position' : ''}</span>
        <div style={row}>
          <button type="button" onClick={() => commit(E.resizeText(doc, id, -2))} style={chip()}>A −</button>
          <button type="button" onClick={() => commit(E.resizeText(doc, id, 2))} style={chip()}>A +</button>
          {layer.type === 'text' ? (['left', 'center', 'right'] as const).map(a => <button key={a} type="button" onClick={() => patch(l => ({ ...(l as TextLayer), align: a === 'left' ? undefined : a }))} style={chip((layer.align || 'left') === a)}>{a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}</button>) : null}
        </div>
      </>) : null}

      {layer.type === 'photo' && added ? (<>
        <span style={label}>Movement</span>
        <div style={row}>
          {([['', 'Still'], ['float', 'Float'], ['sway', 'Sway'], ['spin', 'Turn slowly'], ['pulse', 'Pulse']] as const).map(([k, name]) => <button key={name} type="button" onClick={() => patch(l => { const { idle: _i, ...rest } = l as PhotoLayer; return (k ? { ...rest, idle: k } : rest) as Layer })} style={chip((layer.idle || '') === k)}>{name}</button>)}
        </div>
      </>) : null}
      {layer.type === 'photo' && added ? (soft ? <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.red }}>This image is drawn larger than its real pixels, so it will look soft. Make it smaller or add a larger file.</p> : <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.mut }}>Your image, shown whole. Drag its corner to resize.</p>) : null}
      {layer.type === 'photo' && !added ? (<>
        <div style={{ ...row, marginTop: 10 }}>
          <button type="button" onClick={() => onSwap(id)} style={{ ...chip(), background: UI.gold, color: '#0B0F16', border: 0 }}>Swap photo</button>
          <button type="button" onClick={() => commit(E.patchLayer(doc, id, l => { const { mask: _m, ...rest } = l as PhotoLayer; return { ...rest, box: { x: 0, y: 0, w: W, h: H } } as Layer }))} style={chip()}>Fill the frame</button>
        </div>
        {soft ? <p style={{ margin: '7px 0 0', fontSize: 11.5, color: UI.red }}>This window is larger than the photograph’s real pixels, so it will look soft. Make the window smaller or swap the photo.</p> : null}
        <span style={label}>Window shape</span>
        <div style={row}>
          {([['rect', 'Square corners'], ['round', 'Rounded'], ['arch', 'Arch'], ['circle', 'Circle']] as const).map(([k, name]) => (
            <button key={k} type="button" onClick={() => patch(l => { const { mask: _m, ...rest } = l as PhotoLayer; return (k === 'rect' ? rest : { ...rest, mask: k === 'round' ? { shape: 'round', radius: 28 } : { shape: k } }) as Layer })} style={chip((layer.mask?.shape || 'rect') === k)}>{name}</button>
          ))}
        </div>
        <span style={label}>Movement</span>
        <div style={row}>
          {E.CAMERAS.map(c => <button key={c.key} type="button" onClick={() => patch(l => { const { camera: _c, ...rest } = l as PhotoLayer; return (c.camera ? { ...rest, camera: c.camera } : rest) as Layer })} style={chip(E.cameraKey(layer) === c.key)}>{c.label}</button>)}
        </div>
        <span style={label}>Which part of the photo to show</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 26px)', gap: 4 }}>
          {[0.2, 0.5, 0.8].map(y => [0.2, 0.5, 0.8].map(x => {
            const f = layer.focal || photo?.focal || { x: 0.5, y: 0.5 }, near = (v: number) => [0.2, 0.5, 0.8].reduce((m, c) => (Math.abs(c - v) < Math.abs(m - v) ? c : m), 0.5), on = near(f.x) === x && near(f.y) === y
            return <button key={x + '-' + y} type="button" aria-label={`Focus ${x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'centre'} ${y < 0.4 ? 'top' : y > 0.6 ? 'bottom' : 'middle'}`} onClick={() => patch(l => ({ ...(l as PhotoLayer), focal: { x, y } }))} style={{ width: 26, height: 22, borderRadius: 5, border: '1px solid ' + (on ? UI.gold : UI.line), background: on ? UI.gold : UI.panel2, cursor: 'pointer', padding: 0 }} />
          }))}
        </div>
      </>) : null}

      {layer.type === 'logo' ? (<>
        <span style={label}>Logo</span>
        <div style={row}>
          <button type="button" onClick={() => patch(l => ({ ...l, variant: 'black', tint: undefined } as Layer))} style={chip(layer.variant === 'black')}>Black</button>
          <button type="button" onClick={() => patch(l => ({ ...l, variant: 'white' } as Layer))} style={chip(layer.variant === 'white')}>White</button>
        </div>
      </>) : null}

      {layer.type === 'shape' ? (<>
        <span style={label}>Shape</span>
        <div style={row}>
          {E.SHAPE_KINDS.map(k => (
            <button key={k.key} type="button" onClick={() => patch(l => {
              const { radius: _r, stroke: _s, ...rest } = l as ShapeLayer, b = rest.box
              const box = k.key === 'line' ? { ...b, h: 1 } : b.h < 28 ? { ...b, h: Math.round(b.w * 0.7) } : b
              return (k.key === 'circle' ? { ...rest, shape: 'ellipse', box } : k.key === 'line' ? { ...rest, shape: 'line', stroke: (l as ShapeLayer).stroke || 6, box } : k.key === 'frame' ? { ...rest, shape: 'rect', stroke: (l as ShapeLayer).stroke || 6, box } : k.key === 'rounded' ? { ...rest, shape: 'rect', radius: 36, box } : { ...rest, shape: 'rect', box }) as Layer
            })} style={chip(E.shapeKind(layer) === k.key)}>{k.label}</button>
          ))}
        </div>
        {layer.stroke || layer.shape === 'line' ? (
          <div style={{ ...row, marginTop: 6 }}>
            {([['Thin', 3], ['Medium', 6], ['Thick', 12]] as const).map(([name, w]) => <button key={name} type="button" onClick={() => patch(l => ({ ...(l as ShapeLayer), stroke: w }))} style={chip((layer.stroke || 2) === w)}>{name}</button>)}
          </div>
        ) : null}
      </>) : null}
      {layer.type === 'motif' && (MOTIF_VARIANTS[layer.motif] || []).length > 1 ? (<>
        <span style={label}>Style</span>
        <div style={row}>
          {(MOTIF_VARIANTS[layer.motif] || []).map(v => <button key={v} type="button" onClick={() => patch(l => ({ ...(l as MotifLayer), variant: v }))} style={chip((layer.variant || MOTIF_VARIANTS[layer.motif][0]) === v)}>{E.VARIANT_LABEL[v] || v}</button>)}
        </div>
      </>) : null}
      {layer.type === 'motif' && (layer.motif === 'snow' || layer.motif === 'sparkle') ? (
        <div style={{ ...row, marginTop: 8 }}>
          {([['A few', layer.motif === 'snow' ? 20 : 6], ['Some', layer.motif === 'snow' ? 40 : 12], ['Lots', layer.motif === 'snow' ? 70 : 24]] as const).map(([name, n]) => <button key={name} type="button" onClick={() => patch(l => ({ ...(l as MotifLayer), count: n }))} style={chip((layer.count || (layer.motif === 'snow' ? 40 : 12)) === n)}>{name}</button>)}
        </div>
      ) : null}

      {E.layerColor(doc, layer) || (layer.type === 'motif' && ['leaf', 'ornament', 'star', 'sparkle', 'firework', 'rays', 'snow', 'tree'].indexOf(layer.motif) >= 0) ? (<>
        <span style={label}>{layer.type === 'button' ? 'Button colour' : 'Colour'}</span>
        <Swatches doc={doc} value={E.layerColor(doc, layer)} onPick={k => commit(E.setLayerColor(doc, id, k))} />
      </>) : null}
      {layer.type === 'button' ? (<>
        <span style={label}>Colour of its words</span>
        <Swatches doc={doc} value={resolveColor(doc, layer.color, '#FFFFFF')} onPick={k => patch(l => ({ ...(l as ButtonLayer), color: k }))} />
      </>) : null}
      {accent ? (<>
        <span style={label}>Accent words</span>
        <Swatches doc={doc} value={resolveColor(doc, accent.color)} onPick={k => patch(l => ({ ...(l as TextLayer), runs: (l as TextLayer).runs.map(r => (!('br' in r) && r.color ? { ...r, color: k } : r)) }))} />
      </>) : null}

      {entrances.length ? (<>
        <span style={label}>How it arrives</span>
        <div style={row}>
          <button type="button" onClick={() => commit(E.setEntrance(doc, id, null))} style={chip(!en)}>Already there</button>
          {entrances.map(p => <button key={p.key} type="button" onClick={() => commit(E.setEntrance(doc, id, { preset: p.key }))} style={chip(en?.preset === p.key)}>{p.label}</button>)}
        </div>
        {en ? (<>
          <div style={{ ...row, marginTop: 8 }}>
            <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 64 }}>Starts at</span>
            <input type="range" min={0} max={Math.max(0.1, scene.dur - 0.9)} step={0.05} value={Math.min(en.at, Math.max(0.1, scene.dur - 0.9))} onChange={e => commit(E.setEntrance(doc, id, { at: Number(e.target.value) }), 'at:' + id)} style={{ flex: 1, accentColor: UI.gold }} aria-label="When it arrives in the scene" />
            <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 34, textAlign: 'right' }}>{en.at.toFixed(1)} s</span>
          </div>
          <div style={{ ...row, marginTop: 6 }}>
            {([['Quick', 0.35], ['Normal', 0.6], ['Slow', 1.1]] as const).map(([name, d]) => <button key={name} type="button" onClick={() => commit(E.setEntrance(doc, id, { dur: d }))} style={chip(Math.abs(en.dur - d) < 0.13)}>{name}</button>)}
            {en.preset === 'wipe' || en.preset === 'draw' ? (['left', 'right', 'top', 'bottom', 'center'] as const).map(f => <button key={f} type="button" onClick={() => commit(E.setEntrance(doc, id, { from: f }))} style={chip((en.from || (layer.type === 'photo' ? 'bottom' : 'left')) === f)}>from {f === 'center' ? 'the middle' : f}</button>) : null}
          </div>
        </>) : null}
      </>) : null}

      {layer.type !== 'fill' ? (<>
        <div style={{ ...row, marginTop: 12 }}>
          <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 64 }}>See-through</span>
          <input type="range" min={0.1} max={1} step={0.05} value={layer.opacity ?? 1} onChange={e => patch(l => ({ ...l, opacity: Number(e.target.value) >= 1 ? undefined : Number(e.target.value) } as Layer), 'op:' + id)} style={{ flex: 1, accentColor: UI.gold }} aria-label="Opacity" />
          <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 34, textAlign: 'right' }}>{Math.round((layer.opacity ?? 1) * 100)}%</span>
        </div>
        <div style={{ ...row, marginTop: 10 }}>
          <button type="button" onClick={() => commit(E.reorderLayer(doc, id, 1))} style={chip()}>Bring forward</button>
          <button type="button" onClick={() => commit(E.reorderLayer(doc, id, -1))} style={chip()}>Send back</button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => { commit(E.deleteLayer(doc, id)); onDeselect() }} style={danger}>Delete</button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: UI.mut }}>Drag it on the picture to move it; drag the corner to resize. Arrow keys nudge.</p>
      </>) : null}
    </Sec>
  )
}

// ── the scene on screen ─────────────────────────────────────────────────────────────────────────────────────────
const TR_LABEL: Record<string, string> = { cut: 'Cut', dissolve: 'Dissolve', dip: 'Dip to colour', push: 'Push', slide: 'Slide over', wipe: 'Wipe' }
const ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' }
export function ScenePanel({ doc, scene, index, sel, commit, onSelect, onAddScene, onGo }: {
  doc: Composition; scene: Scene; index: number; sel: string | null; commit: Commit
  onSelect: (id: string | null) => void; onAddScene: (sceneId: string) => void; onGo: (sceneId: string, d: Composition) => void
}) {
  const tr = scene.transitionIn, sid = scene.id, last = index === doc.scenes.length - 1
  const fill = scene.layers.find(l => l.type === 'fill')
  const setDur = (d: number, key = '') => commit(E.setSceneDur(doc, sid, d), key)
  const setTr = (p: Partial<Transition>) => commit(E.setTransition(doc, sid, p))
  const moving = tr.type !== 'none' && tr.type !== 'cut'
  const kinds = new Set(doc.scenes.map(s => s.transitionIn.type).filter(t => t !== 'none' && t !== 'cut'))
  return (
    <Sec title={`Scene ${index + 1} of ${doc.scenes.length}`} right={<span style={{ fontSize: 11.5, color: UI.mut }}>{scene.dur.toFixed(1)} s</span>}>
      <input value={scene.name} onChange={e => commit(E.renameScene(doc, sid, e.target.value), 'name:' + sid)} aria-label="Name of the scene" style={{ ...area, marginTop: 8, resize: 'none', fontWeight: 700 }} />

      <span style={label}>Length</span>
      <div style={row}>
        <button type="button" onClick={() => setDur(scene.dur - 0.5)} disabled={scene.dur <= (last ? 3 : E.SCENE_MIN) + 0.01} style={chip(false, scene.dur <= (last ? 3 : E.SCENE_MIN) + 0.01)}>− ½ s</button>
        <input type="range" min={last ? 3 : E.SCENE_MIN} max={E.SCENE_MAX} step={0.1} value={scene.dur} onChange={e => setDur(Number(e.target.value), 'dur:' + sid)} style={{ flex: 1, minWidth: 80, accentColor: UI.gold }} aria-label="Length of the scene" />
        <button type="button" onClick={() => setDur(scene.dur + 0.5)} disabled={scene.dur >= E.SCENE_MAX} style={chip(false, scene.dur >= E.SCENE_MAX)}>+ ½ s</button>
      </div>

      <span style={label}>How this scene comes in</span>
      {index === 0 ? <p style={{ margin: 0, fontSize: 12, color: UI.mut }}>The first scene opens the piece, so it has no transition.</p> : (<>
        <div style={row}>
          {TRANSITIONS.filter(t => t !== 'none').map(t => <button key={t} type="button" onClick={() => setTr({ type: t })} style={chip(tr.type === t)}>{TR_LABEL[t]}</button>)}
        </div>
        {moving ? (
          <div style={{ ...row, marginTop: 6 }}>
            {tr.type === 'push' || tr.type === 'slide' || tr.type === 'wipe' ? (['up', 'down', 'left', 'right'] as const).map(d => <button key={d} type="button" aria-label={'Direction ' + d} onClick={() => setTr({ dir: d })} style={{ ...chip((tr.dir || 'up') === d), minWidth: 34 }}>{ARROW[d]}</button>) : null}
            {([['Quick', 0.3], ['Normal', 0.5], ['Slow', 0.9]] as const).map(([name, d]) => <button key={name} type="button" onClick={() => setTr({ dur: d })} style={chip(Math.abs((tr.dur || 0.5) - d) < 0.11)}>{name}</button>)}
          </div>
        ) : null}
        <div style={{ ...row, marginTop: 8 }}>
          <button type="button" onClick={() => commit(E.setAllTransitions(doc, tr))} style={chip()}>Use this for every scene</button>
          {kinds.size > 2 ? <span style={{ fontSize: 11.5, color: UI.red }}>{kinds.size} kinds in one piece — keep to 2.</span> : null}
        </div>
      </>)}

      {fill ? (<>
        <span style={label}>Background</span>
        <Swatches doc={doc} value={groundOf(doc, scene)} onPick={k => commit(E.setLayerColor(doc, fill.id, k))} />
      </>) : null}

      <span style={label}>In this scene</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {scene.layers.slice().reverse().filter(l => l.type !== 'fill').map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={() => onSelect(l.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: sel === l.id ? 'rgba(210,176,119,0.16)' : 'transparent', border: '1px solid ' + (sel === l.id ? UI.gold : 'transparent'), borderRadius: 7, color: sel === l.id ? UI.gold : UI.ink, padding: '5px 8px', fontSize: 12.5, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{E.layerName(doc, l)}</button>
            <button type="button" title="Delete" aria-label={'Delete ' + E.layerName(doc, l)} onClick={() => { commit(E.deleteLayer(doc, l.id)); if (sel === l.id) onSelect(null) }} style={{ background: 'none', border: 0, color: UI.mut, cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}>✕</button>
          </div>
        ))}
      </div>

      <span style={label}>This scene</span>
      <div style={row}>
        <button type="button" disabled={index === 0} onClick={() => { const d = E.moveScene(doc, sid, -1); commit(d); onGo(sid, d) }} style={chip(false, index === 0)}>← Earlier</button>
        <button type="button" disabled={last} onClick={() => { const d = E.moveScene(doc, sid, 1); commit(d); onGo(sid, d) }} style={chip(false, last)}>Later →</button>
        <button type="button" onClick={() => onAddScene(sid)} style={chip()}>+ Scene after this</button>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={doc.scenes.length < 2} onClick={() => { const next = doc.scenes[index + 1] || doc.scenes[index - 1]; const d = E.deleteScene(doc, sid); commit(d); onSelect(null); if (next) onGo(next.id, d) }} style={{ ...danger, opacity: doc.scenes.length < 2 ? 0.45 : 1 }}>Delete scene</button>
      </div>
    </Sec>
  )
}

// ── the whole piece ─────────────────────────────────────────────────────────────────────────────────────────────
export function StylePanel({ doc, original, commit }: { doc: Composition; original: Record<string, string>; commit: Commit }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [hearing, setHearing] = useState('')
  const stop = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (stop.current) clearTimeout(stop.current) }, [])
  const hear = (m: typeof MUSIC[number]) => {
    const a = audio.current; if (!a) return
    if (stop.current) clearTimeout(stop.current)
    if (hearing === m.key) { a.pause(); setHearing(''); return }
    a.src = m.file; a.currentTime = 0; a.volume = 0.7; a.play().then(() => setHearing(m.key)).catch(() => setHearing(''))
    stop.current = setTimeout(() => { a.pause(); setHearing('') }, 12000)
  }
  const track = doc.assets.audio.music.track, gain = doc.assets.audio.music.gain
  // the songs by kind, as buttons (Jon, 2026-11-20: "Can we do some better music"): the new set opens first
  const KINDS: { key: string; label: string; test: (m: typeof MUSIC[number]) => boolean }[] = [
    { key: 'new', label: 'New', test: m => !!m.fresh },
    { key: 'chill', label: 'Chill', test: m => /lo-fi|chill|island|easy|dream|ambient|calm|piano|thoughtful|soft|gentle/i.test(m.mood) },
    { key: 'upbeat', label: 'Upbeat', test: m => /upbeat|funk|disco|pop|party|electronic|happy|bright|tropical|groove|latin|epic|quick|ukulele/i.test(m.mood) },
    { key: 'lounge', label: 'Lounge & jazz', test: m => /lounge|jazz|bossa|sax|sleek/i.test(m.mood) },
    { key: 'festive', label: 'Festive', test: m => /christmas|holiday|halloween/i.test(m.mood) },
    { key: 'all', label: 'All', test: () => true },
  ]
  const [kind, setKind] = useState('new')
  const songs = MUSIC.filter(m => m.file && (KINDS.find(k => k.key === kind) || KINDS[0]).test(m))
  const start = doc.assets.audio.music.start || 0
  const same = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).every(k => a[k] === b[k])
  const face = doc.tokens.type.display.family
  const total = doc.canvas.duration
  return (<>
    <Sec title="Colour theme" right={<button type="button" onClick={() => commit(E.flipLightDark(doc))} title="Light grounds become dark, dark type becomes light" style={chip()}>Swap light and dark</button>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6, marginTop: 10 }}>
        <button type="button" onClick={() => commit({ ...doc, tokens: { ...doc.tokens, color: { ...original } } })} style={{ ...chip(same(original, doc.tokens.color)), padding: 0, overflow: 'hidden', textAlign: 'left' }}>
          <span style={{ display: 'flex', height: 18 }}>{Object.values(original).slice(0, 6).map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}</span>
          <span style={{ display: 'block', padding: '5px 8px' }}>As designed</span>
        </button>
        {E.THEMES.map(th => (
          <button key={th.key} type="button" onClick={() => commit(E.applyTheme(doc, th))} style={{ ...chip(same(E.applyTheme(doc, th).tokens.color, doc.tokens.color)), padding: 0, overflow: 'hidden', textAlign: 'left' }}>
            <span style={{ display: 'flex', height: 18 }}>{[th.dark, ...th.accents, th.light].map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}</span>
            <span style={{ display: 'block', padding: '5px 8px' }}>{th.label}</span>
          </button>
        ))}
      </div>
      <span style={label}>Fine-tune a colour</span>
      <div style={row}>
        {Object.entries(doc.tokens.color).map(([k, hex]) => (
          <label key={k} style={{ display: 'inline-flex', cursor: 'pointer' }}>
            <input type="color" value={hex} onChange={e => commit(E.setColor(doc, k, e.target.value), 'col:' + k)} aria-label={'Colour ' + k} style={{ width: 30, height: 30, padding: 0, border: '1px solid rgba(255,255,255,0.35)', borderRadius: 8, background: 'none', cursor: 'pointer' }} />
          </label>
        ))}
      </div>
    </Sec>

    <Sec title="Headline type">
      <div style={{ ...row, marginTop: 10 }}>
        {E.HEADLINE_FACES.map(f => <button key={f.key} type="button" onClick={() => commit(E.setHeadlineFace(doc, f.family, f.weight))} style={{ ...chip(face === f.family), fontFamily: `'${f.family}', sans-serif`, fontSize: 14 }}>{f.label}</button>)}
      </div>
    </Sec>

    <Sec title="Song" right={<span style={{ fontSize: 11.5, color: UI.mut }}>▶ to listen first</span>}>
      <div style={{ ...row, marginTop: 8 }}>
        {KINDS.map(k => <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)} style={chip(kind === k.key)}>{k.label}</button>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8, maxHeight: 340, overflowY: 'auto' }}>
        <button type="button" onClick={() => commit(E.setMusic(doc, '', ''))} style={{ ...chip(!track), textAlign: 'left' }}>No music</button>
        {songs.map(m => (
          <div key={m.key} style={{ display: 'flex', gap: 5 }}>
            <button type="button" aria-label={(hearing === m.key ? 'Stop ' : 'Listen to ') + m.label} onClick={() => hear(m)} style={{ ...chip(hearing === m.key), minWidth: 34 }}>{hearing === m.key ? '❚❚' : '▶'}</button>
            <button type="button" onClick={() => commit(E.setMusic(doc, m.key, m.credit))} style={{ ...chip(track === m.key), flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}<span style={{ color: UI.mut, fontWeight: 500 }}> · {m.mood}</span></button>
          </div>
        ))}
      </div>
      {track ? (
        <div style={{ ...row, marginTop: 10 }}>
          <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 52 }}>Volume</span>
          <input type="range" min={0.05} max={1} step={0.05} value={gain} onChange={e => commit(E.setMusic(doc, track, doc.assets.audio.music.credit, Number(e.target.value)), 'gain')} style={{ flex: 1, accentColor: UI.gold }} aria-label="Music volume" />
          <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 34, textAlign: 'right' }}>{Math.round(gain * 100)}%</span>
        </div>
      ) : null}
      {track ? (<>
        <span style={label}>Start the song at</span>
        <div style={row}>
          <input type="range" min={0} max={80} step={1} value={start} onChange={e => commit(E.setMusicStart(doc, Number(e.target.value)), 'mstart')} style={{ flex: 1, accentColor: UI.gold }} aria-label="Where in the song the video starts" />
          <span style={{ fontSize: 11.5, color: UI.mut, minWidth: 64, textAlign: 'right' }}>{start ? start + ' s in' : 'its start'}</span>
        </div>
        <span style={label}>Fade out at the end</span>
        <div style={row}>
          {([['No fade', 0], ['1 s', 1], ['2 s', 2], ['3 s', 3], ['5 s', 5]] as const).map(([name, n]) => <button key={name} type="button" onClick={() => commit(E.setMusicFade(doc, n))} style={chip(Math.abs(doc.assets.audio.music.fadeOut - n) < 0.26)}>{name}</button>)}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: UI.mut }}>Play the last scene to hear it. The file fades the same way.</p>
      </>) : null}
      <audio ref={audio} preload="none" onEnded={() => setHearing('')} />
    </Sec>

    <Sec title="Length of the video" right={<span style={{ fontSize: 11.5, color: UI.mut }}>{total.toFixed(1)} s now</span>}>
      <div style={{ ...row, marginTop: 10 }}>
        {[8, 10, 15, 20, 30].map(n => <button key={n} type="button" disabled={n < doc.scenes.length * E.SCENE_MIN + 1.8} onClick={() => commit(E.setTotal(doc, n))} style={chip(Math.abs(total - n) < 0.26, n < doc.scenes.length * E.SCENE_MIN + 1.8)}>{n} s</button>)}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.mut }}>Every scene keeps its share. To change one scene, use its Length under Edit.</p>
    </Sec>
  </>)
}

// ── photographs to swap in or add ───────────────────────────────────────────────────────────────────────────────
export function PhotoPicker({ doc, title, pool, busy, err, q, onQ, onPick, onCancel, exceptLayer }: {
  doc: Composition; title: string; pool: Pool | null; busy: boolean; err: string; q: string
  onQ: (q: string) => void; onPick: (key: string, asset: PhotoAsset) => void; onCancel: () => void; exceptLayer?: string
}) {
  const subjects = pool?.subjects || []
  // swapping: a photograph is never stretched past its real pixels, so the ones large enough for this window come
  // first and the rest say that the window will be made smaller to suit them
  const win = exceptLayer ? E.findLayer(doc, exceptLayer)?.layer : null
  const fits = (a: PhotoAsset) => !win || win.type !== 'photo' || maxUpscale({ ...win, camera: undefined }, a.w, a.h) <= 1.005
  const list = pool ? Object.entries(pool.photos).map(([k, a], i) => ({ k, a, i, fit: fits(a) })).sort((x, y) => (x.fit === y.fit ? x.i - y.i : x.fit ? -1 : 1)) : []
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return (
    <Sec accent title={title} right={<button type="button" onClick={onCancel} style={chip()}>Cancel</button>}>
      <p style={{ margin: '6px 0 8px', fontSize: 11.5, color: UI.mut }}>Our own units in {doc.brief.areaLabel || 'this area'}. A photograph is used once in a piece.</p>
      <div style={row}>
        <button type="button" onClick={() => onQ('')} style={chip(!q)}>Best picks</button>
        {subjects.map(s => <button key={s} type="button" onClick={() => onQ(s)} style={chip(q === s)}>{cap(s)}</button>)}
      </div>
      {busy ? <p style={{ margin: '12px 0 4px', fontSize: 12.5, color: UI.mut }}>Looking through the photographs…</p> : null}
      {err ? <p style={{ margin: '12px 0 4px', fontSize: 12.5, color: UI.red }}>{err}</p> : null}
      {!busy && pool && !Object.keys(pool.photos).length ? <p style={{ margin: '12px 0 4px', fontSize: 12.5, color: UI.mut }}>No good photographs of that here. Try another subject.</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 10 }}>
        {!busy && pool ? list.map(({ k, a, fit }) => {
          const used = E.photoInUse(doc, a.src, exceptLayer)
          return (
            <button key={k} type="button" disabled={!!used} onClick={() => onPick(k, a)} title={[a.building, a.unit, a.shows].filter(Boolean).join(' · ')}
              style={{ position: 'relative', padding: 0, border: '1px solid ' + UI.line, borderRadius: 8, overflow: 'hidden', background: UI.panel2, cursor: used ? 'default' : 'pointer', opacity: used ? 0.4 : 1, aspectRatio: '4 / 5' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxied(pool.thumbs[k] || a.src)} alt={a.shows || 'Photograph'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 6px 4px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', color: '#fff', fontSize: 10.5, fontWeight: 700, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{used ? 'In “' + used + '”' : a.building + (fit ? '' : ' · smaller window')}</span>
            </button>
          )
        }) : null}
      </div>
    </Sec>
  )
}

// ── add something to the scene on screen ────────────────────────────────────────────────────────────────────────
// Jon, 2026-11-20: "Should be add shape or image or png tree or lights etc option when you click." One row under the
// picture, always there. Click a spot in the picture first and the new thing lands on it; otherwise it lands in the
// middle. Shape and Decoration open a second row of choices (buttons, not a menu).
export function AddBar({ doc, scene, at, commit, onSelect, onAddPhoto, onImage, onObject, busy, err }: {
  doc: Composition; scene: Scene; at?: E.Pt; commit: Commit
  onSelect: (id: string | null) => void; onAddPhoto: (sceneId: string) => void; onImage: (file: File) => void; onObject: (what: string) => void; busy: boolean; err: string
}) {
  const [open, setOpen] = useState<'' | 'shape' | 'decor' | '3d'>('')
  const [what, setWhat] = useState('')
  // 3D objects that suit the piece (Jon, 2026-11-20: "add some 3d generation to the mix to fit the look")
  const ideas = ({ christmas: ['Christmas ornament', 'wrapped gift box', 'Christmas tree', 'candy cane', 'gold star'], thanksgiving: ['pumpkin', 'autumn leaf', 'pie', 'candle'], nye: ['champagne glass', 'disco ball', 'firework rocket', 'party balloon', 'clock at midnight'], basel: ['abstract sculpture', 'paint brush', 'picture frame', 'spiral ribbon'], team: ['trophy', 'party popper', 'megaphone', 'heart', 'balloon', 'thumbs up sign'], ownerstory: ['house key', 'small modern house', 'rising arrow', 'calendar'], stays: ['palm tree', 'sun', 'suitcase', 'beach umbrella', 'sunglasses', 'cocktail glass'] } as Record<string, string[]>)[doc.brief.moment] || ['palm tree', 'sun', 'gift box', 'star', 'heart']
  const file = useRef<HTMLInputElement>(null)
  const sid = scene.id
  const hasPhoto = scene.layers.some(l => l.type === 'photo' && !E.isAdded(doc, l))
  const hasButton = scene.layers.some(l => l.type === 'button')
  const done = (r: { doc: Composition; layerId: string }) => { if (!r.layerId) return; commit(r.doc); onSelect(r.layerId); setOpen('') }
  return (
    <div style={{ margin: '10px auto 0', maxWidth: 820, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '9px 11px' }}>
      <div style={row}>
        <span style={{ fontSize: 12.5, fontWeight: 800, marginRight: 4 }}>Add</span>
        <button type="button" onClick={() => done(E.addText(doc, sid, 'headline'))} style={chip()}>Headline</button>
        <button type="button" onClick={() => done(E.addText(doc, sid, 'label'))} style={chip()}>Small label</button>
        <button type="button" aria-pressed={open === 'shape'} onClick={() => setOpen(open === 'shape' ? '' : 'shape')} style={chip(open === 'shape')}>Shape</button>
        <button type="button" aria-pressed={open === 'decor'} onClick={() => setOpen(open === 'decor' ? '' : 'decor')} style={chip(open === 'decor')}>Decoration</button>
        <button type="button" aria-pressed={open === '3d'} onClick={() => setOpen(open === '3d' ? '' : '3d')} title="A rendered 3D object on a clear background, made for this piece in its colours. Uses AI: a few cents each." style={chip(open === '3d')}>✦ 3D object</button>
        <button type="button" disabled={busy} onClick={() => file.current?.click()} title="A PNG, JPEG or WebP from your computer: a sticker, a badge, your own picture" style={chip(false, busy)}>{busy ? 'Adding…' : 'Image or PNG'}</button>
        {!hasPhoto ? <button type="button" onClick={() => onAddPhoto(sid)} style={chip()}>Photo of a unit</button> : null}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImage(f) }} />
      </div>
      {open === 'shape' ? <div style={{ ...row, marginTop: 8 }}>{E.SHAPE_KINDS.map(k => <button key={k.key} type="button" onClick={() => done(E.addShape(doc, sid, k.key, at))} style={chip()}>{k.label}</button>)}</div> : null}
      {open === 'decor' ? <div style={{ ...row, marginTop: 8 }}>{E.DECORATIONS.filter(d => !d.needsButton || hasButton).map(d => <button key={d.key} type="button" onClick={() => done(E.addDecoration(doc, sid, d.key, at))} style={chip()}>{d.label}</button>)}</div> : null}
      {open === '3d' ? (
        <div style={{ marginTop: 8 }}>
          <div style={row}>{ideas.map(x => <button key={x} type="button" disabled={busy} onClick={() => onObject(x)} style={chip(false, busy)}>{x.charAt(0).toUpperCase() + x.slice(1)}</button>)}</div>
          <div style={{ ...row, marginTop: 6 }}>
            <input value={what} onChange={e => setWhat(e.target.value)} maxLength={120} placeholder="or type any object: a surfboard, a coffee cup, a golden key" onKeyDown={e => { if (e.key === 'Enter' && what.trim().length >= 3 && !busy) onObject(what.trim()) }}
              style={{ flex: 1, minWidth: 180, background: UI.bg, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '7px 9px', fontSize: 13 }} />
            <button type="button" disabled={busy || what.trim().length < 3} onClick={() => onObject(what.trim())} style={{ ...chip(false, busy || what.trim().length < 3), background: UI.gold, color: '#0B0F16', border: 0 }}>{busy ? 'Making it…' : 'Make it'}</button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: UI.mut }}>Rendered in 3D on a clear background, in this piece’s colours. It takes about half a minute and costs a few cents of the AI budget.</p>
        </div>
      ) : null}
      {err ? <p style={{ margin: '8px 0 0', fontSize: 12, color: UI.red }}>{err}</p> : null}
      <p style={{ margin: '7px 0 0', fontSize: 11, color: UI.mut }}>{at ? 'It lands where you last clicked in the picture.' : 'Click a spot in the picture first and it lands there.'} New things go under the words, so they never cover them.</p>
    </div>
  )
}
