// node lib/adx/__tests__/brief.test.mjs
// AD STUDIO REBUILD (Jon, 2026-11-20): the briefs the models receive must state every one of Jon's ad rules, and the
// format they are told must be the format the validator enforces.
import { suite } from './_load.mjs'
const C = await import('../composition.ts')
const { houseRules, formatSpec, composerSystem, composerUser, conceptPrompt, copyPrompt, repairPrompt, sceneCount, EXAMPLE_FOR } = await import('../brief.ts')
const { IDENTITIES, LOOKS, AUDIENCES, GOALS, VIBES } = await import('../identities.ts')
const { housePiece } = await import('../seeds.ts')
const { ok, eq, done } = suite('adx brief')

const has = (text, ...needles) => needles.every(n => (n instanceof RegExp ? n.test(text) : text.indexOf(n) >= 0))
const guests = houseRules('guests'), owners = houseRules('owners')
ok('black logo is the default; gold only where the palette has it', has(guests, 'The Stay logo is black', /gold appears only/))
ok('guest pieces: no prices, no phone, the one ask', has(guests, 'no prices', 'no phone number', 'Book at stay-hospitality.com'))
ok('owner pieces end on Nick’s line and are built for owners', has(owners, 'Talk to Nick · 651.200.8283', 'Never generic'))
ok('sales facts: 15%, 500+ units, 40+ platforms with the channels named', has(guests, '15% management fee', '500+ units', '40+ platforms', 'Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Marriott', 'Blueground'))
ok('“a local team and 24/7 guest support”, never CCS', has(guests, 'A local team and 24/7 guest support', 'never "CCS"'))
ok('March is the peak', has(guests, 'March is the peak month'))
ok('never Salato or Pompano Beach in a spoken line', has(guests, 'Spoken lines never contain "Salato" or "Pompano Beach"'))
ok('never a collage or a grid', has(guests, /Never a grid, a collage/))
ok('a photograph is used once and matches the scene', has(guests, 'A photograph is used once in a piece', 'The words of a scene describe what its photograph shows'))
ok('location-matched units', has(guests, 'Only our units in the area of the brief'))
ok('never enlarged past 100%; no filter; words on a ground', has(guests, 'never drawn larger than 100%', '"treatment": "none"', 'Never darken a photograph'))

const sys = composerSystem('guests', housePiece('basel'))
ok('the composer is told it designs one piece, not a template', has(sys, 'You are not filling in a template'))
ok('the composer gets the house rules', sys.indexOf(guests) >= 0)
ok('the whole frame must be designed (the empty bottom third the lead saw)', has(sys, 'DESIGN THE WHOLE FRAME', '20% of the frame'))
ok('safe areas, legibility floors and measured contrast are stated', has(sys, 'stay inside the safe area', 'no lower than ' + C.MIN_HEADLINE_PX, 'at least ' + C.MIN_LABEL_PX + ' px', '4.5:1', '3:1'))
ok('clean transitions, at most two kinds', has(sys, /at most two kinds/))
ok('the script is the spine', has(sys, 'The script is the spine'))
ok('all five looks are described', LOOKS.every(l => sys.indexOf(l.key) >= 0) && LOOKS.length === C.LOOK_KEYS.length && LOOKS.every(l => C.LOOK_KEYS.indexOf(l.key) >= 0))
ok('a finished piece for a DIFFERENT event is shown', has(sys, 'A FINISHED PIECE FOR A DIFFERENT EVENT', '"identity":"basel"'))
ok('…and never the event being designed', Object.entries(EXAMPLE_FOR).every(([k, v]) => k !== v && !!housePiece(v)))

