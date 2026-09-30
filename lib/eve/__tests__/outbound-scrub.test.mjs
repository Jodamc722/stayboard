// node lib/eve/__tests__/outbound-scrub.test.mjs
//
// THE WAY OUT (2026-09-30 audit). lib/slack postToChannel / postThreadReply and the Slack answer path
// now run scrubStoredText in room mode on every post Eve composes. These are the two real re-posts
// the audit found in #vr-eve, plus the things a scrub must leave alone: task ids, unit numbers,
// booking money, a translation-shaped sentence with no lock word.
const { scrubStoredText } = await import('../redact.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const room = t => scrubStoredText(t, [], undefined, { room: true })

console.log('\nthe two codes that reached #vr-eve')
{
  const a = room('• 1202 · Access code 950936 not working for unit 1202 — raised in #Broward HK 1h ago, no Breezeway task or glitch yet.')
  ok('access code masked', !a.includes('950936'), a)
  ok('unit kept', a.includes('1202'), a)
  const b = room('• Arya 1002/1 · Master code 8218 not working, guest locked out — raised in #Miami HK 2h ago.')
  ok('master code masked', !b.includes('8218'), b)
  ok('unit kept', b.includes('1002/1'), b)
}
console.log('\nwhat must survive')
{
  const c = room('Both open items on 410 point to the same Breezeway task (169679416), so that\'s resolved.')
  ok('Breezeway task id survives', c.includes('169679416'), c)
  const d = room('Jamari Laster · BOOKING.COM · $2,970 · 15 nights · checked out today')
  ok('money and nights survive', d.includes('2,970') && d.includes('15 nights'), d)
  const e = room('Los huéspedes de 1809 reportaron que el inodoro del baño está obstruido.')
  ok('plain Spanish line untouched', e === 'Los huéspedes de 1809 reportaron que el inodoro del baño está obstruido.', e)
  const f = room('No code on file for 17WEST-411 — the door-code custom field is empty in Guesty.')
  ok('a sentence about a missing code survives', f.includes('No code on file for 17WEST-411'), f)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
