// ONE LOOK FOR EVERY EMAIL STAY SENDS FROM OWNER ONBOARDING (Jon, 2026-11-13: "the emails that get sent are so
// bad, we need to make it more professional"). A single branded layout: logo, a short eyebrow and headline, the
// message, one clear button, a tidy details table, a proper signature and a quiet footer. Built the way email
// has to be built (tables, inline styles, web-safe fonts) so it holds up in Gmail, Outlook and Apple Mail, on a
// phone and in dark mode. Isomorphic (no secrets), so it can be previewed in the browser.

export type EmailPerson = { name: string; role?: string; phone?: string; email?: string }
export type StayEmail = {
  origin: string                         // for the logo
  preheader?: string                     // the grey preview line in the inbox
  eyebrow?: string
  heading: string
  /** Paragraphs, already safe HTML (use escHtml on anything a person typed). */
  paragraphs: string[]
  /** A short list after the paragraphs (safe HTML items); numbered when `ordered`. */
  list?: string[]; ordered?: boolean
  /** Paragraphs between the list and the button (safe HTML). */
  lead?: string[]
  cta?: { label: string; url: string }
  /** Small print under the button (e.g. how long the link works). */
  ctaNote?: string
  details?: { title?: string; rows: [string, string][] }
  /** A full-width table (already safe HTML cells): the linen quantities. */
  table?: { head: string[]; rows: string[][]; alignRight?: number[] }
  note?: string                          // a tinted box, safe HTML
  after?: string[]                       // paragraphs after the details/table
  sign?: EmailPerson
  footer?: string
}
export const escHtml = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const INK = '#14161B', BODY = '#3A3B40', MUT = '#7A7B80', RULE = '#E7E2D8', GOLD = '#8C6D3A', PAPER = '#F4F1EA'
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif", SERIF = "Georgia,'Times New Roman',serif"
const p = (html: string) => `<p style="margin:0 0 16px;font:400 15px/1.65 ${SANS};color:${BODY}">${html}</p>`

export function stayEmail(e: StayEmail): string {
  const logo = e.origin.replace(/\/$/, '') + '/stay-logo.png'
  const cap = `font:600 10.5px/1.3 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${MUT}`
  const details = e.details && e.details.rows.filter(([, v]) => v).length ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;border-top:1px solid ${RULE}">
${e.details.title ? `<tr><td colspan="2" style="padding:14px 0 6px;${cap};color:${GOLD}">${escHtml(e.details.title)}</td></tr>` : ''}
${e.details.rows.filter(([, v]) => v).map(([k, v]) => `<tr><td width="34%" valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};${cap}">${escHtml(k)}</td><td valign="top" style="padding:10px 0;border-bottom:1px solid ${RULE};font:400 14.5px/1.5 ${SANS};color:${INK}">${escHtml(v)}</td></tr>`).join('\n')}
</table>` : ''
  const right = new Set(e.table?.alignRight || [])
  const table = e.table && e.table.rows.length ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;border-collapse:collapse">
<tr>${e.table.head.map((h, i) => `<th align="${right.has(i) ? 'right' : 'left'}" style="padding:9px 10px;background:${PAPER};${cap};border-bottom:1px solid ${RULE}">${h}</th>`).join('')}</tr>
${e.table.rows.map(r => `<tr>${r.map((c, i) => `<td align="${right.has(i) ? 'right' : 'left'}" style="padding:9px 10px;border-bottom:1px solid ${RULE};font:${i === r.length - 1 && right.has(i) ? '600' : '400'} 14px/1.4 ${SANS};color:${INK}">${c}</td>`).join('')}</tr>`).join('\n')}
</table>` : ''
  const cta = e.cta ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 ${e.ctaNote ? 10 : 24}px"><tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK}"><a href="${escHtml(e.cta.url)}" style="display:inline-block;padding:14px 30px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;border-radius:999px">${escHtml(e.cta.label)}</a></td></tr></table>
${e.ctaNote ? `<p style="margin:0 0 24px;font:400 12.5px/1.55 ${SANS};color:${MUT}">${e.ctaNote}</p>` : ''}` : ''
  const s = e.sign
  const sign = s ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0;border-top:1px solid ${RULE};width:100%"><tr><td style="padding-top:18px">
<p style="margin:0;font:600 15px/1.4 ${SANS};color:${INK}">${escHtml(s.name)}</p>
<p style="margin:2px 0 0;font:400 13.5px/1.5 ${SANS};color:${MUT}">${escHtml([s.role, 'Stay Hospitality'].filter(Boolean).join(' · '))}</p>
${s.phone || s.email ? `<p style="margin:2px 0 0;font:400 13.5px/1.5 ${SANS};color:${MUT}">${[s.phone ? escHtml(s.phone) : '', s.email ? `<a href="mailto:${escHtml(s.email)}" style="color:${MUT};text-decoration:underline">${escHtml(s.email)}</a>` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ')}</p>` : ''}
</td></tr></table>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escHtml(e.heading)}</title></head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER};font-size:1px;line-height:1px">${escHtml(e.preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 14px 36px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td style="padding:4px 6px 20px"><img src="${escHtml(logo)}" alt="Stay Hospitality" height="30" style="display:block;height:30px;width:auto;border:0"></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${RULE};border-radius:16px;padding:36px 34px 32px">
${e.eyebrow ? `<p style="margin:0 0 10px;font:600 11px/1.3 ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${GOLD}">${escHtml(e.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 18px;font:400 27px/1.2 ${SERIF};color:${INK}">${escHtml(e.heading)}</h1>
${e.paragraphs.map(p).join('\n')}
${e.list?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${e.list.map((x, i) => `<tr><td width="26" valign="top" style="padding:4px 0;font:600 14px/1.6 ${SANS};color:${GOLD}">${e.ordered ? i + 1 + '.' : '&bull;'}</td><td valign="top" style="padding:4px 0;font:400 15px/1.6 ${SANS};color:${BODY}">${x}</td></tr>`).join('')}</table>` : ''}
${(e.lead || []).map(p).join('\n')}
${cta}${details}${table}
${e.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:${PAPER};border-radius:12px;padding:14px 16px;font:400 13.5px/1.6 ${SANS};color:${BODY}">${e.note}</td></tr></table>` : ''}
${(e.after || []).map(p).join('\n')}
${sign}
</td></tr>
<tr><td style="padding:18px 8px 0;font:400 12px/1.6 ${SANS};color:${MUT};text-align:center">${escHtml(e.footer || 'Stay Hospitality · Vacation rental management across Miami-Dade and Broward')}</td></tr>
</table></td></tr></table></body></html>`
}
