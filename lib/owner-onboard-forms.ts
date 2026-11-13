// The owner's W-9 and ACH authorization as PDFs, made on request for the signed-in team (never stored filled,
// never emailed). The W-9 is the IRS's own form (Rev. March 2024), filled field by field; the ACH authorization
// is Stay Hospitality's. The tax ID and bank numbers are decrypted here and nowhere else. Server-only.
import 'server-only'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { decryptSecret } from './vault'
import type { OORecord, OOTaxClass } from './owner-onboard'

let _w9: Uint8Array | null = null
async function w9Blank(): Promise<Uint8Array> {
  if (_w9) return _w9
  const r = await fetch('https://www.irs.gov/pub/irs-pdf/fw9.pdf', { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('Could not load the IRS W-9 (' + r.status + ').')
  _w9 = new Uint8Array(await r.arrayBuffer())
  return _w9
}
const F = 'topmostSubform[0].Page1[0].'
const CLASS_BOX: Record<OOTaxClass, number> = { individual: 0, 'c-corp': 1, 's-corp': 2, partnership: 3, trust: 4, llc: 5, other: 6 }
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() }

export async function w9Pdf(r: OORecord): Promise<Uint8Array> {
  const p = r.payout; if (!p) throw new Error('No W-9 details yet.')
  const doc = await PDFDocument.load(await w9Blank(), { ignoreEncryption: true })
  const form = doc.getForm()
  const set = (name: string, v: string) => { try { form.getTextField(F + name).setText(v) } catch { /* the form changed */ } }
  set('f1_01[0]', p.w9.name)
  set('f1_02[0]', p.w9.business)
  try { form.getCheckBox(F + `Boxes3a-b_ReadOrder[0].c1_1[${CLASS_BOX[p.w9.taxClass] ?? 0}]`).check() } catch { /* */ }
  if (p.w9.taxClass === 'llc') set('Boxes3a-b_ReadOrder[0].f1_03[0]', p.w9.llcCode.toUpperCase().slice(0, 1))
  if (p.w9.taxClass === 'other') set('Boxes3a-b_ReadOrder[0].f1_04[0]', p.w9.other)
  set('Address_ReadOrder[0].f1_07[0]', p.w9.address)
  set('Address_ReadOrder[0].f1_08[0]', p.w9.cityStateZip)
  set('f1_09[0]', 'Stay Hospitality')
  const tin = decryptSecret(p.w9.tinEnc).replace(/\D/g, '')
  if (p.w9.tinType === 'ssn') { set('f1_11[0]', tin.slice(0, 3)); set('f1_12[0]', tin.slice(3, 5)); set('f1_13[0]', tin.slice(5, 9)) }
  else { set('f1_14[0]', tin.slice(0, 2)); set('f1_15[0]', tin.slice(2, 9)) }
  // the electronic signature the owner typed, on the signature line, with the date
  const page = doc.getPage(0), font = await doc.embedFont(StandardFonts.HelveticaOblique)
  page.drawText('/s/ ' + p.sign.name + ' (signed electronically)', { x: 128, y: 198, size: 9.5, font, color: rgb(0.05, 0.1, 0.35) })
  page.drawText(fmtDate(p.sign.at), { x: 412, y: 198, size: 9.5, font, color: rgb(0.05, 0.1, 0.35) })
  form.flatten()
  return doc.save()
}

export async function achPdf(r: OORecord): Promise<Uint8Array> {
  const p = r.payout; if (!p) throw new Error('No bank details yet.')
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), ital = await doc.embedFont(StandardFonts.HelveticaOblique)
  const ink = rgb(0.06, 0.07, 0.08), mut = rgb(0.4, 0.4, 0.43), acc = rgb(0.55, 0.43, 0.23)
  let y = 730
  const text = (t: string, x: number, size = 10, f = reg, c = ink) => page.drawText(t, { x, y, size, font: f, color: c })
  text('STAY HOSPITALITY', 54, 9, bold, acc); y -= 26
  text('ACH Direct Deposit Authorization', 54, 20, bold); y -= 18
  text('Owner payouts', 54, 10, reg, mut); y -= 34
  const row = (label: string, value: string) => { text(label.toUpperCase(), 54, 7.5, bold, mut); text(value || '—', 220, 11); y -= 12; page.drawLine({ start: { x: 54, y }, end: { x: 558, y }, thickness: 0.5, color: rgb(0.85, 0.84, 0.82) }); y -= 18 }
  const routing = decryptSecret(p.ach.routingEnc), account = decryptSecret(p.ach.accountEnc)
  row('Owner', r.custom.ownerName || p.w9.name)
  row('Property', [r.attach.property, r.attach.unitLabel ? 'Unit ' + r.attach.unitLabel : r.home?.unit ? 'Unit ' + r.home.unit : ''].filter(Boolean).join(', '))
  row('Account holder', p.ach.holder)
  row('Bank', p.ach.bank)
  row('Account type', (p.ach.ownership === 'business' ? 'Business ' : p.ach.ownership === 'personal' ? 'Personal ' : '') + (p.ach.accountType === 'savings' ? 'savings' : 'checking'))
  row('Routing number', routing)
  row('Account number', account)
  y -= 6
  const para = 'I authorize Stay Hospitality to initiate credit entries (and, only to correct an entry made in error, debit entries) to the account above for my owner payouts. This authorization stays in effect until I notify Stay Hospitality in writing to cancel it, in time for Stay Hospitality to act on it.'
  const words = para.split(' '); let line = ''
  for (const w of words) { const t = line ? line + ' ' + w : w; if (reg.widthOfTextAtSize(t, 10) > 500) { text(line, 54, 10); y -= 15; line = w } else line = t }
  if (line) { text(line, 54, 10); y -= 34 }
  text('Signature', 54, 7.5, bold, mut); text('Date', 380, 7.5, bold, mut); y -= 16
  text('/s/ ' + p.sign.name + ' (signed electronically)', 54, 11, ital, rgb(0.05, 0.1, 0.35)); text(fmtDate(p.sign.at), 380, 11); y -= 10
  page.drawLine({ start: { x: 54, y }, end: { x: 330, y }, thickness: 0.6, color: ink }); page.drawLine({ start: { x: 380, y }, end: { x: 558, y }, thickness: 0.6, color: ink }); y -= 28
  text('Signed electronically through Stay Hospitality’s owner onboarding on ' + fmtDate(p.sign.at) + (p.sign.ip ? ' from ' + p.sign.ip : '') + '.', 54, 8, reg, mut)
  return doc.save()
}
