// node lib/__tests__/clean-invoice-mail.test.mjs
// INVOICES BY EMAIL (lib/clean-invoice-mail-rules.ts): who is answered, what is read, what the reply says.
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return n(s + '.ts', c); throw e } }"))
const R = await import('../clean-invoice-mail-rules.ts')
const { INVOICE_ADDRESS, isTeam, addressOf, nameOf, addressedToUs, skipReason, isReply, invoiceFiles, mediaTypeOf, tally, headline, replySubject, teamReplyHtml, outsideReplyHtml, noFileHtml, cleanState, REPLY_TAG, looksLikeTimeReport, TIME_REPORT_NOTE } = R

let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))
const H = (o = {}) => ({ from: 'Ana Ruiz <ana@probowl.com>', to: INVOICE_ADDRESS, cc: '', deliveredTo: '', subject: 'Invoice 1246', autoSubmitted: '', precedence: '', messageId: '<a@x>', references: '', inReplyTo: '', ...o })

// Who is the team
ok('stay-hospitality is team', isTeam('karla@stay-hospitality.com'))
ok('upper case is team', isTeam('Karla@Stay-Hospitality.com'))
ok('staysoflo is team', isTeam('x@staysoflo.com'))
ok('a vendor is not team', !isTeam('ana@probowl.com'))
ok('a look-alike domain is not team', !isTeam('ana@stay-hospitality.com.evil.io'))
ok('a name containing the domain is not team', !isTeam('stay-hospitality.com@gmail.com'))
eq('address from a named sender', addressOf('Ana Ruiz <Ana@ProBowl.com>'), 'ana@probowl.com')
eq('address when bare', addressOf(' ana@probowl.com '), 'ana@probowl.com')
eq('name from a named sender', nameOf('"Ana Ruiz" <ana@probowl.com>'), 'Ana Ruiz')

// Addressed to us: To, Cc or delivered
ok('to', addressedToUs(H()))
ok('cc', addressedToUs(H({ to: 'karla@stay-hospitality.com', cc: 'Invoices <JON+INVOICES@stay-hospitality.com>' })))
ok('delivered-to (a bcc)', addressedToUs(H({ to: 'x@y.com', deliveredTo: INVOICE_ADDRESS })))
ok('bcc line only (sent from the mailbox itself)', addressedToUs(H({ to: '', bcc: INVOICE_ADDRESS })))
ok('plain jon@ is not the invoice address', !addressedToUs(H({ to: 'jon@stay-hospitality.com' })))

// What is left alone
eq('a normal vendor mail is read', skipReason(H()), '')
eq('a team mail is read', skipReason(H({ from: 'jon@stay-hospitality.com' })), '')
ok('not sent to the address', !!skipReason(H({ to: 'jon@stay-hospitality.com' })))
ok('our own reply', !!skipReason(H({ subject: REPLY_TAG + ': Invoice 1246', from: 'jon@stay-hospitality.com' })))
ok('a reply to our own reply', !!skipReason(H({ subject: 'Re: ' + REPLY_TAG + ': Invoice 1246' })))
ok('an out-of-office', !!skipReason(H({ autoSubmitted: 'auto-replied' })))
eq('Auto-Submitted: no is a person', skipReason(H({ autoSubmitted: 'no' })), '')
ok('a bounce', !!skipReason(H({ from: 'MAILER-DAEMON@googlemail.com' })))
ok('a no-reply sender', !!skipReason(H({ from: 'QuickBooks <no-reply@intuit.com>' })))
ok('a mailing list', !!skipReason(H({ precedence: 'bulk' })))
ok('no sender', !!skipReason(H({ from: '' })))
ok('a reply by subject', isReply(H({ subject: 'RE: Invoice 1246' })))
ok('a reply by header', isReply(H({ inReplyTo: '<b@x>' })))
ok('a first message is not a reply', !isReply(H()))

