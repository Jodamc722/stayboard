// node lib/eve/__tests__/tag-position.test.mjs
//
// THE TAG-POSITION RULE MUST NEVER REGRESS (Jon, 2026-09-22 and 2026-09-28): a tag at the FRONT is
// a question she answers; a tag at the END means translate only; a tag in the MIDDLE answers.
// Plain node, no build, no deps (node >= 22.18 strips the types; tag-position.ts has no imports).
//
// The first block is the behaviour the 2026-09-28 audit checked against the compiled function (27
// cases, all correct then). The second block is the three it found wrong (F35): a BMP emoji, an
// em-dash + "gracias", and an ellipsis after an end tag.
const { tagPosition } = await import('../tag-position.ts')

const EVE = 'U0EVE1234'
const E = `<@${EVE}>`
const OTHER = '<@U0ROB5678>'

const CASES = [
  // ── existing behaviour ──
  [`${E} what's the status on 401?`, 'front'],
  [`Hi ${E} can you check 401?`, 'front'],
  [`Hola ${E} ¿ya está lista la 401?`, 'front'],
  [`Buenos días ${E}, qué hay hoy?`, 'front'],
  [`Good morning, ${E} anything late?`, 'front'],
  [`hey team ${E} 401?`, 'front'],
  [`${OTHER} ${E} is 401 done?`, 'front'],
  [`> ${E} quoted question`, 'front'],
  [`*${E}* status please`, 'front'],
  [`${E}`, 'front'],
  [`Ya terminé el 401 ${E}`, 'end'],
  [`401 is finished, needs a check ${E}`, 'end'],
  [`Ya terminé el 401 ${E}.`, 'end'],
  [`done with 401 ${E}!!!`, 'end'],
  [`listo 401 ${E} 🙏`, 'end'],
  [`listo 401 ${E} :pray:`, 'end'],
  [`listo 401 ${E} gracias`, 'end'],
  [`listo 401 ${E} por favor`, 'end'],
  [`listo 401 ${E} 👍🏽`, 'end'],
  [`listo 401 ${E} ${OTHER}`, 'end'],
  [`listo 401 (${E})`, 'end'],
  [`401 ready ${E} thanks`, 'end'],
  [`please translate this ${E} please`, 'end'],
  [`can ${E} check 401?`, 'middle'],
  [`I think ${E} should look at 401 today`, 'middle'],
  [`no tag here`, 'none'],
  [`${OTHER} talk to you later`, 'none'],
  // ── the three F35 found (tag at the END, read as middle before the fix) ──
  [`Ya terminé el 401 ${E} ✅`, 'end'],
  [`Terminé la 401 ${E} — gracias`, 'end'],
  [`Terminé la 401 ${E}… `, 'end'],
  // ── neighbours of those three ──
  [`Terminé ${E} ✔️`, 'end'],
  [`Terminé ${E} ❤️`, 'end'],
  [`Terminé ${E} ☀️ ⭐`, 'end'],
  [`401 lista ${E} - gracias`, 'end'],
  [`401 lista ${E} – gracias`, 'end'],
  [`401 lista ${E}...`, 'end'],
  [`401 lista ${E} muchas gracias`, 'end'],
  [`401 lista ${E} “gracias”`, 'end'],
  [`401 lista ${E} 👨‍👩‍👧`, 'end'],
  [`can ${E} — check 401 please?`, 'middle'],
  [`${E} ✅ is 401 done?`, 'front'],
]

let pass = 0, fail = 0
for (const [text, want] of CASES) {
  const got = tagPosition(text, EVE)
  if (got === want) pass++
  else { fail++; console.log(`  FAIL  ${JSON.stringify(text)} → ${got}, want ${want}`) }
}
// No bot id means the caller could not resolve itself: answering is the safe default.
if (tagPosition(`listo ${E}`, '') === 'front') pass++; else { fail++; console.log('  FAIL  empty bot id should read as front') }

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
