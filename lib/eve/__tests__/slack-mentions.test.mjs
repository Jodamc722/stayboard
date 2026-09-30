// node lib/eve/__tests__/slack-mentions.test.mjs
//
// A person tagged in a message must come out of the translation as a real Slack tag, never as a
// raw id (2026-09-30: "…toca la puerta primero. @U0A6C31LV1C"). Eve's own tag is dropped. Whatever
// the translator does to a placeholder, nobody is silently un-tagged.
const { protectMentions } = await import('../slack-mentions.ts')

const EVE = 'U0EVE1234'
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

// The real 2026-09-26 message.
{
  const p = protectMentions('For 1002/1 - We have permission to enter. But please knock on the door first. <@U0A6C31LV1C|Ernesto Torres> <@U0EVE1234>', EVE)
  eq('placeholder in, Eve out', p.text, 'For 1002/1 - We have permission to enter. But please knock on the door first. @PERSON1')
  eq('restored as a real tag', p.restore('Para 1002/1 - Tenemos permiso para entrar. Pero por favor toca la puerta primero. @PERSON1'), 'Para 1002/1 - Tenemos permiso para entrar. Pero por favor toca la puerta primero. <@U0A6C31LV1C>')
}
// Two people, one of them twice; the translator re-spaces and lower-cases a placeholder.
{
  const p = protectMentions('<@U0AAA> and <@U0BBB> please check 401 with <@U0AAA> <@U0EVE1234>', EVE)
  eq('same person, same placeholder', p.text, '@PERSON1 and @PERSON2 please check 401 with @PERSON1')
  eq('tolerant restore', p.restore('@person1 y @ Person2 revisen la 401 con @PERSON1'), '<@U0AAA> y <@U0BBB> revisen la 401 con <@U0AAA>')
}
// The translator drops a placeholder: the person is appended, never lost.
{
  const p = protectMentions('Gracias por todo <@U0CCC> <@U0EVE1234>', EVE)
  eq('lost tag appended', p.restore('Thanks for everything'), 'Thanks for everything <@U0CCC>')
}
// Channels and links read as text; a tag at the front of the message is handled the same way.
{
  const p = protectMentions('<@U0EVE1234> see <#C0123|vr-ops> and <https://x.io/a|the sheet> <@U0DDD>', EVE)
  eq('channels and links flattened', p.text, 'see #vr-ops and the sheet (https://x.io/a) @PERSON1')
}
// No mentions at all: text passes through, restore is the identity.
{
  const p = protectMentions('Ya terminé el 401 <@U0EVE1234>', EVE)
  eq('plain text', p.text, 'Ya terminé el 401')
  eq('identity restore', p.restore('401 is finished'), '401 is finished')
}
// Line breaks survive.
{
  const p = protectMentions('Línea uno <@U0EEE>\nLínea dos <@U0EVE1234>', EVE)
  eq('line breaks kept', p.text, 'Línea uno @PERSON1\nLínea dos')
}

console.log(`slack-mentions: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
