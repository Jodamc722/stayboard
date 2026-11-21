// node lib/adx/__tests__/quality.test.mjs
// AD STUDIO — GENERATION QUALITY (Jon, 2026-11-21: "We need the best direction for ad generation with real audits
// and real top line designs. From posts, to videos to shorts"). Three things are held to account here:
//   1. ONE PIECE, EVERY SHAPE: every house design is laid out again for a story, a 4:5 feed post and a square, and
//      each result must come through the validator unchanged and pass the measured check with nothing to fix.
//   2. THE CRAFT SCORE: the house designs score as finished work, and a piece that is deliberately made worse loses
//      marks in the right place, with a reason a person can act on.
//   3. WHERE IT CAN GO: the right shape, clear of each platform's own buttons, a length that works there.
import { suite } from './_load.mjs'
const C = await import('../composition.ts')
const { reopenComposition, CHANNELS } = C
const { SEEDS } = await import('../seeds.ts')
const { approxMeasure, layoutText, maxUpscale } = await import('../player.ts')
const { auditComposition } = await import('../audit.ts')
const { reflow, variantOf, SHAPE_LABEL } = await import('../reflow.ts')
const { scorePiece, craftLines, platformFit, PLATFORMS } = await import('../scorecard.ts')
const E = await import('../edit.ts')
const { ok, eq, done } = suite('adx quality')

const fails = d => auditComposition(d, approxMeasure).issues.filter(x => x.sev === 'fail').map(x => x.code + (x.scene ? ' ' + x.scene : '') + (x.layer ? ' ' + x.layer : ''))
const round = d => reopenComposition(JSON.parse(JSON.stringify(d))).doc
const house = k => reopenComposition(SEEDS[k]).doc
const SHAPES = ['vertical', 'story', 'feed', 'square']

// ── 1. one piece, every shape ──
for (const k of Object.keys(SEEDS)) {
  const d = house(k)
  ok(k + ': already vertical, so vertical is the piece itself', reflow(d, 'vertical') === d)
  for (const ch of ['story', 'feed', 'square']) {
    const r = reflow(d, ch), c = CHANNELS[ch], tag = `${k} → ${ch}`
    eq(tag + ': the frame and its safe area are the new shape’s', [r.canvas.w, r.canvas.h, r.canvas.safe, r.brief.channel], [c.w, c.h, c.safe, ch])
    eq(tag + ': passes the measured check with nothing to fix', fails(round(r)), [])
    eq(tag + ': survives the validator unchanged', round(r).scenes, r.scenes)
    ok(tag + ': same scenes, same lengths, same things in them', r.scenes.length === d.scenes.length && r.scenes.every((s, i) => s.dur === d.scenes[i].dur && s.id === d.scenes[i].id && s.layers.map(l => l.id + l.type).join() === d.scenes[i].layers.map(l => l.id + l.type).join()))
    ok(tag + ': the words are the same words', r.scenes.every((s, i) => JSON.stringify(s.layers.filter(l => l.type === 'text').map(l => l.runs)) === JSON.stringify(d.scenes[i].layers.filter(l => l.type === 'text').map(l => l.runs))))
    ok(tag + ': no photograph is shown above its real pixels', r.scenes.every(s => s.layers.every(l => l.type !== 'photo' || maxUpscale(l, r.assets.photos[l.photo].w, r.assets.photos[l.photo].h) <= 1.005)))
    ok(tag + ': every headline is at least the smallest size a headline may be', r.scenes.every(s => s.layers.every(l => l.type !== 'text' || !l.fit || layoutText(r, l, approxMeasure).size >= C.MIN_HEADLINE_PX)))
    ok(tag + ': a circle is still a circle', r.scenes.every((s, i) => s.layers.every((l, j) => { const o = d.scenes[i].layers[j]; return !(l.type === 'shape' && l.shape === 'ellipse' && o.box.w === o.box.h) || Math.abs(l.box.w - l.box.h) <= 1 })))
    // words, the logo and the button never land on one another
    const clash = r.scenes.some(s => { const it = s.layers.filter(l => l.type === 'text' || l.type === 'button').map(l => l.box); return it.some((a, i) => it.some((b, j) => j > i && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1)) })
    ok(tag + ': no two lines of words overlap', !clash)
    ok(tag + ': the piece scores as finished work in this shape too', scorePiece(round(r), approxMeasure).total >= 85, scorePiece(round(r), approxMeasure).total)
  }
  // and back again: a square made tall is still a correct piece
  const back = reflow(reflow(d, 'square'), 'vertical')
  eq(k + ': square and back to vertical still passes', fails(round(back)), [])
}
{
  const d = house('stays'), v = variantOf(d, 'feed')
  ok('a copy in another shape gets its own id from the server and says its shape in its name', v.id === 'piece' && / · Feed 4:5$/.test(v.title) && v.canvas.h === 1350)
  ok('making the copy does not touch the piece it came from', d.canvas.h === 1920 && !/Feed/.test(d.title))
  ok('a copy of a copy does not stack shape names', !/Feed 4:5 · Square/.test(variantOf(v, 'square').title) && / · Square 1:1$/.test(variantOf(v, 'square').title))
  ok('every shape has a name', SHAPES.every(s => SHAPE_LABEL[s].length > 4))
  // a piece a person has edited (an added scene with a video clip) reflows too
  const vid = { src: '/ads/library/book-a-call-short.mp4', w: 1080, h: 1920, dur: 24, kind: 'video', source: 'upload', building: '', unit: '', area: '', shows: 'Book a call' }
  const withClip = E.addVideoScene(d, d.scenes[1].id, 'video-a', vid).doc
  for (const ch of ['feed', 'square']) {
    const r = round(reflow(withClip, ch)), vl = r.scenes[2].layers.find(l => l.type === 'photo')
    ok(`a piece with a video clip → ${ch}: the clip still fills its frame and keeps its place in the file`, !!vl && vl.box.w === r.canvas.w && vl.box.h === r.canvas.h && vl.clip.start === 0 && r.assets.photos[vl.photo].kind === 'video', vl && vl.box)
    eq(`a piece with a video clip → ${ch}: passes the check`, fails(r), [])
  }
}

