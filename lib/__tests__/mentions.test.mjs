import { parseMentions, describeMentions } from '../mentions-parse.ts'

const roster = [
  { email: 'jon@stay-hospitality.com', name: 'Jon McGill', role: 'admin' },
  { email: 'carlo.perez@stay-hospitality.com', name: 'Carlo Perez', role: 'supervisor' },
  { email: 'alberto@stay-hospitality.com', name: 'Alberto Ruiz', role: 'supervisor' },
  { email: 'maria.jose@stay-hospitality.com', name: 'Maria Jose Perez', role: 'housekeeping' },
  { email: 'maria.g@stay-hospitality.com', name: 'Maria Gomez', role: 'housekeeping' },
  { email: 'yoslenis@stay-hospitality.com', name: 'Yoslenis Díaz', role: 'ccs' },
  { email: 'tech1@stay-hospitality.com', name: 'Pedro Lima', role: 'maintenance' },
]
let pass = 0, fail = 0
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) pass++; else { fail++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) } }
const emails = (t, picked) => parseMentions(t, roster, picked).emails.sort()

eq('first name', emails('@carlo the clean at 1704 is running late'), ['carlo.perez@stay-hospitality.com'])
eq('case', emails('@Carlo late'), ['carlo.perez@stay-hospitality.com'])
eq('email prefix', emails('@carlo.perez late'), ['carlo.perez@stay-hospitality.com'])
eq('email', emails('@alberto@stay-hospitality.com please'), ['alberto@stay-hospitality.com'])
eq('ambiguous first name is nobody', emails('@maria please'), [])
eq('full name wins', emails('@Maria Gomez please'), ['maria.g@stay-hospitality.com'])
eq('quoted', emails('@"Maria Jose" please'), ['maria.jose@stay-hospitality.com'])
eq('accent', emails('@yoslenis @Yoslenis Diaz'), ['yoslenis@stay-hospitality.com'])
eq('first + capital sentence', emails('@Carlo Please check 1704'), ['carlo.perez@stay-hospitality.com'])
eq('two tags', emails('@carlo and @alberto'), ['alberto@stay-hospitality.com', 'carlo.perez@stay-hospitality.com'])
eq('not an email mid-word', emails('mail jon@stay-hospitality.com now'), [])
eq('group hk', emails('@housekeeping 1704 is late'), ['maria.g@stay-hospitality.com', 'maria.jose@stay-hospitality.com'])
eq('group everyone', emails('@everyone meeting').length, 7)
eq('group maintenance', emails('@maintenance ac out'), ['tech1@stay-hospitality.com'])
eq('picked honoured', emails('no tags here', ['jon@stay-hospitality.com']), ['jon@stay-hospitality.com'])
eq('unknown reported', parseMentions('@nobody here', roster).unknown, ['nobody'])
eq('groups reported', parseMentions('@hk', roster).groups, ['housekeeping'])
eq('describe', describeMentions(parseMentions('@carlo @alberto', roster), roster), 'Carlo, Alberto')
eq('describe group', describeMentions(parseMentions('@hk', roster), roster), '2 people (@housekeeping)')
eq('no tag', emails('plain note'), [])

console.log(`mentions: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
