'use client'
// Owner Report renderer + edit-in-place. Renders the ReportContent JSON as a stacked
// "deck" of sections in the Capri look (navy/coral/gold on cream). When canEdit,
// an Edit toggle turns every text/number into an inline input, lets quotes/themes/
// project items be removed/added, and sections be hidden/shown (content.omit).
// Save PUTs the whole content JSON to /api/reports. Subcomponents live at module
// scope (never inline in render) so inputs keep focus while typing.
import { useRef, useState } from 'react'
import { Pencil, Save, Loader2, Eye, EyeOff, X, Plus, Link as LinkIcon, Check, Paperclip, Image as ImageIcon, Download } from 'lucide-react'

type Any = any

// ---------- themes (P4): every color in the page comes from the active theme ----------
const THEMES: Record<string, Any> = {
  capri: {
    label: 'Capri', bg: '#FAF6EF', ink: '#102A43', body: '#41586e', sub: '#6b7c8d', muted: '#93a3b3',
    card: '#ffffff', cardBorder: '#efe8d8', chip: '#faf8f2', accent: '#E2725B', gold: '#C9A227', band: '#102A43',
    statusHotBg: '#fdeee9', statusHotInk: '#E2725B', statusColdBg: '#eef3f7', statusColdInk: '#5a7186',
    good: '#1a7f4f', downGray: '#a6b1bc', rule: '#eadfc9', toolbarBg: 'rgba(250,246,239,0.92)', toolbarBorder: '#d9d0bc',
    trackBg: '#fffdf7', footA: '#a89f8a', footB: '#c2baa4', barA: '#102A43', barB: '#E2725B',
    edBg: 'rgba(255,255,255,0.7)', edBorder: '#C9A227',
  },
  minimal: {
    label: 'Minimal', bg: '#ffffff', ink: '#111827', body: '#374151', sub: '#6b7280', muted: '#9ca3af',
    card: '#ffffff', cardBorder: '#e5e7eb', chip: '#f9fafb', accent: '#111827', gold: '#6b7280', band: '#111827',
    statusHotBg: '#f3f4f6', statusHotInk: '#111827', statusColdBg: '#f3f4f6', statusColdInk: '#6b7280',
    good: '#15803d', downGray: '#9ca3af', rule: '#e5e7eb', toolbarBg: 'rgba(255,255,255,0.92)', toolbarBorder: '#d1d5db',
    trackBg: '#fafafa', footA: '#9ca3af', footB: '#d1d5db', barA: '#111827', barB: '#111827',
    edBg: 'rgba(0,0,0,0.03)', edBorder: '#9ca3af',
  },
  lux: {
    label: 'Dark Luxe', bg: '#101216', ink: '#F4EFE6', body: '#c9c4b8', sub: '#9a958a', muted: '#6e7684',
    card: '#181b21', cardBorder: '#262a32', chip: '#1f232b', accent: '#C9A227', gold: '#C9A227', band: '#1e222a',
    statusHotBg: 'rgba(201,162,39,0.15)', statusHotInk: '#C9A227', statusColdBg: '#262a32', statusColdInk: '#9a958a',
    good: '#5fbf8f', downGray: '#6e7684', rule: '#262a32', toolbarBg: 'rgba(16,18,22,0.92)', toolbarBorder: '#33383f',
    trackBg: '#15181d', footA: '#6e6a61', footB: '#4f4b43', barA: '#4a5160', barB: '#C9A227',
    edBg: 'rgba(255,255,255,0.08)', edBorder: '#C9A227',
  },
}

// ---------- PPTX export (P5): built in the browser from the content JSON + active theme ----------
const PPTX_CDN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'

