'use client'
// THE DIGITAL MAGAZINE (Jon, 2026-11-11: "the magazine should be a shareable link too, a digital
// magazine that looks like one"). The same pages as the printed magazine, bound as a book:
//   • two-page spreads on a wide screen, the cover alone on the right and the back cover alone on the
//     left, as in print; one page at a time on a phone
//   • a page turns in 3D around the spine (the leaf carries this page on its front and the next one on
//     its back); arrow keys, a click on either half, a swipe, or the slider
//   • scaled to fit the window, so a spread is always whole
// Pages are the magazine's own <section className="mz-page"> elements, rendered once each.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, List, Phone, Mail, X, MessageSquare } from 'lucide-react'

const PW = 816, PH = 1056, TURN_MS = 760

export type FlipContact = { name?: string; role?: string; phone?: string; email?: string; photo?: string }
export function MagazineFlipbook({ pages, labels, top = 56, contact, title }: { pages: React.ReactNode[]; labels?: string[]; top?: number; contact?: FlipContact; title?: string }) {
  const [vw, setVw] = useState(1200), [vh, setVh] = useState(800)
  useEffect(() => {
    const on = () => { setVw(window.innerWidth); setVh(window.innerHeight) }
    on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on)
  }, [])
  // phone (<760): the readable stacked page; tablet (<1100): one bound page at a time; wider: spreads.
  const phone = vw < 760
  const single = vw < 1100
  // Spreads: [left, right] page indexes. The cover sits alone on the right, like a closed book's front.
  const spreads = useMemo(() => {
    const n = pages.length
    if (single) return pages.map((_, i) => [null, i] as [number | null, number | null])
    const out: [number | null, number | null][] = [[null, 0]]
    for (let i = 1; i < n; i += 2) out.push([i, i + 1 < n ? i + 1 : null])
    return out
  }, [pages.length, single])
  const [at, setAt] = useState(0)
  const [turn, setTurn] = useState<null | { dir: 1 | -1; to: number }>(null)
  useEffect(() => { setAt(a => Math.min(a, spreads.length - 1)) }, [spreads.length])

  const go = useCallback((to: number) => {
    if (turn || to < 0 || to >= spreads.length || to === at) return
    if (Math.abs(to - at) > 1 || single) { setAt(to); return }
    setTurn({ dir: to > at ? 1 : -1, to })
  }, [turn, spreads.length, at, single])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(at + 1) }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1) }
      if (e.key === 'Home') go(0)
      if (e.key === 'End') go(spreads.length - 1)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [go, at, spreads.length])

  // Swipe
  const sx = useRef<number | null>(null)
  const onDown = (e: React.PointerEvent) => { sx.current = e.clientX }
  const onUp = (e: React.PointerEvent) => {
    if (sx.current == null) return
    const dx = e.clientX - sx.current; sx.current = null
    if (Math.abs(dx) > 50) go(at + (dx < 0 ? 1 : -1))
  }

  const bookW = single ? PW : PW * 2
  const availH = Math.max(320, vh - top - 96), availW = Math.max(300, vw - (single ? 24 : 120))
  const scale = Math.min(availW / bookW, availH / PH, 1.15)
  const [L, R] = spreads[at] || [null, null]
  const next = turn ? spreads[turn.to] : null
  const page = (i: number | null) => (i == null ? null : <div className="mz-leaf-page">{pages[i]}</div>)

  // What shows under the turning leaf: going forward, this spread's left and the next spread's right;
  // going back, the previous spread's left and this spread's right.
  const leftBase = turn ? (turn.dir === 1 ? L : next![0]) : L
  const rightBase = turn ? (turn.dir === 1 ? next![1] : R) : R
  const label = (labels || [])[R ?? L ?? 0] || ''
  const pageNo = (i: number | null) => (i == null ? '' : String(i + 1))

  // ON A PHONE (Jon, 2026-11-12: "needs to work as a shareable link we can share directly with owners,
  // designed for phones"): not a shrunken page, a reader. Every page full width, edge to edge, scrolled
  // like an article; a progress line; the section you are in; a contents sheet; and a way to reach the
  // presenter from anywhere in it.
  if (phone) return <PhoneReader pages={pages} labels={labels || []} contact={contact} title={title} />
  return (
    <div className="mz-flip" onPointerDown={onDown} onPointerUp={onUp}>
      <style>{FLIP_CSS}</style>
      <div className="mz-book" style={{ width: bookW * scale, height: PH * scale }}>
        <div className="mz-book-in" style={{ width: bookW, height: PH, transform: `scale(${scale})` }}>
          {single ? (
            <div className="mz-slot mz-slot-r" style={{ left: 0 }} key={at}><div className="mz-phone-page">{page(R)}</div></div>
          ) : (
            <>
              <div className={'mz-slot mz-slot-l' + (leftBase == null ? ' empty' : '')} style={{ left: 0 }}>{page(leftBase)}</div>
              <div className={'mz-slot mz-slot-r' + (rightBase == null ? ' empty' : '')} style={{ left: PW }}>{page(rightBase)}</div>
              {turn && (
                <div className={'mz-turn ' + (turn.dir === 1 ? 'fwd' : 'back')} style={{ left: turn.dir === 1 ? PW : 0, animationDuration: TURN_MS + 'ms' }}
                  onAnimationEnd={() => { setAt(turn.to); setTurn(null) }}>
                  <div className="mz-face front">{page(turn.dir === 1 ? R : L)}<i className="mz-shade" /></div>
                  <div className="mz-face back">{page(turn.dir === 1 ? next![0] : next![1])}<i className="mz-shade" /></div>
                </div>
              )}
              {turn || (leftBase != null && rightBase != null) ? <i className="mz-spine" /> : null}
            </>
          )}
        </div>
        {/* Click either half to turn. */}
        <button type="button" aria-label="Previous page" className="mz-hit l" onClick={() => go(at - 1)} disabled={at === 0} />
        <button type="button" aria-label="Next page" className="mz-hit r" onClick={() => go(at + 1)} disabled={at >= spreads.length - 1} />
      </div>
      <div className="mz-flip-bar">
        <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous"><ChevronLeft size={18} /></button>
        <span className="mz-flip-where"><b>{single ? pageNo(R) : [pageNo(L), pageNo(R)].filter(Boolean).join('–')}</b> of {pages.length}{label ? <em> · {label}</em> : null}</span>
        <input type="range" min={0} max={spreads.length - 1} value={at} onChange={e => go(Number(e.target.value))} aria-label="Go to page" />
        <button type="button" onClick={() => go(at + 1)} disabled={at >= spreads.length - 1} aria-label="Next"><ChevronRight size={18} /></button>
      </div>
    </div>
  )
}

