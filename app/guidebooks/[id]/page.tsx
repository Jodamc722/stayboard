// Single guidebook — full-page viewer/editor (intentionally OUTSIDE Shell so Print/PDF outputs
// clean pages with no app chrome).
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GuidebookView } from '@/components/GuidebookView'

export const dynamic = 'force-dynamic'

export default async function GuidebookPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', params.id).limit(1)
  const gb = (data || [])[0]
  if (!gb) notFound()
  if (!gb.sections) {
    const failed = gb?.answers?._error
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, fontFamily: 'Inter, system-ui, sans-serif', color: '#1a1a1a', padding: 24, textAlign: 'center' }}>
        {!failed && <div style={{ width: 34, height: 34, border: '3px solid #e5e5e5', borderTopColor: '#111', borderRadius: '50%', animation: 'gbspin 0.8s linear infinite' }} />}
        <div style={{ fontSize: 20, fontWeight: 600 }}>{failed ? 'Generation hit a snag' : 'Building your guidebook\u2026'}</div>
        <div style={{ fontSize: 14, color: '#666', maxWidth: 420 }}>{failed ? 'Please regenerate this guidebook from the property page.' : 'This runs in the background \u2014 you can leave this page and it will be ready in your Guidebooks shortly.'}</div>
        <a href="/guidebooks" style={{ fontSize: 13, color: '#4f46e5', textDecoration: 'underline' }}>Back to guidebooks</a>
        {!failed && <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){location.reload()},4000)' }} />}
        <style dangerouslySetInnerHTML={{ __html: '@keyframes gbspin{to{transform:rotate(360deg)}}' }} />
      </div>
    )
  }

  return <GuidebookView initial={gb} />
}
