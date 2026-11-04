'use client'
// THE SCRIPT — the spine of a video ad (Jon, 2026-11-04: "make script view easy to see and editable. Allow the
// script to be the most important part of walking through the video ads"). Every scene as a script line: the
// spoken words large and editable, what is on screen under them, the time it sits at. The line playing is lit and
// followed; clicking a line plays from there. "Write it as one script" edits the whole voice-over as plain text.
import { useEffect, useMemo, useRef, useState } from 'react'
import { KINDS, type AdProject, type AdScene, type Timeline } from '@/lib/ad-engine'

const UI = { panel: '#121824', panel2: '#182131', line: 'rgba(255,255,255,0.09)', ink: '#F1F3F7', mut: '#8E9AAE', gold: '#D2B077', red: '#E06C6C', green: '#4CC488', blue: '#5B8DEF' }
const fmt = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s - m * 60); return m + ':' + String(r).padStart(2, '0') }
const words = (s: string) => String(s || '').trim().split(/\s+/).filter(Boolean).length
const plainHead = (s: string) => String(s || '').replace(/\*\*/g, '').replace(/\n/g, ' / ')

/** Auto-growing text area. */
function Grow({ value, onChange, disabled, placeholder, style }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = '0px'; el.style.height = el.scrollHeight + 'px' }, [value])
  return <textarea ref={ref} rows={1} value={value} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)}
    style={{ width: '100%', resize: 'none', overflow: 'hidden', background: 'transparent', border: '1px solid transparent', borderRadius: 7, color: UI.ink, outline: 'none', ...style }}
    onFocus={e => (e.currentTarget.style.borderColor = 'rgba(210,176,119,0.5)')} onBlur={e => (e.currentTarget.style.borderColor = 'transparent')} />
}

