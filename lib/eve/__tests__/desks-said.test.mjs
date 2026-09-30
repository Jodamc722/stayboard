// node lib/eve/__tests__/desks-said.test.mjs
// The desk map (lib/eve/desks.ts) and the fingerprint the "already said" registry keys on.
const { DESKS, deskForSource, deskForReceipt, deskForAiTask } = await import('../desks.ts')
const { fingerprint, subjectKey } = await import('../said-fingerprint.ts')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }

console.log('\ndesks')
ok('six desks', DESKS.length === 6)
ok('every receipt belongs to one desk', (() => { const seen = new Set(); for (const d of DESKS) for (const r of d.receipts) { if (seen.has(r)) return false; seen.add(r) } return true })())
ok('every ai task belongs to one desk', (() => { const seen = new Set(); for (const d of DESKS) for (const t of d.aiTasks) { if (seen.has(t)) return false; seen.add(t) } return true })())
ok('slack-watch cron is the Watch desk', deskForSource('cron:slack-watch') === 'watch')
ok('a watch fire is the Watch desk', deskForSource('watch:no_show_risk') === 'watch')
ok('chat is the Answer desk', deskForSource('chat') === 'answer')
ok('an unknown cron is the Watch desk', deskForSource('cron:something-new') === 'watch')
ok('translate receipt → interpreter', deskForReceipt('slack-translate') === 'interpreter')
ok('eve-scorecard receipt → reviewer', deskForReceipt('eve-scorecard') === 'reviewer')
ok('project-plan task → planner', deskForAiTask('project-plan') === 'planner')

console.log('\nfingerprint: the duplicates the audit found')
const a = fingerprint('<@U07FSK2BBG8|Roberto Chiriboga> — checking in on this one: Eden 2202 cleaning will be finished by 4:30 pm (Eden 2202). Still on your list, or already handled?')
const b = fingerprint('<@U07FSK2BBG8> — checking in on this one: Eden 2202 cleaning will be finished by 4:31 pm (Eden 2202). Still on your list, or already handled?')
ok('same nudge, different mention form and minute → same words', a === b, a + ' | ' + b)
const c = fingerprint('🚨 NO-SHOW RISK — Sakkez Ali arrives today PT 1019 · welcome call not logged')
const d = fingerprint(':rotating_light: NO-SHOW RISK — Sakkez Ali arrives today PT 1019 · welcome call not logged')
ok('emoji shortcode vs unicode → same words', c === d, c + ' | ' + d)
ok('different unit → different words', fingerprint('Access code not working for unit 1202') !== fingerprint('Access code not working for unit 1203'))
ok('empty text → empty fingerprint', fingerprint('<@U1> <!here>') === '')
ok('subject key normalises', subjectKey('  Eden 2202  ') === 'eden 2202')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
