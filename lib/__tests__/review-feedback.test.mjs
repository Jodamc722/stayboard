// node lib/__tests__/review-feedback.test.mjs
//
// WHICH REVIEW EARNS A QUALITY INSPECTION BEFORE THE NEXT GUEST (2026-09-30). The Command Center's
// arrival rows and the automation that now files those inspections read this one rule, so it is
// pinned here. Plain node: lib/review-feedback.ts has no imports and node >= 22.18 strips the types.
const { worstFeedbackReview, keywordsOf } = await import('../review-feedback.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const r = (id, rating, content = '') => ({ id, rating, content })

console.log('\nthe defect words')
ok('A/C and cleanliness', JSON.stringify(keywordsOf('The AC was broken and the bathroom was dirty')) === JSON.stringify(['cleanliness', 'A/C', 'repairs']))
ok('three at most', keywordsOf('dirty, wifi down, loud, leak, roach').length === 3)
ok('praise names nothing', keywordsOf('Lovely stay, great host').length === 0)

console.log('\nthe worst of the last five')
ok('nothing low → none', worstFeedbackReview([r(1, 5), r(2, 4.5)]) === null)
ok('a 2★ counts with no words at all', worstFeedbackReview([r(1, 5), r(2, 2)])?.id === 2)
ok('a 3★ needs a defect named', worstFeedbackReview([r(1, 3, 'fine I guess')]) === null)
ok('a 3★ naming a defect counts', worstFeedbackReview([r(1, 3, 'the shower had no hot water')])?.id === 1)
ok('the lowest wins', worstFeedbackReview([r(1, 3, 'dirty'), r(2, 1), r(3, 2)])?.id === 2)
ok('only the last five are read', worstFeedbackReview([r(1, 5), r(2, 5), r(3, 5), r(4, 5), r(5, 5), r(6, 1)]) === null)
ok('a missing rating is not a zero-star review', worstFeedbackReview([r(1, null), r(2, undefined), r(3, '')]) === null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
