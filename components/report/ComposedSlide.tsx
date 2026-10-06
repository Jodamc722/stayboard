'use client'
// A SLIDE BUILT FROM A PROMPT (Jon, 2026-10-06: "add a slide where I can prompt it and give it details
// and add photos… and it arranges it on the owner reports or onboarding"). The content comes from
// /api/reports/compose-slide; this draws it in one of six layouts on whichever deck it sits in. The
// deck hands over its own type and colours (serif, ink, accent, tint ladder), so a composed slide
// reads as part of the document rather than a pasted-in card. Everything stays editable in place —
// headline, paragraph, bullets, figures, quote, captions — and every photo can be swapped.
import type { ComponentType, CSSProperties, ReactNode } from 'react'

export type ComposedLayout = 'feature' | 'gallery' | 'stats' | 'list' | 'quote' | 'text'
type Any = any
type EdT = ComponentType<{ v: string; set: (s: string) => void; edit: boolean; multiline?: boolean; placeholder?: string; className?: string }>

export function ComposedSlide({ cs, edit, set, pick, Ed, ink, accent, serif, tint, heading }: {
  cs: Any
  edit: boolean
  /** patch one field of this custom section ('title', 'bullets.2', 'stats.0.value', …) */
  set: (field: string, v: Any) => void
  /** open the deck's photo picker for photo j (j === photos.length adds one) */
  pick: (j: number) => void
  Ed: EdT
  ink: string
  accent: string
  serif: string
  tint: (a: number) => string
  /** the deck's own headline treatment, so this slide's title matches its neighbours */
  heading?: (node: ReactNode) => ReactNode
}) {
  const layout: ComposedLayout = (['feature', 'gallery', 'stats', 'list', 'quote', 'text'].includes(String(cs.layout)) ? cs.layout : 'text') as ComposedLayout
  const photos: string[] = Array.isArray(cs.photos) ? cs.photos : []
  const caps: string[] = Array.isArray(cs.caps) ? cs.caps : []
  const bullets: string[] = Array.isArray(cs.bullets) ? cs.bullets : []
  const stats: { value: string; label: string }[] = Array.isArray(cs.stats) ? cs.stats : []

  const eyebrow = (edit || String(cs.eyebrow || '').trim()) ? (
    <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: accent, margin: '0 0 10px' }}>
      <Ed v={String(cs.eyebrow || '')} set={v => set('eyebrow', v)} edit={edit} placeholder="OVERLINE" />
    </p>
  ) : null
  const titleNode = <Ed v={String(cs.title || '')} set={v => set('title', v)} edit={edit} placeholder="Headline" />
  const title = heading ? heading(titleNode) : (
    <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 36, lineHeight: 1.14, letterSpacing: '-0.02em', color: ink, margin: 0, maxWidth: '22ch' }}>{titleNode}</h2>
  )
  const bodyP = (edit || String(cs.body || '').trim()) ? (
    <p style={{ fontSize: 16.5, lineHeight: 1.6, color: tint(0.66), margin: '16px 0 0', maxWidth: '58ch', whiteSpace: 'pre-wrap' }}>
      <Ed v={String(cs.body || '')} set={v => set('body', v)} edit={edit} multiline placeholder="A sentence or two" />
    </p>
  ) : null
  const list = (cols = 1) => (bullets.length || edit) ? (
    <div style={{ marginTop: 18 }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', minmax(0,1fr))', columnGap: 32, rowGap: 11 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 15.5, lineHeight: 1.45, color: tint(0.78) }}>
            <span style={{ flex: '0 0 auto', width: 6, height: 6, borderRadius: 6, background: accent, transform: 'translateY(-2px)' }} />
            <span style={{ flex: 1, minWidth: 0 }}><Ed v={b} set={v => set('bullets.' + i, v)} edit={edit} placeholder="Point" /></span>
            {edit && <button className="sb-noprint" onClick={() => set('bullets', bullets.filter((_, k) => k !== i))} title="Remove this point" style={{ fontSize: 11, color: tint(0.4), background: 'none', border: 0, cursor: 'pointer' }}>×</button>}
          </li>
        ))}
      </ul>
      {edit && bullets.length < 8 && <button className="sb-noprint" onClick={() => set('bullets', bullets.concat(''))} style={{ marginTop: 10, fontSize: 11.5, fontWeight: 600, color: accent, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>+ Point</button>}
    </div>
  ) : null

  // A plain render function, not a component: a component defined here would remount on every
  // render, and a caption being typed would lose focus after each letter.
  const photo = (j: number, style?: CSSProperties, cap = true, key?: number) => {
    const u = String(photos[j] || '')
    return (
      <figure key={key} style={{ margin: 0, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
        <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden', borderRadius: 12, background: tint(0.07) }}>
          {u ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u} alt={String(caps[j] || '')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : null}
          {edit && (
            <button className="sb-noprint" onClick={() => pick(j)} style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }}>
              <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color: '#111' }}>{u ? 'Change' : 'Add a photo'}</span>
            </button>
          )}
        </div>
        {cap && (caps[j] || edit) ? (
          <figcaption style={{ fontSize: 11.5, lineHeight: 1.4, color: tint(0.48), marginTop: 8, flex: '0 0 auto' }}>
            <Ed v={String(caps[j] || '')} set={v => set('caps.' + j, v)} edit={edit} placeholder="Caption" />
          </figcaption>
        ) : null}
      </figure>
    )
  }
  const addPhoto = edit && photos.length < 8 ? (
    <button className="sb-noprint" onClick={() => pick(photos.length)} style={{ fontSize: 11.5, fontWeight: 600, color: accent, background: 'none', border: 0, cursor: 'pointer', padding: 0, marginTop: 8 }}>+ Photo</button>
  ) : null

  // Figures the team supplied show on EVERY layout (on 2026-10-06 a "$4,860, paid from the reserve" was
  // kept by the builder but had nowhere to sit on a gallery page). Small here; the stats layout gives
  // them the whole page.
  const figs = (stats.length || (edit && layout !== 'stats')) ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 32px', marginTop: 18 }}>
      {stats.map((x, i) => (
        <div key={i} style={{ borderLeft: '2px solid ' + accent, paddingLeft: 12 }}>
          <div style={{ fontFamily: serif, fontSize: 26, lineHeight: 1, color: ink, fontVariantNumeric: 'tabular-nums' }}><Ed v={x.value} set={v => set('stats.' + i + '.value', v)} edit={edit} placeholder="$0" /></div>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.13em', textTransform: 'uppercase', color: tint(0.5), marginTop: 6 }}><Ed v={x.label} set={v => set('stats.' + i + '.label', v)} edit={edit} placeholder="Label" /></div>
        </div>
      ))}
      {edit && stats.length < 4 ? <button className="sb-noprint" onClick={() => set('stats', stats.concat({ value: '', label: '' }))} style={{ fontSize: 11.5, fontWeight: 600, color: accent, background: 'none', border: 0, cursor: 'pointer', padding: 0, alignSelf: 'center' }}>+ Figure</button> : null}
    </div>
  ) : null

  const root: CSSProperties = { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }

  if (layout === 'gallery') {
    const n = photos.length
    const rest = photos.slice(1, 5)
    return (
      <div style={root}>
        <div style={{ flex: '0 0 auto' }}>{eyebrow}{title}{bodyP}{figs}</div>
        <div style={{ flex: '1 1 auto', minHeight: 300, marginTop: 20, display: 'grid', gap: 14,
          gridTemplateColumns: n <= 1 ? '1fr' : n === 2 ? '1fr 1fr' : n === 3 ? '1.4fr 1fr' : '1.3fr 1fr 1fr',
          gridTemplateRows: n <= 2 ? '1fr' : '1fr 1fr' }}>
          {photo(0, { gridRow: n <= 2 ? 'auto' : '1 / span 2' })}
          {rest.map((_, k) => photo(k + 1, undefined, true, k))}
        </div>
        {addPhoto}
      </div>
    )
  }

  if (layout === 'stats') {
    return (
      <div style={root}>
        <div style={{ display: 'grid', gridTemplateColumns: photos[0] || edit ? '1.25fr 0.75fr' : '1fr', columnGap: 44, flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
            {eyebrow}{title}{bodyP}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(2, Math.min(4, stats.length || 2)) + ', minmax(0,1fr))', gap: 28, marginTop: 30 }}>
              {stats.map((s, i) => (
                <div key={i} style={{ borderTop: '2px solid ' + accent, paddingTop: 14 }}>
                  <div style={{ fontFamily: serif, fontSize: 44, lineHeight: 1, letterSpacing: '-0.025em', color: ink, fontVariantNumeric: 'tabular-nums' }}><Ed v={s.value} set={v => set('stats.' + i + '.value', v)} edit={edit} /></div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: tint(0.5), marginTop: 10 }}><Ed v={s.label} set={v => set('stats.' + i + '.label', v)} edit={edit} /></div>
                </div>
              ))}
            </div>
            {edit && stats.length < 4 && <button className="sb-noprint" onClick={() => set('stats', stats.concat({ value: '', label: '' }))} style={{ marginTop: 12, fontSize: 11.5, fontWeight: 600, color: accent, background: 'none', border: 0, cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}>+ Figure</button>}
          </div>
          {(photos[0] || edit) ? photo(0, { minHeight: 280 }) : null}
        </div>
      </div>
    )
  }

  if (layout === 'quote') {
    return (
      <div style={root}>
        <div style={{ display: 'grid', gridTemplateColumns: photos[0] || edit ? '0.8fr 1.2fr' : '1fr', columnGap: 48, flex: '1 1 auto', minHeight: 0, alignItems: 'stretch' }}>
          {(photos[0] || edit) ? photo(0, { minHeight: 280 }, false) : null}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
            {eyebrow}
            <span style={{ fontFamily: serif, fontSize: 72, lineHeight: 0.6, color: accent, display: 'block', height: 34 }}>“</span>
            <p style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 30, lineHeight: 1.3, color: ink, margin: '6px 0 0', maxWidth: '26ch' }}>
              <Ed v={String(cs.quote || '')} set={v => set('quote', v)} edit={edit} multiline placeholder="The quote" />
            </p>
            {(cs.by || edit) ? <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: tint(0.5), marginTop: 20 }}>— <Ed v={String(cs.by || '')} set={v => set('by', v)} edit={edit} placeholder="Who said it" /></p> : null}
            {String(cs.title || '').trim() || edit ? <div style={{ marginTop: 26 }}>{title}</div> : null}
          </div>
        </div>
      </div>
    )
  }

  if (layout === 'list') {
    const side = photos[0] || edit
    return (
      <div style={root}>
        <div style={{ display: 'grid', gridTemplateColumns: side ? '1.35fr 0.65fr' : '1fr', columnGap: 44, flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ minWidth: 0 }}>{eyebrow}{title}{bodyP}{list(side ? 1 : 2)}{figs}</div>
          {side ? photo(0, { minHeight: 260 }) : null}
        </div>
      </div>
    )
  }

  if (layout === 'feature') {
    return (
      <div style={root}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 48, flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>{eyebrow}{title}{bodyP}{list(1)}{figs}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 300 }}>
            {photo(0, { flex: photos.length > 1 ? '1.6 1 0' : '1 1 auto' })}
            {photos.length > 1 ? (
              <div style={{ flex: '1 1 0', minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(' + Math.min(3, photos.length - 1) + ', minmax(0,1fr))', gap: 12 }}>
                {photos.slice(1, 4).map((_, k) => photo(k + 1, undefined, false, k))}
              </div>
            ) : null}
            {addPhoto}
          </div>
        </div>
      </div>
    )
  }

  // text
  return (
    <div style={root}>
      {eyebrow}{title}
      <p style={{ fontSize: 18, lineHeight: 1.62, color: tint(0.66), margin: '20px 0 0', maxWidth: '64ch', whiteSpace: 'pre-wrap' }}>
        <Ed v={String(cs.body || '')} set={v => set('body', v)} edit={edit} multiline placeholder="Write it here" />
      </p>
      {list(2)}
      {figs}
    </div>
  )
}
