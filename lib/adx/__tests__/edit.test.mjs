// node lib/adx/__tests__/edit.test.mjs
// AD STUDIO EDITOR (Jon, 2026-11-20: "change themes, songs, length of videos or scenes, transitions … click into the
// video and change things, delete visuals, add photos, swap photo"). Every edit is a pure function on the document;
// these run them on the four house pieces and hold the results to the same door (the validator) and the same audit.
import { suite } from './_load.mjs'
const { reopenComposition } = await import('../composition.ts')
const { SEEDS } = await import('../seeds.ts')
const { approxMeasure, maxUpscale, restTime } = await import('../player.ts')
const { auditComposition } = await import('../audit.ts')
const E = await import('../edit.ts')
const { ok, eq, done } = suite('adx edit')

const codes = d => auditComposition(d, approxMeasure).issues.filter(x => x.sev === 'fail').map(x => x.code)
const endToEnd = d => d.scenes.every((s, i) => i === 0 ? s.start === 0 : Math.abs(s.start - (d.scenes[i - 1].start + d.scenes[i - 1].dur)) < 0.002) && Math.abs(d.canvas.duration - d.scenes.reduce((a, s) => a + s.dur, 0)) < 0.01
const round = d => reopenComposition(JSON.parse(JSON.stringify(d))).doc
const big = { src: 'https://assets.guesty.com/image/upload/v1/test/big.jpg', w: 4000, h: 3000, source: 'ours', building: 'Elser', unit: 'Elser 1201', area: 'miami', shows: 'Kitchen with an island' }
const small = { ...big, src: 'https://assets.guesty.com/image/upload/v1/test/small.jpg', w: 1000, h: 700 }

