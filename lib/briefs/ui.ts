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

export type Accent = { bar: string; soft: string; ink: string }
export const ACCENTS: Record<string, Accent> = {
  field: { bar: '#0891b2', soft: '#ecfeff', ink: '#155e75' },      // cyan — the run
  ops: { bar: '#4338ca', soft: '#eef2ff', ink: '#3730a3' },        // indigo — the desk
  maint: { bar: '#b45309', soft: '#fffbeb', ink: '#92400e' },      // amber — the tools
  labor: { bar: '#047857', soft: '#ecfdf5', ink: '#065f46' },      // green — the money
  gm: { bar: '#0b1220', soft: '#f3f4f6', ink: '#0b1220' },         // ink — the owner
}

const F = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
export const T = {
  body: `margin:0;padding:0;background:#f3f4f6;font-family:${F};color:#0b1220`,
  wrap: 'max-width:600px;margin:0 auto;padding:16px 12px',
  red: 'color:#b91c1c;font-weight:700', amber: 'color:#b45309;font-weight:700', green: 'color:#047857;font-weight:700',
  muted: 'color:#6b7280', faint: 'color:#9ca3af',
}

/** The masthead: brand line, the brief's name, who it is for and the day. */
export function masthead(a: Accent, name: string, forWhom: string, day: string): string {
  return `<div style="background:#0b1220;border-radius:12px 12px 0 0;padding:16px 20px 14px;border-bottom:4px solid ${a.bar}">
    <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.2em;color:#a5b4fc">LIGHTHOUSE · STAY HOSPITALITY</p>
    <p style="margin:0;font-size:20px;font-weight:700;color:#fff">${esc(name)}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8">${esc(forWhom)} · ${esc(day)}</p>
  </div>`
}

/** The one sentence under the masthead: the day in numbers, nothing else. */
export function headline(a: Accent, html: string, links?: { label: string; href: string }[]): string {
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:12px 20px 12px;margin-bottom:12px">
    <p style="margin:0;font-size:14px;line-height:1.6">${html}</p>
    ${links && links.length ? `<p style="margin:6px 0 0;font-size:12px">${links.map(l => `<a href="${l.href}" style="color:${a.ink};font-weight:600;text-decoration:none">${esc(l.label)} →</a>`).join(' &nbsp;·&nbsp; ')}</p>` : ''}
  </div>`
}

export type Line = { tone?: 'red' | 'amber' | 'green' | 'none'; html: string; sub?: string }

/** A section: an eyebrow title with a count, then lines. Lines over the cap collapse into "+N more". */
export function section(title: string, lines: Line[], opts: { cap?: number; more?: string; note?: string; accent?: Accent } = {}): string {
  if (!lines.length) return ''
  const cap = opts.cap ?? 8
  const shown = lines.slice(0, cap)
  const rest = lines.length - shown.length
  const dot = (t?: Line['tone']) => t === 'red' ? `<span style="${T.red}">●</span>` : t === 'amber' ? `<span style="${T.amber}">●</span>` : t === 'green' ? `<span style="${T.green}">●</span>` : `<span style="color:#cbd5e1">●</span>`
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden">
    <div style="padding:10px 18px 8px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${opts.accent ? opts.accent.ink : '#374151'}">${esc(title)} <span style="font-weight:400;color:#9ca3af">· ${lines.length}</span></div>
    <table width="100%" cellspacing="0" cellpadding="0" style="padding:4px 18px 10px">
      ${shown.map(l => `<tr><td style="padding:5px 0;font-size:13px;line-height:1.5;border-top:1px solid #f8fafc;vertical-align:top;width:14px">${dot(l.tone)}</td><td style="padding:5px 0 5px 6px;font-size:13px;line-height:1.5;border-top:1px solid #f8fafc">${l.html}${l.sub ? `<div style="font-size:12px;color:#6b7280">${l.sub}</div>` : ''}</td></tr>`).join('')}
    </table>
    ${rest > 0 ? `<p style="margin:0;padding:0 18px 10px;font-size:11.5px;color:#9ca3af">+${rest} more ${opts.more || 'on the board'}</p>` : ''}
    ${opts.note ? `<p style="margin:0;padding:0 18px 10px;font-size:11.5px;color:#9ca3af">${opts.note}</p>` : ''}
  </div>`
}

