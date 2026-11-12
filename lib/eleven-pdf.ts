// THE E11EVEN FORM (Jon, 2026-11-12: "new front desk notice for the property Eleven … Attachment:
// signed tenant authorization form … build this form"). E11EVEN Club Hotel & Residences will not
// let a tenant into the building unless the desk holds a signed TENANT AUTHORIZATION FORM for the
// stay. This draws the building's own two-page form: the date, unit, tenant, access dates and
// tenant phone filled in from the booking, and the Agent line signed and dated by Stay as the
// owner's designated agent. The acknowledgment clauses and the indemnity paragraph are the
// BUILDING'S words, printed exactly as the building prints them — never reword them. The Owner
// line and the Management Acknowledgment line stay blank: they are not ours to sign.
// Same contract as lib/elser-pdf.ts and lib/nomad-pdf.ts.
import type { Notice } from './reservation-draft'
import { prettyDate } from './reservation-draft'

let _jsPdfMod: any = null
async function loadJsPdf(): Promise<any> {
  if (!_jsPdfMod) _jsPdfMod = await import('jspdf')
  return _jsPdfMod.jsPDF || _jsPdfMod.default
}

const CLAUSES = [
  'Tenant access is for building entry only. E11EVEN Club Hotel and Residences does not provide Unit access, keys, or supervision of guests.',
  'The Unit Owner is fully responsible for the conduct, actions, and compliance of their Tenant(s) with all governing rules, regulations, and policies.',
  'The undersigned acknowledges and agrees that E11EVEN Club Hotel & Residences is currently in a pre-opening period, and that the short-term rental program in effect during this period operates on a residential basis only. The Hotel is not yet open, and no hotel services of any kind will be provided to the Unit or to the undersigned tenants during their occupancy. This includes, without limitation, housekeeping, linen and towel service, in-room dining, turndown service, unit maintenance, engineering, and any other in-unit services typically associated with hotel operations.',
  'The undersigned further acknowledges that any in-unit needs that arise during the tenants’ occupancy (including cleaning, supplies, maintenance, or repair requests) are the sole responsibility of the undersigned as Unit Owner and must be addressed by the undersigned or by the undersigned’s designated Agent if and as provided. The undersigned will communicate this expectation to the tenants in advance of their arrival and will provide them with the appropriate point of contact for any such requests. The undersigned understands that the Front Desk and building staff are not authorized to provide in-unit services to the tenants. Front Desk and building amenity staff remain available to the tenants for access, security, and general property matters only.',
  'The undersigned acknowledges and agrees that access for the tenants to the Unit and to the building amenities, including the issuance of key fob(s) and any related access credentials, is conditioned upon payment in full of the one-time access fee previously provided to the undersigned.',
]

const INDEMNITY = 'UNIT OWNER AGREES TO INDEMNIFY AND HOLD HARMLESS PMG WORLDWIDE, LLC, MANAGER, AND THEIR AFFILIATES, OFFICERS, DIRECTORS, SHAREHOLDERS, EMPLOYEES AND AGENTS FROM AND AGAINST ALL CLAIMS, SUITS, DAMAGES, COSTS, LOSSES AND EXPENSES (INCLUDING ATTORNEYS’ FEES THROUGH ALL APPELLATE LEVELS) ARISING FROM INJURY TO ANY PERSON OR PROPERTY IN, ON OR ABOUT THE UNIT RELATING TO, ARISING FROM, OR CONNECTED WITH THIS DOCUMENT AND/OR THE UNIT. THE UNIT OWNER HEREBY KNOWINGLY AND INTENTIONALLY WAIVES THEIR RIGHT TO TRIAL BY JURY IN ANY ACTION OR PROCEEDING THAT UNIT OWNER MAY HEREINAFTER INSTITUTE AGAINST PMG WORLDWIDE, LLC, MANAGER, AND THEIR AFFILIATES, OFFICERS, DIRECTORS, SHAREHOLDERS, EMPLOYEES AND AGENTS WITH RESPECT TO ANY MATTER ARISING OUT OF OR RELATED TO THIS DOCUMENT OR THE RENTAL OPERATIONS OF THE UNIT, WHETHER ARISING IN CONTRACT, TORT OR OTHERWISE.'

