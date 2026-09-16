// Cases for the bulk listing-copy scope rules.
// Run: npx tsx lib/__tests__/listing-copy-bulk.test.ts
import {
  BULK_SECTIONS, sectionsForScope, scopeOf, planBulk, scopeError, lengthErrors, driftFrom,
  type CopyTarget,
} from '../listing-copy-bulk';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; return }
  fail++
  console.log('FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))
}

const t = (id: string, building: string, current: any = {}): CopyTarget =>
  ({ id, name: building + ' ' + id, building, current });

// ---- the scope rule Jon set, read straight off the registry ------------------------------------
{
  ok('guest access is property-scoped', scopeOf('access') === 'property')
  ok('neighborhood is property-scoped', scopeOf('neighborhood') === 'property')
  ok('getting around is property-scoped', scopeOf('transit') === 'property')
  ok('other notes is portfolio-scoped', scopeOf('notes') === 'portfolio')
  ok('three sections live at the property', sectionsForScope('property').length === 3)
  ok('one section lives at the portfolio', sectionsForScope('portfolio').length === 1)
  ok('nothing else is bulk editable', BULK_SECTIONS.length === 4 && !scopeOf('summary') && !scopeOf('title'), BULK_SECTIONS.length)
}

// ---- property sections cannot cross buildings ---------------------------------------------------
{
  const oneBuilding = [t('a', 'Botanica'), t('b', 'Botanica')]
  const two = [t('a', 'Botanica'), t('c', 'Elser')]
  const roster = { Botanica: 2, Elser: 1 }
  ok('one property is fine', scopeError(['neighborhood'], oneBuilding, roster) === null)
  const e = scopeError(['neighborhood'], two, roster)
  ok('two properties is refused', !!e && /one property at a time/.test(e), e)
  ok('the refusal names the section', !!e && /Neighborhood/.test(e), e)
  ok('guest access is refused the same way', !!scopeError(['access'], two, roster))
  ok('getting around is refused the same way', !!scopeError(['transit'], two, roster))
}

// ---- a subset of ONE building is fine for property sections -------------------------------------
// Inside a property you pick units; that is the level where picking units is offered.
{
  const half = [t('a', 'Elser'), t('b', 'Elser')]
  ok('half a building may take property text', scopeError(['transit'], half, { Elser: 32 }) === null)
}

// ---- portfolio: whole properties only -----------------------------------------------------------
{
  const roster = { Botanica: 3, Elser: 2 }
  const whole = [t('a', 'Botanica'), t('b', 'Botanica'), t('c', 'Botanica'), t('d', 'Elser'), t('e', 'Elser')]
  ok('whole properties are allowed', scopeError(['notes'], whole, roster) === null)
  const partial = whole.filter(x => x.id !== 'c')
  const e = scopeError(['notes'], partial, roster)
  ok('a partial property is refused', !!e && /whole properties are selected/.test(e), e)
  ok('the refusal names which property and the counts', !!e && /Botanica/.test(e) && /3/.test(e) && /2/.test(e), e)
}

// ---- a building the roster does not know is not fabricated into an error ------------------------
{
  ok('unknown roster is not an error', scopeError(['notes'], [t('a', 'Newbuild')], {}) === null)
}

// ---- mixing a property section into a portfolio push is governed by the stricter rule -----------
{
  const roster = { Botanica: 2, Elser: 2 }
  const two = [t('a', 'Botanica'), t('b', 'Botanica'), t('c', 'Elser'), t('d', 'Elser')]
  const e = scopeError(['notes', 'neighborhood'], two, roster)
  ok('notes+neighborhood across two properties is refused', !!e && /one property at a time/.test(e), e)
  ok('notes+neighborhood inside one property is fine',
    scopeError(['notes', 'neighborhood'], [t('a', 'Botanica'), t('b', 'Botanica')], roster) === null)
}

