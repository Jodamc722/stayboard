// WHICH FORM A BUILDING WANTS. Elser gets its Transient Guest/Occupant Registration Form; Nomad
// gets its Guest Check-In Acknowledgment Form (2026-10-02); E11EVEN gets its signed Tenant
// Authorization Form (2026-11-12). Everything that attaches or downloads a registration form goes
// through here, so adding a building's form is one line.
import type { Notice } from './reservation-draft'
import { buildElserPdf, elserPdfBase64, elserPdfName } from './elser-pdf'
import { buildNomadPdf, nomadPdfBase64, nomadPdfName } from './nomad-pdf'
import { buildElevenPdf, elevenPdfBase64, elevenPdfName } from './eleven-pdf'

export type FormKind = 'elser' | 'nomad' | 'eleven'
export function formKind(propertyId: string | null | undefined): FormKind {
  const id = String(propertyId || '')
  if (/nomad/i.test(id)) return 'nomad'
  if (/eleven|e11even|11even/i.test(id)) return 'eleven'
  return 'elser'
}
export async function buildFormPdf(propertyId: string | null | undefined, n: Notice, jsPdfCtor?: any): Promise<any> {
  const k = formKind(propertyId)
  return k === 'nomad' ? buildNomadPdf(n, jsPdfCtor) : k === 'eleven' ? buildElevenPdf(n, undefined, jsPdfCtor) : buildElserPdf(n, undefined, jsPdfCtor)
}
export async function formPdfBase64(propertyId: string | null | undefined, n: Notice, jsPdfCtor?: any): Promise<string> {
  const k = formKind(propertyId)
  return k === 'nomad' ? nomadPdfBase64(n, jsPdfCtor) : k === 'eleven' ? elevenPdfBase64(n, undefined, jsPdfCtor) : elserPdfBase64(n, undefined, jsPdfCtor)
}
export function formPdfName(propertyId: string | null | undefined, n: Notice): string {
  const k = formKind(propertyId)
  return k === 'nomad' ? nomadPdfName(n) : k === 'eleven' ? elevenPdfName(n) : elserPdfName(n)
}
