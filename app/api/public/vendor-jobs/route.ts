// THE VENDOR'S LINK — the only vendor endpoint with no session.
//
//   GET  ?token=…                        → this vendor's jobs, and nothing else
//   POST { token, action, … }            → the four things a vendor may do
//
// THE TOKEN IS THE ONLY CREDENTIAL, so it is checked first on every call and every write is
// re-scoped through vendorJobFor — a job id is never trusted because it arrived alongside a valid
// token. Without that, any vendor could act on any job by guessing an id.
//
// WHAT A VENDOR MAY NOT DO, deliberately:
//   • change our visit date     — they propose; we decide. A date that moves because a vendor
//                                 typed something is a date the team was told wrongly.
//   • approve their own invoice — over $300 that is the owner's or GM's call, and the whole point
//                                 of the rule is that it is not the payee's.
//   • see anything unasked      — no other vendor, no other job, no budget, no internal comment.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getVendorByToken, vendorJobs, vendorJobFor } from '@/lib/vendor-portal'
import { addNote, logEvent, recountInvoiced, approvalCeiling, toCents, todayISO } from '@/lib/projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const ymd = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null)
const DEAD = () => NextResponse.json({ error: 'This link is no longer valid. Ask your contact at Stay Hospitality for a new one.' }, { status: 403 })

export async function GET(req: NextRequest) {
  const v = await getVendorByToken(str(req.nextUrl.searchParams.get('token')))
  if (!v) return DEAD()
  const jobs = await vendorJobs(v.key, { includeDone: req.nextUrl.searchParams.get('all') === '1' })
  return NextResponse.json({
    ok: true, today: todayISO(),
    // The vendor's own details, so the page can greet them by name and they can see what we hold.
    vendor: { key: v.key, label: v.label, contact_name: v.contact_name, phone: v.phone, email: v.email, trade: v.trade },
    jobs,
  })
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}))
    const v = await getVendorByToken(str(b.token))
    if (!v) return DEAD()
    const action = str(b.action)
    const job = await vendorJobFor(v.key, str(b.jobId))
    if (!job) return NextResponse.json({ error: 'That job is not on your list.' }, { status: 404 })
    const sb = supabaseAdmin()
    const who = v.label || 'vendor'

    switch (action) {
      // "Yes, I'll be there." The single most useful thing a vendor can tell us, and the one thing
      // we otherwise have to phone them to find out.
      case 'confirm': {
        await sb.from('project_steps').update({ vendor_confirmed_at: new Date().toISOString(), vendor_proposed_on: null }).eq('id', job.id)
        await logEvent(job.project_id, null, 'task_moved', `${who} confirmed they are coming`, { task_id: job.id, task_title: job.title })
        break
      }

      // "Not that day — how about this one." Recorded as a REQUEST. Our visit_on does not move, so
      // whatever the team was told stays true until somebody here decides otherwise.
      case 'propose': {
        const on = ymd(b.date)
        if (!on) return NextResponse.json({ error: 'Pick a date.' }, { status: 400 })
        await sb.from('project_steps').update({ vendor_proposed_on: on, vendor_confirmed_at: null }).eq('id', job.id)
        await logEvent(job.project_id, null, 'task_moved', `${who} asked to move the visit to ${on}${str(b.note) ? ' — ' + str(b.note).slice(0, 200) : ''}`, { task_id: job.id, task_title: job.title })
        break
      }

      // "It's finished." This DOES close the job: the vendor is the only person who knows, and
      // making them wait for one of ours to tick it is how a board stops matching reality.
      case 'done': {
        await sb.from('project_steps').update({ status: 'done', done: true, done_at: new Date().toISOString(), done_by: who }).eq('id', job.id)
        const note = str(b.note).slice(0, 2000)
        await addNote(job.project_id, `${who} marked this finished${note ? ': ' + note : '.'}`, who, 'comment', true, { taskId: job.id })
        await logEvent(job.project_id, null, 'task_status', `${who} marked it finished`, { task_id: job.id, task_title: job.title, to: 'done' })
        break
      }

      case 'comment': {
        const body = str(b.body).slice(0, 2000)
        if (!body) return NextResponse.json({ error: 'Nothing to send.' }, { status: 400 })
        await addNote(job.project_id, body, who, 'comment', true, { taskId: job.id })
        break
      }

      // Their bill. It lands as 'received' and never as approved — a payee does not approve their
      // own invoice, and over the limit it waits for the owner or GM exactly as if we had typed it.
      case 'invoice': {
        const amount = toCents(b.amount)
        if (amount == null || amount < 0) return NextResponse.json({ error: 'That amount does not read as money.' }, { status: 400 })
        const { data: proj } = await sb.from('projects').select('settings').eq('id', job.project_id).maybeSingle()
        const needs = amount > approvalCeiling((proj as any)?.settings)
        const { error } = await sb.from('project_invoices').insert({
          project_id: job.project_id, task_id: job.id,
          vendor_key: v.key, vendor_name: v.label,
          number: str(b.number).slice(0, 80) || null,
          amount_cents: amount, status: 'received',
          issued_on: ymd(b.issued_on), note: str(b.note).slice(0, 1000) || null,
          needs_approval: needs, created_by: `vendor:${v.key}`,
        })
        if (error) {
          if (/relation|does not exist/i.test(error.message)) return NextResponse.json({ error: 'We cannot take invoices through this link yet — please send it to your contact.' }, { status: 503 })
          return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })
        }
        await recountInvoiced(job.project_id)
        await logEvent(job.project_id, null, 'spend', `${who} submitted an invoice for $${(amount / 100).toFixed(2)}${needs ? ' — over the limit, needs approval' : ''}`, { task_id: job.id, task_title: job.title })
        break
      }

      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, jobs: await vendorJobs(v.key) })
  } catch {
    // Nothing internal goes out of this endpoint: the reader is outside the company.
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
