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
  const ph = d.scenes.flatMap(s => s.layers).find(l => l.type === 'photo')
  const sw = E.swapPhoto(d, ph.id, 'lib1', big)
  const nl = E.findLayer(sw, ph.id).layer
  ok(k + ': swapped photo is in the table under its key', sw.assets.photos[nl.photo].src === big.src)
  ok(k + ': a large photograph keeps its window', nl.box.w === ph.box.w && nl.box.h === ph.box.h)
  const sm = E.findLayer(E.swapPhoto(d, ph.id, 'lib2', small), ph.id).layer
  ok(k + ': a small photograph is never stretched — its window shrinks', maxUpscale(sm, small.w, small.h) <= 1.005, { box: sm.box })
  ok(k + ': the swap survives the validator', E.findLayer(round(sw), ph.id).layer.photo === nl.photo && !!round(sw).assets.photos[nl.photo])
  ok(k + ': the same photograph is reported as in use', E.photoInUse(sw, big.src) !== null && E.photoInUse(sw, big.src, ph.id) === null)
  const added = E.addSceneLike(d, d.scenes[1].id, 'lib1', big)
  ok(k + ': a new scene after the second', added.doc.scenes.length === d.scenes.length + 1 && added.doc.scenes[2].id === added.sceneId && endToEnd(added.doc))
  const ids = added.doc.scenes.flatMap(s => [s.id, ...s.layers.map(l => l.id)])
  ok(k + ': every id in the piece is still unique', new Set(ids).size === ids.length)
  ok(k + ': the new scene shows the new photograph, once', added.doc.scenes[2].layers.filter(l => l.type === 'photo').length === 1 && !codes(added.doc).includes('photo-reuse') && !codes(added.doc).includes('collage'))
  ok(k + ': the new scene survives the validator', round(added.doc).scenes.length === added.doc.scenes.length)

  // layers
  const gone = E.deleteLayer(d, ph.id)
  ok(k + ': a visual can be deleted', !E.findLayer(gone, ph.id) && gone.scenes.length === d.scenes.length)
  const tx = E.addText(d, s2.id, 'headline')
  ok(k + ': a headline can be added, on top', tx.doc.scenes[1].layers[tx.doc.scenes[1].layers.length - 1].id === tx.layerId)
  ok(k + ': the added headline is readable and inside the safe area', !codes(tx.doc).some(c => c === 'safe-area' || c === 'text-fit' || c === 'text-small'), codes(tx.doc))
  ok(k + ': the added headline survives the validator', !!E.findLayer(round(tx.doc), tx.layerId))
  const mv = E.setBox(d, ph.id, { x: 100, y: 200 })
  eq(k + ': moved', [E.findLayer(mv, ph.id).layer.box.x, E.findLayer(mv, ph.id).layer.box.y], [100, 200])
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
done()
