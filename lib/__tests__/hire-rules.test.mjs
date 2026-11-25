// node lib/__tests__/hire-rules.test.mjs
// THE NEW HIRE FORM (Jon, 2026-11-25): a link sent after hiring, the person fills it in, it waits for
// approval, and only an approval makes their record and sends the invite.
const R = await import('../hire-rules.ts')
const { cleanHire, addRequest, cleanHireState, pendingOf, decidedOf, nicePhone, niceName, phoneDigits, crewKey, HIRE_TRACKS, HIRE_MARKETS, HIRE_TEXT, MARKET_WORD, MAX_PENDING } = R
let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))
const T = '2026-11-25'
const good = (o = {}) => ({ name: 'maria lopez', email: ' Maria.Lopez@Gmail.com ', phone: '954 526 8998', track: 'housekeeping', market: 'Broward', lang: 'es', startDate: '2026-12-01', emergencyName: 'JOSE LOPEZ', emergencyPhone: '(305) 555-0101', note: '  Prefiero   mañanas ', ...o })

// A good form, tidied
const g = cleanHire(good(), T)
ok('a good form passes', g.ok && !g.spam)
eq('what is kept', g.hire, { name: 'Maria Lopez', email: 'maria.lopez@gmail.com', phone: '(954) 526-8998', track: 'housekeeping', market: 'Broward', lang: 'es', startDate: '2026-12-01', emergencyName: 'Jose Lopez', emergencyPhone: '(305) 555-0101', note: 'Prefiero mañanas' })
eq('a name typed with care is left alone', niceName('María de la Cruz McGill'), 'María de la Cruz McGill')
eq('accents and hyphens survive tidying', niceName('josé o\'brien-núñez'), "José O'Brien-Núñez")
eq('phone with a country code', nicePhone('+1 954-526-8998'), '(954) 526-8998')
eq('a foreign number is kept as typed', nicePhone('+57 300 123 4567'), '+57 300 123 4567')
eq('digits', phoneDigits('(954) 526-8998'), '9545268998')
eq('optional things can be empty', cleanHire(good({ startDate: '', emergencyName: '', emergencyPhone: '', note: '' }), T).hire.startDate, null)
eq('language falls to Spanish unless it says English', [cleanHire(good({ lang: 'en' }), T).hire.lang, cleanHire(good({ lang: 'xx' }), T).hire.lang], ['en', 'es'])

// What is refused, and which box it points at
const refused = (o) => { const r = cleanHire(good(o), T); return r.ok ? 'ok' : r.error.field }
eq('one name is not a full name', refused({ name: 'Maria' }), 'name')
eq('initials are not a full name', refused({ name: 'M L' }), 'name')
eq('no email', refused({ email: '' }), 'email')
eq('a broken email', refused({ email: 'maria@gmail' }), 'email')
eq('a short phone', refused({ phone: '526-8998' }), 'phone')
eq('no job picked', refused({ track: '' }), 'track')
eq('a job that is not one of ours', refused({ track: 'ceo' }), 'track')
eq('no area picked', refused({ market: '' }), 'market')
eq('an area that is not one of ours', refused({ market: 'Orlando' }), 'market')
eq('a birthday in the start date box', refused({ startDate: '1990-04-12' }), 'startDate')
eq('a start date two years out', refused({ startDate: '2028-11-25' }), 'startDate')
eq('not a date', refused({ startDate: '12/01/2026' }), 'startDate')
eq('a start date last month is fine (already working)', refused({ startDate: '2026-10-20' }), 'ok')
eq('a short emergency phone', refused({ emergencyPhone: '555-0101' }), 'emergencyPhone')
eq('nothing at all', cleanHire(null, T).ok, false)
ok('every refusal is said in both languages', ['name', 'email', 'phone', 'track', 'market'].every(k => { const r = cleanHire(good({ [k]: '' }), T); return !r.ok && r.error.en && r.error.es && r.error.en !== r.error.es }))
ok('a robot that fills the hidden box is flagged, and still told nothing', cleanHire(good({ website: 'http://spam.example' }), T).spam === true)
ok('long text is cut', cleanHire(good({ note: 'x'.repeat(2000) }), T).hire.note.length === 500)

