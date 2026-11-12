'use client'
// SHARE ANY VERSION OF A DECK (Jon, 2026-11-12: "the share is not editable, does not let them select
// one pager, keynote etc."). Pick what to send: the digital magazine, the print version, the one-pager,
// the keynote, or one of the free calculators credited to this deck. The link and the message are
// written for that choice, and the message and the email subject are the sender's to edit before
// copying, texting or emailing.
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

type Any = any
export type ShareWhat = 'digital' | 'print' | 'onepage' | 'keynote' | 'tool-income' | 'tool-inventory'

export function DeckShare({ code, building, prospect, presenter, dek, onePager = true, onClose }: { code: string; building: string; prospect?: string; presenter?: string; dek?: string; onePager?: boolean; onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const deck = origin + '/r/' + code
  const OPTS: { k: ShareWhat; label: string; hint: string; url: string; noun: string }[] = [
    { k: 'digital', label: 'Digital magazine', hint: 'Best for an owner on a phone or laptop: just the magazine, nothing else', url: origin + '/m/' + code, noun: 'our digital magazine' },
    { k: 'print', label: 'Print version', hint: 'The full magazine, ready to print or save as a PDF', url: deck + '?view=magazine', noun: 'the full magazine (print it or save it as a PDF)' },
    ...(onePager ? [{ k: 'onepage' as ShareWhat, label: 'One-pager', hint: 'Every unit type on a single page', url: deck + '?view=onepage', noun: 'a one-page summary' }] : []),
    { k: 'keynote', label: 'Keynote', hint: 'The presentation slides', url: deck, noun: 'the presentation' },
    { k: 'tool-income', label: 'Projections calculator', hint: 'Free tool, credited to this deck', url: origin + '/tools/income?d=' + code, noun: 'a free calculator for what a home could earn' },
    { k: 'tool-inventory', label: 'Rental supply calculator', hint: 'Free tool, supplies and linen, credited to this deck', url: origin + '/tools/inventory?d=' + code, noun: 'a free checklist of everything a rental needs, linen included' },
  ]
  const [what, setWhat] = useState<ShareWhat>('digital')
  const opt = OPTS.find(o => o.k === what) || OPTS[0]
  const place = building || 'Stay Hospitality'
  const first = String(prospect || '').trim().split(/\s+/)[0]
  const draft = useMemo(() => {
    const hi = first && !/team|owners?|agents?|clients?/i.test(prospect || '') ? 'Hi ' + first + ',' : 'Hi,'
    const body = what.startsWith('tool-')
      ? `Here is ${opt.noun}, free for any owner, whether or not you work with us.`
      : `Here is ${opt.noun} for ${place}.` + (dek && (what === 'digital' || what === 'print') ? ' ' + dek.replace(/\*/g, '') : '')
    return `${hi}\n\n${body}\n\n${opt.url}\n\n${presenter ? presenter + '\n' : ''}Stay Hospitality`
  }, [what, first, prospect, opt.noun, opt.url, place, dek, presenter])
  const [msg, setMsg] = useState(draft)
  const [subject, setSubject] = useState('')
  const [edited, setEdited] = useState(false)
  const [done, setDone] = useState('')
  // A new choice rewrites the message unless the sender has already edited it; then only the link swaps.
  useEffect(() => {
    if (!edited) setMsg(draft)
    else setMsg(m => { const old = OPTS.map(o => o.url).find(u => m.includes(u)); return old ? m.replace(old, opt.url) : m + '\n\n' + opt.url })
    setSubject(place + ' · ' + opt.label + ' · Stay Hospitality')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what])
  useEffect(() => { if (!edited) setMsg(draft) }, [draft, edited])
  const flash = (x: string) => { setDone(x); setTimeout(() => setDone(''), 1600) }
  const copy = async (text: string, x: string) => { try { await navigator.clipboard.writeText(text); flash(x) } catch { flash('Select and copy it from the box') } }
  const canShare = typeof navigator !== 'undefined' && !!(navigator as Any).share
  return (
    <div className="ds" role="dialog" aria-label="Share">
      <style>{DS_CSS}</style>
      <header><b>Share</b><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <p className="ds-h">What to send</p>
      <div className="ds-opts">
        {OPTS.map(o => (
          <button key={o.k} type="button" className={what === o.k ? 'on' : ''} onClick={() => setWhat(o.k)}>
            <span>{o.label}</span><small>{o.hint}</small>
          </button>
        ))}
      </div>
      <p className="ds-h">Link</p>
      <div className="ds-link"><input readOnly value={opt.url} onFocus={e => e.target.select()} /><button type="button" onClick={() => copy(opt.url, 'Link copied')}>Copy</button><a href={opt.url} target="_blank" rel="noreferrer">Open</a></div>
      <p className="ds-h">Message <em>edit it before you send</em></p>
      <input className="ds-subj" value={subject} onChange={e => setSubject(e.target.value)} aria-label="Email subject" />
      <textarea value={msg} rows={7} onChange={e => { setMsg(e.target.value); setEdited(true) }} />
      {edited ? <button type="button" className="ds-reset" onClick={() => { setEdited(false); setMsg(draft) }}>Reset the message</button> : null}
      <div className="ds-acts">
        <button type="button" className="pri" onClick={() => copy(msg, 'Message copied')}>Copy message</button>
        <a href={'sms:?&body=' + encodeURIComponent(msg)}>Text</a>
        <a href={'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(msg)}>Email</a>
        {canShare ? <button type="button" onClick={() => (navigator as Any).share({ title: subject, text: msg.replace(opt.url, '').trim(), url: opt.url }).catch(() => {})}>More…</button> : null}
      </div>
      {done ? <p className="ds-done">{done}</p> : <p className="ds-fine">Opens without a sign-in. In a text or an email, the link shows the building’s photo and name.</p>}
    </div>
  )
}

const DS_CSS = `
.ds{position:absolute;right:0;top:calc(100% + 10px);width:380px;max-height:calc(100vh - 90px);overflow-y:auto;background:#fff;color:#1C1A17;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:14px 16px 16px;z-index:60;font:400 12.5px "Inter",system-ui,sans-serif;text-align:left}
.ds header{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.ds header b{font:600 15px "Inter",sans-serif}
.ds header button{border:0;background:#F3F2EF;border-radius:99px;width:28px;height:28px;display:grid;place-items:center;cursor:pointer;color:#1C1A17;padding:0}
.ds-h{margin:12px 0 6px;font:600 10px "Inter",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#7A7164}
.ds-h em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:400;margin-left:4px}
.ds-opts{display:grid;gap:4px}
.ds-opts button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;border:1px solid #E3DED3;background:#fff;border-radius:10px;padding:7px 10px;cursor:pointer;color:#1C1A17}
.ds-opts button span{font:600 12.5px "Inter",sans-serif}
.ds-opts button small{font:400 11px "Inter",sans-serif;color:#7A7164}
.ds-opts button.on{border-color:#1C1A17;box-shadow:inset 0 0 0 1px #1C1A17;background:#FAF9F6}
.ds-link{display:flex;gap:6px}
.ds-link input,.ds-subj,.ds textarea{width:100%;min-width:0;box-sizing:border-box;font:500 12px "Inter",sans-serif;border:1px solid #E3DED3;border-radius:8px;padding:7px 9px;color:#1C1A17;background:#F7F7F5}
.ds-subj{margin-bottom:6px;background:#fff}
.ds textarea{background:#fff;line-height:1.45;resize:vertical;font-weight:400}
.ds-link button,.ds-link a,.ds-acts button,.ds-acts a{flex:none;font:600 12px "Inter",sans-serif;border:1px solid #E3DED3;border-radius:999px;padding:6px 12px;background:#fff;color:#1C1A17;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center}
.ds-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.ds-acts .pri{background:#1C1A17;color:#fff;border-color:#1C1A17}
.ds-reset{border:0;background:none;color:#7A7164;font:500 11.5px "Inter",sans-serif;padding:4px 0;cursor:pointer;text-decoration:underline}
.ds-done{margin:8px 0 0;color:#2F6B47;font-weight:600}
.ds-fine{margin:8px 0 0;color:#7A7164;line-height:1.4}
@media (max-width:760px){.ds{position:fixed;left:0;right:0;top:auto;bottom:0;width:auto;max-height:86svh;border-radius:18px 18px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}}
`
