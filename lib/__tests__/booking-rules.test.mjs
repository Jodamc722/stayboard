// node lib/__tests__/booking-rules.test.mjs
// BOOKING LINKS (Jon, 2026-11-24): never on a major US holiday, never on a day the host's calendar says
// they are off (even when Google has it marked Free), and the host is emailed every booking.
const R = await import('../booking-rules.ts')
const { usHoliday, saysOff, offDays, bookedSubject, bookedHtml, span, longDay } = R
let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))

// Holidays
eq('Thanksgiving 2026 (the day an owner booked)', usHoliday('2026-11-26'), 'Thanksgiving')
eq('Thanksgiving 2027', usHoliday('2027-11-25'), 'Thanksgiving')
eq('Thanksgiving 2028, when November starts on a Wednesday', usHoliday('2028-11-23'), 'Thanksgiving')
eq('the Thursday before is a working day', usHoliday('2026-11-19'), '')
eq('the Friday after stays open unless the calendar blocks it', usHoliday('2026-11-27'), '')
eq('Christmas Day', usHoliday('2026-12-25'), 'Christmas Day')
eq('Christmas Eve', usHoliday('2026-12-24'), 'Christmas Eve')
eq("New Year's Day", usHoliday('2027-01-01'), "New Year's Day")
eq('Memorial Day 2027 (last Monday of May)', usHoliday('2027-05-31'), 'Memorial Day')
eq('Memorial Day 2026', usHoliday('2026-05-25'), 'Memorial Day')
eq('Independence Day', usHoliday('2027-07-04'), 'Independence Day')
eq('Labor Day 2027 (first Monday of September)', usHoliday('2027-09-06'), 'Labor Day')
eq('Labor Day 2026', usHoliday('2026-09-07'), 'Labor Day')
eq('an ordinary Monday', usHoliday('2026-12-07'), '')
eq('nonsense is no holiday', usHoliday('soon'), '')

// Titles that say the host is away
for (const t of ['Out of Office', 'Out of office', 'OOO', 'Jon OOO', 'Vacation', 'PTO', 'Time off', 'Thanksgiving (not bookable)', 'Day off', 'On leave', 'Office closed'])
  ok('"' + t + '" means off', saysOff(t))
for (const t of ['Google Meet', 'Send out Stay So Flo Expenses', 'Owner Monthly Report Due || Stay Soflo', 'Weekly Ownership Call', 'Booking.com audit', 'Guests leave at 11', 'Holiday party', 'Deal closed', ''])
  ok('"' + t + '" does not', !saysOff(t))

// Days off, read from the calendar as it was on 2026-11-24
const cal = [
  { summary: 'Google Meet', start: { date: '2026-11-27' }, end: { date: '2026-11-28' } },                       // his daily all-day note, marked Free
  { summary: 'Out of Office', start: { date: '2026-11-27' }, end: { date: '2026-12-05' } },                     // the week off, marked Free by Google
  { summary: 'Send out Stay So Flo Expenses', start: { date: '2026-12-02' }, end: { date: '2026-12-03' } },
  { summary: 'Weekly Ownership Call', start: { dateTime: '2026-12-02T11:00:00-05:00' }, end: { dateTime: '2026-12-02T12:30:00-05:00' } },
  { summary: 'Owner Monthly Report Due || Stay Soflo', start: { date: '2026-12-05' }, end: { date: '2026-12-06' } },
]
const off = offDays(cal)
eq('the week off closes Friday to Friday, both included', Array.from(off).sort(), ['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
ok('the Monday he is back stays open', !off.has('2026-12-07') && !off.has('2026-12-05'))
ok('the day before stays open', !off.has('2026-11-26'))
ok('an all-day note that is not about being away closes nothing', offDays([cal[0], cal[2], cal[4]]).size === 0)
ok('a cancelled one closes nothing', offDays([{ ...cal[1], status: 'cancelled' }]).size === 0)
ok("Google's own all-day out-of-office type counts whatever it is called", offDays([{ summary: 'Away', eventType: 'outOfOffice', start: { date: '2026-12-10' }, end: { date: '2026-12-11' } }]).has('2026-12-10'))
ok('a timed meeting called "PTO planning" closes no day (free/busy handles timed events)', offDays([{ summary: 'PTO planning', start: { dateTime: '2026-12-08T10:00:00-05:00' }, end: { dateTime: '2026-12-08T11:00:00-05:00' } }]).size === 0)
ok('a month spans correctly', offDays([{ summary: 'Vacation', start: { date: '2026-12-30' }, end: { date: '2027-01-03' } }]).has('2027-01-02'))
ok('nothing in, nothing out', offDays([]).size === 0 && offDays(undefined).size === 0)

// The host's confirmation
const b = { title: 'Onboarding call', guest: 'Stéphane Georgeon', email: 'owner@example.com', phone: '305 555 0100', note: 'Can we cover pricing first?', day: '2026-12-07', time: '11:00', minutes: 60, where: 'meet', link: 'https://meet.google.com/abc-defg-hij', eventUrl: 'https://www.google.com/calendar/event?eid=x', ownerUrl: 'https://lighthouse-stay.vercel.app/owner-onboarding/abc123def456' }
eq('subject', bookedSubject(b), 'Booked: Onboarding call with Stéphane Georgeon · Mon, Dec 7, 11:00 AM')
eq('a second booking that moves the call says so', bookedSubject({ ...b, moved: true }).slice(0, 6), 'Moved:')
eq('the time span', [span('11:00', 60), span('13:45', 15), span('11:30', 45)], ['11:00 AM to 12:00 PM', '1:45 PM to 2:00 PM', '11:30 AM to 12:15 PM'])
eq('the day in words', longDay('2026-12-07'), 'Monday, December 7')
const h = bookedHtml(b)
ok('says who, when and that it is Eastern', h.includes('Stéphane Georgeon') && h.includes('Monday, December 7') && h.includes('11:00 AM to 12:00 PM Eastern') && h.includes('owner@example.com') && h.includes('305 555 0100'))
ok('the Meet link, the calendar link and their onboarding', h.includes('href="https://meet.google.com/abc-defg-hij"') && h.includes('Open in Google Calendar') && h.includes('Open their onboarding'))
ok('their note is shown', h.includes('Can we cover pricing first?'))
ok('no note, no Note row', !/>Note</.test(bookedHtml({ ...b, note: '' })))
ok('a phone call says by phone with the number', bookedHtml({ ...b, where: 'phone', link: '' }).includes('By phone, 305 555 0100'))
ok('a visit names the place', bookedHtml({ ...b, where: 'in-person', place: '11 NE 6th St, Unit 2201' }).includes('11 NE 6th St, Unit 2201'))
ok('what a guest typed is text, never markup', (() => { const x = bookedHtml({ ...b, guest: '<img src=x onerror=1>', note: '<script>1</script>' }); return !x.includes('<img') && !x.includes('<script>') })())
ok('a link that is not https is not linked', !bookedHtml({ ...b, link: 'javascript:alert(1)' }).includes('javascript:'))

console.log(`booking rules: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
