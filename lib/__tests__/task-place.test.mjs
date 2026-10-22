// node lib/__tests__/task-place.test.mjs
//
// Where a task is (LOCATION | PROPERTY | UNIT) and what the board's summary cards add up to
// (Jon, 2026-10-22, the maintenance & vendors board).
const { unitOf, taskPlace, placePrefix, boardStats, dollarsToCents, centsToDollars } = await import('../task-place.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

// ── the unit out of a nickname ──
eq('17WEST - 511 - 2BR', unitOf('17WEST - 511 - 2BR', '17 West'), '511')
eq('Arya 1705/2 - Studio', unitOf('Arya 1705/2 - Studio', 'Arya'), '1705/2')
eq('Botanica 1106 - King Studio', unitOf('Botanica 1106 - King Studio - A', 'Botanica'), '1106')
eq('Eden 2204 - Suite', unitOf('Eden 2204 - Suite', 'Eden'), '2204')
eq('Pelican 3 - Studio', unitOf('Pelican 3 - Studio', 'Pelican'), '3')
eq('Elser 4418 - 3BR', unitOf('Elser 4418 - 3BR', 'Elser'), '4418')
eq('building unknown: first segment', unitOf('Rustic 16 - 1BR', null), 'Rustic 16')
eq('a type word is not a unit', unitOf('Oasis Mango - 2BR', 'Oasis Mango'), null)
eq('building as its own segment', unitOf('Salato - 401', 'Salato'), '401')
eq('empty', unitOf('', 'Eden'), null)

// ── the place ──
const links = [
  { kind: 'listing', ref_id: 'L1', task_id: 't1', label: '17WEST - 511 - 2BR', place: { building: '17 West', market: 'Miami', unit: '511' } },
  { kind: 'listing', ref_id: 'L2', task_id: 't2', label: 'Rustic 16 - 1BR', place: { building: 'Rustic', market: 'Broward', unit: null } },
  { kind: 'listing', ref_id: 'L3', task_id: 't4', label: 'Lucerne 2 - Studio', place: { building: 'Lucerne', market: 'North', unit: '2' } },
]
eq('unit attached → location, building, unit', taskPlace({ id: 't1' }, links), { location: 'Miami', building: '17 West', unit: '511' })
eq('unit number read off the label when the place has none', taskPlace({ id: 't2' }, links), { location: 'Broward', building: 'Rustic', unit: '16' })
eq('own location wins over the unit', taskPlace({ id: 't1', location: 'Broward' }, links), { location: 'Broward', building: '17 West', unit: '511' })
eq('no unit, own location only', taskPlace({ id: 't3', location: 'Miami' }, links), { location: 'Miami', building: null, unit: null })
eq('a North unit has no board location', taskPlace({ id: 't4' }, links), { location: null, building: 'Lucerne', unit: '2' })
eq('nothing known', taskPlace({ id: 't9' }, links), { location: null, building: null, unit: null })
eq('prefix', placePrefix({ location: 'Miami', building: '17 West', unit: '511' }), 'MIAMI | 17 West | 511')
eq('prefix with gaps', placePrefix({ location: null, building: 'Eden', unit: null }), 'Eden')
eq('prefix empty', placePrefix({ location: null, building: null, unit: null }), '')

// ── the tiles ──
const today = '2026-10-22'
const tasks = [
  { id: 't1', status: 'todo', due_on: '2026-10-20', section: 'Vendor Contact', vendor_name: 'ACME' },
  { id: 't2', status: 'doing', due_on: '2026-10-22', section: 'In Progress', vendor_name: 'ACME' },
  { id: 't3', status: 'todo', due_on: null, section: 'Waiting for Quote / Approval', location: 'Miami' },
  { id: 't4', status: 'todo', due_on: '2026-10-30', section: 'Waiting for Parts' },
  { id: 't5', status: 'done', due_on: '2026-10-01', section: 'Completed' },
  { id: 't6', status: 'todo', due_on: '2026-10-22', section: 'Follow-Up Needed', parent_id: null },
  { id: 'sub', status: 'todo', due_on: '2026-10-01', section: 'New', parent_id: 't6' },
]
const COLS = ['New', 'Vendor Contact', 'Scheduled', 'Waiting for Quote / Approval', 'Waiting for Parts', 'Follow-Up Needed', 'In Progress', 'Completed']
const st = boardStats(tasks, links, today, COLS)
eq('open counts top-level open tasks only', st.open, 5)
eq('completed', st.completed, 1)
eq('by location from units and own location', st.byLocation, { Miami: 2, Broward: 1 })
eq('overdue follow-ups', st.overdue, 1)
eq('due today', st.today, 2)
eq('waiting for vendor = the vendor columns (contact, scheduled, parts) — the job in progress with a vendor is not waiting', st.waitingVendor, 2)
eq('waiting for approval by column name', st.waitingApproval, 1)
eq('follow-up needed column', st.followUp, 1)
// A board with no vendor columns: the tile is the open jobs that carry a vendor; approval by its words.
const plain = boardStats([
  { id: 'a', status: 'todo', due_on: null, section: 'To do', vendor_name: 'ACME' },
  { id: 'b', status: 'doing', due_on: null, section: 'Doing', vendor_name: 'ACME' },
  { id: 'c', status: 'todo', due_on: null, section: 'To do', title: 'Owner approval for the new sofa' },
  { id: 'd', status: 'done', due_on: null, section: 'Done', vendor_name: 'ACME' },
], [], today, ['To do', 'Doing', 'Done'])
eq('no vendor columns: open jobs with a vendor', plain.waitingVendor, 2)
eq('no approval column: the word approval', plain.waitingApproval, 1)

// ── money ──
eq('dollars → cents', dollarsToCents('1,250.50'), 125050)
eq('bare number', dollarsToCents(450), 45000)
eq('empty → null', dollarsToCents(''), null)
eq('cents → dollars', centsToDollars(45000), '$450')
eq('cents → dollars with change', centsToDollars(125050), '$1,250.50')
eq('null → empty', centsToDollars(null), '')

console.log(`task-place: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
