// THE NOMAD FORM (Jon, 2026-10-02: "for front desk for Nomad notices, here are the emails and
// forms we need to fill out"). NoMad Wynwood Residences (2700 NW Wynwood Condominium Association)
// wants their own one-page "Guest Check-In Acknowledgment Form" with every arrival, emailed to the
// FirstService Residential desk. This draws it from the building's template: guest, unit, dates
// and occupants filled in; the rules, liability and access lines printed as the building prints
// them; the fob boxes and signatures left blank for the desk. Same contract as lib/elser-pdf.ts.
import type { Notice } from './reservation-draft'
import { prettyDate } from './reservation-draft'

let _jsPdfMod: any = null
async function loadJsPdf(): Promise<any> {
  if (!_jsPdfMod) _jsPdfMod = await import('jspdf')
  return _jsPdfMod.jsPDF || _jsPdfMod.default
}

const RULES = [
  'Quiet hours are observed from 10:00 PM – 8:00 AM.',
  'No parties or events are permitted.',
  'Maximum occupancy limits must be respected.',
  'No smoking in units, balconies, or common areas.',
  'All building amenities must be used respectfully.',
  'Guests must follow all front desk and security instructions.',
]
const LIABILITY = 'The unit owner is responsible for any damage or violations caused by guests. Guests may be denied access or removed from the property for violations.'
const FOOTER = '2700 NW Wynwood Condominium Association Inc. - 2700 NW 2nd Ave. Miami, FL 33127, Suite 104 - 786.693.4895'

export function nomadPdfName(n: Notice): string {
  const clean = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return 'Guest Check-In Acknowledgment Form - ' + (clean(n.guest_name) || 'Guest') + ' - ' + (clean(n.unit_no) || 'Unit') + '.pdf'
}

export async function buildNomadPdf(n: Notice, jsPdfCtor?: any): Promise<any> {
  const JsPDF = jsPdfCtor || await loadJsPdf()
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, M = 64, CW = W - 2 * M
  let y = 70
  const center = (t: string, size: number, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(0, 0, 0); doc.text(t, W / 2, y, { align: 'center' }) }
  center('GUEST CHECK-IN ACKNOWLEDGMENT FORM', 14, true); y += 18
  center('2700 NW Wynwood Condominium Association, Inc.', 10.5); y += 14
  center('NoMad Wynwood Residences', 10.5); y += 22

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0)
  const intro = doc.splitTextToSize('Welcome to NoMad Wynwood Residences. All guests must review and acknowledge the following rules prior to receiving building access credentials.', CW)
  doc.text(intro, M, y); y += intro.length * 13 + 12

  const head = (t: string) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(t, M, y); y += 16 }
  const fld = (label: string, val: any, x: number, lineW: number) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0)
    doc.text(label, x, y)
    const lx = x + doc.getTextWidth(label) + 5
    if (val) { doc.setFont('helvetica', 'bold'); doc.text(String(val).slice(0, 48), lx + 3, y - 0.5) }
    doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.6); doc.line(lx, y + 2.5, lx + lineW, y + 2.5)
  }
  const fmt = (d?: string | null) => (d ? prettyDate(d) : '')
  const occupants = (n.adults != null || n.children != null) ? String((n.adults || 0) + (n.children || 0)) : ''

  head('Guest Information'); y += 2
  fld('Guest Name:', n.guest_name, M, 300); y += 22
  fld('Unit Number:', n.unit_no, M, 120); y += 22
  fld('Check-In Date:', fmt(n.arrival_date), M, 150); fld('Check-Out Date:', fmt(n.departure_date), M + 250, 150); y += 22
  fld('Number of Occupants:', occupants, M, 80); y += 26

  head('Guest Rules')
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  for (const r of RULES) { doc.text('•', M + 4, y); doc.text(r, M + 18, y); y += 15 }
  y += 10

  head('Liability')
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const li = doc.splitTextToSize(LIABILITY, CW)
  doc.text(li, M, y); y += li.length * 13 + 14

  head('Access Credentials')
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text('Key/Fob Issued:', M, y)
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.8)
  doc.rect(M + 86, y - 8, 9, 9); doc.text('Yes', M + 100, y)
  doc.rect(M + 136, y - 8, 9, 9); doc.text('No', M + 150, y); y += 22
  fld('Number of Fobs Issued:', '', M, 120); y += 36

  fld('Guest Signature:', '', M, 170); fld('Date:', '', M + 260, 120); y += 30
  fld('Front Desk Agent / Short Term Coordinator:', '', M, 160); y += 10

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 90, 90)
  doc.text(FOOTER, W / 2, 760, { align: 'center' })
  return doc
}

export async function nomadPdfBase64(n: Notice, jsPdfCtor?: any): Promise<string> {
  const doc = await buildNomadPdf(n, jsPdfCtor)
  return String(doc.output('datauristring')).split(',')[1] || ''
}
