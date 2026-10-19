// node lib/__tests__/json-repair.test.mjs — A MODEL THAT RAN OUT OF ROOM STILL SAID SOMETHING
// (Jon, 2026-10-19: "Model returned an unparseable response" on the listing optimizer). Six good
// sections were being thrown away because the seventh was cut mid-sentence.
const J = await import('../json-repair.ts')
let pass = 0, fail = 0
const eq = (n, got, want) => { if (got === want) pass++; else { fail++; console.log(`  FAIL  ${n}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`) } }

console.log('\nwhat a well-behaved model sends')
eq('clean object',      J.parseJson('{"title":"A","space":"B"}')?.space, 'B')
eq('code fences',       J.parseJson('```json\n{"title":"A"}\n```')?.title, 'A')
eq('prose around it',   J.parseJson('Here you go:\n{"title":"A"}\nHope that helps')?.title, 'A')
eq('escaped quotes',    J.parseJson('{"space":"He said \\"hi\\" and left"}')?.space, 'He said "hi" and left')
eq('trailing comma',    J.parseJson('{"title":"A","space":"B",}')?.space, 'B')

console.log('\ncut off part way — the finished sections survive')
const cut = '{"title":"Modern Fort Lauderdale Getaway","space":"Two bedrooms, one bath, and parking that is actually free. The kitchen'
eq('title kept',        J.parseJson(cut)?.title, 'Modern Fort Lauderdale Getaway')
eq('partial kept',      typeof J.parseJson(cut)?.space, 'string')
eq('cut after comma',   J.parseJson('{"title":"A","space":"B",')?.space, 'B')
eq('cut on a key',      J.parseJson('{"title":"A","space":')?.title, 'A')
eq('no empty value',    J.parseJson('{"title":"A","space":')?.space, undefined)
eq('cut inside array',  J.parseJson('{"title":"A","tags":["pool","gym"')?.title, 'A')
eq('cut mid-sentence',  J.parseJson('{"title":"A","access":"Lobby code is 1234')?.title, 'A')

console.log('\nbeyond repair — pull the keys out one at a time')
const junk = 'blah "title": "Rescued Title" blah "space": "Rescued space text" <<<'
eq('salvaged title',    J.salvageKeys(junk, ['title', 'space']).title, 'Rescued Title')
eq('salvaged space',    J.salvageKeys(junk, ['title', 'space']).space, 'Rescued space text')
eq('skips unfinished',  J.salvageKeys('"title": "unterminated', ['title']).title, undefined)

console.log('\nnothing usable stays nothing')
eq('refusal is null',   J.parseJson('I cannot help with that.'), null)
eq('empty is null',     J.parseJson(''), null)

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