function cx(v: string, fb: string): string {
  return (v && v.indexOf('#') === 0) ? v.slice(1) : fb
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise<string | null>(resolve => {
      const fr = new FileReader()
      fr.onload = () => {
        const d = String(fr.result || '')
        resolve(d ? d.replace(/^data:/, '') : null)
      }
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

function buildPptx(P: Any, c: Any, t: Any, heroData: string | null): Any {
  const pptx = new P()
  pptx.layout = 'LAYOUT_WIDE'
  const BG = cx(t.bg, 'FFFFFF'), INK = cx(t.ink, '111827'), BODY = cx(t.body, '41586e'), SUB = cx(t.sub, '6b7c8d')
  const MUT = cx(t.muted, '93a3b3'), CARD = cx(t.card, 'FFFFFF'), CB = cx(t.cardBorder, 'e5e7eb'), ACC = cx(t.accent, 'E2725B')
  const GOLD = cx(t.gold, 'C9A227'), BAND = cx(t.band, '102A43'), GOOD = cx(t.good, '1a7f4f'), GRAY = cx(t.downGray, 'a6b1bc')
  const CHIP = cx(t.chip, 'f5f5f5'), BARA = cx(t.barA, '102A43'), BARB = cx(t.barB, 'E2725B')
  const hero = c.hero || {}, snap = c.snapshot || {}, plan = c.plan, ahead = c.ahead || {}, voices = c.voices || {}, projects = c.projects || {}, meta = c.meta || {}
  const isDown = (v: Any) => String(v || '').trim().indexOf('-') === 0 || String(v || '').trim().indexOf('−') === 0
  function head(s: Any, eyebrow: string, headline: string, subtitle?: string) {
    s.background = { color: BG }
    s.addText(eyebrow, { x: 0.6, y: 0.35, w: 12.1, h: 0.3, fontSize: 11, bold: true, color: ACC, charSpacing: 3 })
    s.addText(String(headline || '').slice(0, 120), { x: 0.6, y: 0.65, w: 12.1, h: 0.65, fontSize: 21, bold: true, color: INK })
    if (subtitle) s.addText(String(subtitle).slice(0, 160), { x: 0.6, y: 1.28, w: 12.1, h: 0.3, fontSize: 10.5, color: SUB })
  }

  // hero
  const s1 = pptx.addSlide()
  s1.background = { color: BG }
  s1.addText(String(hero.eyebrow || ''), { x: 0.6, y: 0.85, w: 12.1, h: 0.3, align: 'center', fontSize: 12, bold: true, color: ACC, charSpacing: 4 })
  s1.addText(String(hero.dateLabel || 'OWNER REVIEW'), { x: 0.6, y: 1.25, w: 12.1, h: 0.3, align: 'center', fontSize: 11, bold: true, color: GOLD, charSpacing: 4 })
  s1.addText(String(hero.title || ''), { x: 0.6, y: 1.6, w: 12.1, h: 1.05, align: 'center', fontSize: 46, bold: true, color: INK })
  s1.addText(String(hero.headline || ''), { x: 1.8, y: 2.75, w: 9.7, h: 0.95, align: 'center', fontSize: 16, color: BODY })
  if (heroData) s1.addImage({ data: heroData, x: 2.9, y: 3.85, w: 7.5, h: 2.8, sizing: { type: 'cover', w: 7.5, h: 2.8 } })
  s1.addText(String(hero.preparedFor || '') + '  ·  STAY HOSPITALITY', { x: 0.6, y: 6.95, w: 12.1, h: 0.3, align: 'center', fontSize: 9, bold: true, color: MUT, charSpacing: 2 })

  // snapshot
  const s2 = pptx.addSlide()
  head(s2, 'SNAPSHOT', snap.headline, snap.subtitle)
  const cards = (snap.cards || []).slice(0, 4)
  for (let i = 0; i < cards.length; i++) {
    const x = 0.6 + i * 3.09
    s2.addShape('roundRect', { x, y: 1.8, w: 2.94, h: 1.9, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
    s2.addText(String(cards[i].label || ''), { x: x + 0.15, y: 1.95, w: 2.6, h: 0.25, fontSize: 9, bold: true, color: ACC, charSpacing: 2 })
    s2.addText(String(cards[i].value || ''), { x: x + 0.15, y: 2.25, w: 2.6, h: 0.6, fontSize: 27, bold: true, color: INK })
    s2.addText(String(cards[i].sub || '').slice(0, 95), { x: x + 0.15, y: 2.9, w: 2.64, h: 0.7, fontSize: 8.5, color: SUB })
  }
  if (snap.ytd) {
    s2.addShape('roundRect', { x: 0.6, y: 4.1, w: 12.13, h: 2.2, fill: { color: BAND }, rectRadius: 0.06 })
    s2.addText((meta.asOf ? String(meta.asOf).slice(0, 4) : '') + ' YEAR-TO-DATE', { x: 0.9, y: 4.3, w: 6, h: 0.3, fontSize: 9, bold: true, color: GOLD, charSpacing: 2 })
    s2.addText(String(snap.ytd.text || '').slice(0, 260), { x: 0.9, y: 4.65, w: 6.5, h: 1.45, fontSize: 12, color: 'FFFFFF' })
    const stats = (snap.ytd.stats || []).slice(0, 3)
    for (let i = 0; i < stats.length; i++) {
      const x = 7.8 + i * 1.62
      s2.addText(String(stats[i].value || ''), { x, y: 4.75, w: 1.55, h: 0.5, align: 'center', fontSize: 20, bold: true, color: 'FFFFFF' })
      s2.addText(String(stats[i].label || ''), { x, y: 5.3, w: 1.55, h: 0.3, align: 'center', fontSize: 8, bold: true, color: 'CCCCCC', charSpacing: 1 })
    }
  }

  // pacing
  if (c.pacing) {
    const s = pptx.addSlide()
    head(s, 'PACING VS. MARKET', c.pacing.headline, c.pacing.subtitle)
    const rows = (c.pacing.rows || []).slice(0, 4)
    for (let i = 0; i < rows.length; i++) {
      const y = 1.85 + i * 1.2
      const r = rows[i]
      s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: 1.05, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(r.metric || ''), { x: 0.9, y: y + 0.35, w: 2.4, h: 0.35, fontSize: 13, bold: true, color: INK })
      s.addText(String(r.ours || ''), { x: 3.9, y: y + 0.14, w: 2.4, h: 0.5, align: 'center', fontSize: 20, bold: true, color: INK })
      s.addText(String(meta.scopeLabel || 'US'), { x: 3.9, y: y + 0.66, w: 2.4, h: 0.25, align: 'center', fontSize: 8, bold: true, color: ACC, charSpacing: 1 })
      s.addText(String(r.comps || ''), { x: 6.8, y: y + 0.14, w: 2.4, h: 0.5, align: 'center', fontSize: 20, bold: true, color: MUT })
      s.addText('COMP SET', { x: 6.8, y: y + 0.66, w: 2.4, h: 0.25, align: 'center', fontSize: 8, bold: true, color: MUT, charSpacing: 1 })
      s.addText(String(r.delta || ''), { x: 10.1, y: y + 0.14, w: 2.3, h: 0.5, align: 'right', fontSize: 16, bold: true, color: isDown(r.delta) ? GRAY : GOOD })
      s.addText('VS. COMPS', { x: 10.1, y: y + 0.66, w: 2.3, h: 0.25, align: 'right', fontSize: 8, color: MUT, charSpacing: 1 })
    }
  }

  // performance vs plan
  if (plan) {
    const s = pptx.addSlide()
    head(s, 'PERFORMANCE VS. PLAN', plan.headline)
    const months = (plan.months || []).slice(0, 3)
    for (let mi = 0; mi < months.length; mi++) {
      const m = months[mi]
      const y = 1.6 + mi * 1.88
      s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: 1.76, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(m.label || ''), { x: 0.9, y: y + 0.12, w: 2.5, h: 0.3, fontSize: 13, bold: true, color: INK, charSpacing: 2 })
      s.addText(String(m.status || ''), { x: 3.2, y: y + 0.15, w: 2.5, h: 0.25, fontSize: 9, bold: true, color: ACC, charSpacing: 1 })
      const rows = (m.rows || []).slice(0, 4)
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri]
        const x = 0.9 + ri * 2.95
        s.addShape('roundRect', { x, y: y + 0.48, w: 2.8, h: 0.86, fill: { color: CHIP }, rectRadius: 0.05 })
        s.addText(String(r.metric || ''), { x: x + 0.1, y: y + 0.52, w: 2.6, h: 0.2, fontSize: 7.5, bold: true, color: MUT, charSpacing: 1 })
        s.addText(String(r.actual || ''), { x: x + 0.1, y: y + 0.72, w: 1.7, h: 0.35, fontSize: 15, bold: true, color: INK })
        s.addText(String(r.budget || ''), { x: x + 0.1, y: y + 1.08, w: 1.7, h: 0.22, fontSize: 8, color: MUT })
        s.addText(String(r.delta || ''), { x: x + 1.6, y: y + 0.78, w: 1.1, h: 0.3, align: 'right', fontSize: 10, bold: true, color: r.good ? GOOD : GRAY })
      }
      if (m.note) s.addText(String(m.note).slice(0, 180), { x: 0.9, y: y + 1.4, w: 11.5, h: 0.3, fontSize: 9, color: BODY })
    }
  }

  // owner statement
  if (c.statement && (c.statement.items || []).length) {
    const s = pptx.addSlide()
    head(s, 'OWNER STATEMENT', c.statement.headline || 'Owner statement summary.')
    const items = (c.statement.items || []).slice(0, 4)
    for (let i = 0; i < items.length; i++) {
      const y = 1.8 + i * 1.3
      s.addShape('roundRect', { x: 0.6, y, w: 12.13, h: 1.15, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(items[i].title || ''), { x: 0.9, y: y + 0.1, w: 11.5, h: 0.3, fontSize: 12, bold: true, color: INK })
      s.addText(String(items[i].summary || '').slice(0, 300), { x: 0.9, y: y + 0.42, w: 11.5, h: 0.65, fontSize: 10.5, color: BODY })
    }
  }

  // looking ahead
  const s6 = pptx.addSlide()
  head(s6, 'LOOKING AHEAD', ahead.headline, ahead.subtitle)
  const aMonths = (ahead.months || []).slice(0, 2)
  for (let i = 0; i < aMonths.length; i++) {
    const m = aMonths[i]
    const x = 0.6 + i * 6.15
    s6.addShape('roundRect', { x, y: 1.8, w: 5.98, h: 2.45, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
    s6.addText(String(m.label || ''), { x: x + 0.25, y: 1.95, w: 3, h: 0.3, fontSize: 13, bold: true, color: INK, charSpacing: 2 })
    s6.addText(String(m.status || ''), { x: x + 3.2, y: 1.98, w: 2.5, h: 0.25, fontSize: 9, bold: true, color: ACC, charSpacing: 1 })
    s6.addText(String(m.occPct != null ? m.occPct : 0) + '%', { x: x + 0.25, y: 2.3, w: 2.4, h: 0.6, fontSize: 30, bold: true, color: INK })
    s6.addText('on the books', { x: x + 2.0, y: 2.52, w: 2.4, h: 0.3, fontSize: 10, color: MUT })
    s6.addText('ADR ' + String(m.adr || '') + '   ·   RevPAR ' + String(m.revpar || ''), { x: x + 0.25, y: 3.0, w: 5.5, h: 0.3, fontSize: 11, bold: true, color: BODY })
    if (m.note) s6.addText(String(m.note).slice(0, 190), { x: x + 0.25, y: 3.32, w: 5.5, h: 0.8, fontSize: 9, color: SUB })
  }
  const strip = (ahead.strip || []).slice(0, 8)
  if (strip.length) {
    s6.addText('MONTHS AHEAD  ·  OCCUPANCY %', { x: 0.6, y: 4.55, w: 8, h: 0.25, fontSize: 9, bold: true, color: MUT, charSpacing: 2 })
    const bw = 12.13 / strip.length
    for (let i = 0; i < strip.length; i++) {
      const pct = Number(strip[i].occPct) || 0
      const bh = Math.max(0.08, (pct / 100) * 1.7)
      const x = 0.6 + i * bw
      s6.addShape('rect', { x: x + bw * 0.2, y: 6.75 - bh, w: bw * 0.6, h: bh, fill: { color: i === 1 ? BARB : BARA } })
      s6.addText(String(pct) + '%', { x, y: 6.75 - bh - 0.3, w: bw, h: 0.25, align: 'center', fontSize: 9, bold: true, color: INK })
      s6.addText(String(strip[i].month || ''), { x, y: 6.8, w: bw, h: 0.25, align: 'center', fontSize: 9, color: SUB })
    }
  }

  // guest voices
  const quotes = (voices.quotes || []).slice(0, 4)
  if (quotes.length) {
    const s = pptx.addSlide()
    head(s, 'GUEST VOICES', voices.headline, voices.subtitle)
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i]
      const x = 0.6 + (i % 2) * 6.15
      const y = 1.8 + Math.floor(i / 2) * 2.55
      s.addShape('roundRect', { x, y, w: 5.98, h: 2.4, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText('“' + String(q.text || '').slice(0, 250) + '”', { x: x + 0.25, y: y + 0.15, w: 5.5, h: 1.55, fontSize: 10.5, italic: true, color: BODY })
      s.addText(String(q.guest || ''), { x: x + 0.25, y: y + 1.85, w: 3, h: 0.3, fontSize: 9, bold: true, color: INK, charSpacing: 1 })
      s.addText(String(q.unit || '') + (q.br ? ' · ' + q.br : ''), { x: x + 3.0, y: y + 1.85, w: 2.7, h: 0.3, align: 'right', fontSize: 8.5, color: MUT })
    }
  }

  // hearing / doing
  const themes = (voices.themes || []).slice(0, 3)
  if (themes.length) {
    const s = pptx.addSlide()
    s.background = { color: BAND }
    s.addText("WHAT WE'RE HEARING  ·  AND WHAT WE'RE DOING", { x: 0.6, y: 0.5, w: 12.1, h: 0.35, fontSize: 13, bold: true, color: GOLD, charSpacing: 2 })
    for (let i = 0; i < themes.length; i++) {
      const y = 1.3 + i * 1.9
      s.addShape('rect', { x: 0.6, y: y + 0.05, w: 0.045, h: 1.6, fill: { color: ACC } })
      s.addText(String(themes[i].title || ''), { x: 0.9, y, w: 11.6, h: 0.35, fontSize: 14, bold: true, color: 'FFFFFF' })
      s.addText(String(themes[i].body || '').slice(0, 260), { x: 0.9, y: y + 0.4, w: 11.6, h: 0.65, fontSize: 11, color: 'DDDDDD' })
      s.addText(String(themes[i].action || '').slice(0, 220), { x: 0.9, y: y + 1.1, w: 11.6, h: 0.55, fontSize: 11, color: GOLD })
    }
  }

  // projects
  const weeks = (projects.weeks || []).slice(0, 3)
  if (weeks.length) {
    const s = pptx.addSlide()
    head(s, 'PROJECTS', projects.headline, projects.subtitle)
    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi]
      const x = 0.6 + wi * 4.13
      s.addShape('roundRect', { x, y: 1.75, w: 3.98, h: 4.35, fill: { color: CARD }, line: { color: CB }, rectRadius: 0.06 })
      s.addText(String(w.label || ''), { x: x + 0.2, y: 1.9, w: 3.6, h: 0.3, fontSize: 10.5, bold: true, color: ACC, charSpacing: 1 })
      let body = ''
      const groups = (w.groups || []).slice(0, 4)
      for (let gi = 0; gi < groups.length; gi++) {
        body += String(groups[gi].category || '').toUpperCase() + '\n'
        const items = (groups[gi].items || []).slice(0, 5)
        for (let ii = 0; ii < items.length; ii++) body += '• ' + String(items[ii]).slice(0, 90) + '\n'
        body += '\n'
      }
      s.addText(body.slice(0, 900), { x: x + 0.2, y: 2.25, w: 3.62, h: 3.75, fontSize: 8.5, color: BODY, valign: 'top' })
    }
    const tracking = (projects.tracking || []).slice(0, 4)
    if (tracking.length) {
      s.addShape('roundRect', { x: 0.6, y: 6.35, w: 12.13, h: 0.85, fill: { color: cx(t.trackBg, 'FFFDF7') }, line: { color: GOLD, dashType: 'dash' }, rectRadius: 0.06 })
      let names = ''
      for (let i = 0; i < tracking.length; i++) names += (i ? '   ·   ' : '') + String(tracking[i].title || '')
      s.addText('IN PROGRESS:  ' + names.slice(0, 200), { x: 0.9, y: 6.55, w: 11.6, h: 0.45, fontSize: 10, bold: true, color: GOLD })
    }
  }

  return pptx
}

// ---------- tiny editable primitives (module scope: keeps input focus) ----------
function Ed({ v, set, edit, className, multiline, placeholder }: {
  v: string; set: (s: string) => void; edit: boolean; className?: string; multiline?: boolean; placeholder?: string
}) {
  if (!edit) return <span className={className}>{v}</span>
  if (multiline) {
    return (
      <textarea
        value={v}
        placeholder={placeholder}
        onChange={e => set(e.target.value)}
        rows={Math.max(2, Math.ceil((v || '').length / 60))}
        className={(className || '') + ' w-full rounded-md px-1.5 py-0.5 outline-none'}
        style={{ color: 'inherit', font: 'inherit', letterSpacing: 'inherit', background: 'var(--ed-bg)', border: '1px dashed var(--ed-border)' }}
      />
    )
  }
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={e => set(e.target.value)}
      className={(className || '') + ' rounded-md px-1.5 outline-none min-w-0'}
      style={{ color: 'inherit', font: 'inherit', letterSpacing: 'inherit', width: Math.max(4, (v || '').length + 2) + 'ch', background: 'var(--ed-bg)', border: '1px dashed var(--ed-border)' }}
    />
  )
}

function SectionShell({ id, title, hidden, edit, onToggle, children }: {
  id: string; title: string; hidden: boolean; edit: boolean; onToggle: () => void; children: React.ReactNode
}) {
  if (hidden && !edit) return null
  return (
    <section className="relative">
      {edit && (
        <button
          onClick={onToggle}
          className="absolute -top-3 right-4 z-10 inline-flex items-center gap-1 rounded-full shadow px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--t-card)', border: '1px solid var(--t-border)', color: 'var(--t-ink)' }}
        >
          {hidden ? <Eye size={11} /> : <EyeOff size={11} />} {hidden ? 'Show ' + title : 'Hide ' + title}
        </button>
      )}
      <div className={hidden ? 'opacity-30 pointer-events-none select-none' : ''}>{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: 'var(--t-accent)' }}>{children}</p>
}

// ---------- main ----------
export function ReportView({ initial, canEdit }: { initial: Any; canEdit: boolean }) {
  const [c, setC] = useState<Any>(initial.content || {})
  const [edit, setEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [copied, setCopied] = useState(false)
  const [themeKey, setThemeKey] = useState<string>(THEMES[initial.theme] ? initial.theme : 'capri')
  const t = THEMES[themeKey]
  function switchTheme(k: string) {
    setThemeKey(k)
    fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial.id, theme: k }) }).catch(() => {})
  }
  const [busy, setBusy] = useState('')
  const [attachMsg, setAttachMsg] = useState('')
  const [picker, setPicker] = useState(false)
  const [pool, setPool] = useState<{ url: string; thumb: string; listing: string }[] | null>(null)
  const pacingRef = useRef<HTMLInputElement>(null)
  const stmtRef = useRef<HTMLInputElement>(null)
  const heroRef = useRef<HTMLInputElement>(null)

  // path setter: patch('voices.quotes.0.text', v)
  function patch(path: string, value: Any) {
    setC((prev: Any) => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split('.')
      let node = next
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]]
      node[parts[parts.length - 1]] = value
      return next
    })
  }
  function mutate(fn: (draft: Any) => void) {
    setC((prev: Any) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next })
  }
  const omit: string[] = Array.isArray(c.omit) ? c.omit : []
  const isHidden = (k: string) => omit.indexOf(k) >= 0
  function toggleSection(k: string) {
    mutate(d => {
      d.omit = Array.isArray(d.omit) ? d.omit : []
      const i = d.omit.indexOf(k)
      if (i >= 0) d.omit.splice(i, 1); else d.omit.push(k)
    })
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/reports', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial.id, content: c }),
      })
      const d = await r.json()
      if (d?.ok) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000) }
    } catch {}
    setSaving(false)
  }

  function copyLink() {
    try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  // ---- attachments on an existing report (P3.5) ----
  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d?.ok && d?.url) return d.url
      setAttachMsg(d?.error || 'Upload failed')
    } catch { setAttachMsg('Upload failed') }
    return null
  }
  async function parseAttach(payload: Any): Promise<Any | null> {
    try {
      const r = await fetch('/api/reports/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: initial.id, ...payload }),
      })
      const d = await r.json()
      if (d?.ok && d?.section) return d.section
      setAttachMsg(d?.error || 'Could not read that PDF')
    } catch { setAttachMsg('Could not read that PDF') }
    return null
  }
  async function onPacingPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setAttachMsg(''); setBusy('pacing')
    const url = await uploadOne(f)
    if (url) {
      const section = await parseAttach({ kind: 'pacing', url })
      if (section) patch('pacing', section)
    }
    setBusy(''); e.target.value = ''
  }
  async function onStatementsPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files).slice(0, 4) : []
    if (!files.length) return
    setAttachMsg(''); setBusy('statements')
    const urls: string[] = []
    for (const f of files) {
      const url = await uploadOne(f)
      if (url) urls.push(url)
    }
    if (urls.length) {
      const section = await parseAttach({ kind: 'statements', urls })
      if (section) patch('statement', section)
    }
    setBusy(''); e.target.value = ''
  }
  async function onHeroPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setAttachMsg(''); setBusy('hero')
    const url = await uploadOne(f)
    if (url) { patch('hero.heroImage', url); setPicker(false) }
    setBusy(''); e.target.value = ''
  }
  function openPicker() {
    setPicker(!picker)
    if (pool === null) {
      fetch('/api/reports/attach?photos=' + encodeURIComponent(initial.id)).then(r => r.json()).then(d => {
        setPool(Array.isArray(d?.photos) ? d.photos : [])
      }).catch(() => setPool([]))
    }
  }
  async function downloadPptx() {
    if (busy) return
    setAttachMsg(''); setBusy('pptx')
    try {
      if (!(window as Any).PptxGenJS) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = PPTX_CDN
          s.onload = resolve
          s.onerror = () => reject(new Error('load failed'))
          document.head.appendChild(s)
        })
      }
      const h = c.hero || {}
      let heroData: string | null = null
      if (h.heroImage) heroData = await fetchImageDataUrl(h.heroImage)
      const pptx = buildPptx((window as Any).PptxGenJS, c, t, heroData)
      const name = String(h.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report'
      await pptx.writeFile({ fileName: name + '-owner-review.pptx' })
    } catch (_e) {
      setAttachMsg('PPTX export failed — try again.')
    }
    setBusy('')
  }

  const meta = c.meta || {}
  const hero = c.hero || {}
  const snap = c.snapshot || {}
  const plan = c.plan
  const ahead = c.ahead || {}
  const voices = c.voices || {}
  const projects = c.projects || {}
  const footer = (hero.title || '') + '  ·  ' + (hero.dateLabel || 'OWNER REVIEW')

  return (
    <div className="min-h-screen" style={{ background: t.bg, color: t.ink, '--ed-bg': t.edBg, '--ed-border': t.edBorder, '--t-card': t.card, '--t-border': t.toolbarBorder, '--t-ink': t.ink, '--t-accent': t.accent } as Any}>
      {/* toolbar (edit only appears for logged-in team) */}
      {canEdit && (
        <div className="sticky top-0 z-20 flex items-center justify-end gap-2 px-4 py-2.5 flex-wrap" style={{ background: t.toolbarBg, backdropFilter: 'blur(6px)', borderBottom: '1px solid ' + t.rule }}>
          <div className="mr-auto inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {Object.keys(THEMES).map(k => (
              <button key={k} onClick={() => switchTheme(k)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={themeKey === k ? { background: t.ink, color: t.bg } : { color: t.sub }}>
                {THEMES[k].label}
              </button>
            ))}
          </div>
          {attachMsg && <span className="text-[11px] font-semibold" style={{ color: t.accent }}>{attachMsg}</span>}
          {edit && (
            <>
              <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
              <input ref={stmtRef} type="file" accept="application/pdf" multiple className="hidden" onChange={onStatementsPick} />
              <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
              <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Pacing PDF
              </button>
              <button onClick={() => stmtRef.current && stmtRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'statements' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Statements
              </button>
              <button onClick={openPicker} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={picker ? { background: t.ink, color: t.bg } : { background: t.card, border: '1px solid ' + t.toolbarBorder }}>
                {busy === 'hero' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} Hero photo
              </button>
            </>
          )}
          <button onClick={downloadPptx} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {busy === 'pptx' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} PPTX
          </button>
          <button onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            {copied ? <Check size={12} /> : <LinkIcon size={12} />} {copied ? 'Copied' : 'Copy share link'}
          </button>
          {edit && (
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: t.accent, color: t.card }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {savedFlash ? 'Saved ✓' : 'Save changes'}
            </button>
          )}
          <button onClick={() => setEdit(!edit)} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={edit ? { background: t.ink, color: t.bg } : { background: t.card, border: '1px solid ' + t.toolbarBorder }}>
            <Pencil size={12} /> {edit ? 'Done editing' : 'Edit report'}
          </button>
        </div>
      )}

      {/* hero photo picker: pick from the scoped listings' Guesty photos, or upload */}
      {canEdit && edit && picker && (
        <div className="px-4 py-3 border-b" style={{ background: t.trackBg, borderColor: t.rule }}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>HERO PHOTO  ·  FROM THE LISTING</p>
            <button onClick={() => heroRef.current && heroRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder }}>
              <Plus size={11} /> Upload instead
            </button>
            {hero.heroImage && (
              <button onClick={() => patch('hero.heroImage', null)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.card, border: '1px solid ' + t.toolbarBorder, color: t.accent }}>
                <X size={11} /> Remove current
              </button>
            )}
            <button onClick={() => setPicker(false)} className="ml-auto" style={{ color: t.muted }}><X size={14} /></button>
          </div>
          {pool === null ? (
            <p className="mt-2 text-[12px] italic" style={{ color: t.muted }}>Loading listing photos&hellip;</p>
          ) : pool.length ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pool.map((p, i) => (
                <button key={i} onClick={() => { patch('hero.heroImage', p.url); setPicker(false) }} className="shrink-0 rounded-lg overflow-hidden border-2" style={{ borderColor: hero.heroImage === p.url ? t.accent : t.cardBorder }} title={p.listing}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" loading="lazy" className="h-20 w-28 object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12px] italic" style={{ color: t.muted }}>No listing photos found for this report&rsquo;s properties &mdash; use Upload instead.</p>
          )}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-5 sm:px-8 pb-20">

        {/* ---------- HERO ---------- */}
        <header className="pt-14 pb-12 text-center border-b" style={{ borderColor: t.rule }}>
          <Eyebrow>{hero.eyebrow || ''}</Eyebrow>
          <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: t.gold }}>
            <Ed v={hero.dateLabel || 'OWNER REVIEW'} set={v => patch('hero.dateLabel', v)} edit={edit} />
          </p>
          <h1 className="mt-2 text-5xl sm:text-6xl font-black tracking-tight" style={{ color: t.ink }}>
            <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
          </h1>
          <p className="mt-5 text-lg sm:text-xl font-medium max-w-2xl mx-auto" style={{ color: t.body }}>
            <Ed v={hero.headline || ''} set={v => patch('hero.headline', v)} edit={edit} multiline />
          </p>
          {hero.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.heroImage} alt="" className="mt-8 w-full rounded-2xl shadow-md object-cover" style={{ maxHeight: 420 }} />
          )}
          <p className="mt-8 text-[12px] uppercase tracking-[0.18em] font-semibold" style={{ color: t.footA }}>
            <Ed v={hero.preparedFor || ''} set={v => patch('hero.preparedFor', v)} edit={edit} />  ·  STAY HOSPITALITY
          </p>
        </header>

        {/* ---------- SNAPSHOT ---------- */}
        <SectionShell id="snapshot" title="Snapshot" hidden={isHidden('snapshot')} edit={edit} onToggle={() => toggleSection('snapshot')}>
          <div className="pt-12">
            <Eyebrow>SNAPSHOT</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={snap.headline || ''} set={v => patch('snapshot.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={snap.subtitle || ''} set={v => patch('snapshot.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(snap.cards || []).map((card: Any, i: number) => (
                <div key={card.key || i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.snapshot.cards.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.accent }}>
                    <Ed v={card.label || ''} set={v => patch('snapshot.cards.' + i + '.label', v)} edit={edit} />
                  </p>
                  <p className="mt-2 text-4xl font-black tabular-nums" style={{ color: t.ink }}>
                    <Ed v={card.value || ''} set={v => patch('snapshot.cards.' + i + '.value', v)} edit={edit} />
                  </p>
                  <p className="mt-2 text-[11px] leading-snug" style={{ color: t.sub }}>
                    <Ed v={card.sub || ''} set={v => patch('snapshot.cards.' + i + '.sub', v)} edit={edit} multiline />
                  </p>
                </div>
              ))}
            </div>
            {snap.ytd && (
              <div className="mt-5 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-5" style={{ background: t.band, color: 'white' }}>
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>{meta.asOf ? String(meta.asOf).slice(0, 4) : ''} YEAR-TO-DATE</p>
                  <p className="mt-1.5 text-sm text-white/85">
                    <Ed v={snap.ytd.text || ''} set={v => patch('snapshot.ytd.text', v)} edit={edit} multiline />
                  </p>
                </div>
                <div className="flex gap-6">
                  {(snap.ytd.stats || []).map((s: Any, i: number) => (
                    <div key={i} className="text-center">
                      <p className="text-2xl font-black tabular-nums"><Ed v={s.value || ''} set={v => patch('snapshot.ytd.stats.' + i + '.value', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/60 font-semibold mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- PACING (only when data exists) ---------- */}
        {c.pacing && (
          <SectionShell id="pacing" title="Pacing" hidden={isHidden('pacing')} edit={edit} onToggle={() => toggleSection('pacing')}>
            <div className="pt-12">
              <Eyebrow>PACING VS. MARKET</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={c.pacing.headline || ''} set={v => patch('pacing.headline', v)} edit={edit} multiline />
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
                <Ed v={c.pacing.subtitle || ''} set={v => patch('pacing.subtitle', v)} edit={edit} />
              </p>
              <div className="mt-6 space-y-4">
                {(c.pacing.rows || []).map((r: Any, i: number) => (
                  <div key={i} className="relative rounded-2xl p-5 shadow-sm border flex items-center gap-4" style={{ background: t.card, borderColor: t.cardBorder }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.pacing.rows.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <div className="w-28 text-sm font-bold">{r.metric}</div>
                    <div className="flex-1 grid grid-cols-2 gap-3 text-center">
                      <div>
                        <p className="text-2xl font-black tabular-nums" style={{ color: t.ink }}><Ed v={r.ours || ''} set={v => patch('pacing.rows.' + i + '.ours', v)} edit={edit} /></p>
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.accent }}>{meta.scopeLabel || 'Us'}</p>
                      </div>
                      <div>
                        <p className="text-2xl font-black tabular-nums" style={{ color: t.muted }}><Ed v={r.comps || ''} set={v => patch('pacing.rows.' + i + '.comps', v)} edit={edit} /></p>
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>Comp set</p>
                      </div>
                    </div>
                    <div className="w-24 text-right">
                      <p className="text-lg font-black" style={{ color: (String(r.delta || '').trim().indexOf('-') === 0 || String(r.delta || '').trim().indexOf('−') === 0) ? t.downGray : t.good }}><Ed v={r.delta || ''} set={v => patch('pacing.rows.' + i + '.delta', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: t.muted }}>vs. comps</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- PERFORMANCE VS PLAN ---------- */}
        {plan && (
          <SectionShell id="plan" title="Plan" hidden={isHidden('plan')} edit={edit} onToggle={() => toggleSection('plan')}>
            <div className="pt-12">
              <Eyebrow>PERFORMANCE VS. PLAN</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={plan.headline || ''} set={v => patch('plan.headline', v)} edit={edit} multiline />
              </h2>
              <div className="mt-6 space-y-4">
                {(plan.months || []).map((m: Any, mi: number) => (
                  <div key={mi} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.plan.months.splice(mi, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-black tracking-[0.14em]">{m.label}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={m.status === 'IN MONTH' ? { background: t.statusHotBg, color: t.statusHotInk } : { background: t.statusColdBg, color: t.statusColdInk }}>
                        <Ed v={m.status || ''} set={v => patch('plan.months.' + mi + '.status', v)} edit={edit} />
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(m.rows || []).map((r: Any, ri: number) => (
                        <div key={ri} className="rounded-xl px-3 py-2.5" style={{ background: t.chip }}>
                          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: t.muted }}>{r.metric}</p>
                          <p className="text-xl font-black tabular-nums mt-0.5"><Ed v={r.actual || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.actual', v)} edit={edit} /></p>
                          <p className="text-[11px]" style={{ color: t.muted }}><Ed v={r.budget || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.budget', v)} edit={edit} /></p>
                          <p className="text-[12px] font-bold mt-0.5" style={{ color: r.good ? t.good : t.downGray }}>
                            <Ed v={r.delta || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.delta', v)} edit={edit} />
                          </p>
                        </div>
                      ))}
                    </div>
                    {(m.note || edit) && (
                      <p className="mt-3 text-[13px]" style={{ color: t.body }}>
                        <Ed v={m.note || ''} set={v => patch('plan.months.' + mi + '.note', v)} edit={edit} multiline placeholder="One-line commentary…" />
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- OWNER STATEMENT (P3 — renders when present) ---------- */}
        {c.statement && (
          <SectionShell id="statement" title="Statement" hidden={isHidden('statement')} edit={edit} onToggle={() => toggleSection('statement')}>
            <div className="pt-12">
              <Eyebrow>OWNER STATEMENT</Eyebrow>
              <div className="mt-4 space-y-3">
                {(c.statement.items || []).map((it: Any, i: number) => (
                  <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.statement.items.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                    )}
                    <p className="text-sm font-bold"><Ed v={it.title || ''} set={v => patch('statement.items.' + i + '.title', v)} edit={edit} /></p>
                    <p className="text-[13px] mt-1" style={{ color: t.body }}><Ed v={it.summary || ''} set={v => patch('statement.items.' + i + '.summary', v)} edit={edit} multiline /></p>
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- LOOKING AHEAD ---------- */}
        <SectionShell id="ahead" title="Looking Ahead" hidden={isHidden('ahead')} edit={edit} onToggle={() => toggleSection('ahead')}>
          <div className="pt-12">
            <Eyebrow>LOOKING AHEAD</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={ahead.headline || ''} set={v => patch('ahead.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={ahead.subtitle || ''} set={v => patch('ahead.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              {(ahead.months || []).map((m: Any, i: number) => (
                <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.ahead.months.splice(i, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-black tracking-[0.14em]"><Ed v={m.label || ''} set={v => patch('ahead.months.' + i + '.label', v)} edit={edit} /></span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ background: t.statusHotBg, color: t.statusHotInk }}>{m.status}</span>
                  </div>
                  <p className="mt-3 text-4xl font-black tabular-nums">
                    {edit ? <Ed v={String(m.occPct ?? 0)} set={v => patch('ahead.months.' + i + '.occPct', Number(v) || 0)} edit /> : (m.occPct ?? 0)}%
                    <span className="text-sm font-semibold ml-2" style={{ color: t.muted }}>on the books</span>
                  </p>
                  <p className="mt-1.5 text-[13px] font-semibold" style={{ color: t.body }}>
                    ADR <Ed v={m.adr || ''} set={v => patch('ahead.months.' + i + '.adr', v)} edit={edit} />   ·   RevPAR <Ed v={m.revpar || ''} set={v => patch('ahead.months.' + i + '.revpar', v)} edit={edit} />
                  </p>
                  {(m.note || edit) && (
                    <p className="mt-3 text-[13px]" style={{ color: t.sub }}>
                      <Ed v={m.note || ''} set={v => patch('ahead.months.' + i + '.note', v)} edit={edit} multiline placeholder="Commentary…" />
                    </p>
                  )}
                </div>
              ))}
            </div>
            {Array.isArray(ahead.strip) && ahead.strip.length > 0 && (
              <div className="mt-6 rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-4" style={{ color: t.muted }}>MONTHS AHEAD  ·  OCCUPANCY %</p>
                <div className="flex items-end gap-3 h-36">
                  {ahead.strip.map((s: Any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-[12px] font-black tabular-nums mb-1">{s.occPct}%</span>
                      <div className="w-full rounded-t-md" style={{ height: Math.max(4, (Number(s.occPct) || 0)) + '%', background: i === 1 ? t.barB : t.barA, opacity: i === 0 ? 0.35 : 1 }} />
                      <span className="text-[11px] font-semibold mt-1.5" style={{ color: t.sub }}>{s.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- GUEST VOICES ---------- */}
        <SectionShell id="voices" title="Guest Voices" hidden={isHidden('voices')} edit={edit} onToggle={() => toggleSection('voices')}>
          <div className="pt-12">
            <Eyebrow>GUEST VOICES</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={voices.headline || ''} set={v => patch('voices.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={voices.subtitle || ''} set={v => patch('voices.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              {(voices.quotes || []).map((q: Any, i: number) => (
                <div key={i} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.voices.quotes.splice(i, 1))} className="absolute top-2 right-2 rounded-full p-1 hover:bg-red-50" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <span className="text-4xl leading-none font-serif" style={{ color: t.gold }}>“</span>
                  <p className="mt-1 text-[14px] leading-relaxed" style={{ color: t.body }}>
                    <Ed v={q.text || ''} set={v => patch('voices.quotes.' + i + '.text', v)} edit={edit} multiline />
                  </p>
                  <p className="mt-3 text-[11px] font-bold tracking-[0.14em]" style={{ color: t.ink }}>
                    <Ed v={q.guest || ''} set={v => patch('voices.quotes.' + i + '.guest', v)} edit={edit} />
                    <span className="font-semibold ml-2" style={{ color: t.muted }}>
                      <Ed v={q.unit || ''} set={v => patch('voices.quotes.' + i + '.unit', v)} edit={edit} /> · <Ed v={q.br || ''} set={v => patch('voices.quotes.' + i + '.br', v)} edit={edit} />
                    </span>
                  </p>
                </div>
              ))}
            </div>
            {edit && (
              <button onClick={() => mutate(d => { d.voices.quotes = d.voices.quotes || []; d.voices.quotes.push({ text: '', guest: 'GUEST', unit: '', br: '' }) })} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.accent }}><Plus size={12} /> Add quote</button>
            )}

            <div className="mt-8 rounded-2xl p-6" style={{ background: t.band, color: 'white' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>WHAT WE&rsquo;RE HEARING  ·  AND WHAT WE&rsquo;RE DOING</p>
              <div className="mt-4 space-y-4">
                {(voices.themes || []).map((t: Any, i: number) => (
                  <div key={i} className="relative border-l-2 pl-4" style={{ borderColor: t.accent }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.voices.themes.splice(i, 1))} className="absolute top-0 right-0 rounded-full p-1 text-white/50 hover:text-white"><X size={13} /></button>
                    )}
                    <p className="text-sm font-bold"><Ed v={t.title || ''} set={v => patch('voices.themes.' + i + '.title', v)} edit={edit} /></p>
                    <p className="text-[13px] text-white/75 mt-0.5"><Ed v={t.body || ''} set={v => patch('voices.themes.' + i + '.body', v)} edit={edit} multiline /></p>
                    <p className="text-[13px] mt-0.5" style={{ color: t.gold }}><Ed v={t.action || ''} set={v => patch('voices.themes.' + i + '.action', v)} edit={edit} multiline /></p>
                  </div>
                ))}
              </div>
              {edit && (
                <button onClick={() => mutate(d => { d.voices.themes = d.voices.themes || []; d.voices.themes.push({ title: 'New theme', body: '', action: '' }) })} className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.gold }}><Plus size={12} /> Add theme</button>
              )}
            </div>
          </div>
        </SectionShell>

        {/* ---------- PROJECTS ---------- */}
        <SectionShell id="projects" title="Projects" hidden={isHidden('projects')} edit={edit} onToggle={() => toggleSection('projects')}>
          <div className="pt-12">
            <Eyebrow>PROJECTS</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={projects.headline || ''} set={v => patch('projects.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: t.sub }}>
              <Ed v={projects.subtitle || ''} set={v => patch('projects.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid md:grid-cols-3 gap-4">
              {(projects.weeks || []).map((w: Any, wi: number) => (
                <div key={wi} className="relative rounded-2xl p-5 shadow-sm border" style={{ background: t.card, borderColor: t.cardBorder }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.projects.weeks.splice(wi, 1))} className="absolute top-2 right-2" style={{ color: t.accent }}><X size={13} /></button>
                  )}
                  <p className="text-[11px] font-black tracking-[0.16em] pb-2 border-b" style={{ color: t.accent, borderColor: t.rule }}>
                    <Ed v={w.label || ''} set={v => patch('projects.weeks.' + wi + '.label', v)} edit={edit} />
                  </p>
                  {(w.groups || []).map((g: Any, gi: number) => (
                    <div key={gi} className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: t.muted }}>
                        <Ed v={g.category || ''} set={v => patch('projects.weeks.' + wi + '.groups.' + gi + '.category', v)} edit={edit} />
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {(g.items || []).map((it: string, ii: number) => (
                          <li key={ii} className="relative text-[12.5px] leading-snug pl-3" style={{ color: t.body }}>
                            <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: t.gold }} />
                            <Ed v={it} set={v => patch('projects.weeks.' + wi + '.groups.' + gi + '.items.' + ii, v)} edit={edit} multiline />
                            {edit && (
                              <button onClick={() => mutate(d => d.projects.weeks[wi].groups[gi].items.splice(ii, 1))} className="absolute -left-4 top-0.5" style={{ color: t.accent }}><X size={11} /></button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {edit && (
                        <button onClick={() => mutate(d => d.projects.weeks[wi].groups[gi].items.push(''))} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.accent }}><Plus size={11} /> Add item</button>
                      )}
                    </div>
                  ))}
                  {edit && (
                    <button onClick={() => mutate(d => d.projects.weeks[wi].groups.push({ category: 'NEW GROUP', items: [''] }))} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.muted }}><Plus size={11} /> Add group</button>
                  )}
                </div>
              ))}
            </div>

            {(Array.isArray(projects.tracking) && projects.tracking.length > 0) || edit ? (
              <div className="mt-6 rounded-2xl p-5 border-2 border-dashed" style={{ borderColor: t.gold, background: t.trackBg }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.gold }}>IN PROGRESS  ·  ITEMS WE&rsquo;RE TRACKING</p>
                <div className="mt-3 grid sm:grid-cols-2 gap-4">
                  {(projects.tracking || []).map((t: Any, i: number) => (
                    <div key={i} className="relative">
                      {edit && (
                        <button onClick={() => mutate(d => d.projects.tracking.splice(i, 1))} className="absolute top-0 right-0" style={{ color: t.accent }}><X size={13} /></button>
                      )}
                      <p className="text-sm font-bold"><Ed v={t.title || ''} set={v => patch('projects.tracking.' + i + '.title', v)} edit={edit} /></p>
                      <p className="text-[12.5px] mt-0.5" style={{ color: t.body }}><Ed v={t.body || ''} set={v => patch('projects.tracking.' + i + '.body', v)} edit={edit} multiline /></p>
                    </div>
                  ))}
                </div>
                {edit && (
                  <button onClick={() => mutate(d => { d.projects.tracking = d.projects.tracking || []; d.projects.tracking.push({ title: 'New item', body: '' }) })} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.gold }}><Plus size={12} /> Add tracked item</button>
                )}
              </div>
            ) : null}
          </div>
        </SectionShell>

        {/* footer */}
        <footer className="mt-16 pt-6 border-t text-center" style={{ borderColor: t.rule }}>
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: t.footA }}>{footer}</p>
          <p className="text-[10px] mt-1" style={{ color: t.footB }}>Prepared by Stay Hospitality</p>
        </footer>
      </div>
    </div>
  )
}
