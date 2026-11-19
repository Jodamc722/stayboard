// THE MORNING KIT (Jon, 2026-10-01: "short and compact, with the priorities … rebrand … super
// noisy"). One visual system for every brief Lighthouse sends: a masthead that names the brief and
// its reader, a one-line headline, then sections built from LINES — never cards inside cards, never
// a table where a sentence will do. Email-safe: inline styles, tables for layout, one accent per
// brief, status colours reserved (red = do now, amber = watch, green = fine) and always with a word.
//
// Every brief is measured before it sends. `fit()` drops the optional sections, last first, until
// the HTML is under the budget — the phone screen and Gmail's clip line (~102 KB) are both hard
// limits and a brief that runs past either is a brief nobody reads to the end.
import 'server-only'

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app'

export function esc(s: any): string { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// THE LOOK (Jon, 2026-11-19: "revamp the look and design"). One white sheet on a warm page, the Stay
// black masthead with the brief's name in serif, gold small-cap section labels, hairlines instead of
// boxes inside boxes. Status is a thin coloured rule at the left of a line and a plain word, never a
// filled pill. Every brief shares it, so the accents are one palette now and the brief is told apart
// by its name.
export type Accent = { bar: string; soft: string; ink: string }
const INK = '#101114', GOLD = '#8C6D3A', LINK = '#6F5527', RULE = '#E7E4DD', SOFT = '#FAF8F4', MUTED = '#6B6C72', FAINT = '#9A9BA0'
const RED = '#B42318', AMBER = '#B26A00', GREEN = '#1F7A4D'
const ONE: Accent = { bar: GOLD, soft: SOFT, ink: LINK }
export const ACCENTS: Record<string, Accent> = { field: ONE, ops: ONE, maint: ONE, labor: ONE, gm: ONE }

const F = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
const SERIF = "Georgia,'Times New Roman',serif"
export const T = {
  body: `margin:0;padding:0;background:#F4F2EE;font-family:${F};color:${INK}`,
  wrap: 'max-width:600px;margin:0 auto;padding:16px 10px 28px',
  red: `color:${RED};font-weight:700`, amber: `color:${AMBER};font-weight:700`, green: `color:${GREEN};font-weight:700`,
  muted: `color:${MUTED}`, faint: `color:${FAINT}`,
}
const PAD = '22px'
const eyebrow = (title: string, count?: number | null) => `<p style="margin:0 0 6px;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${GOLD}">${esc(title)}${count != null ? ` <span style="font-weight:400;letter-spacing:.04em;color:${FAINT}">· ${count}</span>` : ''}</p>`
const sheet = (inner: string, bg = '#fff') => `<div style="background:${bg};border-top:1px solid ${RULE};padding:18px ${PAD} 16px">${inner}</div>`

/** The masthead: the brand, the day, the brief's name and who it is for. */
export function masthead(_a: Accent, name: string, forWhom: string, day: string): string {
  return `<div style="background:${INK};padding:20px ${PAD} 20px">
    <table width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="font-size:11px;font-weight:700;letter-spacing:.34em;color:#fff">STAY <span style="font-weight:400;letter-spacing:.22em;color:#B9BAC0">HOSPITALITY</span></td>
      <td align="right" style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#B9BAC0;white-space:nowrap">${esc(day)}</td>
    </tr></table>
    <p style="margin:16px 0 0;font-family:${SERIF};font-size:30px;line-height:1.1;color:#fff">${esc(name)}</p>
    <p style="margin:6px 0 0;font-size:12px;line-height:1.4;color:#B9BAC0">${esc(forWhom)}</p>
  </div>`
}

/** The one sentence under the masthead: the day in numbers, nothing else. */
export function headline(_a: Accent, html: string, links?: { label: string; href: string }[]): string {
  return `<div style="background:${SOFT};padding:16px ${PAD} 15px">
    <p style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.5;color:${INK}">${html}</p>
    ${links && links.length ? `<p style="margin:10px 0 0;font-size:12px">${links.map(l => `<a href="${l.href}" style="color:${LINK};font-weight:600;text-decoration:none">${esc(l.label)}</a>`).join(`<span style="color:${FAINT}"> &nbsp;·&nbsp; </span>`)}</p>` : ''}
  </div>`
}

export type Line = { tone?: 'red' | 'amber' | 'green' | 'none'; html: string; sub?: string }

/** A section: a small-cap title with a count, then lines. Lines over the cap collapse into "+N more". */
export function section(title: string, lines: Line[], opts: { cap?: number; more?: string; note?: string; accent?: Accent } = {}): string {
  if (!lines.length) return ''
  return sheet(eyebrow(title, lines.length) + lineRows(lines, { cap: opts.cap, more: opts.more })
    + (opts.note ? `<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:${FAINT}">${opts.note}</p>` : ''))
}

/**
 * The lines of a section without its title — for a block that holds more than one list (the GM
 * morning's Labor block). Over the cap: "+N more {more}", where `more` carries the board link.
 */
export function lineRows(lines: Line[], opts: { cap?: number; more?: string } = {}): string {
  if (!lines.length) return ''
  const cap = opts.cap ?? 8
  const shown = lines.slice(0, cap)
  const rest = lines.length - shown.length
  const bar = (t?: Line['tone']) => t === 'red' ? RED : t === 'amber' ? AMBER : t === 'green' ? GREEN : 'transparent'
  return `<table width="100%" cellspacing="0" cellpadding="0">
      ${shown.map((l, i) => `<tr><td style="width:3px;background:${bar(l.tone)};font-size:0;line-height:0">&nbsp;</td><td style="padding:8px 0 8px 11px;font-size:13.5px;line-height:1.5;color:${INK};${i ? `border-top:1px solid #F1EFEA` : ''}">${l.html}${l.sub ? `<div style="margin-top:1px;font-size:12px;line-height:1.5;color:${MUTED}">${l.sub}</div>` : ''}</td></tr>`).join('')}
    </table>${rest > 0 ? `<p style="margin:6px 0 0;padding-left:14px;font-size:11.5px;color:${FAINT}">+${rest} more ${opts.more || 'on the board'}</p>` : ''}`
}

/** A person's block inside a run: name line, then numbered rows (the run) and bullets (the rest). */
export function person(name: string, meta: string, numbered: string[], bullets: string[], opts: { bulletCap?: number; tone?: 'red' | 'amber' | 'none' } = {}): string {
  const cap = opts.bulletCap ?? 3
  const extra = bullets.length - Math.min(bullets.length, cap)
  const head = `<p style="margin:14px 0 3px;font-size:14px;line-height:1.4"><b style="${opts.tone === 'red' ? `color:${RED}` : opts.tone === 'amber' ? `color:${AMBER}` : ''}">${esc(name)}</b> <span style="font-size:12px;color:${MUTED}">· ${meta}</span></p>`
  const rows = numbered.map((h, i) => `<tr><td style="width:20px;padding:3px 0;font-size:12px;color:${FAINT};vertical-align:top">${i + 1}</td><td style="padding:3px 0;font-size:13px;line-height:1.45">${h}</td></tr>`).join('')
    + bullets.slice(0, cap).map(h => `<tr><td style="width:20px;padding:3px 0;font-size:12px;color:#CFCBC2;vertical-align:top">–</td><td style="padding:3px 0;font-size:12.5px;line-height:1.45;color:#3A3B40">${h}</td></tr>`).join('')
    + (extra > 0 ? `<tr><td></td><td style="padding:3px 0;font-size:11.5px;color:${FAINT}">+${extra} more on the board</td></tr>` : '')
  return head + (rows ? `<table cellspacing="0" cellpadding="0" width="100%">${rows}</table>` : '')
}

/** A block of free HTML under the same small-cap title. */
export function block(title: string, inner: string, _accent?: Accent, count?: number | null): string {
  return sheet(eyebrow(title, count) + inner)
}

/** How the day runs: a time column and what to do then. Deterministic, built from the data. */
// "How the day runs", not "Shape of the day" (Jon, 2026-11-05: plain headings).
export function dayShape(_a: Accent, steps: { at: string; do: string }[], title = 'How the day runs'): string {
  if (!steps.length) return ''
  return sheet(eyebrow(title) + `<table cellspacing="0" cellpadding="0" width="100%">
      ${steps.map(s => `<tr><td style="padding:4px 14px 4px 0;font-size:12px;font-weight:700;color:${INK};white-space:nowrap;vertical-align:top;width:1%">${esc(s.at)}</td><td style="padding:4px 0;font-size:13px;line-height:1.5">${s.do}</td></tr>`).join('')}
    </table>`, SOFT)
}

/** Numbers in a row, each with a label and a short note. */
export function tiles(items: TileItem[]): string {
  return sheet(tileTable(items))
}
export type TileItem = { label: string; value: string; note?: string; tone?: 'red' | 'amber' | 'green' | 'none' }
/** The tile rows without a title — three to a row so they read on a phone. */
export function tileTable(items: TileItem[]): string {
  const per = items.length <= 4 ? Math.max(1, items.length) : 3
  const col = (t: TileItem, i: number) => `<td style="padding:10px 10px 10px ${i ? '14px' : '0'};vertical-align:top;width:${Math.floor(100 / per)}%;${i ? `border-left:1px solid ${RULE}` : ''}">
    <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">${esc(t.label)}</div>
    <div style="font-family:${SERIF};font-size:27px;line-height:1.15;margin-top:3px;color:${t.tone === 'red' ? RED : t.tone === 'amber' ? AMBER : INK}">${esc(t.value)}</div>
    ${t.note ? `<div style="font-size:11px;line-height:1.4;color:${FAINT};margin-top:2px">${esc(t.note)}</div>` : ''}
  </td>`
  const rows: string[] = []
  for (let i = 0; i < items.length; i += per) rows.push(`<tr>${items.slice(i, i + per).map(col).join('')}</tr>`)
  return `<table width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table>`
}

export function footer(text: string): string {
  return `<div style="background:${SOFT};border-top:1px solid ${RULE};padding:14px ${PAD} 16px;font-size:11px;line-height:1.6;color:${FAINT};text-align:center">${text}<br><span style="letter-spacing:.2em;text-transform:uppercase;font-size:9.5px">Lighthouse · Stay Hospitality</span></div>`
}

/** A status word in small caps. Plain coloured text, no filled pill (Jon dislikes noisy pills). */
export function pill(text: string, tone: 'red' | 'amber' | 'green' | 'blue' | 'grey' = 'grey'): string {
  const c = tone === 'red' ? RED : tone === 'amber' ? AMBER : tone === 'green' ? GREEN : tone === 'blue' ? GOLD : MUTED
  return `<span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${c}">${esc(text)}</span>`
}

/** Wrap the body. `optional` sections are dropped from the END until the budget is met. */
/**
 * THE SIZE GMAIL SEES (Eve audit 2026-10-10). Ops Command was cut to 90,000 characters and still
 * arrived at 114,759 bytes — clipped. Gmail measures the encoded message, and every "·" and "—" in
 * these briefs is two or three UTF-8 bytes that quoted-printable writes as =C2=B7 (six characters).
 * So a non-ASCII character counts for roughly seven here, which is what it costs on the wire.
 */
export function wireSize(html: string): number {
  let extra = 0
  for (let i = 0; i < html.length; i++) if (html.charCodeAt(i) > 127) extra += 7
  return html.length + extra
}

export function fit(parts: { html: string; optional?: boolean }[], budget = 60_000): { html: string; dropped: number } {
  const wrap = (inner: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="${T.body}"><div style="${T.wrap}"><div style="background:#fff;border:1px solid #E7E4DD;border-radius:14px;overflow:hidden">${inner}</div></div></body></html>`
  const live = parts.slice()
  let dropped = 0
  for (;;) {
    const html = wrap(live.map(p => p.html).join('\n'))
    if (wireSize(html) <= budget) return { html, dropped }
    let i = live.length - 1
    while (i >= 0 && !live[i].optional) i--
    if (i < 0) return { html, dropped }
    live.splice(i, 1); dropped++
  }
}

/** Task titles as the crew reads them: one language, no "Guest reported /" prefix, trimmed. */
export function cleanTitle(raw: string, lang: 'en' | 'es' = 'en'): string {
  let t = String(raw || '').trim()
  if (t.includes('||')) {
    const [a, b] = t.split('||').map(x => x.trim())
    const esLike = (x: string) => /[áéíóñ]|\b(de|la|el|limpieza|inspecci[oó]n|llegada)\b/i.test(x)
    t = lang === 'es' ? (esLike(a) ? a : b || a) : (esLike(a) ? b || a : a)
  }
  t = t.replace(/^\[moved to [^\]]+\]\s*/i, '').replace(/^(guest reported|field reported)( priority)?\s*[\/|:—-]*\s*/i, '').replace(/^(glitch|priority)\s*[-—:]\s*/i, '')
  return t.length > 64 ? t.slice(0, 61).trimEnd() + '…' : t
}

/** "with Marilay, Work Cell, +10" → the crew, not the roll call. */
export function crewOf(names: string[], lead: string): string {
  const others = names.filter(n => n !== lead)
  if (!others.length) return ''
  if (others.length <= 2) return ' · with ' + others.map(n => n.split(' ')[0]).map(esc).join(', ')
  return ' · with crew'
}

/** "shaany espinoza" → "Shaany Espinoza"; all-caps names calmed too. */
export function personName(n: string): string {
  const words = String(n || '').trim().split(/\s+/).filter(Boolean)
  // "Opal Works Opal Works" — a vendor account whose first and last name are both the company. Once.
  const half = words.length >= 2 && words.length % 2 === 0 ? words.length / 2 : 0
  const base = half && words.slice(0, half).join(' ').toLowerCase() === words.slice(half).join(' ').toLowerCase() ? words.slice(0, half) : words
  return base.map(w => (w.length > 1 && (w === w.toLowerCase() || w === w.toUpperCase()) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ')
}
/** A reservation note as a crew reads it: the last human/call line, without the Talkroute preamble. */
export function crewNote(note: string): string {
  let n = String(note || '').replace(/\s+/g, ' ').trim()
  n = n.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '')
  if (/guest call by talkroute/i.test(n) && n.includes(' — ')) n = n.slice(n.lastIndexOf(' — ') + 3)
  return n.length > 150 ? n.slice(0, 147).trimEnd() + '…' : n
}
export const isOfficeLike = (n: string) => /customer care|support team|\bccs\b|front desk|office/i.test(String(n || ''))

export function unitShort(u: string): string {
  const n = String(u || '').replace(/\s+-\s*|\s*-\s+/g, ' - ').replace(/\s+/g, ' ').trim()
  if (n.length <= 26) return n
  const parts = n.split(' - ')
  if (parts.length >= 3) return parts[0] + ' ' + parts[1] + ' · ' + parts.slice(2).join(' ').slice(0, 10)
  if (parts.length === 2) return parts[0] + ' · ' + parts[1].slice(0, 12)
  return n.slice(0, 26)
}
