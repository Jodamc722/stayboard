// @MENTIONS — who a comment reaches.
//
// A mention that reaches the wrong person puts a note about Roberto in front of somebody else; a
// mention that reaches nobody is a request nobody answers. Both are quiet failures, so the parser
// is pinned here. Run with: npx tsx lib/__tests__/mentions.test.ts
import { parseMentions } from '../projects-shared'

const M = [
  { id: '1', display: 'Jon', email: 'jon@stay-hospitality.com', person_key: 'jon' },
  { id: '2', display: 'Roberto Diaz', email: 'roberto@stay-hospitality.com', person_key: 'roberto diaz' },
  { id: '3', display: 'Luis Mendez', email: null, person_key: 'luis mendez' },
  { id: '4', display: 'Maria Gomez', email: 'maria.g@stay-hospitality.com', person_key: 'maria gomez' },
  { id: '5', display: 'Maria Santos', email: 'maria.s@stay-hospitality.com', person_key: 'maria santos' },
]
const who = (body: string) => parseMentions(body, M).map(m => m.display)
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

const CASES: [string, string, string[]][] = [
  ['full name',                 '@Roberto Diaz can you look at 407',        ['Roberto Diaz']],
  ['first name only',           '@Roberto can you look at 407',             ['Roberto Diaz']],
  ['lower case',                'ping @roberto',                            ['Roberto Diaz']],
  ['last name only',            '@Diaz — 407 has a guest',                  ['Roberto Diaz']],
  ['mailbox handle',            '@jon is this billable?',                   ['Jon']],
  ['two people',                '@Jon @Luis Mendez both please',            ['Jon', 'Luis Mendez']],
  ['same person twice',         '@Roberto and again @Roberto Diaz',         ['Roberto Diaz']],
  ['ambiguous first name',      '@Maria can you?',                          []],
  ['ambiguous resolved by last','@Maria Santos can you?',                   ['Maria Santos']],
  ['typo forgiven',             '@Robrto see above',                        ['Roberto Diaz']],
  ['unknown name',              '@Nobody here',                             []],
  ['email address is not a mention', 'send to jon@stay-hospitality.com',    []],
  ['mid-sentence after punctuation', 'done.@Jon next?',                     ['Jon']],
  ['name then verb not eaten',  '@Luis do floor 4',                         ['Luis Mendez']],
  ['no @ at all',               'Roberto Diaz did this',                    []],
  ['end of text',               'thanks @Jon',                              ['Jon']],
  ['newline after',             '@Jon\nsecond line',                        ['Jon']],
]

let failed = 0
for (const [why, body, want] of CASES) {
  const got = who(body)
  if (!same(got, want)) { console.log(`FAIL ${why}: ${JSON.stringify(body)} → ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ }
}
console.log(failed === 0 ? `mentions: all ${CASES.length} checks passed` : `mentions: ${failed} FAILED`)
if (failed) process.exit(1)
