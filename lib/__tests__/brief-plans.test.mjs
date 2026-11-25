// node lib/__tests__/brief-plans.test.mjs
// THE BRIEFS (Jon, 2026-11-25): one plan shape for Broward, Miami, North and Customer Care; a note, added
// lines and rows taken out before it goes out, for one day only; and the email drawn from the same plan.
const R = await import('../brief-plan-rules.ts')
const { PLAN_KEYS, PLAN_NAMES, isPlanKey, applyEdits, cleanEdits, emptyEdits, cleanSettings, parseEmails, planEmailHtml, planSubject, sectionCount } = R
let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))

eq('the five plans: Ops, then his order', PLAN_KEYS.map(k => PLAN_NAMES[k]), ['Ops', 'Broward', 'Miami', 'North', 'Customer Care'])
ok('a plan key is checked', isPlanKey('north') && isPlanKey('ops') && !isPlanKey('west') && !isPlanKey(undefined))

const day = '2026-11-25'
const plan = {
  key: 'broward', name: 'Broward', forWhom: 'The Broward field team', day, dayLabel: 'Wed, Nov 25', builtAt: '2026-11-25T11:00:00Z',
  tiles: [{ label: 'Arrivals', value: '9' }, { label: 'Checkouts', value: '7' }, { label: 'Cleans', value: '7' }, { label: 'Not assigned', value: '1', tone: 'red' }],
  sections: [
    { key: 'unassigned', title: 'Cleans not assigned', tone: 'red', empty: 'Every clean has a name on it.', rows: [{ id: 'un:1', title: 'Eden 1203', tone: 'red', meta: 'Guest lands 4:00 PM: assign this one first', tags: [{ text: 'Same-day turn', tone: 'red' }] }] },
    { key: 'vip', title: 'VIPs, big bookings and owners', rows: [{ id: 'vip:2', title: 'Rustic 8', tags: [{ text: 'Big booking · $4,200', tone: 'amber' }], meta: 'Dana lands 4:00 PM · 6 nights' }], empty: 'No VIP today.' },
    { key: 'arrivals', title: 'Arrivals today', rows: [{ id: 'arr:2', title: 'Rustic 8', meta: '4:00 PM · Dana · 6 nights' }, { id: 'arr:3', title: 'Oasis Royal Palm', meta: '4:00 PM · Lee · 2 nights', note: 'Arriving after 11pm' }] },
    { key: 'cleans', title: 'Cleans today, by cleaner', groups: [{ name: 'Vilma', meta: '2 cleans · 1 same-day', rows: [{ id: 'cl:4', title: 'Eden 2101', tags: [{ text: 'Lands 4:00 PM', tone: 'red' }] }, { id: 'cl:5', title: 'Eden 2103' }] }, { name: 'Paola', meta: '1 clean', rows: [{ id: 'cl:6', title: 'Rustic 15' }] }] },
  ],
  board: { label: 'Open the live board', href: 'https://x.test/day?market=Broward' },
}

// Edits are for one day
eq('yesterday’s edits are not today’s', cleanEdits({ day: '2026-11-24', note: 'old', hidden: ['a'], extra: [{ id: 'x1', text: 't', by: 'Jon' }] }, day), emptyEdits(day))
const e = cleanEdits({ day, note: '  Linen truck is late.\nStart with Eden.  ', noteBy: 'Jon', hidden: ['arr:3', 'cl:6', ''], extra: [{ id: 'x1', text: '  Pool   vendor at Eden 10am ', by: 'Jon' }, { id: '', text: 'no id' }, { id: 'x2', text: '' }] }, day)
eq('edits are cleaned', [e.hidden, e.extra], [['arr:3', 'cl:6'], [{ id: 'x1', text: 'Pool vendor at Eden 10am', by: 'Jon' }]])

