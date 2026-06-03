'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import {
  FieldRequest, FieldRequestStatus, FieldRequestPriority,
  PRIORITY_STYLE, STATUS_LABEL, STATUS_STYLE, TYPE_LABEL
} from '@/lib/types'
import { Send } from 'lucide-react'

type Comment = { id: string; author_email: string | null; body: string; created_at: string }

export function RequestDetail({
  request: r0, comments: c0, userEmail
}: { request: FieldRequest; comments: Comment[]; userEmail: string | null }) {
  const router = useRouter()
  const [r, setR] = useState(r0)
  const [comments, setComments] = useState(c0)
  const [newComment, setNewComment] = useState('')
  const [pending, startTransition] = useTransition()

  async function patch(updates: Partial<FieldRequest>) {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('field_requests')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .select()
      .single()
    if (error) return alert(error.message)
    setR(data as any)
    startTransition(() => router.refresh())
  }

  async function addComment() {
    if (!newComment.trim()) return
    const supabase = createClient()
    const { data, error } = await supabase
      .from('field_request_comments')
      .insert({ request_id: r.id, author_email: userEmail, body: newComment.trim() })
      .select()
      .single()
    if (error) return alert(error.message)
    setComments([...comments, data as any])
    setNewComment('')
  }

  async function approve(approved: boolean) {
    await patch({
      approval_status: approved ? 'approved' : 'rejected',
      approver_email: userEmail,
      approved_at: new Date().toISOString()
    } as any)
  }

  const overdue = r.due_at && !['done', 'cancelled'].includes(r.status) && new Date(r.due_at) < new Date(new Date().toISOString().slice(0, 10))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Main */}
      <section className="lg:col-span-2 space-y-5">
        <div className="bg-white rounded-2xl border border-line shadow-soft p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">{TYPE_LABEL[r.type]}</span>
                <span className="text-[10px] text-muted">· created {timeAgo(new Date(r.created_at))} by {r.created_by_email?.split('@')[0]}</span>
              </div>
              <h1 className="text-2xl font-bold text-ink tracking-tight">{r.title}</h1>
              {(r.building || r.unit) && (
                <p className="text-sm text-muted mt-1">{[r.building, r.unit].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <span className={`text-[10px] px-2 py-1 rounded-md font-semibold uppercase tracking-wide ring-1 ring-inset flex-shrink-0 ${PRIORITY_STYLE[r.priority]}`}>{r.priority}</span>
          </div>

          {r.description && (
            <div className="mt-4 text-sm text-ink/90 whitespace-pre-wrap leading-relaxed">{r.description}</div>
          )}
        </div>

        {/* Approval card */}
        {r.approval_required && (
          <div className={`rounded-2xl p-5 border shadow-soft ${
            r.approval_status === 'approved' ? 'bg-emerald-50 border-emerald-200' :
            r.approval_status === 'rejected' ? 'bg-rose-50 border-rose-200' :
            'bg-amber-50 border-amber-200'
          }`}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-muted">Approval</div>
                <div className="font-semibold text-ink mt-0.5">
                  {r.approval_status === 'approved' ? 'Approved' : r.approval_status === 'rejected' ? 'Rejected' : 'Pending approval'}
                  {r.vendor && <span className="text-sm font-normal text-ink/80 ml-2">· {r.vendor}</span>}
                  {r.amount_usd != null && <span className="text-sm font-normal text-ink/80 ml-2">· ${Number(r.amount_usd).toLocaleString()}</span>}
                </div>
                {r.approver_email && (
                  <div className="text-xs text-muted mt-1">by {r.approver_email.split('@')[0]} {r.approved_at ? `· ${timeAgo(new Date(r.approved_at))}` : ''}</div>
                )}
              </div>
              {!r.approval_status || r.approval_status === 'pending' ? (
                <div className="flex gap-2">
                  <button onClick={() => approve(true)} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
                  <button onClick={() => approve(false)} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white text-rose-700 border border-rose-200 hover:bg-rose-50">Reject</button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="bg-white rounded-2xl border border-line shadow-soft p-5">
          <h3 className="font-semibold text-ink mb-3">Activity</h3>
          {comments.length === 0 ? (
            <p className="text-sm text-muted">No comments yet.</p>
          ) : (
            <ul className="space-y-3 mb-4">
              {comments.map(c => (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={c.author_email} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-ink text-sm">{c.author_email?.split('@')[0] || 'someone'}</span>
                      <span className="text-[11px] text-muted">{timeAgo(new Date(c.created_at))}</span>
                    </div>
                    <p className="text-sm text-ink/90 mt-0.5 whitespace-pre-wrap">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-3 border-t border-line">
            <input
              type="text"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }}
              placeholder="Add a comment…"
              className="flex-1 px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
            <button onClick={addComment} disabled={!newComment.trim()}
              className="px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-50 hover:bg-ink/90 inline-flex items-center gap-1 text-xs font-medium"><Send size={13}/></button>
          </div>
        </div>
      </section>

      {/* Sidebar */}
      <aside className="space-y-5">
        <div className="bg-white rounded-2xl border border-line shadow-soft p-5 space-y-3">
          <Field label="Status">
            <select
              value={r.status}
              onChange={e => patch({ status: e.target.value as FieldRequestStatus })}
              className={`w-full px-2.5 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset cursor-pointer ${STATUS_STYLE[r.status]}`}
            >
              {(['open', 'acknowledged', 'in_progress', 'blocked', 'done', 'cancelled'] as FieldRequestStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>

          <Field label="Priority">
            <select
              value={r.priority}
              onChange={e => patch({ priority: e.target.value as FieldRequestPriority })}
              className={`w-full px-2.5 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset cursor-pointer ${PRIORITY_STYLE[r.priority]}`}
            >
              {(['low', 'medium', 'high', 'urgent'] as FieldRequestPriority[]).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>

          <Field label="Assignee">
            <input type="email" defaultValue={r.assignee_email ?? ''} placeholder="email"
              onBlur={e => e.target.value !== (r.assignee_email ?? '') && patch({ assignee_email: e.target.value || null })}
              className="w-full px-3 py-1.5 rounded-md border border-line bg-white text-sm focus:border-brand-400 outline-none" />
          </Field>

          <Field label="Due date">
            <input type="date" defaultValue={r.due_at ?? ''}
              onChange={e => patch({ due_at: e.target.value || null })}
              className={`w-full px-3 py-1.5 rounded-md border bg-white text-sm focus:border-brand-400 outline-none ${overdue ? 'border-rose-300 text-rose-700' : 'border-line'}`} />
          </Field>

          {r.vendor && (
            <Field label="Vendor"><span className="text-sm text-ink">{r.vendor}</span></Field>
          )}
          {r.amount_usd != null && (
            <Field label="Amount"><span className="text-sm text-ink font-medium">${Number(r.amount_usd).toLocaleString()}</span></Field>
          )}
        </div>

        <button
          onClick={() => { if (confirm('Delete this request?')) (async () => {
            const supabase = createClient()
            await supabase.from('field_requests').delete().eq('id', r.id)
            router.push('/requests'); router.refresh()
          })() }}
          className="w-full text-xs text-rose-600 hover:text-rose-700 py-2">Delete request</button>
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1">{label}</div>
      {children}
    </div>
  )
}
function Avatar({ name }: { name: string | null }) {
  const init = (name || 'G').split('@')[0].split('.').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U'
  let h = 0
  for (const c of (name || 'G')) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
      style={{ background: `hsl(${h}, 55%, 92%)`, color: `hsl(${h}, 45%, 32%)` }}>{init}</div>
  )
}
function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
