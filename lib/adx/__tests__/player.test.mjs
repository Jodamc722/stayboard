// node lib/adx/__tests__/player.test.mjs
// AD STUDIO REBUILD (Jon, 2026-11-20): the player's layout pass, run on the house pieces without a canvas. The same
// functions place the words when a frame is drawn, so if these hold, the drawing holds.
import { suite } from './_load.mjs'
const { reopenComposition, MIN_LABEL_PX, MAX_PHOTO_UPSCALE } = await import('../composition.ts')
const { SEEDS } = await import('../seeds.ts')
const { layoutText, approxMeasure, restTime, sceneAt, maxUpscale, coverScale, hitText, buttonSize, groundOf, fontCss } = await import('../player.ts')
const { photoUrl } = await import('../assets.ts')
const { ok, eq, done } = suite('adx player')

for (const k of Object.keys(SEEDS)) {
  const d = reopenComposition(SEEDS[k]).doc, sf = d.canvas.safe
  let texts = 0
  for (const s of d.scenes) {
    ok(`${k}/${s.id}: rest time is inside the scene`, restTime(s) > s.start && restTime(s) < s.start + s.dur)
    ok(`${k}/${s.id}: sceneAt finds it at its rest time`, d.scenes[sceneAt(d, restTime(s))].id === s.id)
    ok(`${k}/${s.id}: has a ground`, /^#[0-9A-F]{6}$/.test(groundOf(d, s)))
    for (const l of s.layers) {
      if (l.type === 'text') {
        texts++
        const L = layoutText(d, l, approxMeasure)
        ok(`${k}/${l.id}: fits its box`, L.fits && !L.tooManyLines, { size: L.size, widths: L.widths, box: l.box })
        ok(`${k}/${l.id}: size within the design's range and above the floor`, L.size >= MIN_LABEL_PX && (!l.fit || (L.size >= l.fit.min && L.size <= l.fit.max)), L.size)
        ok(`${k}/${l.id}: words sit inside the safe area`, L.rect.x0 >= sf.left - 1 && L.rect.x1 <= d.canvas.w - sf.right + 1 && L.rect.y0 >= sf.top - 1 && L.rect.y1 <= d.canvas.h - sf.bottom + 1, L.rect)
        ok(`${k}/${l.id}: widest line is no wider than its box`, Math.max(...L.widths) <= l.box.w + 1)
      }
      if (l.type === 'photo') {
        const a = d.assets.photos[l.photo]
        ok(`${k}/${l.id}: drawn at or under ${MAX_PHOTO_UPSCALE * 100}% of its real pixels`, maxUpscale(l, a.w, a.h) <= MAX_PHOTO_UPSCALE + 0.005, maxUpscale(l, a.w, a.h))
        const u = photoUrl(a, l)
        ok(`${k}/${l.id}: fetched from an allowed source at a size it can honour`, u.indexOf(a.src.split('/image/upload/')[0]) === 0 && !/w_(\d+)/.test(u) || Number(/w_(\d+)/.exec(u)[1]) <= a.w)
      }
      if (l.type === 'button') ok(`${k}/${l.id}: the button's words are legible`, buttonSize(d, l, approxMeasure) >= MIN_LABEL_PX)
    }
  }
  ok(k + ': ten lines of words laid out', texts === 10)
  ok(k + ': scenes are end to end', d.scenes.every((s, i) => i === 0 || Math.abs(s.start - (d.scenes[i - 1].start + d.scenes[i - 1].dur)) < 0.002))
}

// ── the Thanksgiving fixture, line by line ──
const d = reopenComposition(SEEDS.thanksgiving).doc
const head = d.scenes[0].layers.find(l => l.id === 's1-head'), L = layoutText(d, head, approxMeasure)
eq('the hook is two lines', L.lines.map(ln => ln.map(w => w.t).join(' ')), ['Thanksgiving,', 'somewhere warm.'])
ok('the accent word carries its own style and colour', L.lines[1][1].style.style === 'italic' && L.lines[1][1].color === '#C4541C')
ok('a space is kept between a plain run and the accent that follows', L.lines[1][1].sp === true)
const label = d.scenes[0].layers.find(l => l.id === 's1-eyebrow')
eq('labels are set in capitals', layoutText(d, label, approxMeasure).lines[0].map(w => w.t).join(' '), 'FORT LAUDERDALE · NOV 23–29')
// a long headline wraps and shrinks, but never under its floor
const long = { ...head, runs: [{ t: 'Thanksgiving somewhere warm with the whole family this year' }] }
const LL = layoutText(d, long, approxMeasure)
ok('too many words: shrinks to the floor, reports it does not fit, never goes smaller', LL.size === head.fit.min && (!LL.fits || LL.tooManyLines))
const centred = d.scenes[3].layers.find(l => l.id === 's4-head'), LC = layoutText(d, centred, approxMeasure)
ok('centred words are centred in their box', Math.abs((LC.rect.x0 + LC.rect.x1) / 2 - (centred.box.x + centred.box.w / 2)) < 1)
// clicking the words on the picture
const hit = hitText(d, restTime(d.scenes[0]), L.rect.x0 + 40, L.rect.y0 + 40, approxMeasure)
ok('a click on the headline finds the headline', hit && hit.layer.id === 's1-head')
const btn = d.scenes[4].layers.find(l => l.type === 'button')
ok('a click on the button finds the button', hitText(d, restTime(d.scenes[4]), btn.box.x + 50, btn.box.y + 20, approxMeasure).layer.id === btn.id)
ok('a click on the photograph finds no words', hitText(d, restTime(d.scenes[0]), 540, 1500, approxMeasure) === null)
// photographs
const p = d.scenes[1].layers.find(l => l.id === 's2-photo'), a = d.assets.photos[p.photo]
ok('cover scale is the larger of the two ratios', Math.abs(coverScale(p, a.w, a.h) - Math.max(p.box.w / a.w, p.box.h / a.h)) < 1e-9)
ok('a layer with a focal point gets the whole photograph, never upscaled', /c_limit,w_1200,h_800/.test(photoUrl(a, p)))
ok('a layer without one gets a subject-aware crop at its drawn size', /c_fill,g_auto,w_\d+,h_\d+/.test(photoUrl({ ...a, focal: undefined }, { ...p, focal: undefined })))
ok('…and that crop never asks for more pixels than the photograph has', (() => { const u = photoUrl({ ...a, focal: undefined }, { ...p, focal: undefined, box: { x: 0, y: 0, w: 1080, h: 1920 } }); const m = /w_(\d+),h_(\d+)/.exec(u); return Number(m[1]) <= a.w && Number(m[2]) <= a.h })())
ok('a refused source yields no address', photoUrl({ ...a, src: 'https://evil.example/x.jpg' }, p) === '')
ok('fonts are named with a fallback of the same kind', /'Fraunces', Georgia, serif$/.test(fontCss(d.tokens.type.display, 100)) && /^italic 500 /.test(fontCss(d.tokens.type.displayAccent, 100)))
done()
