'use client'
// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// A PIECE, OPEN. The canvas is drawn by the same player that exports it, so the preview is the file. Jon: "everything
// editable afterwards" — click any line of words on the picture (or use the Words list beside it) and type: the piece
// re-renders as you go and the measured audit runs again (does it still fit, is it still readable, is anything outside
// the safe area). Export is frame by frame to MP4 (with or without the music) and PNG for a still; the studio says
// which way the file was made. No drop-down menus. The layer editor, the voice and the reflows are later phases —
// their seams are the document itself.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MUSIC } from '@/lib/ad-engine'
import { type Composition, type TextLayer, type ButtonLayer, type Layer, runsToPlain, plainToRuns, cleanText } from '@/lib/adx/composition'
import { renderFrame, restTime, sceneAt, hitText, canvasMeasure, type Assets, type Ctx } from '@/lib/adx/player'
import { auditComposition, canvasSampler, type AuditResult } from '@/lib/adx/audit'
import { loadAssets } from '@/lib/adx/assets'
import { exportVideo, exportPng, type ExportResult } from '@/lib/adx/export'
import { UI } from './BriefWizard'

const btn = (primary = false, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: '8px 13px', borderRadius: 9, border: primary ? 0 : '1px solid ' + UI.line, background: primary ? UI.gold : UI.panel2, color: primary ? '#0B0F16' : UI.ink, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' })
const mmss = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
const fileBase = (d: Composition) => (d.title || 'Stay piece').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'Stay piece'
function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}

