// node lib/adx/__tests__/audit.test.mjs
// AD STUDIO REBUILD (Jon, 2026-11-20): Jon's ad rules as measured checks. The Thanksgiving house piece is the fixture:
// it must pass as it stands, and each rule must fail when the piece is changed to break exactly that rule.
import { suite } from './_load.mjs'
const { reopenComposition } = await import('../composition.ts')
const { SEEDS } = await import('../seeds.ts')
const { auditComposition, deadBand, issueLines } = await import('../audit.ts')
const { approxMeasure } = await import('../player.ts')
const { ok, eq, done } = suite('adx audit')

const fresh = (k = 'thanksgiving') => JSON.parse(JSON.stringify(reopenComposition(SEEDS[k]).doc))
const audit = d => auditComposition(d, approxMeasure)
const codes = d => audit(d).issues.filter(x => x.sev === 'fail').map(x => x.code)
const layer = (d, id) => { for (const s of d.scenes) for (const l of s.layers) if (l.id === id) return l }
/** Change the fixture, re-validate it like any saved file would be, and return the failing codes. */
const broken = (fn, k) => { const d = fresh(k); fn(d); return codes(reopenComposition(d).doc) }
const breaks = (label, code, fn, k) => { const c = broken(fn, k); ok(label + ' → ' + code, c.indexOf(code) >= 0, 'failing codes: ' + c.join(', ')) }

// ── the four house pieces pass as they stand ──
for (const k of Object.keys(SEEDS)) {
  const r = audit(fresh(k))
  ok(k + ' passes the audit', r.ok, issueLines(r.issues.filter(x => x.sev === 'fail')))
  ok(k + ': every text layer and photograph was measured', r.measured.text >= 8 && r.measured.photos >= 3 && r.measured.scenes === 5)
}

// ── photographs ──
breaks('the same photograph twice', 'photo-reuse', d => { layer(d, 's3-photo').photo = 'p_kitchen' })
breaks('two photographs in one scene (a collage)', 'collage', d => { d.scenes[1].layers.push({ id: 'extra', type: 'photo', photo: 'p_table', box: { x: 0, y: 1300, w: 400, h: 266 }, treatment: 'none' }); d.scenes[2].layers = d.scenes[2].layers.filter(l => l.type !== 'photo') })
breaks('a 1200 px photograph blown up to fill a tall frame', 'photo-soft', d => { layer(d, 's2-photo').box = { x: 0, y: 0, w: 1080, h: 1920 } })
breaks('a camera push past the real pixels', 'photo-soft', d => { layer(d, 's3-photo').camera = { from: { scale: 1 }, to: { scale: 1.3 } } })
breaks('a unit from another area in a Fort Lauderdale piece', 'photo-area', d => { d.assets.photos.p_pool.area = 'miami' })
ok('a filter on a photograph is noted in a no-filter look', audit((() => { const d = fresh(); layer(d, 's2-photo').treatment = 'warm'; return d })()).issues.some(x => x.code === 'photo-filter'))

// ── words ──
breaks('a price in a guest piece', 'price', d => { layer(d, 's1-eyebrow').runs = [{ t: 'From $199 a night' }] })
breaks('a discount in the caption', 'price', d => { d.social.caption = 'Book now for 20% off.' })
breaks('a phone number in a guest piece', 'phone', d => { layer(d, 's5-when').runs = [{ t: 'Call 651-200-8283' }] })
breaks('“Pompano Beach” in a spoken line', 'banned-spoken', d => { d.script.lines[0].vo = 'Thanksgiving in Pompano Beach.' })
breaks('“Salato” in a spoken line', 'banned-spoken', d => { d.script.lines[1].vo = 'Stay at Salato this year.' })
ok('“Pompano Beach” on screen only is allowed', codes((() => { const d = fresh(); layer(d, 's2-label').runs = [{ t: 'Oasis · Pompano Beach' }]; return d })()).indexOf('banned-spoken') < 0)
breaks('“Customer Care Team” anywhere', 'banned-word', d => { layer(d, 's3-label').runs = [{ t: 'Customer Care Team on call' }] })
breaks('“40+” without naming the channels', 'channels-unnamed', d => { layer(d, 's3-label').runs = [{ t: 'Listed on 40+ platforms' }] })
ok('“40+” with the channels named passes that check', broken(d => { layer(d, 's3-label').runs = [{ t: '40+ platforms' }]; d.social.caption += ' Airbnb, Vrbo, Booking.com and more.' }).indexOf('channels-unnamed') < 0)
breaks('a guest piece that does not end on the Book button', 'end-cta', d => { d.scenes[4].layers = d.scenes[4].layers.filter(l => l.type !== 'button') })
breaks('an end card too short to read', 'end-short', d => { d.scenes[4].dur = 2 })
const owner = (() => { const d = fresh(); d.brief.audience = 'owners'; return codes(reopenComposition(d).doc) })()
ok('the same piece as an OWNER piece must end on Nick’s line instead', owner.indexOf('end-cta') >= 0 && owner.indexOf('price') < 0)

