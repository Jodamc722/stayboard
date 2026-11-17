'use client'
// ONE WAY TO FLIP BETWEEN A DECK'S PRESENTATIONS (Jon, 2026-11-17: "change the way we can flip
// between presentations"). A sales deck is one document shown four ways. Getting between them used
// to be a small "Magazine view" pill at the bottom of the slides, and on the magazine a row of
// links called Print / Digital / One page / Keynote — two different controls with two sets of
// names. This is the one control, the same in every view, named for what each is for:
//
//   Slides     present it on a screen            /r/<code>
//   Flipbook   send it; reads like a magazine    /r/<code>?view=digital
//   Print      letter pages, print or PDF        /r/<code>?view=magazine
//   One page   a single-page leave-behind        /r/<code>?view=onepage   (building packages only)
//
// `float` is the slides' version: a bar fixed to the foot of the screen, hidden while presenting
// and on paper. Without it the control sits inline (the magazine's top bar).
import type { MouseEvent } from 'react'

export type DeckView = 'slides' | 'digital' | 'magazine' | 'onepage'
const VIEWS: { k: DeckView; label: string; hint: string; q: string }[] = [
  { k: 'slides', label: 'Slides', hint: 'Present it on a screen: Present mode, PDF and PowerPoint', q: '' },
  { k: 'digital', label: 'Flipbook', hint: 'Send it: turns like a magazine on a phone or laptop', q: '?view=digital' },
  { k: 'magazine', label: 'Print', hint: 'Letter pages to print, save as a PDF or leave at the building', q: '?view=magazine' },
  { k: 'onepage', label: 'One page', hint: 'Everything on a single page: every range and who to call', q: '?view=onepage' },
]

export function DeckViewSwitch({ code, current, onePage = true, float, onPick }: {
  code: string; current: DeckView; onePage?: boolean; float?: boolean
  /** Called before the link is followed; call e.preventDefault() to handle the switch in place. */
  onPick?: (k: DeckView, e: MouseEvent<HTMLAnchorElement>) => void
}) {
  const list = VIEWS.filter(v => v.k !== 'onepage' || onePage)
  return (
    <nav className={'lh-views sb-noprint' + (float ? ' lh-views-float' : '')} aria-label="Ways to view this deck">
      <style dangerouslySetInnerHTML={{ __html: `
.lh-views{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.14);font:600 12.5px Inter,system-ui,sans-serif}
.lh-views a{padding:7px 15px;border-radius:999px;color:#fff;text-decoration:none;white-space:nowrap;opacity:.82;transition:background .12s,opacity .12s}
.lh-views a:hover{background:rgba(255,255,255,.14);opacity:1}
.lh-views a[aria-current="page"]{background:#fff;color:#14161B;opacity:1}
.lh-views-float{position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;background:#14161B;box-shadow:0 8px 28px rgba(16,17,20,.28);padding:4px}
.lh-views-float .lh-views-l{padding:0 10px 0 12px;color:rgba(255,255,255,.55);font-weight:600;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
body:has(.sb-present) .lh-views-float{display:none}
@media (max-width:640px){.lh-views a{padding:6px 10px;font-size:11.5px}.lh-views-float .lh-views-l{display:none}}
@media print{.lh-views{display:none!important}}
` }} />
      {float ? <span className="lh-views-l">View</span> : null}
      {list.map(v => (
        <a key={v.k} href={'/r/' + code + v.q} title={v.hint} aria-current={v.k === current ? 'page' : undefined}
          onClick={e => { if (v.k === current && !onPick) { e.preventDefault(); return } if (onPick) onPick(v.k, e) }}>{v.label}</a>
      ))}
    </nav>
  )
}
