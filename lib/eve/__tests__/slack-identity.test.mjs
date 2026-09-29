// node lib/eve/__tests__/slack-identity.test.mjs
//
// WHO A SLACK MESSAGE SPEAKS FOR (2026-09-29 security review, N1). Before this, the local part of ANY
// Slack email matched any account (a guest signed up as jon@gmail.com became the owner) and a display
// name alone could resolve to an admin. Plain node, no deps: lib/slack-identity-rules.ts and
// lib/person-name.ts have no imports on purpose.
const R = await import('../../slack-identity-rules.ts')
const { nameMatches } = await import('../../person-name.ts')
const { decideIdentity, isOurDomain, OUR_EMAIL_DOMAINS, identityHint, emailDomain } = R

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)

const OWNER = { email: 'jon@stay-hospitality.com', status: 'active', name: 'Jon McGill', privileged: true }
const ADMIN = { email: 'roberto@stay-hospitality.com', status: 'active', name: 'Roberto Chiriboga', privileged: true }
const KARLA = { email: 'karla.stayhospitality@gmail.com', status: 'active', name: 'Karla Valle', privileged: false }
const MARIA = { email: 'maria@stay-hospitality.com', status: 'active', name: 'Maria Santos', privileged: false }
const GONE = { email: 'ex@stay-hospitality.com', status: 'disabled', name: 'Ex Person', privileged: false }
const USERS = [OWNER, ADMIN, KARLA, MARIA, GONE]
const run = (profile, extra = {}) => decideIdentity({ slackUserId: 'U0TEST', map: {}, profile, users: USERS, nameMatches, ...extra })
const member = (email, name) => ({ email, name, guest: false })

console.log('\nour domains')
ok('stay-hospitality.com is ours', isOurDomain('Jon@Stay-Hospitality.com'))
ok('staysoflo.com is ours', isOurDomain('jon@staysoflo.com'))
ok('a look-alike prefix is not', !isOurDomain('jon@evil-stay-hospitality.com'))
ok('a look-alike suffix is not', !isOurDomain('jon@stay-hospitality.com.evil.io'))
ok('the last @ decides', emailDomain('jon@stay-hospitality.com@evil.io') === 'evil.io' && !isOurDomain('jon@stay-hospitality.com@evil.io'))
ok('gmail is not', !isOurDomain('jon@gmail.com'))
ok('the list is a constant with stay-hospitality.com in it', Array.isArray(OUR_EMAIL_DOMAINS) && OUR_EMAIL_DOMAINS.includes('stay-hospitality.com'))

console.log('\nthe hole (N1)')
{
  const r = run({ email: 'jon@gmail.com', name: 'Jon McGill', guest: true })
  eq('a Slack GUEST jon@gmail.com is NOT the owner', r.email, null)
  const r2 = run(member('jon@gmail.com', 'Someone Else'))
  eq('a full member jon@gmail.com is not bridged to jon@stay-hospitality.com', r2.email, null)
  const r3 = run(member('someone@gmail.com', 'Jon McGill'))
  eq('a display name alone never resolves the owner', r3.email, null)
  ok('…and says why', /admin account/.test(identityHint(r3)), identityHint(r3))
  const r4 = run(member('rc@outlook.com', 'Roberto Chiriboga'))
  eq('a display name alone never resolves an admin', r4.email, null)
  const withAdminMaria = USERS.concat([{ email: 'maria.g@stay-hospitality.com', status: 'active', name: 'Maria Gomez', privileged: true }])
  eq('"Maria" matches an admin AND a member → nobody (not the member by elimination)', run(member('x@gmail.com', 'Maria'), { users: withAdminMaria }).email, null)
  eq('"Maria Santos" still finds the member when only she matches', run(member('x@gmail.com', 'Maria Santos'), { users: withAdminMaria }).email, 'maria@stay-hospitality.com')
  const r6 = run({ email: 'x@gmail.com', name: 'Maria Santos', guest: true })
  eq('a Slack guest is never matched by name, even to a member', r6.email, null)
  ok('…and says why', /guest account/.test(identityHint(r6)), identityHint(r6))
  const r7 = run({ email: 'x@gmail.com', name: 'Maria Santos', guest: null })
  eq('an unknown guest flag (old cached directory) is treated as a guest', r7.email, null)
  const r8 = run(member('jon@staysoflo.com', 'J'), { users: [{ email: 'jon@gmail.com', status: 'active', name: 'Jon Doe', privileged: false }] })
  eq('the bridge never lands on an account outside our domains', r8.email, null)
}

console.log('\nwhat still works')
eq('the manual map by Slack id wins', run(member('x@gmail.com', 'Jon McGill'), { map: { u0test: 'jon@stay-hospitality.com' } }).how, 'map-id')
eq('an exact profile email', run(member('Maria@Stay-Hospitality.com', 'M')).email, 'maria@stay-hospitality.com')
eq('an exact profile email works for a guest too (Slack verified the address)', run({ email: 'karla.stayhospitality@gmail.com', name: 'K', guest: true }).how, 'profile')
eq('the map by profile email', run(member('vendor@cleanco.com', 'V'), { map: { 'vendor@cleanco.com': 'maria@stay-hospitality.com' } }).how, 'map-email')
{
  const r = run(member('jon@staysoflo.com', 'Jon'))
  eq('jon@staysoflo.com → jon@stay-hospitality.com (our other domain)', [r.email, r.how], ['jon@stay-hospitality.com', 'alias-domain'])
}
eq('the bridge ignores a look-alike account domain', run(member('sam@staysoflo.com', 'S'), { users: [
  { email: 'sam@staysoflo.com.au', status: 'active', name: 'Sam B', privileged: false },
] }).email, null)
eq('a full member matched by name to a non-admin', [run(member('karla.personal@yahoo.com', 'Karla Valle')).email, run(member('karla.personal@yahoo.com', 'Karla Valle')).how], ['karla.stayhospitality@gmail.com', 'name'])
eq('two members named alike → nobody', run(member('x@y.com', 'Maria'), { users: USERS.concat([{ email: 'maria2@stay-hospitality.com', status: 'active', name: 'Maria Lopez', privileged: false }]) }).email, null)
{
  const r = run(member('ex@stay-hospitality.com', 'Ex Person'))
  eq('an inactive account is not matched', r.email, null)
  ok('…and says it is inactive', /disabled, not active/.test(String(r.problem)), String(r.problem))
}
eq('nobody at all → the unmapped tier', run(member('stranger@cleanco.com', 'Pat Stranger')), { email: null, how: null, profileEmail: 'stranger@cleanco.com', slackName: 'Pat Stranger' })
eq('no profile → nothing', run(null).email, null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