// On the page: marked, never removed
const page = applyEdits(plan, e, false)
ok('the note rides on the plan', page.note.startsWith('  Linen truck') && page.noteBy === 'Jon')
eq('an added line leads the plan under Also today', [page.sections[0].key, page.sections[0].rows[0].title, page.sections[0].rows[0].custom, page.sections[0].rows[0].by], ['also', 'Pool vendor at Eden 10am', true, 'Jon'])
ok('a row taken out stays on the page, marked', page.sections.find(s => s.key === 'arrivals').rows.find(r => r.id === 'arr:3').hidden === true)
ok('and so does one inside a cleaner’s list', page.sections.find(s => s.key === 'cleans').groups[1].rows[0].hidden === true)
eq('the count leaves hidden rows out', [sectionCount(page.sections.find(s => s.key === 'arrivals')), sectionCount(page.sections.find(s => s.key === 'cleans'))], [1, 2])
ok('the numbers at the top never change with an edit', JSON.stringify(page.tiles) === JSON.stringify(plan.tiles))
ok('the plan itself is not changed', plan.sections.length === 4 && !plan.sections[2].rows[1].hidden)

// In what is sent: gone
const out = applyEdits(plan, e, true)
ok('a row taken out is not sent', !JSON.stringify(out).includes('Oasis Royal Palm'))
ok('a cleaner left with nothing is not sent', out.sections.find(s => s.key === 'cleans').groups.map(g => g.name).join() === 'Vilma')
ok('no edits: the plan as built, no note', applyEdits(plan, null, true).sections.length === 4 && applyEdits(plan, null).note === undefined)
ok('a section emptied by hand keeps its "nothing" line when it has one', applyEdits(plan, { ...e, hidden: ['un:1'] }, true).sections.some(s => s.key === 'unassigned'))
ok('one without that line is dropped', !applyEdits(plan, { ...e, hidden: ['arr:2', 'arr:3'] }, true).sections.some(s => s.key === 'arrivals'))

// The email
const html = planEmailHtml(out)
ok('the name, the day and who it is for', html.includes('Broward plan') && html.includes('Wed, Nov 25') && html.includes('The Broward field team'))
ok('the numbers', html.includes('>9<') && html.includes('Not assigned'))
ok('the note, with who wrote it, above the sections', html.includes('Note from Jon') && html.indexOf('Linen truck is late.') < html.indexOf('Cleans not assigned'))
ok('his order: also today, not assigned, VIPs, arrivals, cleans', ['Also today', 'Cleans not assigned', 'VIPs, big bookings', 'Arrivals today', 'Cleans today'].every((t, i, a) => i === 0 || html.indexOf(a[i - 1]) < html.indexOf(t)))
ok('cleans are under each cleaner, numbered', html.includes('<b>Vilma</b>') && html.includes('2 cleans') && />1<\/td>/.test(html) && />2<\/td>/.test(html))
ok('tags are words', html.includes('Same-day turn') && html.includes('Big booking'))
ok('the board link', html.includes('href="https://x.test/day?market=Broward"'))
ok('an empty section says so', planEmailHtml({ ...plan, sections: [{ key: 'unassigned', title: 'Cleans not assigned', rows: [], empty: 'Every clean has a name on it.' }] }).includes('Every clean has a name on it.'))
ok('what a person typed is text, never markup', (() => { const x = planEmailHtml(applyEdits(plan, { day, note: '<script>1</script>', noteBy: '<b>x', hidden: [], extra: [{ id: 'x9', text: '<img src=x>', by: 'J' }] }, true)); return !x.includes('<script>') && !x.includes('<img') && !x.includes('<b>x') })())
ok('a link that is not https is not linked', !planEmailHtml({ ...plan, board: { label: 'x', href: 'javascript:alert(1)' } }).includes('javascript:'))
eq('subject', planSubject(plan), 'Broward plan · Wed, Nov 25 · 9 arrivals · 7 checkouts')

// Who gets it
eq('addresses from what a person typed', parseEmails('Karla@Stay-Hospitality.com, roberto@stay-hospitality.com;\n karla@stay-hospitality.com  not-an-email'), ['karla@stay-hospitality.com', 'roberto@stay-hospitality.com'])
const st = cleanSettings({ broward: { to: 'a@b.co', auto: true, lastSent: { day, at: 'x', by: 'jon', n: 1 } }, care: { to: ['c@d.co'], auto: 0 } })
eq('settings: every plan present, off unless switched on', [st.broward.auto, st.broward.to, st.miami, st.care.auto, st.care.to, st.broward.lastSent.n], [true, ['a@b.co'], { to: [], auto: false, lastSent: null }, false, ['c@d.co'], 1])
eq('settings from nothing: all off, nobody on any list', PLAN_KEYS.map(k => [cleanSettings(null)[k].auto, cleanSettings(null)[k].to.length]), [[false, 0], [false, 0], [false, 0], [false, 0], [false, 0]])

