// node --import tsx: npx --no-install tsx lib/__tests__/channel-lint.test.mjs
import assert from 'node:assert/strict'
import { lintField, lintCopy, blocks, warns, vrboBytes, vrboCombined, rejectReasons, fateOf } from '../channel-lint.ts'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL', name, '-', e.message) } }

t('clean summary passes', () => assert.equal(lintField('summary', 'Bright studio a short walk to the sand. Please see Other things to note before booking.').length, 0))
t('summary over 500 blocks', () => assert.ok(blocks(lintField('summary', 'x'.repeat(501))).length))
t('title over 50 blocks', () => assert.ok(blocks(lintField('title', 'Oceanview Studio With Pool And Free Parking Near Delray Beach FL')).length))
t('title all caps blocks', () => assert.ok(blocks(lintField('title', 'OCEANVIEW STUDIO NEAR DELRAY')).length))
t('title short warns', () => assert.ok(warns(lintField('title', 'Cozy studio')).length))
t('email blocks', () => assert.ok(blocks(lintField('space', 'Email us at hi@stay.com')).length))
t('url blocks', () => assert.ok(blocks(lintField('notes', 'See www.stay-hospitality.com')).length))
t('phone blocks', () => assert.ok(blocks(lintField('access', 'Call 954-555-0123 on arrival')).length))
t('emoji blocks', () => assert.ok(blocks(lintField('summary', 'Beach vibes 🌴')).length))
t('Mr. abbreviation blocks', () => assert.ok(rejectReasons('Ask for Mr. Smith').length))
t('word.word blocks', () => assert.ok(rejectReasons('Great spot.Close to the beach').length))
t('decimal numbers fine', () => assert.equal(rejectReasons('About 1.5 miles to the beach').length, 0))
t('ellipsis fine', () => assert.equal(rejectReasons('And more…').length, 0))
t('TV / BBQ / A1A not caps-flagged', () => assert.equal(lintField('space', 'Smart TV, BBQ grill, on A1A').filter(h => /ALL-CAPS/.test(h.message)).length, 0))
t('caps run blocks', () => assert.ok(blocks(lintField('space', 'BEST BEACH DEAL in town')).length))
t('door code blocks', () => assert.ok(blocks(lintField('access', 'The door code is 4521')).length))
t('refund terms warn', () => assert.ok(warns(lintField('notes', 'Non-refundable within 7 days')).length))
t('OTA name warns in body', () => assert.ok(warns(lintField('space', 'Also listed on Airbnb')).length))
t('house rules >150 warns', () => assert.ok(warns(lintField('houseRules', 'x'.repeat(151))).length))
t('html blocks', () => assert.ok(blocks(lintField('space', 'Great <b>view</b>')).length))
t('vrbo bytes counts <br>', () => assert.equal(vrboBytes('a\nb'), 1 + 4 + 1))
t('vrbo combined truncates house rules', () => assert.equal(vrboCombined({ summary: 'S', houseRules: 'r'.repeat(200) }).length, 1 + 2 + 150))
t('vrbo over 10000 blocks', () => assert.ok(blocks(lintCopy({ space: 'x'.repeat(6000), neighborhood: 'y'.repeat(5000) })).some(h => h.field === 'vrbo')))
t('vrbo floor only with 4+ sections', () => assert.equal(lintCopy({ summary: 'short' }).filter(h => h.field === 'vrbo').length, 0))
t('fate: booking.com none for summary', () => assert.equal(fateOf('summary').find(f => f.channel === 'Booking.com').fate, 'none'))
t('fate: vrbo partial for house rules', () => assert.equal(fateOf('houseRules').find(f => f.channel === 'Vrbo').fate, 'partial'))

console.log(`channel-lint: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