function PhoneReader({ pages, labels, contact, title }: { pages: React.ReactNode[]; labels: string[]; contact?: FlipContact; title?: string }) {
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const [cur, setCur] = useState(0)
  const [prog, setProg] = useState(0)
  const [sheet, setSheet] = useState<null | 'contents' | 'contact'>(null)
  useEffect(() => {
    const on = () => {
      const h = document.documentElement
      const max = Math.max(1, h.scrollHeight - window.innerHeight)
      setProg(Math.min(1, Math.max(0, window.scrollY / max)))
      const mid = window.innerHeight * 0.4
      let c = 0
      refs.current.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= mid) c = i })
      setCur(c)
    }
    on(); window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on)
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [pages.length])
  // The contents: the first page of each section, in order.
  const toc = labels.map((l, i) => ({ l: i === 0 ? 'Cover' : (l || (i === pages.length - 1 ? 'Contact' : '')), i }))
    .filter((x, j, a) => x.l && (j === 0 || a.findIndex(y => y.l === x.l) === j))
  const jump = (i: number) => { setSheet(null); const el = refs.current[i]; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 52, behavior: 'smooth' }) }
  const label = cur === 0 ? (title || 'Cover') : (labels[cur] || (cur === pages.length - 1 ? 'Contact' : ''))
  const atEnd = cur >= pages.length - 1
  const first = (contact?.name || '').split(' ')[0]
  const tel = (contact?.phone || '').replace(/[^\d+]/g, '')
  return (
    <div className="mz-reader">
      <style>{FLIP_CSS}</style>
      <i className="mz-r-prog" style={{ transform: `scaleX(${prog})` }} />
      {pages.map((p, i) => <div key={i} ref={el => { refs.current[i] = el }} className={'mz-r-page' + (i === 0 ? ' mz-r-cover' : '')}>{p}</div>)}
      <div className={'mz-r-dock' + (sheet ? ' up' : '')}>
        <button type="button" className="mz-r-where" onClick={() => setSheet(s => s === 'contents' ? null : 'contents')} aria-label="Contents">
          <List size={16} /><span>{label}</span><em>{cur + 1}/{pages.length}</em>
        </button>
        {contact && (contact.phone || contact.email) ? (
          <button type="button" className={'mz-r-talk' + (atEnd ? ' hot' : '')} onClick={() => setSheet(s => s === 'contact' ? null : 'contact')}>
            {contact.photo ? <img src={contact.photo} alt="" /> : <MessageSquare size={15} />}<span>{first ? 'Talk to ' + first : 'Talk to us'}</span>
          </button>
        ) : null}
      </div>
      {sheet ? <div className="mz-r-scrim" onClick={() => setSheet(null)} /> : null}
      {sheet === 'contents' ? (
        <div className="mz-r-sheet" role="dialog" aria-label="Contents">
          <header><b>Contents</b><button type="button" onClick={() => setSheet(null)} aria-label="Close"><X size={18} /></button></header>
          <ol>{toc.map(x => <li key={x.i}><button type="button" className={x.i <= cur && (toc.find(y => y.i > x.i)?.i ?? 1e9) > cur ? 'on' : ''} onClick={() => jump(x.i)}><span>{x.l}</span><em>{x.i + 1}</em></button></li>)}</ol>
        </div>
      ) : null}
      {sheet === 'contact' && contact ? (
        <div className="mz-r-sheet" role="dialog" aria-label="Contact">
          <header><b>{contact.name || 'Stay Hospitality'}</b><button type="button" onClick={() => setSheet(null)} aria-label="Close"><X size={18} /></button></header>
          {contact.role ? <p className="mz-r-role">{contact.role}</p> : null}
          <div className="mz-r-acts">
            {tel ? <a href={'tel:' + tel}><Phone size={16} /><span>Call</span><small>{contact.phone}</small></a> : null}
            {tel ? <a href={'sms:' + tel}><MessageSquare size={16} /><span>Text</span><small>{contact.phone}</small></a> : null}
            {contact.email ? <a href={'mailto:' + contact.email + '?subject=' + encodeURIComponent((title || 'Stay Hospitality') + ' · a question')}><Mail size={16} /><span>Email</span><small>{contact.email}</small></a> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const FLIP_CSS = `
.mz-reader{padding-bottom:96px;background:var(--mz-paper,#fff);margin:-36px -16px -64px}
.mz-r-prog{position:fixed;left:0;right:0;top:44px;height:3px;background:var(--mz-glow,#8C6D3A);transform-origin:left center;z-index:40;pointer-events:none}
.mz-r-page>.mz-page{margin:0!important;box-shadow:none!important;border-radius:0!important;width:100%!important;max-width:none!important}
.mz-r-page+.mz-r-page>.mz-page:not(.mz-dark):not(.mz-opener):not(.mz-backcover){border-top:1px solid var(--mz-rule,#e4e2dd)}
.mz-r-cover>.mz-page{min-height:calc(100svh - 44px)!important;display:flex;flex-direction:column;justify-content:flex-end}
.mz-r-page .mz-opener,.mz-r-page .mz-backcover{min-height:88svh!important}
.mz-r-dock{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));display:flex;gap:8px;z-index:45;font-family:"Inter",system-ui,sans-serif}
.mz-r-dock button{display:flex;align-items:center;gap:8px;border:0;border-radius:999px;height:48px;padding:0 16px;font:600 13.5px "Inter",system-ui,sans-serif;box-shadow:0 10px 30px rgba(10,11,14,.22);cursor:pointer}
.mz-r-where{flex:1;min-width:0;background:rgba(255,255,255,.96);color:#101114;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.mz-r-where span{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mz-r-where em{font-style:normal;font-weight:500;color:#6B6C72;font-variant-numeric:tabular-nums}
.mz-r-talk{background:var(--mz-navy,#14161B);color:#fff;padding:0 16px 0 6px!important}
.mz-r-talk img{width:36px;height:36px;border-radius:99px;object-fit:cover}
.mz-r-talk svg{margin-left:10px}
.mz-r-talk.hot{background:var(--mz-glow,#8C6D3A)}
.mz-r-scrim{position:fixed;inset:0;background:rgba(10,11,14,.36);z-index:46;animation:mzFade .2s ease-out}
.mz-r-sheet{position:fixed;left:0;right:0;bottom:0;z-index:47;background:#fff;color:#101114;border-radius:20px 20px 0 0;padding:16px 20px calc(20px + env(safe-area-inset-bottom,0px));max-height:76svh;overflow-y:auto;font-family:"Inter",system-ui,sans-serif;animation:mzSheet .26s cubic-bezier(.2,.8,.2,1)}
.mz-r-sheet header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.mz-r-sheet header b{font:400 24px/1.2 var(--mz-display,Georgia,serif)}
.mz-r-sheet header button{border:0;background:#F3F2EF;border-radius:99px;width:34px;height:34px;display:grid;place-items:center;color:#101114}
.mz-r-sheet ol{list-style:none;margin:0;padding:0}
.mz-r-sheet li button{display:flex;width:100%;justify-content:space-between;align-items:baseline;border:0;background:none;padding:14px 0;border-bottom:1px solid #EEECE7;font:400 19px var(--mz-display,Georgia,serif);color:#101114;text-align:left}
.mz-r-sheet li button em{font:500 12px "Inter",sans-serif;color:#86878C;font-style:normal}
.mz-r-sheet li button.on{color:var(--mz-glow,#8C6D3A)}
.mz-r-role{margin:0 0 12px;color:#6B6C72;font-size:13px}
.mz-r-acts{display:grid;gap:8px}
.mz-r-acts a{display:grid;grid-template-columns:22px auto 1fr;align-items:center;gap:10px;padding:15px 16px;border-radius:14px;background:#F3F2EF;color:#101114;text-decoration:none;font-weight:600;font-size:15px}
.mz-r-acts a small{justify-self:end;font-weight:400;color:#6B6C72;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
@keyframes mzSheet{from{transform:translateY(100%)}to{transform:none}}
@keyframes mzFade{from{opacity:0}to{opacity:1}}

.mz-flip{min-height:calc(100vh - 150px);display:flex;flex-direction:column;align-items:center;touch-action:pan-y;user-select:none}
.mz-book{position:relative;perspective:3200px}
.mz-book-in{position:absolute;left:0;top:0;transform-origin:top left;transform-style:preserve-3d}
.mz-slot{position:absolute;top:0;width:${PW}px;height:${PH}px;background:transparent}
.mz-slot.empty{visibility:hidden}
.mz-slot-l .mz-leaf-page,.mz-turn.back .front .mz-leaf-page{box-shadow:-18px 22px 50px rgba(20,18,15,.20)}
.mz-slot-r .mz-leaf-page,.mz-turn.fwd .front .mz-leaf-page{box-shadow:18px 22px 50px rgba(20,18,15,.20)}
.mz-leaf-page{width:${PW}px;height:${PH}px;overflow:hidden;position:relative}
.mz-leaf-page>.mz-page{margin:0!important;box-shadow:none!important}
.mz-spine{position:absolute;left:${PW - 40}px;top:0;width:80px;height:${PH}px;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.10) 44%,rgba(0,0,0,.22) 50%,rgba(255,255,255,.06) 53%,rgba(0,0,0,0) 100%);z-index:3}
.mz-turn{position:absolute;top:0;width:${PW}px;height:${PH}px;transform-style:preserve-3d;z-index:5;animation-timing-function:cubic-bezier(.45,.05,.35,1);animation-fill-mode:forwards}
.mz-turn.fwd{transform-origin:left center;animation-name:mzTurnFwd}
.mz-turn.back{transform-origin:right center;animation-name:mzTurnBack}
.mz-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
.mz-face.back{transform:rotateY(180deg)}
.mz-shade{position:absolute;inset:0;pointer-events:none;animation:inherit;animation-name:mzShade}
.mz-turn.fwd .front .mz-shade{background:linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 40%)}
.mz-turn.fwd .back .mz-shade{background:linear-gradient(270deg,rgba(0,0,0,.18),rgba(0,0,0,0) 40%)}
.mz-turn.back .front .mz-shade{background:linear-gradient(270deg,rgba(0,0,0,.18),rgba(0,0,0,0) 40%)}
.mz-turn.back .back .mz-shade{background:linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 40%)}
@keyframes mzTurnFwd{from{transform:rotateY(0deg)}to{transform:rotateY(-180deg)}}
@keyframes mzTurnBack{from{transform:rotateY(0deg)}to{transform:rotateY(180deg)}}
@keyframes mzShade{0%{opacity:0}50%{opacity:1}100%{opacity:0}}
.mz-hit{position:absolute;top:0;bottom:0;width:18%;background:none;border:0;cursor:pointer;z-index:6}
.mz-hit.l{left:0;cursor:w-resize}.mz-hit.r{right:0;cursor:e-resize}.mz-hit:disabled{cursor:default}
.mz-flip-bar{display:flex;align-items:center;gap:14px;margin:18px 0 24px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.86);backdrop-filter:blur(6px);box-shadow:0 6px 24px rgba(20,18,15,.12);font:500 12.5px "Inter",sans-serif;color:#1C1A17}
.mz-flip-bar button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;border:0;background:#1C1A17;color:#fff;cursor:pointer}
.mz-flip-bar button:disabled{opacity:.25;cursor:default}
.mz-flip-bar input{width:min(280px,30vw);accent-color:#1C1A17}
.mz-flip-where{min-width:120px;text-align:center;white-space:nowrap}.mz-flip-where em{font-style:normal;color:#7A7164}
.mz-slot .mz-phone-page{animation:mzPageIn .35s ease-out}
@media (max-width:899px){.mz-flip-bar input{display:none}.mz-flip-where em{display:none}}
.mz-flip-phone{display:block;min-height:0;padding-bottom:80px}
.mz-phone-page{animation:mzPageIn .35s ease-out}
.mz-phone-page>.mz-page{margin:0 auto}
@keyframes mzPageIn{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
.mz-flip-bar-fixed{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);margin:0;z-index:15}
@media print{.mz-flip{display:none}}
`
