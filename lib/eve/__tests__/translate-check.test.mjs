// node lib/eve/__tests__/translate-check.test.mjs
//
// A translation is posted as it came unless the model bolted a sentence of its own onto the end.
// Question marks are not a signal: Spanish writes "¿…?" (twice the marks), and an English question
// without a "?" gets one in Spanish. Both used to be rejected (2026-09-30).
const { stripBoltedOn, hasBoltedOn } = await import('../translate-check.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

const jon = 'Karla, Roberto, Yoslenis, and Ernesto, can we work getting billables done for Miami please? Happy to train and help? Thanks'
const jonEs = 'Karla, Roberto, Yoslenis y Ernesto, ¿podemos trabajar en completar los facturables de Miami, por favor? ¿Con gusto entreno y ayudo? Gracias'
eq('Spanish ¿…? pairs are a translation, not extra questions', stripBoltedOn(jon, jonEs), jonEs)
eq('nothing bolted on', hasBoltedOn(jon, jonEs), false)
eq('a question without a ? in English gets its ¿? in Spanish', stripBoltedOn('Testing how are you', '¿Probando, cómo estás?'), '¿Probando, cómo estás?')
eq('an offer bolted on in Spanish is cut', stripBoltedOn('401 is done and ready for the guest', 'El 401 está listo para el huésped. ¿Quieres que le avise a alguien?'), 'El 401 está listo para el huésped.')
eq('an offer bolted on in English is cut', stripBoltedOn('Ya terminé el 401, está limpio', 'I finished 401, it is clean. Let me know if you need anything else!'), 'I finished 401, it is clean.')
eq('two bolted-on lines are both cut', stripBoltedOn('Ya terminé el 401', 'I finished 401.\nHope this helps.\nIs there anything else I can do?'), 'I finished 401.')
eq('a real sentence with "let me know" in the source survives', stripBoltedOn('Avísame si necesitas algo para el 401', 'Let me know if you need anything for 401'), 'Let me know if you need anything for 401')
eq('"con gusto" written by the author survives', stripBoltedOn('Happy to train and help', 'Con gusto entreno y ayudo'), 'Con gusto entreno y ayudo')
eq('all bolted on → empty', stripBoltedOn('ok', 'Is there anything else I can help with?'), '')
eq('multi-line translation kept, breaks and all', stripBoltedOn('Línea uno\nLínea dos', 'Line one\nLine two'), 'Line one\nLine two')
eq('the author\'s own closing offer is kept', stripBoltedOn('Ya terminé el 401. Avísame si necesitas algo más.', 'I finished 401. Let me know if you need anything else.'), 'I finished 401. Let me know if you need anything else.')
eq('an offer after a multi-line translation is cut, breaks kept', stripBoltedOn('Línea uno\nLínea dos', 'Line one\nLine two\nLet me know if you need anything else.'), 'Line one\nLine two')

console.log(`translate-check: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
