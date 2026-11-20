'use client'
// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// MAKING A PIECE WITH THE NEW ENGINE, step by step — and nothing is built until the brief is confirmed:
//   1 the guided brief (buttons)  →  2 three ideas, as low-fidelity previews  →  3 the script and copy, three options,
//   every line editable  →  4 the composition (the art director designs it for this event and these photographs; it is
//   validated, measured and audited before it is shown)  →  the piece, open in the player: edit any words, export.
// When Ad Studio's monthly AI budget is used up, or no AI key is set, the studio says so plainly and offers the house
// design for the event, which costs nothing and is just as editable.
import { useEffect, useRef, useState } from 'react'
import type { Brief, Composition, PhotoAsset } from '@/lib/adx/composition'
import { ADX_MONTHLY_CAP_USD } from '@/lib/adx/composition'
import { IDENTITIES, LOOKS } from '@/lib/adx/identities'
import { loadFonts } from '@/lib/adx/assets'
import BriefWizard, { UI } from './BriefWizard'
import AdxPlayer from './AdxPlayer'

type Concept = { name: string; idea: string; look: string; ground: string[]; hook: string; lead: string; beats: string[]; why: string }
type CopyOption = { voice: string; lines: { vo: string; head: string; photo: string }[]; caption: string; hashtags: string[] }
export type AdxStart = { moment?: string; openId?: string; house?: string }
type Budget = { usd: number; cap: number; left: number }
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json().catch(() => null) })).catch(() => ({ status: 0, j: null as any }))
const proxied = (u: string) => (!u ? '' : u.startsWith('/') || /supabase\.co\//.test(u) ? u : '/api/img-proxy?url=' + encodeURIComponent(u))
const big = (primary = true, disabled = false): React.CSSProperties => ({ fontSize: 13.5, fontWeight: 800, padding: '10px 17px', borderRadius: 10, border: primary ? 0 : '1px solid ' + UI.line, background: primary ? UI.gold : 'transparent', color: primary ? '#0B0F16' : UI.ink, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 })

/** A headline with its accent words (in *stars*) coloured, for the previews. */
function Hook({ text, color, accent, family, accentFamily, size }: { text: string; color: string; accent: string; family: string; accentFamily: string; size: number }) {
  return (
    <span style={{ display: 'block', fontFamily: family, fontWeight: 700, fontSize: size, lineHeight: 1.06, color, letterSpacing: '-0.01em' }}>
      {text.split('\n').map((line, i) => <span key={i} style={{ display: 'block' }}>{line.split('*').map((p, k) => (k % 2 ? <em key={k} style={{ fontFamily: accentFamily, fontStyle: 'italic', fontWeight: 500, color: accent }}>{p}</em> : <span key={k}>{p}</span>))}</span>)}
    </span>
  )
}

export default function AdxStudio({ start, canEdit, display, onClose }: { start: AdxStart; canEdit: boolean; display: string; onClose: (changed: boolean) => void }) {
  const [step, setStep] = useState<'brief' | 'concepts' | 'copy' | 'piece'>(start.openId || start.house ? 'piece' : 'brief')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [capped, setCapped] = useState(false)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [photos, setPhotos] = useState<Record<string, PhotoAsset>>({})
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [concepts, setConcepts] = useState<Concept[]>([])
  const [concept, setConcept] = useState<Concept | null>(null)
  const [options, setOptions] = useState<CopyOption[]>([])
  const [doc, setDoc] = useState<Composition | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [budget, setBudget] = useState<Budget | null>(null)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved' | ''>('')
  const spent = useRef(0)
  const changed = useRef(false)
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const docRef = useRef<Composition | null>(null); docRef.current = doc

  useEffect(() => { loadFonts().catch(() => {}) }, [])
  useEffect(() => {
    fetch('/api/adx/pieces').then(r => r.json()).then(j => { if (j?.budget) setBudget(j.budget) }).catch(() => {})
  }, [])

  const openHouse = async (moment: string) => {
    setBusy('house'); setErr('')
    const j = await fetch('/api/adx/pieces?house=' + encodeURIComponent(moment)).then(r => r.json()).catch(() => null)
    setBusy('')
    if (!j?.ok || !j.doc) { setErr(j?.error || 'The house design did not open. Try again.'); return }
    setDoc(j.doc); setNotes([]); setStep('piece'); setSaved('unsaved')
  }
  useEffect(() => {
    if (start.house) openHouse(start.house)
    else if (start.openId) {
      setBusy('open')
      fetch('/api/adx/pieces?id=' + encodeURIComponent(start.openId)).then(r => r.json()).then(j => { setBusy(''); if (j?.ok && j.doc) { setDoc(j.doc); setSaved('saved') } else { setErr(j?.error || 'That piece did not open.'); setStep('brief') } }).catch(() => { setBusy(''); setErr('That piece did not open.'); setStep('brief') })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 1 → 2: the brief is confirmed; look through the photographs and come back with three ideas ──
  const confirmBrief = async (b: Brief) => {
    setBusy('concepts'); setErr(''); setCapped(false); setBrief(b)
    const { status, j } = await post('/api/adx/concepts', { brief: b })
    setBusy('')
    if (j?.budget) setBudget(j.budget)
    if (!j?.ok) { setCapped(!!j?.capped || status === 503); setErr(j?.error || 'The ideas did not come back. Try again.'); if (j?.brief) setBrief(j.brief); return }
    spent.current = Number(j.usd) || 0
    setBrief(j.brief); setPhotos(j.photos || {}); setThumbs(j.thumbs || {}); setConcepts(j.concepts || []); setStep('concepts')
  }
  // ── 2 → 3: an idea is chosen; write three ways to say it ──
  const pickConcept = async (c: Concept) => {
    if (!brief) return
    setBusy('copy'); setErr(''); setConcept(c)
    const { j } = await post('/api/adx/copy', { brief, concept: c, photos })
    setBusy('')
    if (!j?.ok) { setCapped(!!j?.capped); setErr(j?.error || 'The script did not come back. Try again.'); return }
    spent.current += Number(j.usd) || 0
    setOptions(j.options || []); setStep('copy')
  }
  // ── 3 → 4: the words are chosen; design the piece ──
  const compose = async (o: CopyOption) => {
    if (!brief || !concept) return
    setBusy('compose'); setErr('')
    const { j } = await post('/api/adx/compose', { brief, concept, option: o, photos, spentUsd: spent.current })
    setBusy('')
    if (j?.budget) setBudget(j.budget)
    if (!j?.ok || !j.doc) { setCapped(!!j?.capped); setErr(j?.error || 'The design did not come back. Try again.'); return }
    changed.current = true
    setDoc(j.doc); setNotes(j.notes || []); setSaved('saved'); setStep('piece')
  }

  // ── the open piece: every change is saved a moment later ──
  const change = (d: Composition) => {
    setDoc(d); setSaved('unsaved'); dirty.current = true
    if (!canEdit) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1200)
  }
  const save = async () => {
    const d = docRef.current; if (!d || !canEdit) return
    setSaved('saving')
    const { j } = await post('/api/adx/pieces', { doc: d })
    if (j?.ok) { changed.current = true; if (docRef.current === d) { dirty.current = false; setSaved('saved') } else setSaved('unsaved') } else { setSaved('unsaved'); setErr(j?.error || 'Could not save. Check the connection.') }
  }
  const remove = async () => {
    if (!doc || !window.confirm('Delete “' + doc.title + '”? This cannot be undone.')) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await fetch('/api/adx/pieces?id=' + encodeURIComponent(doc.id), { method: 'DELETE' }).catch(() => {})
    onClose(true)
  }
  const close = async () => { if (saveTimer.current) clearTimeout(saveTimer.current); if (dirty.current && docRef.current && canEdit) await save(); onClose(changed.current) }

  const id = brief ? IDENTITIES[brief.moment] : doc ? IDENTITIES[doc.brief.moment] : null
  const pal = id ? id.palette : {}
  const colours = Object.values(pal)
  const grotesk = !!id && /Bricolage/.test(id.type)
  const headFamily = grotesk ? "'Bricolage Grotesque', sans-serif" : "'Fraunces', Georgia, serif"
  const lightest = colours.slice().sort((a, b) => lumOf(b) - lumOf(a))[0] || '#FFFFFF', darkest = colours.slice().sort((a, b) => lumOf(a) - lumOf(b))[0] || '#000000'

  const Bar = ({ title, sub }: { title: string; sub?: string }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 14px', flexWrap: 'wrap' }}>
      <p style={{ fontFamily: display, fontWeight: 800, fontSize: 24, margin: 0, color: UI.ink }}>{title}</p>
      {sub ? <span style={{ fontSize: 13, color: UI.mut }}>{sub}</span> : null}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        {budget ? <span title="Ad Studio's own monthly AI budget" style={{ fontSize: 11.5, color: budget.left <= 0 ? UI.red : UI.mut }}>AI this month: ${budget.usd.toFixed(2)} of ${budget.cap || ADX_MONTHLY_CAP_USD}</span> : null}
        <button type="button" onClick={close} style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 11px', borderRadius: 8, border: '1px solid ' + UI.line, background: 'transparent', color: UI.mut, cursor: 'pointer' }}>✕ Close</button>
      </span>
    </div>
  )
  const Trouble = () => err ? (
    <div role="alert" style={{ background: capped ? '#3a3016' : '#3a1d1b', color: capped ? '#F0DFB4' : '#F3C2BC', borderRadius: 10, padding: '11px 14px', fontSize: 13, lineHeight: 1.5, margin: '0 0 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 240 }}>{err}</span>
      {(brief?.moment || doc?.brief.moment) && step !== 'piece' ? <button type="button" disabled={!!busy} onClick={() => openHouse((brief?.moment || doc!.brief.moment))} style={big(true, !!busy)}>Open the house design</button> : null}
      <button type="button" onClick={() => setErr('')} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 12.5 }}>Dismiss</button>
    </div>
  ) : null
  const Waiting = ({ text, sub }: { text: string; sub: string }) => (
    <div style={{ maxWidth: 620, margin: '70px auto', textAlign: 'center', color: UI.ink }}>
      <p style={{ fontFamily: display, fontWeight: 800, fontSize: 22, margin: '0 0 8px' }}>{text}</p>
      <p style={{ fontSize: 13.5, color: UI.mut, lineHeight: 1.6, margin: 0 }}>{sub}</p>
      <div style={{ height: 4, borderRadius: 2, background: UI.panel2, overflow: 'hidden', margin: '22px auto 0', maxWidth: 320 }}><div style={{ width: '40%', height: '100%', background: UI.gold, animation: 'adxslide 1.4s ease-in-out infinite' }} /></div>
      <style>{'@keyframes adxslide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}'}</style>
    </div>
  )

  return (
    <div style={{ background: UI.bg, minHeight: 620, borderRadius: 14 }}>
      {busy === 'concepts' ? Waiting({ text: "Looking through our photographs…", sub: `Finding the best pictures of our ${brief?.areaLabel || ''} units, measuring them, and sketching three different ideas for ${id?.name || 'the piece'}.` })
        : busy === 'copy' ? Waiting({ text: "Writing three ways to say it…", sub: "A spoken line and an on-screen headline for every scene, and a caption. You choose one and can change any word." })
        : busy === 'compose' ? Waiting({ text: "Designing the piece…", sub: "The art director is laying out every scene for these words and these photographs, in the event’s colours. It is then measured and checked before you see it. This takes a minute or two." })
        : busy === 'house' || busy === 'open' ? Waiting({ text: 'Opening…', sub: '' })
        : step === 'brief' ? (<>
          {err ? <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 24px 0' }}>{Trouble()}</div> : null}
          <BriefWizard moment={start.moment} display={display} busy={!!busy} onConfirm={confirmBrief} onHouse={openHouse} onCancel={() => onClose(changed.current)} />
        </>)
        : step === 'concepts' ? (
          <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 40px' }}>
            {Bar({ title: "Three ideas", sub: `for ${id?.name} · ${brief?.areaLabel} · pick one — the script comes next` })}
            {Trouble()}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
              {concepts.map((c, i) => {
                const ground = pal[c.ground[0]] || darkest, light = lumOf(ground) > 0.4
                const accent = pal[c.ground[1]] && pal[c.ground[1]] !== ground ? pal[c.ground[1]] : colours.find(x => Math.abs(lumOf(x) - lumOf(ground)) > 0.25 && x !== lightest && x !== darkest) || (light ? darkest : lightest)
                const look = LOOKS.find(l => l.key === c.look)
                return (
                  <div key={i} style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* a low-fidelity preview: the ground, the lead photograph as a window, the opening headline */}
                    <div style={{ background: ground, padding: '18px 18px 16px', display: 'flex', gap: 14, alignItems: 'flex-end', minHeight: 190 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent, marginBottom: 8 }}>{brief?.areaLabel} · {brief?.dates}</span>
                        <Hook text={c.hook || c.name} color={light ? darkest : lightest} accent={accent} family={headFamily} accentFamily="'Fraunces', Georgia, serif" size={27} />
                      </div>
                      {thumbs[c.lead] ? <span style={{ width: 118, height: 150, flex: 'none', borderRadius: i % 2 ? '59px 59px 6px 6px' : 8, background: `url(${proxied(thumbs[c.lead])}) center/cover`, boxShadow: '0 6px 18px rgba(0,0,0,.3)' }} /> : null}
                    </div>
                    <div style={{ display: 'flex', height: 6 }}>{(c.ground.length ? c.ground.map(k => pal[k]) : colours.slice(0, 4)).filter(Boolean).map((x, k) => <span key={k} style={{ flex: 1, background: x }} />)}</div>
                    <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, color: UI.ink }}>
                      <p style={{ margin: 0, fontFamily: display, fontWeight: 800, fontSize: 17 }}>{c.name}</p>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{c.idea}</p>
                      <p style={{ margin: 0, fontSize: 11.5, color: UI.gold, fontWeight: 700 }}>{look?.label || c.look} look{look ? <span style={{ color: UI.mut, fontWeight: 500 }}> · {look.oneLine}</span> : null}</p>
                      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: UI.mut, lineHeight: 1.5, flex: 1 }}>{c.beats.map((b, k) => <li key={k}>{b.replace(/^scene \d+:\s*/i, '')}</li>)}</ol>
                      <button type="button" disabled={!canEdit} onClick={() => pickConcept(c)} style={{ ...big(true, !canEdit), marginTop: 4 }}>Use this idea → the script</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => setStep('brief')} style={big(false)}>← Back to the brief</button>
              <button type="button" disabled={!brief} onClick={() => brief && confirmBrief(brief)} style={big(false)}>↻ Three other ideas</button>
              <span style={{ fontSize: 12, color: UI.mut }}>{Object.keys(photos).length} photographs of our {brief?.areaLabel} units were found for this piece.</span>
            </div>
          </div>
        )
        : step === 'copy' && concept ? (
          <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 40px' }}>
            {Bar({ title: "The script", sub: `“${concept.name}” · three ways to say it · change any word, then design it` })}
            {Trouble()}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              {options.map((o, i) => (
                <div key={i} style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10, color: UI.ink }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.gold }}>Option {i + 1}{o.voice ? ' · ' + o.voice : ''}</p>
                  {o.lines.map((l, k) => {
                    const setLine = (patch: Partial<{ vo: string; head: string }>) => setOptions(os => os.map((x, xi) => (xi === i ? { ...x, lines: x.lines.map((y, yi) => (yi === k ? { ...y, ...patch } : y)) } : x)))
                    return (
                      <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ width: 46, height: 46, flex: 'none', borderRadius: 7, background: l.photo && thumbs[l.photo] ? `url(${proxied(thumbs[l.photo])}) center/cover` : UI.panel2, display: 'grid', placeItems: 'center', fontSize: 11, color: UI.mut, fontWeight: 800 }}>{l.photo && thumbs[l.photo] ? '' : k + 1}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <textarea rows={2} value={l.head} onChange={e => setLine({ head: e.target.value.slice(0, 120) })} aria-label={'On-screen headline, scene ' + (k + 1)} style={{ width: '100%', boxSizing: 'border-box', background: UI.bg, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '6px 9px', fontSize: 14.5, fontWeight: 700, fontFamily: display, lineHeight: 1.25, resize: 'vertical' }} />
                          <textarea rows={1} value={l.vo} onChange={e => setLine({ vo: e.target.value.slice(0, 200) })} aria-label={'Spoken line, scene ' + (k + 1)} style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: '1px solid transparent', borderRadius: 8, color: UI.mut, padding: '3px 9px', fontSize: 12.5, lineHeight: 1.35, resize: 'vertical', fontFamily: 'inherit' }} />
                        </span>
                      </div>
                    )
                  })}
                  <p style={{ margin: 0, fontSize: 12, color: UI.mut, lineHeight: 1.5, borderTop: '1px solid ' + UI.line, paddingTop: 9 }}>{o.caption}</p>
                  <button type="button" disabled={!canEdit} onClick={() => compose(o)} style={{ ...big(true, !canEdit), marginTop: 'auto' }}>Design the piece with this script</button>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: UI.mut, margin: '12px 0 0' }}>The large line is the headline on screen (*stars* mark the accent words; a new line breaks the line). The small line is what the voice will say.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={() => setStep('concepts')} style={big(false)}>← Back to the ideas</button>
              <button type="button" onClick={() => pickConcept(concept)} style={big(false)}>↻ Three other scripts</button>
            </div>
          </div>
        )
        : step === 'piece' && doc ? (
          <div style={{ maxWidth: 1380, margin: '0 auto', padding: '20px 24px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px', flexWrap: 'wrap' }}>
              <button type="button" onClick={close} style={big(false)}>← Studio</button>
              <input value={doc.title} disabled={!canEdit} onChange={e => change({ ...doc, title: e.target.value.slice(0, 120) })} aria-label="Name of the piece"
                style={{ flex: 1, minWidth: 220, background: 'transparent', border: '1px solid transparent', borderRadius: 8, color: UI.ink, fontFamily: display, fontWeight: 800, fontSize: 20, padding: '6px 8px' }} />
              <span style={{ fontSize: 11.5, color: UI.mut }}>{doc.meta.origin === 'house' ? 'House design' : 'Designed for this brief'}{doc.meta.costUsd ? ` · AI cost $${doc.meta.costUsd.toFixed(2)}` : ''} · {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : saved === 'unsaved' ? (doc.meta.origin === 'house' && !changed.current ? 'Not saved yet' : 'Unsaved changes') : ''}</span>
              {canEdit && saved === 'unsaved' ? <button type="button" onClick={save} style={big(true)}>Save</button> : null}
              {canEdit ? <button type="button" onClick={remove} title="Delete this piece" style={{ ...big(false), color: UI.red, borderColor: 'rgba(224,108,108,0.4)' }}>✕ Delete</button> : null}
            </div>
            {Trouble()}
            {notes.length ? <p style={{ fontSize: 12, color: UI.mut, margin: '0 0 10px' }}>Tidied on the way in: {notes.slice(0, 4).join(' · ')}</p> : null}
            <AdxPlayer doc={doc} onChange={change} canEdit={canEdit} display={display} />
            <p style={{ fontSize: 12, color: UI.mut, margin: '16px 0 0', lineHeight: 1.6 }}>{doc.concept.name ? <><b style={{ color: UI.ink }}>{doc.concept.name}.</b> {doc.concept.idea} </> : null}Photographs: {Array.from(new Set(Object.values(doc.assets.photos).map(p => p.building))).join(', ') || '—'} · {doc.brief.areaLabel}.</p>
          </div>
        )
          : <div style={{ padding: 40 }}>{Trouble()}<button type="button" onClick={() => onClose(changed.current)} style={big(false)}>← Studio</button></div>}
    </div>
  )
}

function lumOf(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0.5
  const n = parseInt(m[1], 16), f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255)
}
