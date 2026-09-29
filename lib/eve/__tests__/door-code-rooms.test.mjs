// node lib/eve/__tests__/door-code-rooms.test.mjs
//
// WHERE A DOOR CODE MAY BE ASKED FOR IN SLACK (Jon, 2026-09-29): "Door codes can be requested by any
// Customer Service team member in CCS and Jon Channel, VR Customer Care channel. Never in team
// channels with field team." Plain node, no deps: lib/eve/door-code-rooms.ts has no imports on purpose.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const R = await import('../door-code-rooms.ts')
const { DOOR_CODE_ROOMS, DOOR_CODE_ROOM_NAMES, doorCodeRoomName, isDoorCodeRoom, isDirectMessage, doorCodeSurface, slackDoorCodeSetting, NOT_HERE_LINE } = R

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)

const CCS_AND_JON = 'C07SBALUTU2'
const CUSTOMER_CARE = 'G01TT278P2L'
// Field-team rooms, from lib/slack-rules.ts CH — every one of them must refuse.
const FIELD = {
  '#vr-broward-housekeeping': 'C04BE7CL90W',
  '#vr-broward-maintenance': 'C02S24UE1EZ',
  '#vr-miami-hk-maintenance-arya-elser-district225': 'C094TA92QGM',
  '#vr-miami-houskeeping-17west': 'C09PGAX5ARL',
  '#vr-maintenance-17west': 'C09T9T65VGU',
  '#vr-lakeworth-palmbeach-amri-capri-lucerne': 'C08HW9XBZ8U',
  '#vr-botanica': 'C0B8VTD0BFC',
  '#vr-parktower': 'C0AFLUUE8BH',
}
// Rooms that are ours but are not Customer Service's: codes are not asked for there either.
const OTHER = { '#leadership': 'C0BQ4EZR3DM', '#vr-eve': 'C0C13B7LPJ5', '#vr-ccs-messageboard': 'C09DTAL4ZEW' }

console.log('\nthe #ccs-and-jon id is the one lib/slack-rules.ts keeps')
{
  const src = readFileSync(join(here, '..', '..', 'slack-rules.ts'), 'utf8')
  const m = src.match(/ccsJon:\s*'([A-Z0-9]+)'/)
  ok('slack-rules CH.ccsJon is readable', !!m)
  ok('door-code-rooms #ccs-and-jon matches slack-rules CH.ccsJon', m && m[1] === CCS_AND_JON && DOOR_CODE_ROOMS.some(r => r.id === m[1]), m ? m[1] : '')
}

console.log('\nexactly the two Customer Service rooms')
eq('two rooms', DOOR_CODE_ROOMS.map(r => r.id), [CCS_AND_JON, CUSTOMER_CARE])
eq('names for the pointer', DOOR_CODE_ROOM_NAMES, '#ccs-and-jon or #vr-customercareteam')
eq('#ccs-and-jon by id', doorCodeRoomName(CCS_AND_JON), '#ccs-and-jon')
eq('#vr-customercareteam by id', doorCodeRoomName(CUSTOMER_CARE), '#vr-customercareteam')
ok('an id in lower case or with spaces still matches', isDoorCodeRoom('  c07sbalutu2 ') && isDoorCodeRoom('g01tt278p2l'))
for (const [name, id] of Object.entries(FIELD)) ok(`field room ${name} is not a door-code room`, !isDoorCodeRoom(id) && doorCodeSurface(id) === 'elsewhere')
for (const [name, id] of Object.entries(OTHER)) ok(`${name} is not a door-code room`, !isDoorCodeRoom(id) && doorCodeSurface(id) === 'elsewhere')
ok('nothing is not a room', !isDoorCodeRoom('') && !isDoorCodeRoom(null) && !isDoorCodeRoom(undefined))
ok('a prefix of a room id is not the room', !isDoorCodeRoom('C07SBALUT') && !isDoorCodeRoom('C07SBALUTU2X'))

