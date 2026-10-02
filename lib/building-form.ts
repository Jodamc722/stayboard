// WHICH FORM A BUILDING WANTS. Elser gets its Transient Guest/Occupant Registration Form; Nomad
// gets its Guest Check-In Acknowledgment Form (2026-10-02). Everything that attaches or downloads
// a registration form goes through here, so adding a building's form is one line.
import type { Notice } from './reservation-draft'
import { buildElserPdf, elserPdfBase64, elserPdfName } from './elser-pdf'
import { buildNomadPdf, nomadPdfBase64, nomadPdfName } from './nomad-pdf'

export function formKind(propertyId: string | null | undefined): 'elser' | 'nomad' {
  return /nomad/i.test(String(propertyId || '')) ? 'nomad' : 'elser'
}
export async function buildFormPdf(propertyId: string | null | undefined, n: Notice, jsPdfCtor?: any): Promise<any> {
  return formKind(propertyId) === 'nomad' ? buildNomadPdf(n, jsPdfCtor) : buildElserPdf(n, undefined, jsPdfCtor)
}
export async function formPdfBase64(propertyId: string | null | undefined, n: Notice, jsPdfCtor?: any): Promise<string> {
  return formKind(propertyId) === 'nomad' ? nomadPdfBase64(n, jsPdfCtor) : elserPdfBase64(n, undefined, jsPdfCtor)
}
export function formPdfName(propertyId: string | null | undefined, n: Notice): string {
  return formKind(propertyId) === 'nomad' ? nomadPdfName(n) : elserPdfName(n)
}
