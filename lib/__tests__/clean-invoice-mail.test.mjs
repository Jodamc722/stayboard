// node lib/__tests__/clean-invoice-mail.test.mjs
// INVOICES BY EMAIL (lib/clean-invoice-mail-rules.ts): who is answered, what is read, what the reply says.
const R = await import('../clean-invoice-mail-rules.ts')
const { INVOICE_ADDRESS, isTeam, addressOf, nameOf, addressedToUs, skipReason, isReply, invoiceFiles, mediaTypeOf, tally, headline, replySubject, teamReplyHtml, outsideReplyHtml, noFileHtml, cleanState, REPLY_TAG } = R

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
eq('tally', tally(inv), { lines: 5, matched: 2, flagged: 2, flaggedAmount: 250, unbilled: 2 })
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
ok('team reply says prices are not checked', team.includes('not the prices'))
const forJon = teamReplyHtml([{ file: 'a.pdf', invoice: inv }], 'https://lh.example', { forOutside: { name: 'Ana Ruiz', email: 'ana@probowl.com' } })
ok('the copy for Jon says who sent it and that they were not told', forJon.includes('ana@probowl.com') && forJon.includes('nothing below went to them'))

// THE RULE THAT MATTERS: an outside sender is told nothing about what the audit found.
const out = outsideReplyHtml([{ file: 'a.pdf', invoice: inv }])
ok('outside note thanks them', /received your invoice/.test(out))
for (const leak of ['No clean on record', 'Billed twice', 'do not match', '$250', 'flag', 'Capri', 'dispute', 'clean-invoices', 'Lighthouse', 'because'])
  ok('outside note does not say "' + leak + '"', !out.includes(leak))
ok('outside note for two invoices', /your 2 invoices/.test(outsideReplyHtml([{ file: 'a', invoice: inv }, { file: 'b', invoice: inv }])))
ok('no-file note says what to attach', /PDF/.test(noFileHtml()) && noFileHtml().includes(REPLY_TAG))

// State
eq('empty state is off', cleanState(null).on, false)
eq('junk state is off', cleanState('x').on, false)
eq('state keeps on', cleanState({ on: true, handled: [{ id: '1' }], count: '3' }).count, 3)
eq('state caps what it remembers', cleanState({ handled: Array.from({ length: 400 }, (_, i) => ({ id: String(i) })) }).handled.length, 300)

console.log(`clean-invoice mail: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
