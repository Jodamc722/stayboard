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
import { ChevronLeft, ChevronRight } from 'lucide-react'

const PW = 816, PH = 1056, TURN_MS = 760

export function MagazineFlipbook({ pages, labels, top = 56 }: { pages: React.ReactNode[]; labels?: string[]; top?: number }) {
  const [vw, setVw] = useState(1200), [vh, setVh] = useState(800)
  useEffect(() => {
    const on = () => { setVw(window.innerWidth); setVh(window.innerHeight) }
    on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on)
  }, [])
  const single = vw < 900
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

  return (
    <div className="mz-flip" onPointerDown={onDown} onPointerUp={onUp}>
      <style>{FLIP_CSS}</style>
      <div className="mz-book" style={{ width: bookW * scale, height: PH * scale }}>
        <div className="mz-book-in" style={{ width: bookW, height: PH, transform: `scale(${scale})` }}>
          {single ? (
            <div className="mz-slot" style={{ left: 0 }} key={at}>{page(R)}</div>
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

const FLIP_CSS = `
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
@media (max-width:899px){.mz-flip-bar input{display:none}.mz-flip-where em{display:none}}
@media print{.mz-flip{display:none}}
`