/** Who signs the Agent line. `owner` prints on the Unit Owner / Owner lines when it is known. */
export type ElevenSigner = { signature: string; company: string; owner?: string }
export const ELEVEN_SIGNER: ElevenSigner = { signature: 'Jonathan McGill', company: 'Stay Hospitality' }

/** FALLBACK filename only — the real one is the property's docName template in Settings. */
export function elevenPdfName(n: Notice): string {
  const clean = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return 'Tenant Authorization Form - ' + (clean(n.guest_name) || 'Guest') + ' - ' + (clean(n.unit_no) || 'Unit') + '.pdf'
}

export async function buildElevenPdf(n: Notice, signer: ElevenSigner = ELEVEN_SIGNER, jsPdfCtor?: any): Promise<any> {
  const JsPDF = jsPdfCtor || await loadJsPdf()
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, M = 72, CW = W - 2 * M
  const fmt = (d?: string | null) => (d ? prettyDate(d) : '')
  // The form's Date is the day the authorization is written, in Eastern — the same rule as the
  // Booking Date on the Elser form. Rebuilding a form re-dates it, which is correct.
  const today = prettyDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()))
  const black = () => doc.setTextColor(0, 0, 0)
  const rule = (x1: number, x2: number, yy: number, w = 0.7) => { doc.setDrawColor(40, 40, 40); doc.setLineWidth(w); doc.line(x1, yy, x2, yy) }
  /** A bold label, a rule after it, and the value written on the rule. Returns where the rule ends. */
  const fld = (label: string, val: string, x: number, lineW: number, yy: number, italic = false) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); black()
    doc.text(label, x, yy)
    const lx = x + doc.getTextWidth(label) + 4
    if (val) {
      doc.setFont(italic ? 'times' : 'helvetica', italic ? 'italic' : 'normal'); doc.setFontSize(italic ? 13 : 10.5)
      let v = String(val)
      while (v.length > 3 && doc.getTextWidth(v) > lineW - 6) v = v.slice(0, -1)
      doc.text(v, lx + 3, yy - 1)
    }
    rule(lx, lx + lineW, yy + 2.5)
    return lx + lineW
  }

  // ───── Page 1 ─────
  let y = 64
  doc.setFont('helvetica', 'normal'); doc.setFontSize(30); doc.setTextColor(35, 35, 35)
  doc.text('E 1 1 E V E N', W / 2, y, { align: 'center' }); y += 14
  doc.setFontSize(6.5); doc.setTextColor(70, 70, 70)
  doc.text('C L U B   H O T E L   &   R E S I D E N C E S', W / 2, y, { align: 'center' }); y += 30
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); black()
  doc.text('TENANT AUTHORIZATION FORM', W / 2, y, { align: 'center' }); y += 36

  let x = fld('Date:', today, M + 14, 78, y)
  x = fld('Unit Owner', signer.owner || '', x + 6, 196, y)
  fld('Unit #:', String(n.unit_no || ''), x + 6, 52, y)
  y += 20

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); black()
  const l1a = 'THIS FORM IS TO AUTHORIZE TEMPORARY TENANT ACCESS to the building at'
  doc.text(l1a, M - 6, y)
  const l1w = doc.getTextWidth(l1a)   // measured in the normal face, before switching to bold
  doc.setFont('helvetica', 'bold'); doc.text('E11EVEN Club', M - 6 + l1w + 6, y); y += 15
  doc.text('Hotel and Residences', M - 6, y)
  const hw = doc.getTextWidth('Hotel and Residences') + 6
  doc.setFont('helvetica', 'normal'); doc.text('under the conditions outlined below.', M - 6 + hw, y); y += 24
  const g = 'In granting Tenant access, the undersigned'
  doc.text(g, M + 14, y)
  const gw = doc.getTextWidth(g) + 6
  doc.setFont('helvetica', 'bold'); doc.text('ACKNOWLEDGES AND AGREES', M + 14 + gw, y)
  const aw = doc.getTextWidth('ACKNOWLEDGES AND AGREES')
  doc.setFont('helvetica', 'normal'); doc.text(':', M + 14 + gw + aw, y); y += 26

  doc.setFontSize(10.5)
  CLAUSES.forEach((c, i) => {
    const ls = doc.splitTextToSize(c, CW - 62)
    doc.text(String(i + 1) + '.', M + 30, y)
    doc.text(ls, M + 50, y, { lineHeightFactor: 1.5 })
    y += ls.length * 15.75 + 9
  })

  // ───── Page 2 ─────
  doc.addPage()
  y = 78
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); black()
  doc.text('TENANT INFORMATION', M, y); y += 9
  const cols = [CW * 0.47, CW * 0.285, CW * 0.245], rowH = 26
  const tenantRow = [String(n.guest_name || ''), fmt(n.arrival_date), fmt(n.departure_date)]
  doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.7)
  for (let r = 0; r < 5; r++) {
    let cx = M
    for (let c = 0; c < 3; c++) {
      doc.rect(cx, y, cols[c], rowH)
      if (r === 0) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40)
        doc.text(['Tenant Name', 'Access Start Date', 'Access End Date'][c], cx + 3, y + 15)
      } else if (r === 1 && tenantRow[c]) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); black()
        let v = tenantRow[c]
        while (v.length > 3 && doc.getTextWidth(v) > cols[c] - 10) v = v.slice(0, -1)
        doc.text(v, cx + 5, y + 16.5)
      }
      cx += cols[c]
    }
    y += rowH
  }
  y += 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); black()
  doc.text('Tenant Contact Phone Number:', M, y)
  if (n.guest_phone) { doc.setFont('helvetica', 'normal'); doc.text(String(n.guest_phone).slice(0, 40), M + doc.getTextWidth('Tenant Contact Phone Number:  ') + 14, y) }
  y += 28
  doc.setDrawColor(160, 160, 160); doc.setLineWidth(1.6); doc.line(M, y, W - M - 18, y); y += 22

  // Signature block. Labels sit in a fixed column, the way the building's form sets them.
  const LX = M + 68
  const line = (label: string, val: string, yy: number, x2: number, italic = false) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); black()
    doc.text(label, M, yy)
    if (val) { doc.setFont(italic ? 'times' : 'helvetica', italic ? 'italic' : 'normal'); doc.setFontSize(italic ? 14 : 10.5); doc.text(val, LX + 4, yy - 1.5) }
    rule(LX, x2, yy + 2.5)
  }
  line('Owner:', signer.owner || '', y, W - M - 18); y += 25
  line('Agent:', signer.signature, y, M + 322, true)
  // The printed company sits after the signature so the desk can read who signed as Agent.
  doc.setFont('times', 'italic'); doc.setFontSize(14)
  const sw = doc.getTextWidth(signer.signature)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40)
  doc.text('— ' + signer.company, LX + 4 + sw + 8, y - 1.5)
  fld('Date:', today, M + 322, 112, y); y += 25
  let mx = fld('Management Acknowledgment Signature:', '', M, 136, y)
  fld('Date:', '', mx + 4, 72, y); y += 46

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.3); black()
  const ind = doc.splitTextToSize(INDEMNITY, CW + 24)
  doc.text(ind, M - 12, y, { lineHeightFactor: 1.5, align: 'justify', maxWidth: CW + 24 })
  return doc
}

export async function elevenPdfBase64(n: Notice, signer?: ElevenSigner, jsPdfCtor?: any): Promise<string> {
  const doc = await buildElevenPdf(n, signer, jsPdfCtor)
  return String(doc.output('datauristring')).split(',')[1] || ''
}
