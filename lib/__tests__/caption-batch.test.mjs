// node lib/__tests__/caption-batch.test.mjs
// Captions for every photo (Jon, 2026-10-27): "If unsure of bed size don't say it, if not sure if
// common area vs in-room just describe it."
const { sanitizeCaption, parseBatch, batchInstruction, chunks, CERTAINTY_RULES } = await import('../caption-batch.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }
const unsure = { bedSure: false, placeSure: false }, sure = { bedSure: true, placeSure: true }

// ── bed size ──
eq('unsure: king bed → bed', sanitizeCaption('Bedroom with king bed and city view', unsure), 'Bedroom with bed and city view')
eq('unsure: queen-size bed → bed', sanitizeCaption('Bright bedroom with a queen-size bed', unsure), 'Bright bedroom with a bed')
eq('unsure: king bedroom → bedroom', sanitizeCaption('King bedroom with blackout shades', unsure), 'Bedroom with blackout shades')
eq('unsure: two twin beds → two beds', sanitizeCaption('Second bedroom with two twin beds', unsure), 'Second bedroom with two beds')
eq('unsure: 2 queen beds → 2 beds', sanitizeCaption('Bedroom with 2 queen beds', unsure), 'Bedroom with 2 beds')
eq('unsure: king suite → bedroom suite', sanitizeCaption('King suite with walk-in closet', unsure), 'Bedroom suite with walk-in closet')
eq('unsure: sofa bed untouched', sanitizeCaption('Living room with sofa bed', unsure), 'Living room with sofa bed')
eq('unsure: "full kitchen" is not a bed', sanitizeCaption('Full kitchen with island seating', unsure), 'Full kitchen with island seating')
eq('sure: king bed kept', sanitizeCaption('Bedroom with king bed and city view', sure), 'Bedroom with king bed and city view')

// ── common area vs in-unit ──
eq('unsure: private balcony → balcony', sanitizeCaption('Private balcony with bay view', unsure), 'Balcony with bay view')
eq('unsure: building pool → pool', sanitizeCaption('Building pool with loungers', unsure), 'Pool with loungers')
eq("unsure: the building's rooftop pool", sanitizeCaption("The building's rooftop pool at sunset", unsure), 'Rooftop pool at sunset')
eq('unsure: shared gym → gym', sanitizeCaption('Shared gym with treadmills', unsure), 'Gym with treadmills')
eq('unsure: in-unit washer → washer', sanitizeCaption('In-unit washer and dryer', unsure), 'Washer and dryer')
eq('unsure: residents lounge', sanitizeCaption("Residents' lounge with sofas", unsure), 'Lounge with sofas')
eq('unsure: "Building exterior" kept — building is the subject', sanitizeCaption('Building exterior at dusk', unsure), 'Building exterior at dusk')
eq('sure: private balcony kept', sanitizeCaption('Private balcony with bay view', sure), 'Private balcony with bay view')
eq('both flags work together', sanitizeCaption('Private balcony off the king bedroom', unsure), 'Balcony off the bedroom')

// ── tidying ──
eq('heated is never claimed', sanitizeCaption('Pool deck with heated pool and loungers', sure), 'Pool deck with pool and loungers')
eq('quotes and full stop stripped', sanitizeCaption('"Kitchen with island."', sure), 'Kitchen with island')
eq('exclamation stripped', sanitizeCaption('Pool deck!', sure), 'Pool deck')
eq('newlines collapsed', sanitizeCaption('Kitchen\nwith island', sure), 'Kitchen with island')
eq('capitalised', sanitizeCaption('kitchen with island', sure), 'Kitchen with island')
const long = sanitizeCaption('Open kitchen with stainless appliances, quartz counters, breakfast bar seating for four and a view across the living room to the bay', sure, 80)
eq('length cap at a word boundary', long.length <= 80 && !/[ ,]$/.test(long), true)
eq('empty stays empty', sanitizeCaption('   ', sure), '')

// ── parsing ──
eq('parse a clean array', parseBatch('[{"i":1,"caption":"Pool","bedSure":false,"placeSure":true},{"i":2,"caption":"Gym"}]', [1, 2]), [{ caption: 'Pool', bedSure: false, placeSure: true }, { caption: 'Gym', bedSure: false, placeSure: false }])
eq('parse inside a code fence', parseBatch('```json\n[{"i":3,"caption":"Lobby"}]\n```', [3]), [{ caption: 'Lobby', bedSure: false, placeSure: false }])
eq('missing answer is null', parseBatch('[{"i":1,"caption":"Pool"}]', [1, 2]), [{ caption: 'Pool', bedSure: false, placeSure: false }, null])
eq('no i: falls back to position', parseBatch('[{"caption":"A"},{"caption":"B"}]', [5, 6]).map(x => x && x.caption), ['A', 'B'])
eq('garbage is all null', parseBatch('sorry, I cannot', [1, 2]), [null, null])
eq('bedSure must be literally true', parseBatch('[{"i":1,"caption":"x","bedSure":"yes"}]', [1])[0].bedSure, false)

// ── the instruction ──
const ins = batchInstruction([{ i: 1, context: 'analyst saw: bedroom' }, { i: 2 }], 'Listing: Elser 1203 (Elser, Miami).')
eq('instruction names every photo', /Photo 1 — analyst saw: bedroom/.test(ins) && /Photo 2/.test(ins), true)
eq('instruction asks for the flags', /bedSure/.test(ins) && /placeSure/.test(ins), true)
eq('rules mention both of Jon\'s rules', /Bed size/.test(CERTAINTY_RULES) && /shared building space/.test(CERTAINTY_RULES), true)
eq('chunks', chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])

console.log(`caption-batch: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