// Waiting for approval
const empty = cleanHireState(null)
eq('nothing saved reads as empty', empty, { code: '', codeAt: '', requests: [] })
const a = addRequest({ ...empty, code: 'abc' }, g.hire, 'h1', '2026-11-25T15:00:00.000Z')
eq('a form is added as waiting', [a.replaced, a.full, a.state.requests.map(r => [r.id, r.status])], [false, false, [['h1', 'pending']]])
eq('the link code is kept', a.state.code, 'abc')
const again = addRequest(a.state, { ...g.hire, phone: '(954) 000-1111' }, 'h2', '2026-11-25T16:00:00.000Z')
eq('the same email again replaces the first: still one to approve', [again.replaced, again.state.requests.length, again.state.requests[0].id, again.state.requests[0].phone], [true, 1, 'h1', '(954) 000-1111'])
const other = addRequest(again.state, { ...g.hire, email: 'ana@x.com', name: 'Ana Ruiz' }, 'h3', '2026-11-25T17:00:00.000Z')
eq('a second person is a second line, oldest first', pendingOf(other.state).map(r => r.name), ['Maria Lopez', 'Ana Ruiz'])
// Approved once, the same person sending the form again is a new request to look at, not a silent change.
const approved = { ...other.state, requests: other.state.requests.map(r => (r.id === 'h1' ? { ...r, status: 'approved', decidedAt: '2026-11-25T18:00:00.000Z', decidedBy: 'Jon' } : r)) }
const resend = addRequest(approved, g.hire, 'h4', '2026-11-26T09:00:00.000Z')
eq('after approval the same email is a new line', [resend.replaced, pendingOf(resend.state).map(r => r.id)], [false, ['h3', 'h4']])
eq('decided, newest first', decidedOf(resend.state).map(r => r.id), ['h1'])
// A decision is forgotten after 90 days; what is waiting never is.
const old = { code: 'abc', codeAt: '', requests: [{ ...g.hire, id: 'o1', at: '2026-06-01T00:00:00.000Z', status: 'declined', decidedAt: '2026-06-02T00:00:00.000Z' }, { ...g.hire, email: 'w@x.com', id: 'o2', at: '2026-06-01T00:00:00.000Z', status: 'pending' }] }
eq('old decisions are dropped, old waiting ones stay', addRequest(old, { ...g.hire, email: 'new@x.com' }, 'n1', '2026-11-25T00:00:00.000Z').state.requests.map(r => r.id), ['o2', 'n1'])
// The link cannot be used to bury the list.
let s = { code: 'abc', codeAt: '', requests: [] }
for (let i = 0; i < MAX_PENDING; i++) s = addRequest(s, { ...g.hire, email: `p${i}@x.com` }, 'p' + i, '2026-11-25T00:00:00.000Z').state
const over = addRequest(s, { ...g.hire, email: 'one-more@x.com' }, 'px', '2026-11-25T00:00:00.000Z')
eq('past the cap nothing more is taken', [over.full, over.state.requests.length], [true, MAX_PENDING])
eq('the cap does not stop someone already waiting from correcting theirs', addRequest(s, { ...g.hire, email: 'p3@x.com', note: 'fixed' }, 'py', '2026-11-25T00:00:00.000Z').replaced, true)

// The record key matches onboarding by hand
eq('the person key', [crewKey('Maria Lopez'), crewKey("José O'Brien-Núñez")], ['crew:maria-lopez', 'crew:jose-o-brien-nunez'])

// The words
eq('the four jobs', HIRE_TRACKS.map(t => t.key), ['housekeeping', 'maintenance', 'ops', 'ccs_admin'])
eq('the three areas', [...HIRE_MARKETS], ['Miami', 'Broward', 'North'])
ok('North is called Palm Beach on the form', MARKET_WORD.North.en === 'Palm Beach')
ok('both languages have every line', Object.keys(HIRE_TEXT.en).every(k => typeof HIRE_TEXT.es[k] === 'string' && HIRE_TEXT.es[k].length > 0) && Object.keys(HIRE_TEXT.es).length === Object.keys(HIRE_TEXT.en).length)
ok('the form says nothing happens until a manager approves', /approve/.test(HIRE_TEXT.en.lead) && /aprueb/.test(HIRE_TEXT.es.lead) && /approves/.test(HIRE_TEXT.en.done))
ok('and warns off ID and bank details', /ID numbers or bank/.test(HIRE_TEXT.en.privacy) && /bancarios/.test(HIRE_TEXT.es.privacy))

console.log(`hire rules: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