// ---- rubbish input is refused rather than guessed at ---------------------------------------------
{
  ok('nothing selected', scopeError(['notes'], [], {}) === 'Nothing selected.')
  ok('no real section', !!scopeError(['summary'], [t('a', 'B')], {}))
  const e = scopeError(['title'], [t('a', 'B')], {})
  ok('an off-list section is named back', !!e && /title/.test(e), e)
  const blank = scopeError(['neighborhood'], [t('a', '')], {})
  ok('a listing with no property is refused', !!blank && /no property set/.test(blank), blank)
}

// ---- the plan: identical text is never written ---------------------------------------------------
{
  const targets = [
    t('a', 'Waves', { transit: 'Rideshare at the north door.' }),
    t('b', 'Waves', { transit: 'old text' }),
    t('c', 'Waves', {}),
  ]
  const p = planBulk(targets, { transit: 'Rideshare at the north door.' })
  ok('one row per listing per section', p.rows.length === 3, p.rows.length)
  ok('the matching one is left alone', p.unchanged === 1 && p.rows[0].action === 'same', p.rows[0])
  ok('the other two are written', p.writes === 2, p)
  ok('listings counts units, not sections', p.listings === 2, p.listings)
  ok('the plan carries what is being overwritten', p.rows[1].before === 'old text', p.rows[1])
}

// ---- whitespace is not a change ------------------------------------------------------------------
{
  const p = planBulk([t('a', 'W', { notes: '  Parking is validated.\r\n' })], { notes: 'Parking is validated.' })
  ok('trailing whitespace and CRLF are not a change', p.writes === 0 && p.unchanged === 1, p)
}

// ---- blank input is not an instruction to erase ---------------------------------------------------
// A blank box means "I am not editing this section", never "wipe it on every unit".
{
  const targets = [t('a', 'W', { notes: 'keep me' })]
  ok('an empty section is skipped', planBulk(targets, { notes: '   ' }).rows.length === 0)
  ok('no edits at all is an empty plan', planBulk(targets, {}).writes === 0)
  const mixed = planBulk(targets, { notes: '', transit: 'new' })
  ok('the filled section still runs', mixed.writes === 1 && mixed.rows[0].section === 'transit', mixed.rows)
}

// ---- several sections at once ---------------------------------------------------------------------
{
  const p = planBulk([t('a', 'B'), t('b', 'B')], { access: 'A', neighborhood: 'N', transit: 'T' })
  ok('two listings by three sections is six rows', p.rows.length === 6, p.rows.length)
  ok('six writes, two listings', p.writes === 6 && p.listings === 2, p)
}

// ---- length guard ------------------------------------------------------------------------------
{
  ok('normal text passes', lengthErrors({ notes: 'short' }).length === 0)
  const e = lengthErrors({ notes: 'x'.repeat(2001) })
  ok('over the limit is named with both numbers', e.length === 1 && /2001/.test(e[0]) && /2000/.test(e[0]), e)
  ok('exactly at the limit passes', lengthErrors({ notes: 'x'.repeat(2000) }).length === 0)
}

// ---- drift off the property's saved standard -----------------------------------------------------
{
  const std = { transit: 'Rideshare at the north door.', neighborhood: 'Two blocks from the water.' }
  const targets = [
    t('a', 'W', { transit: 'Rideshare at the north door.', neighborhood: 'Two blocks from the water.' }),
    t('b', 'W', { transit: 'Rideshare at the north door.', neighborhood: 'something else' }),
    t('c', 'W', {}),
  ]
  const d = driftFrom(std, targets)
  ok('the matching unit is not listed', !d.some(x => x.id === 'a'), d)
  ok('the drifted unit names only its drifted section', d.find(x => x.id === 'b')?.sections.join() === 'neighborhood', d)
  ok('a blank unit has drifted on both', d.find(x => x.id === 'c')?.sections.length === 2, d)
  ok('no standard means no drift', driftFrom({}, targets).length === 0)
  ok('a blank standard section is not a standard', driftFrom({ transit: '   ' }, targets).length === 0)
}

console.log((fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
