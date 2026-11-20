// node lib/adx/__tests__/composition.test.mjs
// AD STUDIO REBUILD (Jon, 2026-11-20): the validator is the only door model output comes through. These are the
// things a model (or anyone holding the save route) could send, and what must come out.
import { suite } from './_load.mjs'
const { sanitizeComposition, reopenComposition, photoSrcAllowed, runsToPlain, plainToRuns, rulesFor, resolveColor, lum, contrast, CHANNELS, ADX_MONTHLY_CAP_USD, ADX_MOMENTS, MAX_PHOTO_UPSCALE, DEAD_BAND_MAX } = await import('../composition.ts')
const { SEEDS, housePiece } = await import('../seeds.ts')
const { ok, eq, done } = suite('adx composition')

const brief = { goal: 'g', audience: 'guests', who: 'w', takeaway: '', moment: 'thanksgiving', momentName: 'Thanksgiving week', dates: 'Nov 23–29', area: 'fort-lauderdale', areaLabel: 'Fort Lauderdale', vibe: 'warm', channel: 'vertical', seconds: 15, note: '', confirmedBy: 'x', confirmedAt: 'y' }
const good = { src: 'https://assets.guesty.com/image/upload/v1/production/a/b.jpg', w: 1200, h: 800, source: 'ours', building: 'Oasis', unit: 'Oasis 1', area: 'fort-lauderdale', shows: 'A kitchen' }
const trusted = (photos = { p1: good }) => ({ id: 'x1', brief, canvas: null, photos })
const scene = (layers, extra = {}) => ({ id: 's1', name: 'One', dur: 3, transitionIn: { type: 'none' }, layers, ...extra })
const base = layers => ({ tokens: { color: { cream: '#F5EBDC', bark: '#2A1A12' }, type: {} }, scenes: [scene(layers)] })
const run = (authored, t = trusted()) => sanitizeComposition(authored, t)

// ── the decisions are one-line constants ──
eq('monthly cap default', ADX_MONTHLY_CAP_USD, 50)
eq('moments made by the new engine', ADX_MOMENTS, ['thanksgiving', 'christmas', 'nye', 'basel'])
eq('never enlarge a photograph', MAX_PHOTO_UPSCALE, 1)
ok('dead band limit is a fifth of the frame', DEAD_BAND_MAX === 0.2)

// ── sources: only the app's storage and the listing photo hosts ──
ok('guesty photo allowed', photoSrcAllowed(good.src))
ok('own storage, public object, allowed', photoSrcAllowed('https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/listing-photos/a/b.jpg'))
ok('own storage, signed/private path refused', !photoSrcAllowed('https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/sign/ad-studio/x.json'))
ok('bundled ad asset allowed', photoSrcAllowed('/ads/sales/elser-pool.jpg'))
ok('path traversal refused', !photoSrcAllowed('/ads/../api/secret.png'))
ok('other site refused', !photoSrcAllowed('https://evil.example/x.jpg'))
ok('look-alike host refused', !photoSrcAllowed('https://assets.guesty.com.evil.example/x.jpg'))
ok('http refused', !photoSrcAllowed('http://assets.guesty.com/x.jpg'))
ok('javascript: refused', !photoSrcAllowed('javascript:alert(1)'))
ok('data: refused', !photoSrcAllowed('data:image/png;base64,AAAA'))

