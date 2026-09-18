// Google READ consent for Eve's learning corpus (Gmail / Drive / Calendar, read-only).
//
// The existing OAuth flow (app/api/google/auth) asks for send/compose/drive.file. Eve learning from
// the mailbox needs the read scopes, which are a separate consent Jon has to give on purpose. The
// grant is a flag in app_settings — the ingest itself is the next step and is not built yet.
import 'server-only'
import { getSetting, setSetting } from './app-settings'

export const GOOGLE_READ_KEY = 'google_read_grant'
export const GOOGLE_READ_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
]

export type GoogleReadGrant = { granted: boolean; email: string | null; at: string | null; scopes: string[] }

export async function getGoogleReadGrant(): Promise<GoogleReadGrant> {
  const v = await getSetting<any>(GOOGLE_READ_KEY, null)
  if (!v || typeof v !== 'object') return { granted: false, email: null, at: null, scopes: [] }
  return { granted: !!v.granted, email: v.email || null, at: v.at || null, scopes: Array.isArray(v.scopes) ? v.scopes : [] }
}

export async function setGoogleReadGrant(email: string, scopes: string[], by: string): Promise<void> {
  const have = scopes.filter(s => GOOGLE_READ_SCOPES.indexOf(s) >= 0)
  await setSetting(GOOGLE_READ_KEY, { granted: have.length > 0, email, at: new Date().toISOString(), scopes: have }, by)
}
