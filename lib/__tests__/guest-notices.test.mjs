// Pilot One: the only guest messages Eve sends on her own are fixed templates with no numbers in them.
import assert from 'node:assert/strict'
import { renderNotice } from '../eve/guest-notices.ts'

const a = renderNotice('work_done', { guestFirst: 'Clemence Swierc', what: 'AC', leavingToday: false })
assert.ok(a && a.text.startsWith('Hi Clemence, ') && a.text.includes('the AC issue you reported has been taken care of') && a.text.endsWith('Enjoy the rest of your stay!'), a && a.text)
const b = renderNotice('work_done', { guestFirst: null, what: 'something odd 4821', leavingToday: true })
assert.ok(b && b.text.startsWith('Hello,') && b.text.includes('the issue you reported') && !/\d/.test(b.text), 'unknown trade word falls back and never carries digits')
const c = renderNotice('entry_request', { guestFirst: 'Peter', what: 'plumbing', when: 'tomorrow' })
assert.ok(c && c.text.includes('stop by tomorrow to take care of the plumbing issue you reported') && c.text.includes('reply here'), c && c.text)
const d = renderNotice('entry_request', { guestFirst: 'Peter', what: 'pest issue', when: 'whenever 1234' })
assert.ok(d && d.text.includes('stop by today') && !/\d/.test(d.text), 'a bad "when" becomes today, never free text')
assert.equal(renderNotice('refund_offer', { guestFirst: 'X' }), null, 'unknown kinds are refused')
assert.ok(renderNotice('work_done', { guestFirst: 'J0hn', what: 'AC' }).text.startsWith('Hello,'), 'a name with a digit in it is dropped, never printed')
console.log('guest-notices: ok')
