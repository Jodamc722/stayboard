// Owner onboarding files: the signed management agreement (Jon, 2026-11-12: "Nick can upload the agreement to
// start the onboarding form… sent to Bethany as well once signed"). Private bucket 'owner-onboarding'. Server-only.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const BUCKET = 'owner-onboarding'
async function ensureBucket() {
  const sb = supabaseAdmin()
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 30 * 1024 * 1024 })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}
export async function signAgreementUpload(code: string, name: string): Promise<{ path: string; signedUrl: string }> {
  await ensureBucket()
  const safe = String(name || 'agreement.pdf').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'agreement.pdf'
  const path = `${code}/agreement-${Date.now().toString(36)}-${safe}`
  const r = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path)
  if (r.error || !r.data) throw new Error('signed upload: ' + (r.error?.message || 'no url'))
  return { path, signedUrl: r.data.signedUrl }
}
export const pathOk = (code: string, path: string) => path.startsWith(code + '/') && !path.includes('..')
export async function fileUrl(path: string): Promise<string> {
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 60 * 30)
  return data?.signedUrl || ''
}
export async function fileBytes(path: string): Promise<Buffer | null> {
  const { data } = await supabaseAdmin().storage.from(BUCKET).download(path)
  return data ? Buffer.from(await data.arrayBuffer()) : null
}