// ── a hostile document ──
const hostile = run({
  tokens: { color: { cream: '#F5EBDC', evil: 'url(javascript:alert(1))', 'bad key!': '#fff', ink: '#111' }, type: { display: { family: 'Comic Sans MS; } body { display:none', weight: 99999, style: 'oblique', lineHeight: -4, tracking: 9 } } },
  scenes: [scene([
    { type: 'fill', color: 'expression(alert(1))' },
    { type: 'html', html: '<script>alert(1)</script>' },
    { type: 'iframe', src: 'https://evil.example' },
    { type: 'photo', photo: 'https://evil.example/x.jpg', box: { x: 0, y: 0, w: 100, h: 100 } },
    { type: 'photo', photo: 'p1', box: { x: 'NaN', y: -1e9, w: 1e12, h: 0 }, treatment: 'blur(99px)', mask: { shape: 'star' }, camera: { from: { scale: 99 }, to: { scale: -3 } }, focal: { x: 7, y: -2 } },
    { type: 'text', style: 'nope', color: 'red', box: { x: 64, y: 300, w: 800, h: 200 }, fit: { max: 99999, min: 1, lines: 99 }, runs: [{ t: '<img src=x onerror=alert(1)>\u0000\u0007 hi' }, { t: 'x'.repeat(5000) }, { br: true }, 'junk', { t: '' }], onclick: 'alert(1)', in: { preset: 'explode', at: 1 } },
    { type: 'vector', box: { x: 0, y: 0, w: 100, h: 100 }, viewBox: [100, 100], paths: [{ d: 'M0 0 L10 10 Z', fill: 'cream' }, { d: 'M0 0"/><script>alert(1)</script>', fill: 'cream' }, { d: 'url(#x)', fill: 'cream' }] },
    { type: 'motif', motif: 'malware', box: { x: 0, y: 0, w: 10, h: 10 } },
    { type: 'motif', motif: 'leaf', variant: 'poison', color: '#12345', box: { x: 0, y: 0, w: 10, h: 10 }, target: 'nobody', in: { preset: 'settle', at: 0.2, dur: 99, fromY: 1e9, spin: 1e9 } },
    { type: 'logo', variant: 'https://evil.example/logo.png', src: 'https://evil.example/logo.png', box: { x: 64, y: 64, w: 5 } },
    { type: 'button', label: '   ', fill: 'cream', color: 'bark', box: { x: 0, y: 0, w: 10, h: 10 } },
    { type: 'button', label: 'Book at stay-hospitality.com', fill: 'cream', color: 'bark', size: 9999, href: 'javascript:alert(1)', box: { x: 190, y: 1100, w: 700, h: 108 } },
  ], { dur: 9999, transitionIn: { type: 'explode', dur: 50 } })],
  script: { lines: [{ scene: 's1', vo: 'a\u0000b' }, { scene: 'nope', vo: 'x' }] },
  social: { caption: 'c', hashtags: ['#ok', 'javascript:alert(1)', '#has space'] },
  assets: { photos: { p9: { src: 'https://evil.example/x.jpg' } }, logo: { black: 'https://evil.example/logo.png' } },
  rules: { guestAd: false, noPrices: false, maxPhotoUpscale: 9 },
  canvas: { w: 99999, h: 1, safe: { top: 0, bottom: 0, left: 0, right: 0 } },
})
const hd = hostile.doc, hl = hd.scenes[0].layers
const json = JSON.stringify(hd)
ok('no evil host anywhere in the result', json.indexOf('evil.example') < 0)
ok('no script, url( or expression( survives outside plain words', !/<script|url\(|expression\(|javascript:/i.test(JSON.stringify({ ...hd, scenes: hd.scenes.map(s => ({ ...s, layers: s.layers.filter(l => l.type !== 'text') })) })))
ok('unknown layer types dropped (html, iframe)', !hl.some(l => l.type === 'html' || l.type === 'iframe'))
eq('layer types kept', hl.map(l => l.type), ['fill', 'photo', 'text', 'vector', 'motif', 'logo', 'button'])
ok('bad colours fall back, palette keeps only hex', hd.tokens.color.evil === undefined && hd.tokens.color['bad key!'] === undefined && /^#[0-9A-F]{6}$/.test(resolveColor(hd, hl[0].color)))
ok('font family comes from the fixed list', ['Fraunces', 'Instrument Sans', 'Bricolage Grotesque'].indexOf(hd.tokens.type.display.family) >= 0)
ok('type numbers clamped', hd.tokens.type.display.weight <= 800 && hd.tokens.type.display.lineHeight >= 0.9 && hd.tokens.type.display.tracking <= 0.4)
const ph = hl.find(l => l.type === 'photo')
ok('photo keeps only a known asset', ph.photo === 'p1' && Object.keys(hd.assets.photos).join() === 'p1')
ok('photo box clamped to finite numbers', [ph.box.x, ph.box.y, ph.box.w, ph.box.h].every(Number.isFinite) && ph.box.w <= 2160 && ph.box.h >= 1)
ok('camera scale clamped 1..1.6', ph.camera.from.scale === 1.6 && ph.camera.to.scale === 1)
ok('focal clamped 0..1', ph.focal.x === 1 && ph.focal.y === 0)
ok('unknown treatment and mask dropped', ph.treatment === 'none' && ph.mask === undefined)
const tx = hl.find(l => l.type === 'text')
ok('text style falls back to display', tx.style === 'display')
ok('fit clamped; the floor is never under the label minimum', tx.fit.max <= 280 && tx.fit.min >= 20 && tx.fit.lines <= 5)
ok('control characters stripped from words', !/[\u0000-\u001f]/.test(tx.runs.map(r => r.t || '').join('')))
ok('a run is capped in length', tx.runs.every(r => !r.t || r.t.length <= 140))
ok('unknown keys on a layer are gone (onclick, href, src)', tx.onclick === undefined && hl.find(l => l.type === 'button').href === undefined && hl.find(l => l.type === 'logo').src === undefined)
ok('unknown entrance preset dropped', tx.in === undefined)
const vec = hl.find(l => l.type === 'vector')
eq('only plain path data survives', vec.paths.map(p => p.d), ['M0 0 L10 10 Z'])
const mo = hl.find(l => l.type === 'motif')
ok('motif variant from its own list; dangling target removed', mo.motif === 'leaf' && mo.variant === 'maple' && mo.target === undefined)
ok('entrance numbers clamped', mo.in.dur <= 2.4 && Math.abs(mo.in.fromY) <= 800 && Math.abs(mo.in.spin) <= 360)
const lg = hl.find(l => l.type === 'logo')
ok('logo is one of the two bundled marks, width floored', lg.variant === 'black' && lg.box.w >= 60 && hd.assets.logo.black === '/ads/stay-logo-black.png')
ok('empty button dropped, real one kept and clamped', hl.filter(l => l.type === 'button').length === 1 && hl.find(l => l.type === 'button').size <= 72)
ok('scene duration clamped', hd.scenes[0].dur <= 14 && hd.canvas.duration === hd.scenes[0].dur)
ok('first scene has no transition', hd.scenes[0].transitionIn.type === 'none')
eq('script lines only for real scenes, cleaned', hd.script.lines, [{ scene: 's1', vo: 'a b' }])
eq('hashtags filtered', hd.social.hashtags, ['#ok'])
ok('canvas comes from the channel, not the document', hd.canvas.w === 1080 && hd.canvas.h === 1920 && hd.canvas.safe.bottom === CHANNELS.vertical.safe.bottom)
ok('rules come from the audience, not the document', hd.rules.guestAd === true && hd.rules.noPrices === true && hd.rules.maxPhotoUpscale === 1)
ok('notes say what was dropped', hostile.notes.length >= 4)

// ── shapes of garbage ──
for (const junk of [null, undefined, 42, 'text', [], { scenes: 'no' }, { scenes: [null, 5, {}] }, { scenes: [{ layers: [{ type: 'text', runs: [] }] }] }]) {
  const r = run(junk)
  ok('garbage in → an empty, drawable-safe document: ' + JSON.stringify(junk), r.doc.scenes.length === 0 && r.doc.format === 'stay.composition/1' && Number.isFinite(r.doc.canvas.duration))
}
ok('at most 8 scenes', run({ tokens: { color: { a: '#000000' } }, scenes: Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, dur: 2, layers: [{ type: 'fill', color: 'a' }, { type: 'shape', shape: 'rect', color: 'a', box: { x: 0, y: 0, w: 10, h: 10 } }] })) }).doc.scenes.length === 8)
ok('duplicate ids made unique', new Set(run(base([{ type: 'fill', color: 'cream', id: 'a' }, { type: 'shape', shape: 'rect', color: 'bark', box: { x: 0, y: 0, w: 5, h: 5 }, id: 'a' }])).doc.scenes[0].layers.map(l => l.id)).size === 2)
ok('a scene always starts on a ground', run(base([{ type: 'shape', shape: 'rect', color: 'bark', box: { x: 0, y: 0, w: 5, h: 5 } }])).doc.scenes[0].layers[0].type === 'fill')
ok('a refused photo source never reaches the asset table', Object.keys(run(base([{ type: 'photo', photo: 'p1', box: { x: 0, y: 0, w: 10, h: 10 } }]), trusted({ p1: { ...good, src: 'https://evil.example/x.jpg' } })).doc.assets.photos).length === 0)
ok('owners brief → owner rules', rulesFor({ audience: 'owners', area: 'miami' }).guestAd === false && rulesFor({ audience: 'owners', area: 'miami' }).endsOn.indexOf('Nick') >= 0)