// Hours and other tasks (Jon, 2026-11-25: "how many hours based on cleans expected, also other task they have assigned too")
const { hoursText, personMeta, crewFor } = R
eq('hours read short', [hoursText(7.5), hoursText(8), hoursText(31.3), hoursText(0), hoursText(0.1)], ['7.5h', '8h', '31.5h', '0h', '0.5h'])
eq('one clean reads to the quarter hour', [hoursText(1.75, 0.25), hoursText(2.5, 0.25), hoursText(3.25, 0.25), hoursText(3, 0.25)], ['1.75h', '2.5h', '3.25h', '3h'])
eq('beside a cleaner: cleans, hours, other tasks, then hot and done', personMeta({ cleans: 4, hours: 7.5, tasks: 2, sameDay: 1, done: 1 }), '4 cleans · about 7.5h · 2 other tasks · 1 same-day · 1 done')
eq('one of each', personMeta({ cleans: 1, hours: 1.75, tasks: 1 }), '1 clean · about 2h · 1 other task')
eq('a vendor clean has no hours of ours', personMeta({ cleans: 3, hours: 0, tasks: 0 }), '3 cleans')
eq('no cleans: just the tasks', personMeta({ cleans: 0, hours: 0, tasks: 3 }), '3 tasks')
eq('hours as people on a shift, a whole person at a time', [crewFor(31.5, 8), crewFor(8, 8), crewFor(8.25, 8), crewFor(3, 8), crewFor(0, 8), crewFor(12, 0)], ['4 cleaners at 8h', '1 cleaner at 8h', '2 cleaners at 8h', '1 cleaner at 8h', '', '2 cleaners at 8h'])
const team = { ...plan, tiles: [{ label: 'Arrivals', value: '9' }, { label: 'Cleans', value: '7' }, { label: 'Clean hours', value: '15.5h', note: '2 cleaners at 8h' }],
  sections: [{ key: 'cleans', title: 'Cleans and tasks today, by person', empty: 'No checkout cleans today.', groups: [
    { name: 'Vilma', meta: '2 cleans · about 4h · 2 other tasks', rows: [{ id: 'cl:4', title: 'Eden 2101', meta: '1 BR · about 1.75h' }, { id: 'cl:5', title: 'Eden 1203', meta: 'Studio · about 1.75h' }], also: [{ id: 'ot:4:linen', title: 'Eden 2101', meta: 'Linen drop' }, { id: 'ot:9:restock', title: 'Eden Building', meta: 'Restock closet', tags: [{ text: '2 days late', tone: 'red' }] }], more: 'and 3 more on the board' },
    { name: 'Karla', meta: '2 tasks', rows: [], also: [{ id: 'ot:7:insp', title: 'Rustic 8', meta: 'VIP arrival inspection' }, { id: 'ot:8:insp', title: 'Oasis Mango', meta: 'Arrival inspection' }] },
  ] }] }