console.log('\none-to-one DMs, and group DMs that are not')
ok('a D id is a DM', isDirectMessage('D0123ABCD') && doorCodeSurface('D0123ABCD') === 'dm')
ok('a group DM (G / C id) is not a DM', !isDirectMessage('G0123ABCD') && !isDirectMessage('C0123ABCD'))
ok('a bare D is not a DM', !isDirectMessage('D') && !isDirectMessage(''))

console.log('\nwhat a request runs at')
for (const personal of ['off', 'ask', 'direct']) {
  eq(`field channel refuses ${personal}`, slackDoorCodeSetting(personal, 'elsewhere'), 'refused')
}
eq('room: no setting → Ask (any Customer Service member may ask; an approver releases)', slackDoorCodeSetting('off', 'room'), 'ask')
eq('room: Ask stays Ask', slackDoorCodeSetting('ask', 'room'), 'ask')
eq('room: Direct stays Direct (Jon)', slackDoorCodeSetting('direct', 'room'), 'direct')
eq('DM: own setting — off', slackDoorCodeSetting('off', 'dm'), 'off')
eq('DM: own setting — ask', slackDoorCodeSetting('ask', 'dm'), 'ask')
eq('DM: own setting — direct', slackDoorCodeSetting('direct', 'dm'), 'direct')
eq('DM: an unknown setting is off', slackDoorCodeSetting('bogus', 'dm'), 'off')
eq('room: an unknown setting is Ask, never Direct', slackDoorCodeSetting('bogus', 'room'), 'ask')

console.log('\nwho in Slack gets the door-code tool (doorCodeAccessFor — lib/eve/slack-tier.ts enforceDoorCodes)')
{
  const { doorCodeAccessFor } = R
  for (const tier of ['admin', 'staff', 'vendor']) {
    eq(`${tier} in #ccs-and-jon: room`, doorCodeAccessFor({ channelId: CCS_AND_JON, tier }), 'room')
    eq(`${tier} in #vr-customercareteam: room`, doorCodeAccessFor({ channelId: CUSTOMER_CARE, tier }), 'room')
    for (const [name, id] of Object.entries(FIELD)) eq(`${tier} in ${name}: never`, doorCodeAccessFor({ channelId: id, tier }), 'never')
    for (const [name, id] of Object.entries(OTHER)) eq(`${tier} in ${name}: never`, doorCodeAccessFor({ channelId: id, tier }), 'never')
    eq(`${tier} in a group DM: never`, doorCodeAccessFor({ channelId: 'G0123ABCD', tier }), 'never')
  }
  eq('admin in a one-to-one DM: dm', doorCodeAccessFor({ channelId: 'D0123ABCD', tier: 'admin' }), 'dm')
  eq('staff in a one-to-one DM: never', doorCodeAccessFor({ channelId: 'D0123ABCD', tier: 'staff' }), 'never')
  eq('unrecognised in a one-to-one DM: never', doorCodeAccessFor({ channelId: 'D0123ABCD', tier: 'vendor' }), 'never')
  eq('a vendor-run room never, even if configured as a Customer Service room', doorCodeAccessFor({ channelId: CCS_AND_JON, tier: 'admin', vendorRoom: true }), 'never')
}

console.log('\none Slack person, and nothing else (isSlackUserId)')
{
  const { isSlackUserId } = R
  ok('U id', isSlackUserId('U04G9B24ECT'))
  ok('W id (enterprise)', isSlackUserId('W012ABCDEF'))
  ok('two ids is not one person', !isSlackUserId('U04G9B24ECT,U07FSK2BBG8'))
  ok('a channel is not a person', !isSlackUserId('C07SBALUTU2') && !isSlackUserId('G01TT278P2L') && !isSlackUserId('D0123ABCD'))
  ok('nothing is nobody', !isSlackUserId('') && !isSlackUserId(null) && !isSlackUserId(undefined))
  ok('no spaces or mentions', !isSlackUserId('<@U04G9B24ECT>') && !isSlackUserId('U04G9 B24ECT'))
}

console.log('\nthe pointer names both rooms')
ok('NOT_HERE_LINE names #ccs-and-jon and #vr-customercareteam', NOT_HERE_LINE.includes('#ccs-and-jon') && NOT_HERE_LINE.includes('#vr-customercareteam'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
