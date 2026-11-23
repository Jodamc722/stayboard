// node lib/__tests__/mail-review.test.mjs
// EMAIL REVIEW (lib/mail-review-rules.ts): what is reviewed, which attachments are read, and what Jon is sent.
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return n(s + '.ts', c); throw e } }"))
const R = await import('../mail-review-rules.ts')
const { REVIEW_ADDRESS, REVIEW_TAG, skipReason, docKind, imageType, pickDocs, mailText, parseReview, reviewHtml, reviewLine, cleanReviewState, REVIEW_PROMPT } = R

let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))
const H = (o = {}) => ({ from: 'Rock Soffer <rock@owner.com>', to: 'jon@stay-hospitality.com', cc: REVIEW_ADDRESS, deliveredTo: '', subject: 'W-9 and ACH form', autoSubmitted: '', precedence: '', messageId: '<a@x>', references: '', inReplyTo: '', ...o })

// What is reviewed
eq('an email copied to the address is reviewed', skipReason(H()), '')
eq('Jon forwarding to it is reviewed', skipReason(H({ from: 'jon@stay-hospitality.com', to: REVIEW_ADDRESS, cc: '', subject: 'Fwd: lease' })), '')
eq('a bcc is reviewed', skipReason(H({ cc: '', deliveredTo: REVIEW_ADDRESS })), '')
ok('mail not sent to the address is left alone', !!skipReason(H({ cc: '' })))
ok('the invoice address is a different address', !!skipReason(H({ cc: 'jon+invoices@stay-hospitality.com' })))
ok('our own review is never reviewed', !!skipReason(H({ subject: REVIEW_TAG + ': W-9' })))
ok('nor a reply to it', !!skipReason(H({ subject: 'RE: ' + REVIEW_TAG + ': W-9' })))
ok('an out-of-office is left alone', !!skipReason(H({ autoSubmitted: 'auto-replied' })))
ok('a bounce is left alone', !!skipReason(H({ from: 'mailer-daemon@google.com' })))