const teamSec = p => p.sections.find(s => s.key === 'cleans')
eq('other tasks count with the cleans', sectionCount(teamSec(team)), 6)
const teamPage = applyEdits(team, { day, note: '', noteBy: '', hidden: ['ot:9:restock', 'ot:7:insp', 'ot:8:insp'], extra: [] }, false)
ok('an other task taken out stays on the page, marked', teamSec(teamPage).groups[0].also[1].hidden === true && teamSec(teamPage).groups[1].also.every(r => r.hidden) && sectionCount(teamSec(teamPage)) === 3)
const teamOut = applyEdits(team, { day, note: '', noteBy: '', hidden: ['ot:9:restock', 'ot:7:insp', 'ot:8:insp'], extra: [] }, true)
eq('and is not sent; a person left with nothing is not sent either', [teamSec(teamOut).groups.map(g => g.name), teamSec(teamOut).groups[0].also.map(r => r.id)], [['Vilma'], ['ot:4:linen']])
ok('a person with tasks and no cleans is sent', teamSec(applyEdits(team, null, true)).groups.map(g => g.name).join() === 'Vilma,Karla')
ok('hiding every clean keeps the person while a task is left', teamSec(applyEdits(team, { day, note: '', noteBy: '', hidden: ['cl:4', 'cl:5'], extra: [] }, true)).groups[0].name === 'Vilma')
const teamHtml = planEmailHtml(applyEdits(team, null, true))
ok('the email: hours beside the name, other tasks under the cleans', teamHtml.includes('2 cleans · about 4h · 2 other tasks') && teamHtml.indexOf('Other tasks') > teamHtml.indexOf('Eden 1203') && teamHtml.includes('Linen drop') && teamHtml.includes('and 3 more on the board'))
ok('the email: a person with only tasks has their tasks straight under the name, no second label', teamHtml.includes('<b>Karla</b>') && teamHtml.includes('VIP arrival inspection') && teamHtml.split('Other tasks').length === 2)
ok('the email: the hours tile says how many people that is', teamHtml.includes('15.5h') && teamHtml.includes('2 cleaners at 8h'))
eq('subject with the hours tile', planSubject(team), 'Broward plan · Wed, Nov 25 · 9 arrivals · 7 cleans')

// The Ops plan (Jon, 2026-11-25: "top priorities, not necessarily the cleans, the schedule and any cleans not assigned")
const ops = { key: 'ops', name: 'Ops', forWhom: 'The operations team: every market on one page', day, dayLabel: 'Wed, Nov 25', builtAt: '2026-11-25T11:00:00Z',
  tiles: [{ label: 'Arrivals', value: '31' }, { label: 'Cleans', value: '24' }, { label: 'Clean hours', value: '52h', note: '7 cleaners at 8h' }, { label: 'Not assigned', value: '2', tone: 'red' }],
  sections: [
    { key: 'priorities', title: 'Top priorities', tone: 'red', empty: 'Nothing needs a decision right now.', rows: [{ id: 'pr:unassigned', title: '2 cleans have nobody on them', tone: 'red', meta: 'Eden 1203, Elser 2504' }, { id: 'pr:x', title: 'Rustic 8', tone: 'amber', tags: [{ text: 'Supervisor', tone: 'amber' }], meta: 'VIP lands 4:00 PM, clean not started', note: 'Next: confirm the clean is under way by noon' }] },
    { key: 'unassigned', title: 'Cleans not assigned', tone: 'red', empty: 'Every clean has a name on it.', rows: [{ id: 'un:1', title: 'Eden 1203', tone: 'red', tags: [{ text: 'Broward', tone: 'grey' }] }, { id: 'un:2', title: 'Elser 2504', tone: 'red', tags: [{ text: 'Miami', tone: 'grey' }] }] },
    { key: 'schedule', title: 'The schedule: who is working', groups: [
      { name: 'Broward', meta: '2 working · 7 cleans · about 15h, the guide is 2 cleaners at 8h', rows: [], also: [{ id: 'sc:vilma', title: 'Vilma Perez', meta: '8:00 AM – 4:30 PM · 4 cleans · about 7.5h · 2 other tasks · 2 same-day' }, { id: 'sc:yos', title: 'Yoslenis Diaz', meta: '8:00 AM – 4:30 PM · 3 cleans · about 7.5h' }] },
      { name: 'On shift, nothing assigned', rows: [], also: [{ id: 'sc:idle:ana', title: 'Ana Ruiz', tone: 'amber', meta: '9:00 AM – 5:00 PM' }] },
    ] },
  ] }
