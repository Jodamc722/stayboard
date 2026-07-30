'use client'
// THE ELSER REGISTRATION FORM — Transient Guest/Occupant Registration Form.
//
// Elser will not admit a guest unless this form reaches their front desk at least two hours before
// the rental period starts. Every word of the static copy, the fee table and the authorisation
// paragraph is the building's, reproduced exactly as they issued it — do NOT reword any of it to
// read better. Only the field VALUES change per booking.
//
// Elser is the only property that attaches a form; the others send the email alone. Whether this
// runs at all is the per-property `attachPdf` flag in Users & admin, never a check on the name here.
//
// jsPDF is loaded from a CDN at runtime rather than added to package.json: the repo ships a
// committed package-lock.json, and adding a dependency through the GitHub web UI without
// regenerating that lock is how you break a Vercel install.
import type { Notice } from './reservation-draft'
import { prettyDate, AGENT } from './reservation-draft'

let _jsPdfMod: any = null
async function loadJsPdf(): Promise<any> {
  if (!_jsPdfMod) _jsPdfMod = await import(/* webpackIgnore: true */ 'https://esm.sh/jspdf@2.5.1' as any)
  return _jsPdfMod.jsPDF || _jsPdfMod.default?.jsPDF || _jsPdfMod.default
}

const AUTH = 'THIS IS TO AUTHORIZE AND REQUEST granted access to the above-described Unit in The Elser project to the person(s) listed on this form. In giving this authorization and request, the undersigned ACKNOWLEDGES AND AGREES that this authorization is for entry into the building. The Commercial Parcel Owner is not responsible in any manner for supervising, observing, or controlling the conduct of the person(s) to whom access and/or the key was given. The undersigned agrees to notify the Condominium Association Manager in writing of the termination or changes to this authorization.'

const FOOTNOTE_1 = '* Check-In Fees will be waived at this time. This waiver is subject to change based on the number of Units rented by third-party operators.'
const FOOTNOTE_2 = '** Daily Resort Fee: Subject to change at the sole discretion of the Commercial Parcel Owner.'

const INTRO = 'Each Approved Rental Operator MUST submit any new reservation via email at least two (2) hours in advance prior to the commencement of the rental period.'

const FEE_ROWS = [
  ['Unit Type', 'Daily Resort Fee', 'Check-In Fee per Reservation'],
  ['Studio Units', '$58.00**', '$30.00*'],
  ['One-Bedroom Units', '$58.00**', '$30.00*'],
  ['Two-Bedroom Units', '$58.00**', '$30.00*'],
  ['Three-Bedroom Units', '$58.00**', '$30.00*'],
]

export type AgentDetails = { name: string; phone: string; email: string; signature: string }

export const DEFAULT_AGENT: AgentDetails = {
  name: AGENT.name, phone: AGENT.phone, email: AGENT.email, signature: 'Jonathan McGill',
}

/** The filename the building sees on the attachment. */
export function elserPdfName(n: Notice): string {
  return 'Reservation Report - ' + (n.guest_name || 'Guest') + ' - ' + (n.unit_no || 'Unit') + '.pdf'
}