// ── the four house pieces go through the same door and come out unchanged the second time ──
for (const k of Object.keys(SEEDS)) {
  const a = reopenComposition(SEEDS[k])
  eq(k + ': nothing dropped from the house piece', a.notes, [])
  const b = reopenComposition(JSON.parse(JSON.stringify(a.doc)))
  eq(k + ': stable through a second pass', { ...b.doc, meta: 0 }, { ...a.doc, meta: 0 })
  ok(k + ': five scenes, fifteen seconds', a.doc.scenes.length === 5 && Math.abs(a.doc.canvas.duration - 15) < 0.01)
  ok(k + ': housePiece() returns it', housePiece(k).id === a.doc.id)
}
ok('no house piece for an unknown event', housePiece('ultra') === null)

// ── words in and out, for editing in place ──
const head = reopenComposition(SEEDS.thanksgiving).doc.scenes[0].layers.find(l => l.id === 's1-head')
eq('runs → plain', runsToPlain(head), 'Thanksgiving,\nsomewhere *warm.*')
eq('plain → runs keeps the accent’s look', plainToRuns('Thanksgiving,\nsomewhere *warm.*', head), head.runs)
const edited = plainToRuns('Friendsgiving,\nsomewhere *sunny.*', head)
ok('edited words keep the accent style and colour', edited[3].t === 'sunny.' && edited[3].style === 'displayAccent' && edited[3].color === 'pumpkin' && edited[2].t === 'somewhere ')
eq('stars removed → plain words, nothing lost', plainToRuns('Just words', head), [{ t: 'Just words' }])
eq('empty text keeps what was there', plainToRuns('   ', head), head.runs)
ok('contrast maths: black on white is 21:1', Math.abs(contrast(lum('#000000'), lum('#FFFFFF')) - 21) < 0.01)
done()