const opsHtml = planEmailHtml(applyEdits(ops, null, true))
ok('ops: priorities lead, then not assigned, then the schedule', ['Top priorities', 'Cleans not assigned', 'The schedule'].every((t, i, a) => i === 0 || opsHtml.indexOf(a[i - 1]) < opsHtml.indexOf(t)))
ok('ops: the schedule is a line a person, not a list of cleans', opsHtml.includes('<b>Vilma Perez</b>') && opsHtml.includes('4 cleans · about 7.5h · 2 other tasks') && !opsHtml.includes('Other tasks') && opsHtml.includes('the guide is 2 cleaners at 8h'))
ok('ops: someone on shift with nothing is named', opsHtml.includes('On shift, nothing assigned') && opsHtml.includes('Ana Ruiz'))
eq('ops: the count beside the schedule is people', sectionCount(ops.sections[2]), 3)
eq('ops: subject', planSubject(ops), 'Ops plan · Wed, Nov 25 · 31 arrivals · 24 cleans')
ok('ops: a person taken off the schedule is not sent', !planEmailHtml(applyEdits(ops, { day, note: '', noteBy: '', hidden: ['sc:idle:ana'], extra: [] }, true)).includes('nothing assigned'))

// The day and the preview (Jon, 2026-11-25: "add a calendar selection to briefs … look at tomorrow's brief" · "have a preview button so we can see")
const { cleanDay, addDays, daysBetween, dayWord, editsKey, pruneEdits, asSent, DAYS_AHEAD } = R
eq('days are counted on the calendar, across a month end', [addDays('2026-11-25', 1), addDays('2026-11-30', 1), addDays('2026-12-31', 1), daysBetween('2026-11-25', '2026-11-26'), daysBetween('2026-11-25', '2026-12-02')], ['2026-11-26', '2026-12-01', '2027-01-01', 1, 7])
eq('today and the next seven days are allowed; anything else is today', [cleanDay('2026-11-26', day), cleanDay(addDays(day, DAYS_AHEAD), day), cleanDay(addDays(day, DAYS_AHEAD + 1), day), cleanDay('2026-11-24', day), cleanDay('tomorrow', day), cleanDay(null, day), cleanDay('2026-13-45', day)], ['2026-11-26', '2026-12-02', day, day, day, day, day])
eq('the word for the day', [dayWord(0), dayWord(undefined), dayWord(1), dayWord(3)], ['today', 'today', 'tomorrow', 'that day'])
eq('each day keeps its own edits', [editsKey('ops', '2026-11-26'), editsKey('broward', day)], ['ops@2026-11-26', 'broward@2026-11-25'])
eq('edits for days gone are dropped, tomorrow’s are kept', Object.keys(pruneEdits({ 'ops@2026-11-24': { day: '2026-11-24' }, 'ops@2026-11-25': { day }, 'ops@2026-11-26': { day: '2026-11-26' }, broward: { day: '2026-11-20' }, junk: 'x' }, day)), ['ops@2026-11-25', 'ops@2026-11-26'])
const tomorrow = { ...plan, day: '2026-11-26', dayLabel: 'Thu, Nov 26', ahead: 1 }
const tEdits = { day: '2026-11-26', note: 'Thanksgiving: short crew', noteBy: 'Jon', hidden: ['arr:3'], extra: [{ id: 'x2', text: 'Gate vendor at 9', by: 'Jon' }] }
ok('today’s edits are not put on tomorrow’s plan', applyEdits(tomorrow, e, false).note === undefined && !applyEdits(tomorrow, e, false).sections.some(s => s.key === 'also'))
const tPage = applyEdits(tomorrow, tEdits, false)
eq('a line added to tomorrow’s plan leads it under Also tomorrow', [tPage.sections[0].title, tPage.note], ['Also tomorrow', 'Thanksgiving: short crew'])
eq('the preview is the page with the rows left out removed: the same thing that is sent', JSON.stringify(asSent(tPage)), JSON.stringify(applyEdits(tomorrow, tEdits, true)))
ok('and the preview does not change the page', tPage.sections.find(s => s.key === 'arrivals').rows.some(r => r.hidden))
const tHtml = planEmailHtml(asSent(tPage))
ok('the previewed email is tomorrow’s: its day, its note, without the row left out', tHtml.includes('Thu, Nov 26') && tHtml.includes('Thanksgiving: short crew') && tHtml.includes('Also tomorrow') && !tHtml.includes('Oasis Royal Palm'))
eq('its subject names the day', planSubject(asSent(tPage)).startsWith('Broward plan · Thu, Nov 26'), true)

console.log(`brief plans: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
