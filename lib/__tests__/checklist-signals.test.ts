// CHECKLIST SIGNALS — the number next to an item, and where the item sends you.
//
// Run: npx tsx lib/__tests__/checklist-signals.test.ts
//
// What is worth testing here is not the counting — that is one PostgREST call each — but the two
// promises this module makes to a page that renders whatever a manager typed: every link is an
// in-app path, and an unknown key is silent rather than fatal.
import { SIGNAL_META, signalLabel, signalLink } from '../checklist-shared'

let failed = 0
const eq = (why: string, got: any, want: any) => {
  if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ }
}
const ok = (why: string, cond: boolean) => { if (!cond) { console.log(`FAIL ${why}`); failed++ } }

// Every signal points somewhere inside the app. A checklist row is not a place to send people off-site.
for (const [key, def] of Object.entries(SIGNAL_META)) {
  ok(`${key} link is an in-app path`, def.link.startsWith('/') && !def.link.startsWith('//'))
  ok(`${key} has an editor title`, typeof def.title === 'string' && def.title.length > 0)
  ok(`${key} labels a count`, typeof def.label(3) === 'string' && def.label(3).length > 0)
  ok(`${key} labels zero`, typeof def.label(0) === 'string')
}

// The wording the page mirrors.
eq('eve questions, some',   signalLabel('eve_questions', 45), '45 waiting')
eq('eve questions, none',   signalLabel('eve_questions', 0),  'none waiting')
eq('glitches, some',        signalLabel('open_glitches', 4),  '4 open')
eq('glitches, none',        signalLabel('open_glitches', 0),  'all clear')

// A key a manager typed that this build has never heard of: no chip, no crash.
eq('unknown key',           signalLabel('made_up_thing', 7),  '')
eq('unknown key link',      signalLink('made_up_thing'),      null)
eq('no key',                signalLabel(null, 7),             '')
eq('no key link',           signalLink(null),                 null)

// A signal with no count yet (still loading, or the count failed) prints nothing rather than 'null'.
eq('count not available',   signalLabel('eve_questions', null),      '')
eq('count undefined',       signalLabel('eve_questions', undefined), '')

// The fallback link an item inherits when it names a signal but no link of its own.
eq('eve questions link',    signalLink('eve_questions'), '/command')
eq('glitches link',         signalLink('open_glitches'), '/glitches')

console.log(failed ? `\n${failed} checklist signal check(s) failed.` : '\nAll checklist signal checks passed.')
process.exit(failed ? 1 : 0)