export default function AdxPlayer({ doc, onChange, canEdit, display }: { doc: Composition; onChange: (d: Composition) => void; canEdit: boolean; display: string }) {
  const W = doc.canvas.w, H = doc.canvas.h, dur = doc.canvas.duration
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const assets = useRef<Assets | null>(null)
  const docRef = useRef(doc); docRef.current = doc
  const tRef = useRef(0)
  /** Each text layer as it was when the piece opened: the accent's look is taken from here, so retyping never loses it. */
  const orig = useRef<Record<string, TextLayer>>({})
  const [ready, setReady] = useState(false)
  const [missing, setMissing] = useState(0)
  const [t, setT] = useState(() => restTime(doc.scenes[0]))
  const [playing, setPlaying] = useState(false)
  const [guides, setGuides] = useState(false)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [edit, setEdit] = useState<null | { id: string; x: number; y: number; w: number }>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [exp, setExp] = useState<null | { pct: number; stage: string }>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  tRef.current = t

  const music = MUSIC.find(m => m.key === doc.assets.audio.music.track && m.file)
  // which photographs are drawn, and where: when that changes the pictures are fetched again
  const photoKey = useMemo(() => doc.id + '|' + doc.scenes.map(s => s.layers.map(l => (l.type === 'photo' ? [l.id, l.photo, l.box.w, l.box.h, l.focal ? 1 : 0].join(':') : '')).join(',')).join(';'), [doc])

  useEffect(() => {
    for (const s of doc.scenes) for (const l of s.layers) if (l.type === 'text' && !orig.current[l.id]) orig.current[l.id] = l
  }, [doc])

  useEffect(() => {
    let live = true
    setReady(false)
    loadAssets(docRef.current).then(r => { if (!live) return; assets.current = r.assets; setMissing(r.missing.length); setReady(true) })
    return () => { live = false }
  }, [photoKey])

  // draw the frame on screen
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !assets.current) return
    const g = cv.getContext('2d'); if (g) renderFrame(g as Ctx, doc, t, assets.current)
  }, [doc, t, ready])

  // the measured audit, a moment after every change
  useEffect(() => {
    if (!ready || !assets.current) return
    const h = setTimeout(() => {
      try {
        const c = document.createElement('canvas'); c.width = W; c.height = H
        const g = c.getContext('2d', { willReadFrequently: true }) as Ctx
        setAudit(auditComposition(docRef.current, canvasMeasure(g), { sample: canvasSampler(docRef.current, assets.current!, g) }))
      } catch { /* keep the last result */ }
    }, 350)
    return () => clearTimeout(h)
  }, [doc, ready, W, H])

  // play
  useEffect(() => {
    if (!playing) { audioRef.current?.pause(); return }
    const start = performance.now() - tRef.current * 1000
    const a = audioRef.current
    if (a && music) { try { a.currentTime = Math.min(tRef.current, Math.max(0, (a.duration || 100) - 0.2)); a.volume = Math.max(0, Math.min(1, docRef.current.assets.audio.music.gain)); a.play().catch(() => {}) } catch { /* no sound in the preview is fine */ } }
    let raf = 0
    const tick = () => {
      const x = (performance.now() - start) / 1000
      if (x >= dur) { setT(dur - 0.02); setPlaying(false); return }
      setT(x); raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, dur, music])

  const seek = (x: number) => { setPlaying(false); setT(Math.max(0, Math.min(dur - 0.02, x))) }
  const togglePlay = () => { if (!playing && t >= dur - 0.1) setT(0); setPlaying(p => !p); setEdit(null) }

  // ── editing the words ──
  const patchLayer = useCallback((id: string, fn: (l: Layer) => Layer) => {
    const d = docRef.current
    onChange({ ...d, scenes: d.scenes.map(s => (s.layers.some(l => l.id === id) ? { ...s, layers: s.layers.map(l => (l.id === id ? fn(l) : l)) } : s)), meta: { ...d.meta, origin: d.meta.origin === 'house' ? 'house' : 'edited' } })
  }, [onChange])
  const setWords = (l: TextLayer | ButtonLayer, text: string) => {
    setDrafts(x => ({ ...x, [l.id]: text }))
    if (l.type === 'button') patchLayer(l.id, x => ({ ...(x as ButtonLayer), label: cleanText(text, 60) || (x as ButtonLayer).label }))
    else patchLayer(l.id, x => ({ ...(x as TextLayer), runs: plainToRuns(text, orig.current[l.id] || (x as TextLayer)) }))
  }
  const wordsOf = (l: TextLayer | ButtonLayer) => (drafts[l.id] != null ? drafts[l.id] : l.type === 'button' ? l.label : runsToPlain(l))
  const findLayer = (id: string) => { for (const s of doc.scenes) for (const l of s.layers) if (l.id === id && (l.type === 'text' || l.type === 'button')) return l as TextLayer | ButtonLayer; return null }

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!canEdit) return
    const cv = canvasRef.current; if (!cv) return
    const r = cv.getBoundingClientRect(), k = W / r.width
    const g = cv.getContext('2d') as Ctx
    const hit = hitText(doc, t, (e.clientX - r.left) * k, (e.clientY - r.top) * k, canvasMeasure(g))
    if (!hit) { setEdit(null); return }
    setPlaying(false)
    const s = doc.scenes[hit.scene]
    if (t < restTime(s) - 0.01) setT(restTime(s))
    setEdit({ id: hit.layer.id, x: hit.rect.x0 / k, y: hit.rect.y1 / k + 8, w: Math.max(240, (hit.rect.x1 - hit.rect.x0) / k) })
  }
  const closeEdit = () => { if (edit) setDrafts(x => { const y = { ...x }; delete y[edit.id]; return y }); setEdit(null) }

  // ── export ──
  const run = async (withMusic: boolean) => {
    if (!assets.current || exp) return
    setErr(''); setResult(null); setPlaying(false); setExp({ pct: 0, stage: 'Starting' })
    try {
      const r = await exportVideo(doc, assets.current, { musicUrl: withMusic && music ? music.file : undefined, musicGain: doc.assets.audio.music.gain, onProgress: (a, b, stage) => setExp({ pct: Math.round((a / Math.max(1, b)) * 100), stage }) })
      download(r.blob, `${fileBase(doc)} (${W}x${H}).${r.ext}`)
      setResult(r)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setExp(null)
  }
  const still = async () => {
    if (!assets.current) return
    try { download(await exportPng(doc, assets.current, t), `${fileBase(doc)} (${W}x${H}) ${mmss(t).replace(':', 'm')}s.png`) } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const captionText = [doc.social.caption, doc.social.hashtags.join(' '), music ? doc.assets.audio.music.credit : ''].filter(Boolean).join('\n\n')
  const copyCaption = async () => { try { await navigator.clipboard.writeText(captionText); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* the text is selectable below */ } }

  const si = sceneAt(doc, t)
  const fails = audit ? audit.issues.filter(x => x.sev === 'fail') : []
  const warns = audit ? audit.issues.filter(x => x.sev === 'warn') : []
  const editLayer = edit ? findLayer(edit.id) : null
  const sf = doc.canvas.safe
  const tall = H > W
  const area: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: UI.bg, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '7px 9px', fontSize: 13, lineHeight: 1.35, resize: 'vertical', fontFamily: 'inherit' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) clamp(320px, 30vw, 430px)', gap: 18, alignItems: 'start', color: UI.ink }}>
      {/* ── the picture ── */}
      <div style={{ minWidth: 0 }}>
        <div ref={wrapRef} style={{ position: 'relative', margin: '0 auto', width: tall ? `min(100%, calc((100vh - 250px) * ${W / H}))` : '100%', maxWidth: tall ? 480 : 820 }}>
          <canvas ref={canvasRef} width={W} height={H} onClick={onCanvasClick} title={canEdit ? 'Click a line of words to change it' : undefined}
            style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 10, background: '#000', cursor: canEdit ? 'text' : 'default', boxShadow: '0 12px 40px rgba(0,0,0,.45)' }} />
          {guides ? <div style={{ position: 'absolute', left: `${(sf.left / W) * 100}%`, top: `${(sf.top / H) * 100}%`, right: `${(sf.right / W) * 100}%`, bottom: `${(sf.bottom / H) * 100}%`, border: '1.5px dashed rgba(255,255,255,0.85)', borderRadius: 4, pointerEvents: 'none', boxShadow: '0 0 0 2000px rgba(255,60,60,0.10)' }} /> : null}
          {!ready ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)', borderRadius: 10, fontSize: 13, color: UI.ink }}>Loading the photographs and type…</div> : null}
          {edit && editLayer ? (
            <div style={{ position: 'absolute', left: Math.max(0, Math.min(edit.x, (wrapRef.current?.clientWidth || 400) - 260)), top: edit.y, width: Math.min(Math.max(260, edit.w), 360), zIndex: 5, background: UI.panel, border: '1px solid ' + UI.gold, borderRadius: 10, padding: 9, boxShadow: '0 10px 30px rgba(0,0,0,.6)' }}>
              <textarea autoFocus rows={editLayer.type === 'button' ? 1 : 2} value={wordsOf(editLayer)} onChange={e => setWords(editLayer, e.target.value)} onKeyDown={e => { if (e.key === 'Escape') closeEdit() }} style={area} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: UI.mut, flex: 1 }}>{editLayer.type === 'button' ? 'The button’s words.' : 'A new line breaks the line. *Stars* mark the accent words.'}</span>
                <button type="button" onClick={closeEdit} style={btn(true)}>Done</button>
              </div>
            </div>
          ) : null}
        </div>
        {/* transport */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px auto 0', maxWidth: 820 }}>
          <button type="button" onClick={togglePlay} disabled={!ready} style={{ ...btn(true, !ready), minWidth: 74 }}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <input type="range" min={0} max={dur} step={1 / 30} value={t} onChange={e => seek(Number(e.target.value))} aria-label="Position in the piece" style={{ flex: 1, accentColor: UI.gold }} />
          <span style={{ fontSize: 12, color: UI.mut, fontVariantNumeric: 'tabular-nums', minWidth: 74, textAlign: 'right' }}>{mmss(t)} / {mmss(dur)}</span>
          <button type="button" onClick={() => setGuides(v => !v)} aria-pressed={guides} title="Shows the area the platform's own buttons leave clear" style={{ ...btn(), background: guides ? 'rgba(210,176,119,0.18)' : UI.panel2 }}>Safe area</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px auto 0', maxWidth: 820 }}>
          {doc.scenes.map((s, i) => <button key={s.id} type="button" onClick={() => seek(restTime(s))} style={{ ...btn(), fontWeight: 700, borderColor: i === si ? UI.gold : UI.line, color: i === si ? UI.gold : UI.ink }}>{i + 1} · {s.name}</button>)}
        </div>
        {music ? <audio ref={audioRef} src={music.file} preload="auto" /> : null}
      </div>

      {/* ── beside it: the check, the words, the files ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <section style={{ background: UI.panel, border: '1px solid ' + (fails.length ? 'rgba(224,108,108,0.5)' : UI.line), borderRadius: 12, padding: '11px 13px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>
            {!audit ? 'Checking the piece…' : fails.length ? <span style={{ color: UI.red }}>{fails.length} thing{fails.length === 1 ? '' : 's'} to fix before it goes out</span> : <span style={{ color: UI.green }}>✓ Passed the check</span>}
            {audit ? <span style={{ fontWeight: 500, color: UI.mut, marginLeft: 8, fontSize: 11.5 }}>{audit.measured.text} lines measured · {audit.measured.photos} photos · {audit.measured.scenes} scenes</span> : null}
          </p>
          {missing ? <p style={{ margin: '6px 0 0', fontSize: 12, color: UI.red }}>{missing} photograph{missing === 1 ? '' : 's'} could not be loaded.</p> : null}
          {fails.concat(warns).slice(0, 8).map((x, i) => (
            <button key={i} type="button" onClick={() => { const s = doc.scenes.find(y => y.id === x.scene); if (s) seek(restTime(s)) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: '7px 0 0', color: UI.ink, cursor: x.scene ? 'pointer' : 'default', fontSize: 12.5, lineHeight: 1.45 }}>
              <span style={{ color: x.sev === 'fail' ? UI.red : UI.gold, fontWeight: 800, marginRight: 6 }}>{x.sev === 'fail' ? 'Fix' : 'Note'}</span>{x.msg}
            </button>
          ))}
        </section>

        <section style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '11px 13px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 800 }}>Files</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" disabled={!ready || !!exp || !!fails.length} onClick={() => run(true)} style={btn(true, !ready || !!exp || !!fails.length)}>{music ? 'MP4 with music' : 'MP4'}</button>
            {music ? <button type="button" disabled={!ready || !!exp || !!fails.length} onClick={() => run(false)} style={btn(false, !ready || !!exp || !!fails.length)}>MP4 without sound</button> : null}
            <button type="button" disabled={!ready} onClick={still} title="The frame on screen, full size — for a photo post" style={btn(false, !ready)}>PNG of this frame</button>
          </div>
          {fails.length && ready && !exp ? <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.mut }}>Video export waits for the check to pass. <button type="button" onClick={() => run(!!music)} style={{ background: 'none', border: 0, padding: 0, color: UI.gold, cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline' }}>Export anyway</button></p> : null}
          {exp ? (
            <div style={{ marginTop: 9 }}>
              <div style={{ height: 6, borderRadius: 3, background: UI.panel2, overflow: 'hidden' }}><div style={{ width: exp.pct + '%', height: '100%', background: UI.gold, transition: 'width .2s' }} /></div>
              <p style={{ margin: '5px 0 0', fontSize: 11.5, color: UI.mut }}>{exp.stage} · {exp.pct}%</p>
            </div>
          ) : null}
          {result ? <p style={{ margin: '8px 0 0', fontSize: 12, color: result.path === 'webcodecs' ? UI.green : UI.gold, lineHeight: 1.45 }}>{result.path === 'webcodecs' ? '✓ ' : ''}{result.note} ({(result.blob.size / 1048576).toFixed(1)} MB in {(result.ms / 1000).toFixed(1)} s)</p> : null}
          {err ? <p style={{ margin: '8px 0 0', fontSize: 12, color: UI.red }}>{err}</p> : null}
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.mut }}>{W} × {H} · 30 frames a second · {doc.scenes.length} scenes · {dur.toFixed(1)} s{music ? ' · ' + music.label : ''}</p>
        </section>

        <section style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '11px 13px' }}>
          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 800 }}>Words</p>
          <p style={{ margin: '0 0 10px', fontSize: 11.5, color: UI.mut }}>Every line is editable, here or by clicking it on the picture. *Stars* mark the accent words.</p>
          {doc.scenes.map((s, i) => {
            const line = doc.script.lines.find(l => l.scene === s.id)
            return (
              <div key={s.id} style={{ borderTop: i ? '1px solid ' + UI.line : 0, padding: i ? '9px 0 2px' : '0 0 2px' }}>
                <button type="button" onClick={() => seek(restTime(s))} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: i === si ? UI.gold : UI.mut, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{i + 1} · {s.name}</button>
                {s.layers.filter((l): l is TextLayer | ButtonLayer => l.type === 'text' || l.type === 'button').map(l => (
                  <textarea key={l.id} rows={l.type === 'text' && l.fit ? 2 : 1} disabled={!canEdit} value={wordsOf(l)} onFocus={() => { if (si !== i) seek(restTime(s)) }} onChange={e => setWords(l, e.target.value)}
                    onBlur={() => setDrafts(x => { const y = { ...x }; delete y[l.id]; return y })} aria-label={(l.type === 'button' ? 'Button' : l.fit ? 'Headline' : 'Label') + ' in scene ' + (i + 1)}
                    style={{ ...area, marginTop: 6, fontWeight: l.type === 'text' && l.fit ? 700 : 500, fontFamily: l.type === 'text' && l.fit ? display : 'inherit', fontSize: l.type === 'text' && l.fit ? 14.5 : 12.5 }} />
                ))}
                {line ? (
                  <label style={{ display: 'block', marginTop: 6 }}>
                    <span style={{ fontSize: 10.5, color: UI.mut, fontWeight: 700 }}>Spoken line (for the voice, next phase)</span>
                    <textarea rows={1} disabled={!canEdit} value={line.vo} onChange={e => onChange({ ...doc, script: { ...doc.script, lines: doc.script.lines.map(x => (x.scene === s.id ? { ...x, vo: e.target.value.slice(0, 300) } : x)) } })} style={{ ...area, marginTop: 3, fontSize: 12.5, color: UI.mut }} />
                  </label>
                ) : null}
              </div>
            )
          })}
        </section>

        <section style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '11px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, flex: 1 }}>Caption</p>
            <button type="button" onClick={copyCaption} style={btn()}>{copied ? '✓ Copied' : 'Copy caption'}</button>
          </div>
          <textarea rows={4} disabled={!canEdit} value={doc.social.caption} onChange={e => onChange({ ...doc, social: { ...doc.social, caption: e.target.value.slice(0, 2200) } })} style={area} />
          {doc.social.captionAlternates.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7 }}>
              {doc.social.captionAlternates.map((c, i) => <button key={i} type="button" disabled={!canEdit} onClick={() => onChange({ ...doc, social: { ...doc.social, caption: c, captionAlternates: doc.social.captionAlternates.map((x, k) => (k === i ? doc.social.caption : x)) } })} title="Use this caption instead" style={{ textAlign: 'left', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.mut, padding: '6px 9px', fontSize: 12, lineHeight: 1.4, cursor: 'pointer' }}>↺ {c}</button>)}
            </div>
          ) : null}
          <p style={{ margin: '7px 0 0', fontSize: 11.5, color: UI.mut }}>{doc.social.hashtags.join(' ')}{music ? ' · the music credit is copied with it' : ''}</p>
        </section>
      </div>
    </div>
  )
}