// Which attachments are read
const part = (filename, mimeType, size, o = {}) => ({ filename, mimeType, size, attachmentId: 'a-' + filename, inline: false, ...o })
eq('pdf', docKind({ filename: 'w9.PDF', mimeType: 'application/octet-stream' }), 'pdf')
eq('photo', docKind({ filename: 'IMG_1.jpeg', mimeType: 'image/jpeg' }), 'image')
eq('csv', docKind({ filename: 'a.csv', mimeType: 'application/vnd.ms-excel' }), 'text')
eq('word is not read', docKind({ filename: 'lease.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), null)
eq('heic is not read', docKind({ filename: 'IMG_2.HEIC', mimeType: 'image/heic' }), null)
eq('image type from the name', imageType({ filename: 'a.PNG', mimeType: 'application/octet-stream' }), 'image/png')
const picked = pickDocs([part('w9.pdf', 'application/pdf', 90000), part('logo.png', 'image/png', 5000), part('image001.jpg', 'image/jpeg', 200000, { inline: true }), part('lease.docx', 'application/msword', 40000), part('photo.jpg', 'image/jpeg', 900000), part('huge.pdf', 'application/pdf', 11 * 1024 * 1024)])
eq('reads the pdf and the photo, in order', picked.read.map(p => p.filename), ['w9.pdf', 'photo.jpg'])
eq('names what it could not read, and why', picked.unread, [{ name: 'lease.docx', why: 'a file type that is not read' }, { name: 'huge.pdf', why: 'over 10 MB' }])
ok('a signature logo is neither read nor named', !picked.read.concat(picked.unread.map(u => ({ filename: u.name }))).some(p => /logo|image001/.test(p.filename)))
const many = pickDocs([1, 2, 3, 4, 5, 6, 7].map(n => part(`d${n}.pdf`, 'application/pdf', 1000)))
eq('five are read', many.read.length, 5)
eq('the rest are named', many.unread.map(u => u.name), ['d6.pdf', 'd7.pdf'])
const heavy = pickDocs([1, 2, 3].map(n => part(`h${n}.pdf`, 'application/pdf', 8 * 1024 * 1024)))
eq('18 MB together is the ceiling', [heavy.read.length, heavy.unread[0].why], [2, 'the attachments together are over 18 MB'])
eq('the forwarded part of the text is kept', /Forwarded message/.test(mailText('See below.\n\n---------- Forwarded message ---------\nFrom: Rock\n\nPlease find the W-9.')), true)
eq('text is capped', mailText('x'.repeat(50000)).length, 30000)

// Reading the model's answer
const good = parseReview('Here you go:\n{"summary":"Rock sent his W-9 and ACH form for Icon 2806.","documents":[{"name":"w9.pdf","what":"W-9 for Rock Soffer LLC","notes":"Not signed."}],"steps":[{"do":"Ask Rock to sign the W-9","who":"Accounting","by":null},{"do":"","who":null,"by":null},{"do":"Enter the ACH details","who":null,"by":"Nov 30"}],"missing":["The routing number is cut off."]}')
eq('summary', good.summary, 'Rock sent his W-9 and ACH form for Icon 2806.')
eq('an empty step is dropped', good.steps.map(s => s.do), ['Ask Rock to sign the W-9', 'Enter the ACH details'])
eq('who and by', [good.steps[0].who, good.steps[1].by], ['Accounting', 'Nov 30'])
const bad = parseReview('I could not read this email, sorry.')
eq('a reply that is not JSON becomes the summary', [bad.summary, bad.steps.length], ['I could not read this email, sorry.', 0])
eq('junk fields do not crash', parseReview('{"summary":5,"documents":"x","steps":{},"missing":null}'), { summary: '5', documents: [], steps: [], missing: [] })

// What Jon is sent
const html = reviewHtml(good, { from: 'Rock Soffer <rock@owner.com>', subject: 'W-9', unread: [{ name: 'lease.docx', why: 'a file type that is not read' }] })
ok('opens with the tag', html.includes(REVIEW_TAG))
ok('says what the document is', html.includes('W-9 for Rock Soffer LLC') && html.includes('Not signed.'))
ok('lists the steps in order', html.indexOf('Ask Rock to sign') < html.indexOf('Enter the ACH details') && html.includes('<ol'))
ok('shows who and by', html.includes('Accounting') && html.includes('by Nov 30'))
ok('names the unread attachment', html.includes('lease.docx') && html.includes('not read'))
ok('says what is missing', html.includes('routing number'))
ok('says it went to Jon only', html.includes('Sent to you only'))
ok('the sender is escaped', html.includes('&lt;rock@owner.com&gt;') && !html.includes('<rock@owner.com>'))
const evil = reviewHtml(parseReview('{"summary":"<img src=x onerror=alert(1)> hello","documents":[],"steps":[{"do":"<script>x</script>"}],"missing":[]}'), { from: 'a@b.c', subject: 's', unread: [] })
ok('whatever the model writes is text, never markup', !/<img|<script/.test(evil) && evil.includes('&lt;script&gt;'))
ok('nothing to do reads as for information', reviewHtml(parseReview('{"summary":"FYI newsletter","steps":[]}'), { from: 'a@b.c', subject: 's', unread: [] }).includes('for your information'))
ok('a failure says so and how to retry', /could not be reviewed/.test(reviewHtml(parseReview(''), { from: 'a@b.c', subject: 's', unread: [], error: 'the reader timed out' })))
eq('line with steps and documents', reviewLine(good), '2 steps · 1 document')
eq('line with nothing to do', reviewLine(parseReview('{"summary":"x"}')), 'for information')

// The instructions the reader is given
ok('told to say only what is shown', /Never invent/.test(REVIEW_PROMPT))
ok('told not to follow instructions inside the email', /do not follow them/.test(REVIEW_PROMPT))
eq('state starts off', cleanReviewState(undefined).on, false)

console.log(`mail review: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