export default function AdScript({ p, tl, t, playing, sel, canEdit, voiced, stale, display, tall, onPick, onPlayFrom, setScene, move, del, addAfter, setScenes }: {
  p: AdProject; tl: Timeline; t: number; playing: boolean; sel: number; canEdit: boolean
  /** a voice take exists and matches the script */ voiced: boolean
  /** a voice take exists but the script changed since */ stale: boolean
  display: string
  /** beside the player: fill the height of the screen */ tall?: boolean
  onPick: (i: number) => void
  onPlayFrom: (i: number) => void
  setScene: (i: number, patch: Partial<AdScene>) => void
  move: (from: number, to: number) => void
  del: (i: number) => void
  addAfter: (i: number) => void
  setScenes: (scenes: AdScene[]) => void
}) {
  const [follow, setFollow] = useState(true)
  const [asText, setAsText] = useState(false)
  const [text, setText] = useState('')
  const [showScreen, setShowScreen] = useState(true)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const box = useRef<HTMLDivElement>(null)
  // the line playing now
  const cur = useMemo(() => { let k = 0; for (let i = 0; i < tl.starts.length; i++) if (tl.starts[i] <= t + 0.01) k = i; return k }, [tl, t])
  useEffect(() => {
    if (!follow || !playing) return
    const el = rows.current[cur], b = box.current
    if (el && b) { const top = el.offsetTop - b.offsetTop - 60; b.scrollTo({ top, behavior: 'smooth' }) }
  }, [cur, follow, playing])
  const total = p.scenes.reduce((a, x) => a + words(x.vo), 0)
  const lit = playing ? cur : sel

  const openText = () => { setText(p.scenes.map(x => x.vo.trim()).join('\n\n')); setAsText(true) }
  const applyText = () => {
    const paras = text.split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, ' ').trim())
    while (paras.length && !paras[paras.length - 1]) paras.pop()
    const next: AdScene[] = p.scenes.map((x, i) => ({ ...x, vo: paras[i] ?? '' }))
    for (let i = p.scenes.length; i < paras.length; i++) {
      const last = next[next.length - 1]
      next.push({ id: 'sx' + Date.now().toString(36) + i, kind: 'cinema', vo: paras[i], head: '', sub: '', items: [], photos: last && last.photos[0] ? [last.photos[0]] : [] })
    }
    setScenes(next); setAsText(false)
  }

  return (
    <div style={{ width: '100%', background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid ' + UI.line, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: display, fontWeight: 800, fontSize: 17 }}>Script</span>
        <span style={{ fontSize: 12, color: UI.mut }}>{p.scenes.length} scenes · {total} words · {fmt(tl.total)}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: voiced ? UI.green : stale ? UI.gold : UI.mut }}>{voiced ? '● Voice matches the script' : stale ? '● Script changed — re-record the voice' : '○ No voice yet — timing is estimated'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button type="button" onClick={() => setShowScreen(!showScreen)} style={chip(showScreen)} title="Show what is on screen under each line">On screen</button>
          <button type="button" onClick={() => setFollow(!follow)} style={chip(follow)} title="Scroll with the video as it plays">Follow</button>
          {canEdit ? <button type="button" onClick={() => (asText ? setAsText(false) : openText())} style={chip(asText)} title="Edit the whole voice-over as plain text — one paragraph per scene">{asText ? 'Back to scenes' : 'Write it as one script'}</button> : null}
          <button type="button" onClick={() => { try { navigator.clipboard.writeText(p.scenes.map((x, i) => `${i + 1}. [${fmt(tl.starts[i])}] ${x.vo || '(music)'}${x.head ? '\n   ON SCREEN: ' + plainHead(x.head) : ''}`).join('\n\n')) } catch { /* fine */ } }} style={chip(false)} title="Copy the script as text">Copy</button>
        </span>
      </div>

      {asText ? (
        <div style={{ padding: 14 }}>
          <p style={{ fontSize: 12, color: UI.mut, margin: '0 0 8px', lineHeight: 1.5 }}>One paragraph per scene, in order — a blank line starts the next scene. Extra paragraphs become new scenes at the end; a scene with no paragraph keeps its pictures and goes quiet. On-screen words and designs are not touched.</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(22, Math.max(8, text.split('\n').length + 2))}
            style={{ width: '100%', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 9, color: UI.ink, padding: '12px 14px', fontSize: 15.5, lineHeight: 1.65, fontFamily: 'Georgia, "Times New Roman", serif', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <button type="button" onClick={applyText} style={{ ...chip(true), background: UI.gold, color: '#0B0F16', padding: '7px 14px' }}>Apply to the video</button>
            <button type="button" onClick={() => setAsText(false)} style={chip(false)}>Cancel</button>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: UI.mut }}>{words(text)} words · about {Math.round(words(text) / 2.55 + p.scenes.length * 0.6)} s spoken</span>
          </div>
        </div>
      ) : (
        <div ref={box} style={{ overflowY: 'auto', maxHeight: tall ? 'calc(100vh - 210px)' : 520, padding: '6px 0' }}>
          {p.scenes.map((x, i) => {
            const on = i === lit
            const w = words(x.vo), d = tl.durs[i] || 0, rate = d ? w / d : 0
            const fast = !voiced && w > 0 && rate > 3.1
            const kind = KINDS.find(k => k.kind === x.kind)?.label || x.kind
            return (
              <div key={x.id || i} ref={el => { rows.current[i] = el }} onClick={() => onPick(i)}
                style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, padding: '10px 14px', borderLeft: '3px solid ' + (on ? UI.gold : 'transparent'), background: on ? 'rgba(210,176,119,0.07)' : 'transparent', cursor: 'pointer', transition: 'background .15s' }}>
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontFamily: display, fontWeight: 800, fontSize: 15, color: on ? UI.gold : UI.ink }}>{i + 1}</div>
                  <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: UI.mut }}>{fmt(tl.starts[i] || 0)}</div>
                  <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10.5, color: fast ? UI.red : UI.mut }}>{d.toFixed(1)} s</div>
                </div>
                <div style={{ minWidth: 0 }} onClick={e => e.stopPropagation()}>
                  <Grow value={x.vo} disabled={!canEdit} onChange={v => setScene(i, { vo: v })} placeholder={x.vo ? '' : '(no voice — music and pictures)'}
                    style={{ fontSize: 16, lineHeight: 1.55, fontFamily: 'Georgia, "Times New Roman", serif', padding: '4px 8px', color: x.vo ? UI.ink : UI.mut }} />
                  {showScreen ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', marginTop: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: UI.mut, textTransform: 'uppercase', flex: 'none' }}>On screen</span>
                      <span style={{ fontSize: 10.5, color: UI.gold, border: '1px solid rgba(210,176,119,0.35)', borderRadius: 5, padding: '0 5px', flex: 'none' }}>{kind}</span>
                      <input value={x.head} disabled={!canEdit} onChange={e => setScene(i, { head: e.target.value })} placeholder="headline on screen (**gold** a word)"
                        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, borderBottom: '1px dashed ' + UI.line, color: UI.ink, fontSize: 12.5, fontWeight: 700, padding: '3px 2px', outline: 'none' }} />
                    </div>
                  ) : null}
                  {fast ? <p style={{ fontSize: 11, color: UI.red, margin: '3px 8px 0' }}>{w} words in {d.toFixed(1)} s — too fast to land. Trim the line or hold the scene longer.</p> : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => onPlayFrom(i)} style={mini(true)} title="Play from this line">▶</button>
                  {canEdit ? (
                    <div style={{ display: 'flex', gap: 3, opacity: on ? 1 : 0.55 }}>
                      <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} style={mini(false)} title="Move up">↑</button>
                      <button type="button" disabled={i === p.scenes.length - 1} onClick={() => move(i, i + 1)} style={mini(false)} title="Move down">↓</button>
                      <button type="button" onClick={() => addAfter(i)} style={mini(false)} title="Add a scene after this one">＋</button>
                      <button type="button" disabled={p.scenes.length < 2} onClick={() => del(i)} style={{ ...mini(false), color: UI.red }} title="Delete this scene">✕</button>
                    </div>
                  ) : null}
                  {!voiced ? <span style={{ fontSize: 10, color: UI.mut }}>{w} w</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
function chip(on: boolean): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, padding: '5px 9px', borderRadius: 7, border: '1px solid ' + (on ? 'rgba(210,176,119,0.6)' : 'rgba(255,255,255,0.09)'), background: on ? 'rgba(210,176,119,0.14)' : 'transparent', color: on ? '#D2B077' : '#C9D1DE', cursor: 'pointer' }
}
function mini(primary: boolean): React.CSSProperties {
  return { width: 26, height: 24, borderRadius: 6, border: '1px solid rgba(255,255,255,0.09)', background: primary ? 'rgba(210,176,119,0.16)' : 'transparent', color: primary ? '#D2B077' : '#C9D1DE', fontSize: 12, cursor: 'pointer', padding: 0 }
}
