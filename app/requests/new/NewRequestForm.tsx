'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { ArrowLeft, Loader2 } from 'lucide-react'

type ListingOption = { id: string; nickname: string | null; title: string | null; building: string | null; unit: string | null }

export function NewRequestForm({
  listings, creatorEmail, prefillListingId, prefillReservationId
}: { listings: ListingOption[]; creatorEmail: string | null; prefillListingId: string | null; prefillReservationId: string | null }) {
  const router = useRouter()
  const [type, setType]       = useState<'issue' | 'order' | 'pte'>('issue')
  const [title, setTitle]     = useState('')
  const [desc, setDesc]       = useState('')
  const [listingId, setListingId] = useState<string | null>(prefillListingId)
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [assignee, setAssignee] = useState('')
  const [dueAt, setDueAt]     = useState('')
  const [vendor, setVendor]   = useState('')
  const [amount, setAmount]   = useState('')
  const [reqApproval, setReqApproval] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const listing = listings.find(l => l.id === listingId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setErr(null)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('field_requests')
        .insert({
          type,
          title: title.trim(),
          description: desc.trim() || null,
          listing_id: listingId,
          building: listing?.building ?? null,
          unit: listing?.unit ?? null,
          reservation_id: prefillReservationId,
          priority,
          status: 'open',
          created_by_email: creatorEmail,
          assignee_email: assignee.trim() || null,
          due_at: dueAt || null,
          vendor: vendor.trim() || null,
          amount_usd: amount ? Number(amount) : null,
          approval_required: reqApproval,
          approval_status: reqApproval ? 'pending' : null
        })
        .select('id')
        .single()
      if (error) throw error
      router.push(`/requests/${data!.id}`)
    } catch (e: any) {
      setErr(e.message || 'Failed to create')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/requests" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink mb-4">
        <ArrowLeft size={12} /> All requests
      </Link>
      <h1 className="text-3xl font-bold text-ink tracking-tight">New request</h1>
      <p className="text-sm text-muted mt-1">Log a maintenance issue, vendor order, or approval needed.</p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        {/* Type */}
        <div>
          <Label>Type</Label>
          <div className="inline-flex p-0.5 rounded-lg bg-app">
            {(['issue', 'order', 'pte'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all capitalize ${type === t ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}>{t}</button>
            ))}
          </div>
        </div>

        {/* Title */}
        <Field label="Title" required>
          <input type="text" required autoFocus value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. AC not cooling in master bedroom"
            className="w-full px-3 py-2 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-sm" />
        </Field>

        {/* Property */}
        <Field label="Property" required>
          <select required value={listingId ?? ''} onChange={e => setListingId(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 outline-none cursor-pointer">
            <option value="">Select a property…</option>
            {listings.map(l => (
              <option key={l.id} value={l.id}>
                {[l.building, l.unit, l.nickname].filter(Boolean).join(' · ') || l.title || l.id}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Priority">
            <select value={priority} onChange={e => setPriority(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 outline-none cursor-pointer">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 outline-none" />
          </Field>
        </div>

        <Field label="Assignee email">
          <input type="email" value={assignee} onChange={e => setAssignee(e.target.value)}
            placeholder="who handles this"
            className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition" />
        </Field>

        <Field label="Description">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4}
            placeholder="What happened, what's needed, anything ops should know"
            className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition resize-none" />
        </Field>

        {/* Order/PTE-only: vendor + amount + approval */}
        {(type === 'order' || type === 'pte') && (
          <div className="rounded-xl bg-app p-4 space-y-4 border border-line">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted">{type === 'order' ? 'Order details' : 'Permission to expense'}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Vendor">
                <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Home Depot"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 outline-none" />
              </Field>
              <Field label="Amount (USD)">
                <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm focus:border-brand-400 outline-none" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={reqApproval} onChange={e => setReqApproval(e.target.checked)} className="rounded border-line text-brand-500 focus:ring-brand-200" />
              Requires owner / manager approval before proceeding
            </label>
          </div>
        )}

        {err && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm border border-rose-200">{err}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={submitting || !title.trim() || !listingId}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-ink text-white hover:bg-ink/90 disabled:opacity-50 shadow-sm transition-colors">
            {submitting ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : 'Create request'}
          </button>
          <Link href="/requests" className="text-sm text-muted hover:text-ink">Cancel</Link>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</Label>
      {children}
    </div>
  )
}
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] uppercase tracking-wider font-semibold text-muted mb-1.5">{children}</label>
}