const spec = formatSpec()
for (const list of [C.LAYER_TYPES, C.MOTIFS, C.PRESETS, C.TRANSITIONS, C.MASKS, C.SHAPES, C.DRESSES, C.EASES, C.TREATMENTS, C.FONT_FAMILIES, C.LOOK_KEYS]) ok('the format names everything the validator accepts: ' + list.slice(0, 3).join(', ') + '…', list.every(x => spec.indexOf('"' + x + '"') >= 0), list.filter(x => spec.indexOf('"' + x + '"') < 0))
ok('the format says nothing else exists', has(spec, 'no HTML, no CSS', 'Unknown things are deleted'))

const brief = { goal: 'Bookings for the event dates', audience: 'guests', who: 'Travellers', takeaway: '', moment: 'christmas', momentName: 'Christmas', dates: 'Dec 20–26', area: 'miami', areaLabel: 'Miami', vibe: 'festive', channel: 'vertical', seconds: 15, note: 'mention the rooftop pool', confirmedBy: 'jon', confirmedAt: '' }
const photos = { p1: { src: 'https://assets.guesty.com/image/upload/x.jpg', w: 1200, h: 800, source: 'ours', building: 'Arya', unit: 'Arya 1002', area: 'miami', shows: 'Rooftop pool' } }
const user = composerUser(brief, { name: 'Lights over the water', idea: 'i', look: 'festive-lights' }, [{ vo: 'a', head: 'b *c*', photo: 'p1' }, { vo: 'd', head: 'e', photo: '' }], 'cap', photos)
ok('this piece: the confirmed brief, the safe area, the area, the note', has(user, 'Christmas · Dec 20–26', 'Miami only', 'top 230, bottom 422', 'mention the rooftop pool', 'confirmed by jon'))
ok('this piece: the event’s identity — colours, motifs, never-list', has(user, 'evergreen #0F3D2B', 'string-lights', 'Santa'))
ok('this piece: the photographs with their real sizes', has(user, 'p1  1200 x 800  ours  Arya'))
ok('this piece: the chosen script, in order', has(user, 's1  vo: a', 'head: b *c*', 'photo: p1'))
const cp = conceptPrompt(brief, photos), sp = copyPrompt(brief, { name: 'n', idea: 'i', hook: 'h', beats: ['x'] }, photos)
ok('concepts: three different ideas, from our photographs, under the house rules', has(cp, 'THREE different ideas', 'p1  1200 x 800', guests))
ok('copy: three options, one line per scene, under the house rules', has(sp, 'THREE options', 'exactly 5 scenes', guests))
eq('scenes for 10, 15, 20 seconds', [sceneCount(10), sceneCount(15), sceneCount(20)], [3, 5, 6])
ok('the repair pass hands the findings back', has(repairPrompt('- [dead-area] scene s2: empty', ['s2']), '[dead-area]', 's2'))

// ── identities: every event the new engine makes has one, with a palette people would recognise ──
for (const m of C.ADX_MOMENTS) {
  const id = IDENTITIES[m]
  ok(m + ': has an identity with a palette, motifs, a motion language and a never-list', !!id && Object.keys(id.palette).length >= 5 && id.motifs.length > 20 && id.never.length > 20 && id.looks.every(l => C.LOOK_KEYS.indexOf(l) >= 0))
  ok(m + ': palette is hex', Object.values(id.palette).every(v => /^#[0-9A-F]{6}$/i.test(v)))
  ok(m + ': a house piece exists and uses that identity', housePiece(m).concept.identity === m)
}
ok('Thanksgiving is fall colours with leaves', has(IDENTITIES.thanksgiving.expect, 'pumpkin', 'cranberry') && has(IDENTITIES.thanksgiving.motifs, 'leaf'))
ok('Christmas is evergreen and red with lights and a tree', has(IDENTITIES.christmas.expect, 'Evergreen', 'lights', 'tree') && has(IDENTITIES.christmas.motifs, 'string-lights', 'bulbs-around'))
ok('the brief’s choices are plain lists (drawn as buttons)', AUDIENCES.length === 2 && GOALS.guests.length >= 2 && GOALS.owners.length >= 2 && VIBES.length >= 4)
done()