// ── 2. the craft score ──
for (const k of Object.keys(SEEDS)) {
  const d = house(k), c = scorePiece(d, approxMeasure)
  ok(k + ': a house design scores as finished work', c.total >= 88 && c.parts.every(p => p.score >= 7), JSON.stringify(c.parts.map(p => [p.key, p.score])))
  ok(k + ': six marks out of ten, each with its name', c.parts.length === 6 && c.parts.every(p => p.score >= 0 && p.score <= 10 && p.label.length > 3))
  ok(k + ': every mark taken off has a reason', c.parts.every(p => (p.score < 10) === (p.notes.length > 0)))
  ok(k + ': at most three things to fix first', c.top.length <= 3)
}
{
  const d = house('stays'), base = scorePiece(d, approxMeasure)
  const part = (c, key) => c.parts.find(p => p.key === key)
  const has = (c, key, re) => part(c, key).notes.some(n => re.test(n))
  // the same piece, made worse one way at a time
  const noLogo = { ...d, scenes: d.scenes.map(s => ({ ...s, layers: s.layers.filter(l => l.type !== 'logo') })) }
  ok('no logo: brand loses most', part(scorePiece(noLogo, approxMeasure), 'brand').score <= 6 && has(scorePiece(noLogo, approxMeasure), 'brand', /logo/i))
  const lateHook = E.patchLayer(d, 's1-head', l => ({ ...l, in: { preset: 'rise-lines', at: 1.6, dur: 0.9 } }))
  ok('a headline that lands late: the first frame says when', part(scorePiece(lateHook, approxMeasure), 'first').score < part(base, 'first').score && has(scorePiece(lateHook, approxMeasure), 'first', /2\.5 s/))
  const plainOpen = { ...d, scenes: d.scenes.map((s, i) => (i ? s : { ...s, layers: s.layers.filter(l => l.type !== 'photo' && l.type !== 'shape') })) }
  ok('opening on a plain ground: the first frame loses four', part(scorePiece(plainOpen, approxMeasure), 'first').score <= 6 && has(scorePiece(plainOpen, approxMeasure), 'first', /plain ground/))
  const longHook = E.patchLayer(d, 's1-head', l => ({ ...l, fit: { max: 70, min: 64, lines: 3 }, box: { ...l.box, h: 300 }, runs: [{ t: 'Come and stay with us in sunny Miami this year' }] }))
  ok('a ten-word opening line is marked down', has(scorePiece(longHook, approxMeasure), 'first', /10 words/))
  const timid = E.patchLayer(E.patchLayer(d, 's2-head', l => ({ ...l, fit: { max: 66, min: 64, lines: 2 } })), 's2-label', l => ({ ...l, size: 40, box: { ...l.box, h: 50 } }))
  ok('a headline barely larger than its label: hierarchy says so, and by how much', has(scorePiece(timid, approxMeasure), 'hierarchy', /only 1\.[0-9]× the size of its label/) && has(scorePiece(timid, approxMeasure), 'hierarchy', /small on a phone/))
  const sameTwice = { ...d, scenes: d.scenes.map((s, i) => (i === 3 ? { ...d.scenes[2], id: s.id, name: 'Again', layers: d.scenes[2].layers.map(l => ({ ...l, id: 'x-' + l.id, ...(l.type === 'photo' ? { photo: 'a_balcony' } : {}) })) } : s)) }
  ok('the same layout twice in a row: rhythm names both scenes', part(scorePiece(sameTwice, approxMeasure), 'rhythm').score <= 8 && has(scorePiece(sameTwice, approxMeasure), 'rhythm', /“The kitchen” and “Again” are laid out the same way/))
  const shortEnd = E.retime({ ...d, scenes: d.scenes.map((s, i) => (i === d.scenes.length - 1 ? { ...s, dur: 2 } : s)) })
  ok('a two-second end card: rhythm and the measured check both count', has(scorePiece(shortEnd, approxMeasure), 'rhythm', /last scene holds 2\.0 s/) && part(scorePiece(shortEnd, approxMeasure), 'finish').score < 10)
  const silent = E.setMusic(d, '', '')
  ok('no song: finish says so', has(scorePiece(silent, approxMeasure), 'finish', /no song/))
  const tiny = { ...d, scenes: d.scenes.map(s => ({ ...s, layers: s.layers.map(l => (l.type === 'photo' ? { ...l, box: { x: 340, y: l.box.y + 100, w: 400, h: 300 } } : l)) })) }
  ok('photographs in timid little windows: composition gives the share', has(scorePiece(tiny, approxMeasure), 'composition', /small windows \(\d+% of the frame/))
  const worse = scorePiece(E.setMusic(noLogo, '', ''), approxMeasure)
  ok('worse in two ways scores lower than worse in one, and lower than the design', worse.total < scorePiece(noLogo, approxMeasure).total && scorePiece(noLogo, approxMeasure).total < base.total)
  ok('what to fix first comes from the weakest mark', worse.top.length > 0 && /logo/i.test(worse.top.join(' ')))
  const lines = craftLines(worse)
  ok('the notes go to the creative director as lines that say which mark they are', /^- \[craft: brand\] /m.test(lines) && /^- \[craft: finish\] /m.test(lines) && craftLines(scorePiece(house('team'), approxMeasure)) === '')
  // the score never changes the piece
  const before = JSON.stringify(d); scorePiece(d, approxMeasure); platformFit(d)
  ok('scoring does not touch the piece', JSON.stringify(d) === before)
}

// ── 3. where it can go ──
{
  const d = house('stays'), fit = platformFit(d), by = k => fit.find(f => f.key === k)
  eq('six places, in the order people post', fit.map(f => f.key), ['reels', 'tiktok', 'shorts', 'story', 'feed', 'square'])
  ok('a vertical piece is ready for Reels, Shorts and Stories', by('reels').state === 'ready' && by('shorts').state === 'ready' && by('story').state === 'ready')
  ok('fifteen seconds is short for TikTok, and it says what works there', by('tiktok').state === 'notes' && /20 to 35 s/.test(by('tiktok').notes.join(' ')))
  ok('a feed post and a square need their own shape, and say which', by('feed').state === 'shape' && by('feed').channel === 'feed' && /4:5/.test(by('feed').notes[0]) && by('square').state === 'shape' && /1:1/.test(by('square').notes[0]))
  const sq = platformFit(reflow(d, 'square'))
  eq('the square copy is ready as a square and nothing else', sq.filter(f => f.state !== 'shape').map(f => f.key + ':' + f.state), ['square:ready'])
  eq('the feed copy is ready as a feed post', platformFit(reflow(d, 'feed')).filter(f => f.state !== 'shape').map(f => f.key + ':' + f.state), ['feed:ready'])
  // the studio's vertical safe area is wider than every platform's own buttons
  ok('the vertical safe area clears every tall platform’s buttons', PLATFORMS.filter(p => p.channel !== 'feed' && p.channel !== 'square').every(p => p.chrome.top <= CHANNELS.vertical.safe.top && p.chrome.bottom <= CHANNELS.vertical.safe.bottom && p.chrome.left <= CHANNELS.vertical.safe.left && p.chrome.right <= CHANNELS.vertical.safe.right))
  // a story's words run wider than TikTok's buttons allow: posted there, it is told
  const story = reflow(d, 'story'), wide = E.patchLayer(story, 's1-head', l => ({ ...l, box: { ...l.box, w: 952 } }))
  ok('words under a platform’s buttons are named by scene', platformFit(wide).find(f => f.key === 'tiktok').notes.some(n => /“Hook: the rooftop” sit under TikTok/.test(n)) && platformFit(wide).find(f => f.key === 'story').state === 'ready')
  const long = E.setTotal(d, 50)
  ok('fifty seconds: long for Reels and Stories, and it says so', /15 to 45 s/.test(platformFit(long).find(f => f.key === 'reels').notes.join(' ')) && /5 to 15 s/.test(platformFit(long).find(f => f.key === 'story').notes.join(' ')))
  ok('a piece with no song is told the feeds play with sound', platformFit(E.setMusic(d, '', '')).find(f => f.key === 'reels').notes.some(n => /sound on/.test(n)) && !platformFit(E.setMusic(d, '', '')).find(f => f.key === 'feed').notes.some(n => /sound/.test(n)))
  ok('every platform names a best length inside what it allows', PLATFORMS.every(p => p.best[0] < p.best[1] && p.best[1] <= p.max))
}

// ── 4. the direction the designer is given ──
{
  const B = await import('../brief.ts'), V = await import('../versions.ts')
  const brief = (channel, seconds) => C.cleanBrief({ audience: 'guests', moment: 'stays', area: 'miami', channel, seconds })
  const sys = B.composerSystem('guests', house('ownerstory'))
  ok('the designer is told how its piece will be marked, with the same numbers the score uses', /HOW IT WILL BE MARKED/.test(sys) && /landed by 1\.5 s/.test(sys) && /2\.5 times the size of any label/.test(sys) && /16% of the frame/.test(sys) && /4 words a second/.test(sys) && /3\.2 s/.test(sys))
  const pb = [B.formatPlaybook(brief('vertical', 15)), B.formatPlaybook(brief('story', 15)), B.formatPlaybook(brief('feed', 15)), B.formatPlaybook(brief('square', 15)), B.formatPlaybook(brief('vertical', 6))]
  ok('each format has its own playbook', new Set(pb).size === 5 && /A SHORT/.test(pb[0]) && /A STORY/.test(pb[1]) && /POST IN THE FEED \(4:5\)/.test(pb[2]) && /POST IN THE FEED \(square\)/.test(pb[3]) && /A STILL/.test(pb[4]))
  ok('the playbook is in what the designer is sent for the piece', B.composerUser(brief('feed', 15), { name: 'x', idea: 'y', look: 'stay-black' }, [{ vo: 'a', head: 'b', photo: '' }], 'c', {}).indexOf(pb[2]) > 0)
  ok('an owner piece learns from the stays design and a stays piece from the owner design', B.exampleFor('ownerstory', 'owners') === 'stays' && B.exampleFor('stays', 'guests') === 'ownerstory')
  ok('an owner piece for a calendar date is shown the owner design; a team piece the team design', B.exampleFor('march-owners', 'owners') === 'ownerstory' && B.exampleFor('someevent', 'team') === 'team' && B.exampleFor('someevent', 'guests') === 'thanksgiving')
  ok('the review is told what the craft lines are', /\[craft: …\] are weaknesses measured in the design/.test(B.reviewPrompt(house('stays'), '- [craft: rhythm] x', {}, 1, 2)))
  ok('this release is written down', V.adxVersion().v === '1.2' && V.adxVersion().items.length >= 4)
}
done()