// Which attachments are read
const part = (filename, mimeType, size, o = {}) => ({ filename, mimeType, size, attachmentId: 'att-' + filename, inline: false, ...o })
eq('a pdf is read', invoiceFiles([part('inv.pdf', 'application/pdf', 90000)]).take.map(p => p.filename), ['inv.pdf'])
eq('a pdf sent as octet-stream is read', invoiceFiles([part('inv.PDF', 'application/octet-stream', 90000)]).take.length, 1)
eq('a signature logo is not', invoiceFiles([part('logo.png', 'image/png', 6000)]).take.length, 0)
eq('an inline image is not', invoiceFiles([part('image001.jpg', 'image/jpeg', 300000, { inline: true })]).take.length, 0)
eq('a photo of an invoice is', invoiceFiles([part('IMG_2231.jpg', 'image/jpeg', 2400000)]).take.length, 1)
eq('a spreadsheet is not read', invoiceFiles([part('inv.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 30000)]).take.length, 0)
eq('a csv is', invoiceFiles([part('inv.csv', 'text/csv', 900)]).take.length, 1)
eq('a file over 20 MB is not', invoiceFiles([part('big.pdf', 'application/pdf', 21 * 1024 * 1024)]).take.length, 0)
eq('a part with no attachment id is not', invoiceFiles([part('inv.pdf', 'application/pdf', 9000, { attachmentId: '' })]).take.length, 0)
const six = [1, 2, 3, 4, 5, 6].map(n => part(`i${n}.pdf`, 'application/pdf', n * 1000))
eq('four per email, largest first', invoiceFiles(six).take.map(p => p.filename), ['i6.pdf', 'i5.pdf', 'i4.pdf', 'i3.pdf'])
eq('and it says how many were left', invoiceFiles(six).left, 2)
eq('octet-stream pdf reads as pdf', mediaTypeOf({ filename: 'a.PDF', mimeType: 'application/octet-stream' }), 'application/pdf')
eq('jpeg keeps its type', mediaTypeOf({ filename: 'a.jpg', mimeType: 'image/jpeg; name=a.jpg' }), 'image/jpeg')
eq('csv with an odd type reads as text', mediaTypeOf({ filename: 'a.csv', mimeType: 'application/vnd.ms-excel' }), 'text/plain')

// What the reply says
const line = (n, verdict, amount = 100, o = {}) => ({ n, date: '2026-11-0' + n, unitText: 'Capri 11' + n, unit: 'Capri 11' + n + ' - 1BR', service: 'Departure clean', amount, verdict, why: 'because ' + verdict, ...o })
const inv = { id: 'abc123', vendor: 'Pro Bowl <Cleaning>', number: 'INV1246', periodFrom: '2026-11-01', periodTo: '2026-11-07', invoiceDate: '2026-11-08', total: 500,
  lines: [line(1, 'match'), line(2, 'no_clean', 125), line(3, 'duplicate', 125), line(4, 'match'), line(5, 'date_off', 50, { resolved: { by: 'x' } })], unbilled: [{}, {}] }
eq('tally', tally(inv), { lines: 5, matched: 2, flagged: 2, flaggedAmount: 250, unbilled: 2, unchecked: 0 })
eq('headline with flags', headline([{ file: 'a.pdf', invoice: inv }]), '2 of 5 lines do not match ($250.00)')
eq('headline all matching', headline([{ file: 'a.pdf', invoice: { ...inv, lines: [line(1, 'match')] } }]), 'all 1 line match a clean')
eq('headline one flag', headline([{ file: 'a.pdf', invoice: { ...inv, lines: [line(1, 'match'), line(2, 'no_clean', null)] } }]), '1 of 2 lines does not match')
eq('headline unreadable', headline([{ file: 'a.pdf', error: 'boom' }]), 'could not be read')
eq('headline mixed', headline([{ file: 'a.pdf', invoice: inv }, { file: 'b.pdf', error: 'x' }]), '2 of 5 lines do not match ($250.00); 1 file could not be read')
eq('headline nothing', headline([]), 'no invoice file found')
eq('subject', replySubject('Fwd: RE: Invoice 1246'), 'Re: Invoice 1246')
eq('subject empty', replySubject(''), 'Re: Invoice')

const team = teamReplyHtml([{ file: 'a.pdf', invoice: inv }], 'https://lh.example', { skipped: 1 })
ok('team reply names the vendor, escaped', team.includes('Pro Bowl &lt;Cleaning&gt;') && !team.includes('<Cleaning>'))
ok('team reply links the invoice', team.includes('https://lh.example/clean-invoices?id=abc123'))
ok('team reply lists the flagged lines', team.includes('No clean on record') && team.includes('Billed twice') && team.includes('because no_clean'))
ok('team reply leaves out matching and resolved lines', !team.includes('because match') && !team.includes('because date_off'))
ok('team reply says what was skipped', team.includes('1 more attachment was not read'))
ok('team reply says prices are not checked', team.includes('Prices are not checked') && team.includes('billed per clean'))
const forJon = teamReplyHtml([{ file: 'a.pdf', invoice: inv }], 'https://lh.example', { forOutside: { name: 'Ana Ruiz', email: 'ana@probowl.com' } })
ok('the copy for Jon says who sent it and that they were not told', forJon.includes('ana@probowl.com') && forJon.includes('nothing below went to them'))

// THE RULE THAT MATTERS: an outside sender is told nothing about what the audit found.
const out = outsideReplyHtml([{ file: 'a.pdf', invoice: inv }])
ok('outside note thanks them', /received your invoice/.test(out))
for (const leak of ['No clean on record', 'Billed twice', 'do not match', '$250', 'flag', 'Capri', 'dispute', 'clean-invoices', 'Lighthouse', 'because'])
  ok('outside note does not say "' + leak + '"', !out.includes(leak))
ok('outside note for two invoices', /your 2 invoices/.test(outsideReplyHtml([{ file: 'a', invoice: inv }, { file: 'b', invoice: inv }])))
ok('no-file note says what to attach', /PDF/.test(noFileHtml()) && noFileHtml().includes(REPLY_TAG))

// TWO MODELS (Jon, 2026-11-25): an hours invoice reads as hours, and a time report is named, not audited.
const hline = (n, verdict, o = {}) => ({ n, date: null, unitText: 'Dayrene Mayari', unit: 'Dayrene Mayari', service: 'Housekeeper, Miami · 40.00 regular + 6.10 overtime at $18.00', amount: 1047.51, verdict, why: 'because ' + verdict, ...o })
const hinv = { id: 'h1', vendor: 'Opal Works, LLC', number: '337', periodFrom: '2026-11-15', periodTo: '2026-11-21', invoiceDate: '2026-11-21', total: 5434.56, model: 'hours',
  lines: [hline(1, 'hours_match'), hline(2, 'hours_over', { risk: 46.1 }), hline(3, 'hours_under'), hline(4, 'amount_off', { unitText: 'Invoice total', amount: 5434.56, risk: 27.61 }), hline(5, 'unchecked')], unbilled: [{}] }
eq('an hours tally counts the part in question, not the whole line', tally(hinv), { lines: 5, matched: 1, flagged: 2, flaggedAmount: 73.71, unbilled: 1, unchecked: 1 })
eq('fewer hours than worked is shown, not flagged', tally({ ...hinv, lines: [hline(1, 'hours_under')] }).flagged, 0)
eq('an hours headline says Homebase', headline([{ file: 'a.pdf', invoice: { ...hinv, lines: [hline(1, 'hours_match')] } }]), 'all 1 line match Homebase')
eq('one of each says our records', headline([{ file: 'a.pdf', invoice: { ...hinv, lines: [hline(1, 'hours_match')] } }, { file: 'b.pdf', invoice: { ...inv, lines: [line(1, 'moved')] } }]), 'all 2 lines match our records')
eq('a moved clean counts as matching', tally({ ...inv, lines: [line(1, 'moved'), line(2, 'other_cleaner', 115)] }), { lines: 2, matched: 1, flagged: 1, flaggedAmount: 115, unbilled: 2, unchecked: 0 })
eq('nothing flagged but something unchecked does not read as all clear', headline([{ file: 'a.pdf', invoice: { ...hinv, lines: [hline(1, 'hours_match'), hline(2, 'unchecked')] } }]), 'nothing flagged on 2 lines; 1 could not be checked')
const hteam = teamReplyHtml([{ file: 'a.pdf', invoice: hinv }, { file: 'Time Report 11.15 - 11.21.pdf', note: TIME_REPORT_NOTE }], 'https://lh.example')
ok('an hours reply says how it bills and what it was checked against', hteam.includes('billed by the hour') && hteam.includes('match Homebase') && hteam.includes('punched in Homebase'))
ok('an hours reply shows the hours column, not a date', hteam.includes('Hours billed') && hteam.includes('40.00 regular + 6.10 overtime') && !hteam.includes('no date'))
ok('an hours reply lists flags and what could not be checked', hteam.includes('because hours_over') && hteam.includes('because amount_off') && hteam.includes('because unchecked') && !hteam.includes('because hours_match') && !hteam.includes('because hours_under'))
ok('an hours reply counts people not on the invoice', hteam.includes('1 person with hours in the period not on the invoice'))
ok('a time report is named, not called unreadable', hteam.includes('Time Report 11.15 - 11.21.pdf') && hteam.includes('not an invoice') && !hteam.includes('could not be read'))
eq('only a time report in the mail', headline([{ file: 't.pdf', note: TIME_REPORT_NOTE }]), 'no invoice in the files, only a time report')
eq('a time report does not count as an unreadable file', headline([{ file: 'a.pdf', invoice: inv }, { file: 't.pdf', note: TIME_REPORT_NOTE }]), '2 of 5 lines do not match ($250.00)')
ok('Atlantic time reports by name', looksLikeTimeReport('Time Report 11.15 - 11.21 Stay Hospitality.pdf') && looksLikeTimeReport('timesheet_week47.pdf') && looksLikeTimeReport('Time-Sheet.PDF'))
ok('an invoice is not a time report by name', !looksLikeTimeReport('Invoice 195 Stay Hospitality - MIA.pdf') && !looksLikeTimeReport('OpalWorks 0337-Stay Hospitality Housekeeping.pdf') && !looksLikeTimeReport('Invoice and time report 195.pdf') && !looksLikeTimeReport('Overtime report.pdf'))
for (const leak of ['Homebase', 'hours', 'Dayrene', '$', 'flag'])
  ok('outside note for an hours invoice does not say "' + leak + '"', !outsideReplyHtml([{ file: 'a.pdf', invoice: hinv }]).includes(leak))

// State
eq('empty state is off', cleanState(null).on, false)
eq('junk state is off', cleanState('x').on, false)
eq('state keeps on', cleanState({ on: true, handled: [{ id: '1' }], count: '3' }).count, 3)
eq('state caps what it remembers', cleanState({ handled: Array.from({ length: 400 }, (_, i) => ({ id: String(i) })) }).handled.length, 300)

// Who gets the answer (Jon, 2026-11-25: "sent to me so I see in my inbox … and it always respond to the person who emailed it")
const { answerTo } = R
const ME = 'jon@stay-hospitality.com'
eq('one of ours: to them, Jon copied', answerTo('Karla@Stay-Hospitality.com', ME), { to: ['karla@stay-hospitality.com'], cc: [ME] })
eq('Jon himself: to Jon, once', answerTo('jon@stay-hospitality.com', ME), { to: [ME], cc: [] })
eq('Jon from one of his plus-addresses: still just Jon', answerTo('jon+ops@stay-hospitality.com', ME), { to: [ME], cc: [] })
eq('an outside sender never gets the full answer', answerTo('billing@cleanco.com', ME), { to: [ME], cc: [] })
eq('no sender: to Jon', answerTo('', ME), { to: [ME], cc: [] })

console.log(`clean-invoice mail: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