/** A person's block inside a run: name line, then numbered rows (the run) and bullets (the rest). */
export function person(name: string, meta: string, numbered: string[], bullets: string[], opts: { bulletCap?: number; tone?: 'red' | 'amber' | 'none' } = {}): string {
  const cap = opts.bulletCap ?? 3
  const extra = bullets.length - Math.min(bullets.length, cap)
  const head = `<p style="margin:10px 0 2px;font-size:13px"><b style="${opts.tone === 'red' ? T.red : opts.tone === 'amber' ? T.amber : ''}">${esc(name)}</b> <span style="${T.muted};font-size:12px">· ${meta}</span></p>`
  const rows = numbered.map((h, i) => `<tr><td style="width:18px;padding:2px 0;font-size:12.5px;color:#9ca3af;vertical-align:top">${i + 1}</td><td style="padding:2px 0;font-size:13px;line-height:1.45">${h}</td></tr>`).join('')
    + bullets.slice(0, cap).map(h => `<tr><td style="width:18px;padding:2px 0;font-size:12.5px;color:#cbd5e1;vertical-align:top">•</td><td style="padding:2px 0;font-size:12.5px;line-height:1.45;color:#374151">${h}</td></tr>`).join('')
    + (extra > 0 ? `<tr><td></td><td style="padding:2px 0;font-size:11.5px;color:#9ca3af">+${extra} more on the board</td></tr>` : '')
  return head + (rows ? `<table cellspacing="0" cellpadding="0" style="margin-left:4px">${rows}</table>` : '')
}

/** A block of free HTML inside the same card chrome. */
export function block(title: string, inner: string, accent?: Accent, count?: number | null): string {
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden">
    <div style="padding:10px 18px 8px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${accent ? accent.ink : '#374151'}">${esc(title)}${count != null ? ` <span style="font-weight:400;color:#9ca3af">· ${count}</span>` : ''}</div>
    <div style="padding:6px 18px 12px">${inner}</div>
  </div>`
}

/** The shape of the day: a time column and what to do then. Deterministic, built from the data. */
export function dayShape(a: Accent, steps: { at: string; do: string }[], title = 'Shape of the day'): string {
  if (!steps.length) return ''
  return `<div style="background:${a.soft};border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden">
    <div style="padding:10px 18px 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${a.ink}">${esc(title)}</div>
    <table cellspacing="0" cellpadding="0" style="padding:0 18px 12px">
      ${steps.map(s => `<tr><td style="padding:3px 10px 3px 0;font-size:12px;font-weight:700;color:${a.ink};white-space:nowrap;vertical-align:top">${esc(s.at)}</td><td style="padding:3px 0;font-size:13px;line-height:1.5">${s.do}</td></tr>`).join('')}
    </table>
  </div>`
}

/** Four numbers in a row, each with a label and a one-word verdict. */
export function tiles(items: { label: string; value: string; note?: string; tone?: 'red' | 'amber' | 'green' | 'none' }[]): string {
  const col = (t: typeof items[number]) => `<td style="padding:10px 6px;text-align:center;vertical-align:top;width:${Math.floor(100 / items.length)}%">
    <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">${esc(t.label)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:2px;${t.tone === 'red' ? 'color:#b91c1c' : t.tone === 'amber' ? 'color:#b45309' : t.tone === 'green' ? 'color:#047857' : ''}">${esc(t.value)}</div>
    ${t.note ? `<div style="font-size:10.5px;color:#9ca3af;margin-top:1px">${esc(t.note)}</div>` : ''}
  </td>`
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px"><table width="100%" cellspacing="0" cellpadding="0"><tr>${items.map(col).join('')}</tr></table></div>`
}

export function footer(text: string): string {
  return `<p style="font-size:11px;color:#9ca3af;margin:12px 4px 0;text-align:center">${text}</p>`
}

export function pill(text: string, tone: 'red' | 'amber' | 'green' | 'blue' | 'grey' = 'grey'): string {
  const c = tone === 'red' ? 'background:#fee2e2;color:#991b1b' : tone === 'amber' ? 'background:#fef3c7;color:#92400e' : tone === 'green' ? 'background:#d1fae5;color:#065f46' : tone === 'blue' ? 'background:#e0e7ff;color:#3730a3' : 'background:#f3f4f6;color:#374151'
  return `<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:999px;vertical-align:middle;${c}">${esc(text)}</span>`
}

/** Wrap the body. `optional` sections are dropped from the END until the budget is met. */
export function fit(parts: { html: string; optional?: boolean }[], budget = 60_000): { html: string; dropped: number } {
  const wrap = (inner: string) => `<!doctype html><html><body style="${T.body}"><div style="${T.wrap}">${inner}</div></body></html>`
  const live = parts.slice()
  let dropped = 0
  for (;;) {
    const html = wrap(live.map(p => p.html).join('\n'))
    if (html.length <= budget) return { html, dropped }
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
  return String(n || '').trim().split(/\s+/).map(w => (w.length > 1 && (w === w.toLowerCase() || w === w.toUpperCase()) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ')
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