// ── type: fits, legible, in the safe area, readable against what is behind it ──
breaks('a headline that cannot fit at its smallest size', 'text-fit', d => { layer(d, 's1-head').runs = [{ t: 'Thanksgiving somewhere extraordinarily, unbelievably, impossibly warm and sunny this year for everyone you know' }] })
breaks('type under the phone-legible floor', 'text-small', d => { const l = layer(d, 's1-eyebrow'); l.size = 18 })
breaks('words under the platform’s buttons (bottom safe area)', 'safe-area', d => { layer(d, 's2-head').box.y = 1500 })
breaks('words under the right-hand buttons', 'safe-area', d => { layer(d, 's2-label').box.x = 600 })
breaks('the logo outside the safe area', 'safe-area', d => { layer(d, 's1-logo').box.y = 40 })
breaks('a small label on a mid-tone ground', 'contrast', d => { layer(d, 's2-label').color = 'bark' })
breaks('pale accent on a pale ground', 'contrast', d => { layer(d, 's1-head').runs[3].color = 'ochre'; layer(d, 's1-head').color = 'ochre' })
breaks('the black logo on a dark ground', 'logo-contrast', d => { const l = layer(d, 's2-logo'); l.variant = 'black'; delete l.tint })
breaks('a piece with no logo at all', 'no-logo', d => { for (const s of d.scenes) s.layers = s.layers.filter(l => l.type !== 'logo') })
ok('words placed on a photograph are flagged for the pixel check', audit((() => { const d = fresh(); layer(d, 's1-head').box.y = 900; return reopenComposition(d).doc })()).issues.some(x => x.code === 'contrast-photo'))
ok('with a sampler, unreadable words over a photograph fail', auditComposition((() => { const d = fresh(); layer(d, 's1-head').box.y = 900; return reopenComposition(d).doc })(), approxMeasure, { sample: () => ({ lo: 0.02, hi: 0.9 }) }).issues.some(x => x.code === 'contrast-photo' && x.sev === 'fail'))

// ── layout and motion ──
breaks('decoration resting on the words', 'decor-on-words', d => { layer(d, 's1-leaf-a').box = { x: 200, y: 440, w: 200, h: 200 } })
breaks('more than two kinds of transition', 'transitions', d => { d.scenes[1].transitionIn = { type: 'slide', dir: 'left', dur: 0.5 }; d.scenes[2].transitionIn = { type: 'wipe', dir: 'up', dur: 0.5 } })
// the issue the lead saw in the first prototype: the bottom third of the frame left empty
breaks('a scene that leaves the bottom third empty', 'dead-area', d => { d.scenes[1].layers = d.scenes[1].layers.filter(l => ['s2-band', 's2-leaf-b', 's2-leaf-c', 's2-leaf-d'].indexOf(l.id) < 0) })
const d2 = fresh(); const before = deadBand(d2, d2.scenes[1], approxMeasure)
ok('the fixed scene’s largest empty band is under a fifth of the frame', (before[1] - before[0]) / 1920 <= 0.2, before)
d2.scenes[1].layers = d2.scenes[1].layers.filter(l => ['s2-band', 's2-leaf-b', 's2-leaf-c', 's2-leaf-d'].indexOf(l.id) < 0)
const after = deadBand(d2, d2.scenes[1], approxMeasure)
ok('without its base band the empty band is the bottom ~27% of the frame', after[1] === 1920 && (after[1] - after[0]) / 1920 > 0.25, after)
ok('an empty document fails cleanly', auditComposition(reopenComposition({}).doc, approxMeasure).ok === false)
ok('every failure names its scene or the piece and says what to do', audit((() => { const d = fresh(); layer(d, 's3-photo').photo = 'p_kitchen'; return reopenComposition(d).doc })()).issues.every(x => x.msg.length > 20))
done()