for (const k of Object.keys(SEEDS)) {
  const d = reopenComposition(SEEDS[k]).doc
  const base = codes(d)
  eq(k + ': the house piece passes before any edit', base, [])
  const s2 = d.scenes[1], last = d.scenes[d.scenes.length - 1]

  // length
  for (const n of [10, 20, 30]) {
    const x = E.setTotal(d, n)
    ok(`${k}: ${n} s — total within a quarter second`, Math.abs(x.canvas.duration - n) < 0.26, x.canvas.duration)
    ok(`${k}: ${n} s — scenes end to end`, endToEnd(x))
    ok(`${k}: ${n} s — the end card still holds 3 s`, x.scenes[x.scenes.length - 1].dur >= 3)
    ok(`${k}: ${n} s — the brief asks for the same`, x.brief.seconds === n)
    ok(`${k}: ${n} s — no entrance starts after its scene has nearly ended`, x.scenes.every(s => s.layers.every(l => !l.in || l.in.at <= s.dur - 0.85)))
    eq(`${k}: ${n} s — survives the validator`, round(x).scenes.map(s => s.dur), x.scenes.map(s => s.dur))
  }
  const longer = E.setSceneDur(d, s2.id, s2.dur + 2)
  ok(k + ': one scene two seconds longer', Math.abs(longer.canvas.duration - d.canvas.duration - 2) < 0.05 && endToEnd(longer))
  ok(k + ': a scene cannot be shorter than the floor', E.setSceneDur(d, s2.id, 0.2).scenes[1].dur >= E.SCENE_MIN - 0.01)

  // transitions
  const pushed = E.setTransition(d, s2.id, { type: 'push', dir: 'left', dur: 0.9 })
  eq(k + ': a push from the left', [pushed.scenes[1].transitionIn.type, pushed.scenes[1].transitionIn.dir], ['push', 'left'])
  ok(k + ': a transition never takes more than 40% of its scene', pushed.scenes[1].transitionIn.dur <= pushed.scenes[1].dur * 0.4 + 0.001)
  const cut = E.setTransition(d, s2.id, { type: 'cut' })
  eq(k + ': a cut carries no direction or length', cut.scenes[1].transitionIn, { type: 'cut' })
  const all = E.setAllTransitions(d, { type: 'dissolve', dur: 0.5 })
  ok(k + ': one transition for every scene, none on the first', all.scenes[0].transitionIn.type === 'none' && all.scenes.slice(1).every(s => s.transitionIn.type === 'dissolve'))
  eq(k + ': transitions survive the validator', round(pushed).scenes[1].transitionIn, pushed.scenes[1].transitionIn)

  // scene order
  const moved = E.moveScene(d, d.scenes[0].id, 1)
  ok(k + ': moving the first scene later keeps the opener without a transition', moved.scenes[0].transitionIn.type === 'none' && moved.scenes[1].transitionIn.type !== 'none' && moved.scenes[1].id === d.scenes[0].id && endToEnd(moved))
  const fewer = E.deleteScene(d, s2.id)
  ok(k + ': deleting a scene', fewer.scenes.length === d.scenes.length - 1 && endToEnd(fewer) && !fewer.script.lines.some(l => l.scene === s2.id))

  // themes: every theme keeps the piece legible (no new contrast failure) and keeps its palette keys
  for (const th of E.THEMES) {
    const x = E.applyTheme(d, th)
    eq(`${k}/${th.key}: same palette keys`, Object.keys(x.tokens.color).sort(), Object.keys(d.tokens.color).sort())
    const bad = codes(x).filter(c => c === 'contrast' || c === 'logo-contrast')
    eq(`${k}/${th.key}: still legible`, bad, [])
    eq(`${k}/${th.key}: survives the validator`, round(x).tokens.color, x.tokens.color)
  }
  const flipped = E.flipLightDark(d)
  eq(k + ': light and dark swapped is still legible', codes(flipped).filter(c => c === 'contrast' || c === 'logo-contrast'), [])
  const { lum: lumOf } = await import('../composition.ts')
  const twice = E.flipLightDark(flipped).tokens.color
  ok(k + ': swapped twice is as bright as it was, colour by colour', Object.keys(d.tokens.color).every(c => Math.abs(lumOf(twice[c]) - lumOf(d.tokens.color[c])) < 0.02), twice)
  ok(k + ': swapped, the lightest colour is now the darkest', Object.entries(flipped.tokens.color).sort((a, b) => lumOf(a[1]) - lumOf(b[1]))[0][0] === Object.entries(d.tokens.color).sort((a, b) => lumOf(b[1]) - lumOf(a[1]))[0][0])
  ok(k + ': a colour can be fine-tuned', E.setColor(d, Object.keys(d.tokens.color)[0], '#123456').tokens.color[Object.keys(d.tokens.color)[0]] === '#123456')
  ok(k + ': a bad colour is ignored', E.setColor(d, Object.keys(d.tokens.color)[0], 'red') === d)

  // music
  const m = E.setMusic(d, 'werq', 'Music: "Werq" by Kevin MacLeod', 0.3)
  eq(k + ': the song and its credit survive the validator', round(m).assets.audio.music, { track: 'werq', gain: 0.3, credit: 'Music: "Werq" by Kevin MacLeod', fadeOut: 2, start: 0 })
  eq(k + ': no music', round(E.setMusic(d, '', '')).assets.audio.music.track, '')

  // photographs
  // (the team design is type and colour only: what follows needs a photograph, so it runs on the six that have one)
  const ph = d.scenes.flatMap(s => s.layers).find(l => l.type === 'photo')
  ok(k + ': has photographs, unless it is the team design', !!ph === (k !== 'team'))
  if (ph) {
  const sw = E.swapPhoto(d, ph.id, 'lib1', big)
  const nl = E.findLayer(sw, ph.id).layer
  ok(k + ': swapped photo is in the table under its key', sw.assets.photos[nl.photo].src === big.src)
  ok(k + ': a large photograph keeps its window', nl.box.w === ph.box.w && nl.box.h === ph.box.h)
  const sm = E.findLayer(E.swapPhoto(d, ph.id, 'lib2', small), ph.id).layer
  ok(k + ': a small photograph is never stretched — its window shrinks', maxUpscale(sm, small.w, small.h) <= 1.005, { box: sm.box })
  ok(k + ': the swap survives the validator', E.findLayer(round(sw), ph.id).layer.photo === nl.photo && !!round(sw).assets.photos[nl.photo])
  ok(k + ': the same photograph is reported as in use', E.photoInUse(sw, big.src) !== null && E.photoInUse(sw, big.src, ph.id) === null)
  const gone = E.deleteLayer(d, ph.id)
  ok(k + ': a visual can be deleted', !E.findLayer(gone, ph.id) && gone.scenes.length === d.scenes.length)
  const mv = E.setBox(d, ph.id, { x: 100, y: 200 })
  eq(k + ': moved', [E.findLayer(mv, ph.id).layer.box.x, E.findLayer(mv, ph.id).layer.box.y], [100, 200])
  ok(k + ': a photograph of a unit never takes an added image\'s movement', !E.findLayer(round(E.patchLayer(d, ph.id, l => ({ ...l, idle: 'spin' }))), ph.id).layer.idle)
  }
  const added = E.addSceneLike(d, d.scenes[1].id, 'lib1', big)
  ok(k + ': a new scene after the second', added.doc.scenes.length === d.scenes.length + 1 && added.doc.scenes[2].id === added.sceneId && endToEnd(added.doc))
  const ids = added.doc.scenes.flatMap(s => [s.id, ...s.layers.map(l => l.id)])
  ok(k + ': every id in the piece is still unique', new Set(ids).size === ids.length)
  ok(k + ': the new scene shows the new photograph, once', added.doc.scenes[2].layers.filter(l => l.type === 'photo').length === 1 && !codes(added.doc).includes('photo-reuse') && !codes(added.doc).includes('collage'))
  ok(k + ': the new scene survives the validator', round(added.doc).scenes.length === added.doc.scenes.length)

  // layers
  const tx = E.addText(d, s2.id, 'headline')
  ok(k + ': a headline can be added, on top', tx.doc.scenes[1].layers[tx.doc.scenes[1].layers.length - 1].id === tx.layerId)
  ok(k + ': the added headline is readable and inside the safe area', !codes(tx.doc).some(c => c === 'safe-area' || c === 'text-fit' || c === 'text-small'), codes(tx.doc))
  ok(k + ': the added headline survives the validator', !!E.findLayer(round(tx.doc), tx.layerId))
  const up = E.reorderLayer(d, s2.layers[1].id, 1)
  ok(k + ': one step forward', up.scenes[1].layers[2].id === s2.layers[1].id)
  ok(k + ': the ground stays at the bottom', E.reorderLayer(d, s2.layers[1].id, -1) === d || s2.layers[0].type !== 'fill')
  const head = d.scenes[0].layers.find(l => l.type === 'text' && l.fit)
  ok(k + ': bigger type', E.findLayer(E.resizeText(d, head.id, 2), head.id).layer.fit.max === head.fit.max + 8)
  const en = E.setEntrance(d, head.id, { preset: 'fade', at: 99 })
  ok(k + ': an entrance is kept inside its scene', E.findLayer(en, head.id).layer.in.at <= d.scenes[0].dur - 0.9 + 0.001)
  ok(k + ': "already there" removes the entrance', !E.findLayer(E.setEntrance(d, head.id, null), head.id).layer.in)

  // adding things (Jon, 2026-11-20: "add shape or image or png tree or lights etc option when you click")
  const before = codes(d)
  for (const sk of E.SHAPE_KINDS) {
    const r = E.addShape(d, s2.id, sk.key, { x: 400, y: 900 })
    const nl2 = E.findLayer(r.doc, r.layerId)
    ok(`${k}: a ${sk.key} can be added and is the right kind`, !!nl2 && nl2.layer.type === 'shape' && E.shapeKind(nl2.layer) === sk.key)
    ok(`${k}: the ${sk.key} survives the validator as the same kind`, E.shapeKind(E.findLayer(round(r.doc), r.layerId).layer) === sk.key)
    const words = r.doc.scenes[1].layers.findIndex(l => l.type === 'text' || l.type === 'logo' || l.type === 'button')
    ok(`${k}: the ${sk.key} sits under the words`, words < 0 || nl2.li < words)
    const moved2 = E.setBox(r.doc, r.layerId, { x: 50, y: 60 })
    ok(`${k}: a moved ${sk.key} is still the same kind`, E.shapeKind(E.findLayer(moved2, r.layerId).layer) === sk.key)
  }
  for (const dc of E.DECORATIONS) {
    const hasBtn = last.layers.some(l => l.type === 'button'), sid = dc.needsButton ? last.id : s2.id
    const r = E.addDecoration(d, sid, dc.key, { x: 500, y: 700 })
    if (dc.needsButton && !hasBtn) { ok(`${k}: ${dc.key} is not added without a button`, r.layerId === ''); continue }
    const got = E.findLayer(round(r.doc), r.layerId)
    ok(`${k}: ${dc.key} can be added and survives the validator`, !!got && got.layer.type === 'motif' && got.layer.motif === dc.key, r.layerId)
    ok(`${k}: ${dc.key} never rests on the words`, !codes(r.doc).includes('decor-on-words'), codes(r.doc))
    ok(`${k}: ${dc.key} adds no new failure`, codes(r.doc).filter(c => !before.includes(c)).length === 0, codes(r.doc))
    ok(`${k}: ${dc.key} has a name`, E.layerName(r.doc, got.layer).length > 2)
  }
  const sticker = { src: '/api/ads/image?path=ai%2F202611%2Fabc123def456.png', w: 800, h: 600, source: 'upload', building: '', unit: '', area: '', shows: 'palm sticker' }
  const im = E.addImage(d, s2.id, sticker, { x: 300, y: 500 })
  const iml = E.findLayer(round(im.doc), im.layerId)
  ok(k + ': an image can be added and survives the validator', !!iml && round(im.doc).assets.photos[iml.layer.photo].source === 'upload')
  ok(k + ': the added image keeps its shape and is not stretched', Math.abs(iml.layer.box.w / iml.layer.box.h - 800 / 600) < 0.02 && E.upscaleOf(im.doc, iml.layer) <= 1.005, iml.layer.box)
  ok(k + ': an added image is not counted as a second photograph', !codes(im.doc).includes('collage') && !codes(im.doc).includes('photo-reuse') && !codes(im.doc).includes('photo-source'), codes(im.doc))
  ok(k + ': the same image can be used in another scene', !codes(E.addImage(im.doc, d.scenes[2].id, sticker).doc).includes('photo-reuse'))
  ok(k + ': an added image is named as one', /^Image/.test(E.layerName(im.doc, iml.layer)) && E.isAdded(im.doc, iml.layer))
  ok(k + ': an image from anywhere else is refused by the validator', !Object.values(round(E.addImage(d, s2.id, { ...sticker, src: 'https://example.com/x.png' }).doc).assets.photos).some(p => p.src.indexOf('example.com') >= 0))
  const moving = E.patchLayer(im.doc, im.layerId, l => ({ ...l, idle: 'float' }))
  eq(k + ': an added image keeps its gentle movement through the validator', E.findLayer(round(moving), im.layerId).layer.idle, 'float')
  const big2 = E.patchLayer(im.doc, im.layerId, l => ({ ...l, box: { ...l.box, w: 1000, h: 750 } }))
  ok(k + ': an added image drawn past its pixels is caught', codes(big2).includes('photo-soft'))

  // the music's fade
  const { musicLevel } = await import('../composition.ts')
  const fd = E.setMusicFade(d, 3)
  eq(k + ': the fade-out survives the validator', round(fd).assets.audio.music.fadeOut, 3)
  eq(k + ': changing the song keeps the fade', E.setMusic(fd, 'werq', 'x').assets.audio.music.fadeOut, 3)
  const st = E.setMusicStart(E.setMusic(d, 'rooftops', ''), 22)
  eq(k + ': the song start survives the validator', round(st).assets.audio.music.start, 22)
  eq(k + ': a new song starts from its beginning again', E.setMusic(st, 'faded', '').assets.audio.music.start, 0)
  eq(k + ': the same song keeps its start', E.setMusic(st, 'rooftops', '', 0.4).assets.audio.music.start, 22)
  ok(k + ': silent at the very start and the very end', musicLevel(0, 15, 0.5, 3) === 0 && musicLevel(15, 15, 0.5, 3) === 0)
  ok(k + ': full in the middle, half way down half way through the fade', musicLevel(7, 15, 0.5, 3) === 0.5 && Math.abs(musicLevel(13.5, 15, 0.5, 3) - 0.25) < 0.001)
  ok(k + ': no fade holds the level to the end', musicLevel(14.99, 15, 0.5, 0) === 0.5)

  // clicking into the picture
  const sc = d.scenes[0], phot = sc.layers.find(l => l.type === 'photo')
  if (phot) {
    const hits = E.hitLayers(d, 0, phot.box.x + phot.box.w / 2, phot.box.y + phot.box.h / 2, approxMeasure)
    ok(k + ': a click in the middle of the photograph finds it', hits.some(l => l.id === phot.id), hits.map(l => l.id))
  }
  const L = (await import('../player.ts')).layoutText(d, head, approxMeasure).rect
  eq(k + ': a click on the headline picks the headline first', E.hitLayers(d, 0, (L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2, approxMeasure)[0].id, head.id)
  ok(k + ': every layer has a name a person would use', d.scenes.every(s => s.layers.every(l => E.layerName(d, l).length > 2)))
  ok(k + ': rest time still inside every scene after a retime', E.retime(d).scenes.every(s => restTime(s) > s.start && restTime(s) < s.start + s.dur))
}
// the song list: every file is in the app, keys are ones a piece can hold, public-domain tracks carry no credit
{
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../../ad-engine.ts', import.meta.url), 'utf8')
  const rows = [...src.matchAll(/\{ key: '([a-z0-9]+)', label: '([^']+)', mood: '([^']*)', file: '([^']*)', credit: ([^}]*?)(, fresh: true)? \},/g)]
  ok('the song list was read', rows.length >= 40, rows.length)
  const keys = rows.map(r => r[1])
  ok('song keys are unique', new Set(keys).size === keys.length)
  ok('every song key fits a piece', keys.every(k => /^[a-z0-9]{1,24}$/.test(k)))
  ok('every song file exists', rows.every(r => !r[4] || fs.existsSync(new URL('../../../public' + r[4], import.meta.url))), rows.filter(r => r[4] && !fs.existsSync(new URL('../../../public' + r[4], import.meta.url))).map(r => r[4]))
  const fresh = rows.filter(r => r[6])
  eq('sixteen new songs', fresh.length, 16)
  ok('the new songs carry no credit line (public domain)', fresh.every(r => r[5].trim() === "''"))
  const credits = fs.readFileSync(new URL('../../../public/ads/music/CREDITS.md', import.meta.url), 'utf8')
  ok('each new song is listed with its source', fresh.every(r => credits.indexOf(r[4].split('/').pop()) >= 0))
}
// from scratch: our stays, owners, the team (Jon, 2026-11-20: "team promo videos, culture events, announcements, internal ads")
{
  const C = await import('../composition.ts'), I = await import('../identities.ts')
  ok('the three from-scratch kinds are made by the new studio', C.ADX_ANYTIME.every(k => C.ADX_MOMENTS.includes(k)) && C.ADX_ANYTIME.length === 3)
  ok('each has an identity with a palette, looks and a song', C.ADX_ANYTIME.every(k => I.IDENTITIES[k] && Object.keys(I.IDENTITIES[k].palette).length >= 5 && I.IDENTITIES[k].looks.length && I.IDENTITIES[k].music))
  ok('each is offered in the brief with a fixed audience', I.ANYTIME.map(x => x.key).join() === C.ADX_ANYTIME.join() && I.ANYTIME.every(x => I.GOALS[x.audience].length > 0))
  eq('a team brief stays a team brief', C.cleanBrief({ audience: 'team' }).audience, 'team')
  const rt = C.rulesFor({ audience: 'team', area: '' }), rg = C.rulesFor({ audience: 'guests', area: 'miami' }), ro = C.rulesFor({ audience: 'owners', area: 'miami' })
  ok('a team piece sells nothing: no booking button, no owner line', !rt.guestAd && rt.endsOn === '' && !rt.noPrices)
  ok('guest and owner rules are what they were', rg.guestAd && rg.noPrices && /stay-hospitality/.test(rg.endsOn) && !ro.guestAd && /Nick/.test(ro.endsOn))
  // a team piece made only of type and colour passes the check without a button or a photograph
  const base = reopenComposition(SEEDS.basel).doc
  const teamDoc = C.sanitizeComposition({ concept: { name: 'Holiday lunch', idea: 'x', look: 'colour-field', identity: 'team' }, tokens: { color: I.IDENTITIES.team.palette, type: base.tokens.type }, scenes: [
    { id: 's1', name: 'News', dur: 4, layers: [{ type: 'fill', color: 'coral' }, { type: 'shape', shape: 'rect', color: 'cream', box: { x: 0, y: 1100, w: 1080, h: 820 }, in: { preset: 'fade', at: 0, dur: 0.4 } }, { type: 'shape', shape: 'ellipse', color: 'sky', box: { x: 560, y: 1180, w: 420, h: 420 } }, { type: 'logo', variant: 'black', box: { x: 64, y: 250, w: 150 } }, { type: 'text', style: 'display', color: 'black', box: { x: 64, y: 480, w: 860, h: 420 }, fit: { max: 150, min: 90, lines: 3 }, runs: [{ t: 'Holiday lunch.' }] }, { type: 'text', style: 'label', color: 'black', size: 34, box: { x: 64, y: 1240, w: 460, h: 50 }, runs: [{ t: 'Fri Dec 18 · noon' }] }] },
  ] }, { id: 'xteam', brief: { ...base.brief, audience: 'team', moment: 'team', momentName: 'Team (internal)', area: '', areaLabel: '', seconds: 4 }, canvas: base.canvas, photos: {} }).doc
  const tc = auditComposition(teamDoc, approxMeasure).issues.filter(x => x.sev === 'fail').map(x => x.code)
  ok('a team piece needs no booking button and no photograph', !tc.includes('end-cta') && !tc.includes('photo-source'), tc)
}
// AI graphics and styles (Jon, 2026-11-20: "Add graphic design, new style and needs the creative power of AI not just templates")
{
  const src = (await import('node:fs')).readFileSync(new URL('../prop.ts', import.meta.url), 'utf8')
  ok('ten art styles and nine brief styles are offered', (src.match(/\{ key: '[a-z0-9-]*', label: '[^']+', says:/g) || []).length === 10 && (src.match(/hint: '[^']+', art: '/g) || []).length === 9)
  ok('every prompt forbids text, logos and people, and a graphic is never a pretend photo', /No text, no letters, no numbers, no logos, no brand marks, no people/.test(src) && /not a photograph/.test(src))
  const C = await import('../composition.ts')
  eq('the brief keeps its style', C.cleanBrief({ style: 'three-d' }).style, 'three-d')
  const d = reopenComposition(SEEDS.christmas).doc, s2 = d.scenes[1]
  const art = { src: '/api/ads/image?path=ai%2F202611%2Fabc123def456.png', w: 900, h: 700, source: 'upload', building: '', unit: '', area: '', shows: 'Graphic: gift box' }
  const obj = E.placeArt(d, s2.id, art, { box: { x: 600, y: 1200, w: 360 }, idle: 'float' })
  const ol = E.findLayer(round(obj.doc), obj.layerId).layer
  eq('a graphic the director asked for sits where it was asked, keeps its shape and its movement', [ol.box.x, ol.box.y, ol.box.w, ol.box.h, ol.idle], [600, 1200, 360, 280, 'float'])
  ok('it is under the words', E.findLayer(obj.doc, obj.layerId).li < obj.doc.scenes[1].layers.findIndex(l => l.type === 'text'))
  const bd = E.placeArt(d, s2.id, { ...art, src: '/api/ads/image?path=ai%2F202611%2Fabc123def457.jpg', w: 1024, h: 1536 }, { backdrop: true })
  const bl = E.findLayer(round(bd.doc), bd.layerId)
  ok('a backdrop fills the frame, at the back, and survives the validator', bl.layer.cover === true && bl.layer.box.w === d.canvas.w && bl.layer.box.h === d.canvas.h && bl.li === 1)
  const bc = auditComposition(bd.doc, approxMeasure).issues.filter(x => x.sev === 'fail').map(x => x.code)
  ok('a backdrop is not a second photograph and is not called soft', !bc.includes('collage') && !bc.includes('photo-soft'), bc)
  ok('a photograph of a unit can never be turned into a cover graphic', !E.findLayer(round(E.patchLayer(d, d.scenes[0].layers.find(l => l.type === 'photo').id, l => ({ ...l, cover: true }))), d.scenes[0].layers.find(l => l.type === 'photo').id).layer.cover)
}
// everything on the new studio (Jon, 2026-11-20: "everything should run on the new engine")
{
  const I = await import('../identities.ts'), C = await import('../composition.ts')
  ok('an event with its own identity keeps it', I.identityOf('christmas').key === 'christmas' && I.identityOf('christmas', 'owners').name === 'Christmas')
  const ws = I.identityOf('winter-sun', 'guests', 'Winter sun season')
  ok('any other moment takes the brand identity for its audience, under its own name', ws.key === 'winter-sun' && ws.name === 'Winter sun season' && ws.palette.black === '#000000' && ws.subjects.length > 3)
  ok('an owner moment takes the owner identity, a team one the team identity', I.identityOf('basel-owners', 'owners').looks.join() === I.IDENTITIES.ownerstory.looks.join() && I.identityOf('x', 'team').music === I.IDENTITIES.team.music)
  ok('a still image is offered as a length', I.LENGTHS[0] === 6 && I.LENGTHS.includes(30))
  eq('the house designs are the four events and the three everyday kinds', C.ADX_HOUSE, ['thanksgiving', 'christmas', 'nye', 'basel', 'stays', 'ownerstory', 'team'])
  ok('every house design opens', C.ADX_HOUSE.every(k => !!SEEDS[k] && reopenComposition(SEEDS[k]).doc.concept.identity === k))
}
// versions (Jon, 2026-11-20: "have new versions … 1 a week")
{
  const V = await import('../versions.ts')
  ok('the studio has a version with what is new, newest first', V.ADX_VERSIONS.length >= 1 && V.adxVersion() === V.ADX_VERSIONS[0] && V.ADX_VERSIONS.every(x => /^\d+\.\d+$/.test(x.v) && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.items.length >= 1 && x.items.length <= 6) && V.ADX_VERSIONS.every((x, i, a) => !i || a[i - 1].date >= x.date))
}
// wider markets on the brief's "Where?" step (Jon, 2026-11-20: "more options, broader markets")
{
  const P = await import('../../ad-places.ts')
  eq('a single area is its own market', P.marketAreas('miami-beach'), ['miami-beach'])
  eq('Miami & Miami Beach', P.marketAreas('miami-all'), ['miami-beach', 'miami'])
  eq('Broward', P.marketAreas('broward'), ['fort-lauderdale', 'pompano'])
  ok('all South Florida is every area', P.marketAreas('south-florida').length === P.AREAS.length)
  eq('an unknown market has no areas', P.marketAreas('mars'), [])
  ok('every market has a label and buildings', P.MARKETS.every(m => P.MARKET_LABEL[m.key] && P.buildingsIn(P.marketAreas(m.key)).length > 0))
  eq('Surfside is named as people say it', P.buildingName('Boynton'), 'Surfside')
  const { cleanBrief } = await import('../composition.ts')
  eq('a market key survives the brief', cleanBrief({ area: 'south-florida' }).area, 'south-florida')
}

// ── THE TIMELINE'S CUTS, AND VIDEO CLIPS (Jon, 2026-11-21: "add video, shorten the video, cut the video … make the
//    edit feature amazing and similar to the best editing tools") ──
{
  const { videoTimes } = await import('../player.ts')
  const ids = d => d.scenes.flatMap(s => [s.id, ...s.layers.map(l => l.id)])
  const unique = d => new Set(ids(d)).size === ids(d).length
  const total = d => d.scenes.reduce((a, s) => a + s.dur, 0)
  const vid = { src: '/ads/library/book-a-call-short.mp4', w: 1080, h: 1920, dur: 24, kind: 'video', source: 'upload', building: '', unit: '', area: '', shows: 'Book a call' }
  for (const k of Object.keys(SEEDS)) {
    const d = reopenComposition(SEEDS[k]).doc, s2 = d.scenes[1], last = d.scenes[d.scenes.length - 1]

    // cut a scene in two
    const at = Math.round((s2.dur / 2) * 30) / 30
    ok(k + ': a scene can be cut in the middle', E.canSplit(d, s2.id, at))
    const sp = E.splitScene(d, s2.id, at)
    eq(k + ': cut — one more scene', sp.doc.scenes.length, d.scenes.length + 1)
    ok(k + ': cut — the piece is exactly as long as before', Math.abs(total(sp.doc) - total(d)) < 0.04 && endToEnd(sp.doc), total(sp.doc))
    ok(k + ': cut — the halves are where the cut was', Math.abs(sp.doc.scenes[1].dur - at) < 0.001 && Math.abs(sp.doc.scenes[2].dur - (s2.dur - at)) < 0.04 && sp.doc.scenes[2].id === sp.sceneId)
    eq(k + ': cut — the second half comes straight in', sp.doc.scenes[2].transitionIn.type, 'cut')
    ok(k + ': cut — every id is still its own', unique(sp.doc))
    ok(k + ': cut — nothing that had arrived comes in twice', sp.doc.scenes[2].layers.every(l => !l.in || s2.layers.some(o => o.in && o.in.at >= at - 0.01)))
    ok(k + ': cut — no entrance is left in the first half that starts after it ends', sp.doc.scenes[1].layers.every(l => !l.in || l.in.at < at))
    eq(k + ': cut — survives the validator', round(sp.doc).scenes.map(s => [s.id, s.dur]), sp.doc.scenes.map(s => [s.id, s.dur]))
    eq(k + ': cut — the check still passes', codes(sp.doc), [])
    ok(k + ': a cut too near an edge is refused', !E.canSplit(d, s2.id, 0.2) && !E.canSplit(d, s2.id, s2.dur - 0.2) && E.splitScene(d, s2.id, 0.2).doc === d)

    // the same scene again
    const du = E.duplicateScene(d, s2.id)
    ok(k + ': duplicate — the copy follows the scene', du.doc.scenes.length === d.scenes.length + 1 && du.doc.scenes[2].id === du.sceneId && du.doc.scenes[2].layers.length === s2.layers.length)
    ok(k + ': duplicate — ids its own, scenes end to end', unique(du.doc) && endToEnd(du.doc) && Math.abs(total(du.doc) - total(d) - s2.dur) < 0.04)
    eq(k + ': duplicate — survives the validator', round(du.doc).scenes.length, d.scenes.length + 1)

    // trim the start
    const tr = E.trimSceneStart(d, s2.id, 0.5)
    ok(k + ': trim the start — half a second shorter, end to end', Math.abs(tr.scenes[1].dur - (s2.dur - 0.5)) < 0.04 && endToEnd(tr))
    ok(k + ': trim the start — entrances come that much sooner, never before zero', tr.scenes[1].layers.every(l => !l.in || l.in.at >= 0))
    ok(k + ': trim the start — a scene is never trimmed away', E.trimSceneStart(d, s2.id, 99).scenes[1].dur >= E.SCENE_MIN - 0.01)
    ok(k + ': trim the start — time can be given back', E.trimSceneStart(d, s2.id, -1).scenes[1].dur > s2.dur + 0.9)

    // drag a scene to another place
    const mv = E.moveSceneTo(d, s2.id, 0)
    ok(k + ': move — the scene is first, the piece as long, end to end', mv.scenes[0].id === s2.id && endToEnd(mv) && Math.abs(total(mv) - total(d)) < 0.01)
    ok(k + ': move — to where it already is changes nothing', E.moveSceneTo(d, s2.id, 1) === d)

    // limits: a minute, sixteen scenes
    ok(k + ': a piece never runs past its longest', total(E.setSceneDur(d, s2.id, 500)) <= E.MAX_PIECE_SECONDS + 0.01)
    let many = d
    for (let i = 0; i < 30; i++) many = E.splitScene(many, many.scenes[0].id, many.scenes[0].dur / 2).doc
    for (let i = 0; i < 30; i++) many = E.duplicateScene(many, many.scenes[many.scenes.length - 1].id).doc
    ok(k + ': a piece never has more scenes than the most', many.scenes.length <= E.MAX_SCENES && total(many) <= E.MAX_PIECE_SECONDS + 0.01, many.scenes.length)

    // a video clip as a scene of its own
    const av = E.addVideoScene(d, s2.id, 'video-a', vid)
    const vs = av.doc.scenes.find(s => s.id === av.sceneId), vl = vs && vs.layers.find(l => l.id === av.layerId)
    ok(k + ': video — a new scene after the one on screen', av.doc.scenes.length === d.scenes.length + 1 && av.doc.scenes[2].id === av.sceneId)
    ok(k + ': video — edge to edge, from the start of the file', !!vl && vl.type === 'photo' && vl.cover === true && vl.clip.start === 0 && vl.box.w === d.canvas.w && vl.box.h === d.canvas.h)
    ok(k + ': video — up to eight seconds to begin with', vs.dur <= 8.001 && vs.dur >= E.SCENE_MIN)
    ok(k + ': video — it is a video, not an added image', E.isVideo(av.doc, vl) && !E.isAdded(av.doc, vl) && E.videoOf(av.doc, vs) === vl && /^Video/.test(E.layerName(av.doc, vl)))
    const rv = round(av.doc), rvl = rv.scenes[2].layers.find(l => l.id === av.layerId)
    ok(k + ': video — survives the validator as a video', rv.assets.photos[rvl.photo].kind === 'video' && rv.assets.photos[rvl.photo].dur === 24 && rvl.clip.start === 0 && rvl.cover === true)
    eq(k + ': video — the check has nothing to fix', codes(av.doc), [])
    const ae = E.addVideoScene(d, last.id, 'video-a', vid)
    ok(k + ': video — added from the end card, it goes before it', ae.doc.scenes[ae.doc.scenes.length - 1].id === last.id && ae.doc.scenes[ae.doc.scenes.length - 2].id === ae.sceneId)
    ok(k + ': video — a photograph is not a video clip', E.addVideoScene(d, s2.id, 'x', big).doc === d)

    // which part of the file, how fast, how loud
    const sc = E.setClip(av.doc, av.layerId, { start: 5, speed: 2, sound: 0.35 })
    eq(k + ': clip — start, speed and sound', E.findLayer(sc, av.layerId).layer.clip, { start: 5, speed: 2, sound: 0.35 })
    eq(k + ': clip — an odd speed is normal speed, silence is not written', E.findLayer(E.setClip(sc, av.layerId, { speed: 3, sound: 0 }), av.layerId).layer.clip, { start: 5 })
    ok(k + ': clip — cannot start past the end of the file', E.findLayer(E.setClip(sc, av.layerId, { start: 99 }), av.layerId).layer.clip.start <= 24 - 0.2 + 0.001)
    eq(k + ': clip — survives the validator', round(sc).scenes[2].layers.find(l => l.id === av.layerId).clip, { start: 5, speed: 2, sound: 0.35 })

    // the frame on screen
    const sv = sc.scenes[2]
    const vt = videoTimes(sc, sv.start + 1)
    ok(k + ': clip — one second in at double speed shows two seconds on', vt.length === 1 && Math.abs(vt[0].time - 7) < 0.01 && vt[0].speed === 2 && vt[0].sound === 0.35, JSON.stringify(vt.map(x => x.time)))
    ok(k + ': clip — no video on screen in a scene without one', videoTimes(sc, sc.scenes[0].start + 0.5).length === 0)
    ok(k + ': clip — past the end of the file the last frame holds', videoTimes(E.setClip(sc, av.layerId, { start: 23.5 }), sv.start + 2)[0].time <= 24 - 0.04 + 0.001)

    // cutting and trimming a clip keeps the footage where it was
    const cut = E.splitScene(sc, sv.id, 2), c1 = cut.doc.scenes[2].layers.find(l => l.type === 'photo'), c2 = cut.doc.scenes[3].layers.find(l => l.type === 'photo')
    ok(k + ': clip — cut at 2 s: the second half picks up where the first stopped', c1.clip.start === 5 && Math.abs(c2.clip.start - 9) < 0.01 && c2.clip.speed === 2 && c1.id !== c2.id, c2.clip.start)
    const before = videoTimes(sc, sv.start + 3)[0].time, after = videoTimes(cut.doc, cut.doc.scenes[3].start + 1)[0].time
    ok(k + ': clip — the same moment shows the same frame after the cut', Math.abs(before - after) < 0.01, before + ' ' + after)
    const tv = E.trimSceneStart(sc, sv.id, 1), tl = tv.scenes[2].layers.find(l => l.type === 'photo')
    ok(k + ': clip — trimming a second off its start moves it two seconds on in the file', Math.abs(tl.clip.start - 7) < 0.01 && Math.abs(tv.scenes[2].dur - (sv.dur - 1)) < 0.04)
    const back = E.trimSceneStart(sc, sv.id, -10), bl = back.scenes[2].layers.find(l => l.type === 'photo')
    ok(k + ': clip — time is only given back while there is earlier footage', bl.clip.start >= 0 && Math.abs((sv.dur + 2.5) - back.scenes[2].dur) < 0.05, back.scenes[2].dur)

    // a video in a photograph's window, and a photograph back
    const ph = d.scenes.flatMap(s => s.layers).find(l => l.type === 'photo' && !E.isAdded(d, l))
    if (ph) {
      const sw = E.swapPhoto(d, ph.id, 'video-a', vid), sl = E.findLayer(sw, ph.id).layer
      ok(k + ': a photograph\'s window can hold a video', E.isVideo(sw, sl) && sl.cover === true && sl.clip.start === 0)
      const bk = E.swapPhoto(sw, ph.id, 'p9', big), kl = E.findLayer(bk, ph.id).layer
      ok(k + ': and a photograph again', !E.isVideo(bk, kl) && !kl.clip)
    }
  }
  // the door: a video from anywhere but the library is not let in
  const d0 = reopenComposition(SEEDS[Object.keys(SEEDS)[0]]).doc
  const evil = E.addVideoScene(d0, d0.scenes[0].id, 'video-x', { ...vid, src: 'https://example.com/x.mp4' })
  const re = round(evil.doc)
  ok('a video from outside the library does not survive the validator', !Object.values(re.assets.photos).some(a => a.kind === 'video'))
  const lib = E.addVideoScene(d0, d0.scenes[0].id, 'video-y', { ...vid, src: '/api/adx/video?path=library%2Fmb1x2y3z4abc.mp4' })
  ok('a library video does', Object.values(round(lib.doc).assets.photos).some(a => a.kind === 'video' && a.src === '/api/adx/video?path=library%2Fmb1x2y3z4abc.mp4'))
  const V = await import('../versions.ts')
  ok('the editor release is written down', V.ADX_VERSIONS.some(x => x.v === '1.1' && x.items.length >= 3) && V.adxVersion().items.length >= 3)
}
done()