/** Build the form. Returns the jsPDF doc so the caller can save it, or take a blob to upload. */
export async function buildElserPdf(n: Notice, agent: AgentDetails = DEFAULT_AGENT): Promise<any> {
  const JsPDF = await loadJsPdf()
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth(), M = 64, CW = W - M * 2
  let y = 38

  // ----- Logo: rose ellipse monogram + wordmark -----
  doc.setDrawColor(186, 124, 112); doc.setLineWidth(1.2)
  doc.ellipse(W / 2, y + 26, 22, 30)
  doc.setFont('times', 'normal'); doc.setFontSize(30); doc.setTextColor(186, 124, 112)
  doc.text('E', W / 2, y + 36, { align: 'center' })
  y += 70
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(120, 120, 120)
  doc.text('T H E   E L S E R   H O T E L   &   R E S I D E N C E S   M I A M I', W / 2, y, { align: 'center' })
  y += 22
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(0, 0, 0)
  doc.text('TRANSIENT GUEST/ OCCUPANT REGISTRATION FORM', W / 2, y, { align: 'center' }); y += 13
  doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5)
  doc.text('(MUST COMPLETE ONE FORM PER BOOKING PER UNIT)', W / 2, y, { align: 'center' }); y += 20

  // ----- Required documentation -----
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
  doc.text('REQUIRED DOCUMENTATION AND FEES', M, y); y += 13
  doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
  const para = doc.splitTextToSize(INTRO, CW)
  doc.text(para, M, y); y += para.length * 11 + 3

  const bullet = (txt: string, indent = 28, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9)
    const ls = doc.splitTextToSize(txt, CW - indent - 10)
    doc.text('o', M + indent - 12, y)
    doc.text(ls, M + indent, y)
    y += ls.length * 11 + 1.5
  }
  bullet('Email – Guestservices@TheElserHotel.com', 28, true)
  bullet('Email Subject Line - [Approved Rental Operator Name]/New Reservation/Unit#/Dates')
  bullet('Check-In Time: 3:00PM - Check-Out Time: 11:00AM')
  bullet('Check-In Fee: $30.00* to be paid at the time of reservation. (See Disclaimer)')
  bullet('Guests must provide a valid credit card for payment of any fees and incidental charges.')
  bullet('Daily Resort Fee: To be paid at check-in, plus tax', 50)
  bullet('Current Daily Valet Parking Fees: $55.00 plus tax overnight + $25.00 for visitor parking', 50)
  y += 4

  // ----- Fee table -----
  const tX = M + 70, tW = CW - 140, cols = [0.36, 0.27, 0.37], rowH = 15
  doc.setLineWidth(0.7); doc.setDrawColor(60, 60, 60)
  FEE_ROWS.forEach((row, ri) => {
    let cx = tX
    if (ri === 0) { doc.setFillColor(235, 235, 235); doc.rect(tX, y, tW, rowH, 'F') }
    doc.setFont('helvetica', ri === 0 ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(0, 0, 0)
    row.forEach((cell, ci) => {
      const cw = tW * cols[ci]
      doc.rect(cx, y, cw, rowH)
      doc.text(cell, ci === 0 ? cx + 5 : cx + cw / 2, y + 10.5, ci === 0 ? {} : { align: 'center' })
      cx += cw
    })
    y += rowH
  })
  y += 14

  // ----- Form fields -----
  const fmt = (d?: string | null) => (d ? prettyDate(d) : '')
  const fld = (label: string, val: any, x: number, lineW: number, boldLabel = false, italicVal = false) => {
    doc.setFont('helvetica', boldLabel ? 'bold' : 'normal'); doc.setFontSize(9.5); doc.setTextColor(0, 0, 0)
    doc.text(label, x, y)
    const lx = x + doc.getTextWidth(label) + 5
    if (val) { doc.setFont('helvetica', italicVal ? 'italic' : 'normal'); doc.text(String(val).slice(0, 48), lx + 4, y - 0.5) }
    doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.7); doc.line(lx, y + 2.5, lx + lineW, y + 2.5)
  }

  doc.setDrawColor(150, 150, 150); doc.setLineWidth(2); doc.line(M - 6, y - 8, W - M + 6, y - 8); y += 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
  fld('UNIT NO.:', n.unit_no, M, 120, true); y += 22
  fld('Booking Date:', fmt(n.booking_date), M, 160); fld('ETA:', n.eta || '', M + 270, 150); y += 22
  fld('Arrival Date:', fmt(n.arrival_date), M, 160); fld('Departure Date:', fmt(n.departure_date), M + 270, 130); y += 16
  doc.setDrawColor(40, 40, 40); doc.setLineWidth(2.4); doc.line(M - 6, y - 6, W - M + 6, y - 6); y += 12
  fld('GUEST NAME:', n.guest_name, M, CW - 90, true); y += 22
  fld('Phone:', n.guest_phone || '', M, 175); fld('Email:', n.guest_email || '', M + 270, 160); y += 22
  // Guesty reports a guest TOTAL far more often than an adult/child split, so a blank line here is
  // normal and correct — never guess a number onto a building's form.
  fld('Number of Adults:', n.adults != null ? String(n.adults) : '', M, 115)
  fld('Number of Children:', n.children != null ? String(n.children) : '', M + 270, 105); y += 22
  fld('Pet(s):', n.pets || '', M, 175); fld('Breed:', n.pet_breed || '', M + 270, 160); y += 10
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60, 60, 60)
  doc.text('(Pet Deposit Required)', M, y); y += 18
  doc.setTextColor(0, 0, 0)
  fld('Agent Name:', agent.name, M, 175); fld('Phone:', agent.phone, M + 270, 160); y += 22
  fld('Email:', agent.email, M, 185); fld('Signature:', agent.signature, M + 270, 150, false, true); y += 14

  // ----- Authorization paragraph -----
  doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.6); doc.line(M - 6, y - 4, W - M + 6, y - 4); y += 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(30, 30, 30)
  const auth = doc.splitTextToSize(AUTH, CW + 12)
  doc.text(auth, M - 6, y); y += auth.length * 9 + 8
  doc.setDrawColor(170, 170, 170); doc.line(M - 6, y - 4, W - M + 6, y - 4); y += 6
  doc.setFontSize(7.5)
  const fn1 = doc.splitTextToSize(FOOTNOTE_1, CW + 12)
  doc.text(fn1, M - 6, y); y += fn1.length * 9
  doc.setFont('helvetica', 'italic')
  doc.text(FOOTNOTE_2, M - 6, y)

  // Footer
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 110)
  doc.text('398 NE 5th Street Miami, FL. 33132', W / 2, 772, { align: 'center' })
  return doc
}

/** The form as a base64 payload, for handing to the document store. */
export async function elserPdfBase64(n: Notice, agent?: AgentDetails): Promise<string> {
  const doc = await buildElserPdf(n, agent)
  const raw = doc.output('datauristring') as string
  const comma = raw.indexOf(',')
  return comma >= 0 ? raw.slice(comma + 1) : raw
}
