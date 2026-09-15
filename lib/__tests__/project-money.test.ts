// INVOICES AND VENDORS — the arithmetic and the normalising.
//
// These are the two places a project board can be quietly wrong about money: counting the wrong
// statuses into a total, and letting the same vendor exist twice under two spellings.
// Run: npx tsx lib/__tests__/project-money.test.ts
import { invoiceTotals, approvalCeiling, INVOICE_APPROVAL_CENTS, type Invoice } from '../projects-shared'

let failed = 0
const eq = (why: string, got: any, want: any) => { if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ } }

// The helpers under test are pure string work, copied here rather than imported because
// lib/project-vendors is 'server-only' and will not load outside a request.
const slugVendor = (s: string) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const tidyPhone = (raw: any): string | null => {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return String(raw).trim().slice(0, 40)
}

const inv = (over: Partial<Invoice>): Invoice => ({
  id: Math.random().toString(36).slice(2), project_id: 'p', task_id: null,
  vendor_key: null, vendor_name: 'Acme', number: null, amount_cents: 0, status: 'received',
  issued_on: null, due_on: null, paid_on: null, note: null, photo_id: null,
  needs_approval: false, approved_by: null, approved_at: null,
  created_by: null, created_at: '', updated_at: '', ...over,
} as Invoice)

// ── WHAT COUNTS AS MONEY OUT ────────────────────────────────────────────────────────────────────
// Only approved and paid. A quote is a maybe; a received invoice nobody has agreed to is a claim
// against us, not a commitment; a void one never happened. Getting this wrong is how a project
// reports itself over budget on quotes it never accepted.
{
  const list = [
    inv({ amount_cents: 50_000, status: 'paid' }),
    inv({ amount_cents: 30_000, status: 'approved' }),
    inv({ amount_cents: 90_000, status: 'quoted' }),
    inv({ amount_cents: 20_000, status: 'received' }),
    inv({ amount_cents: 70_000, status: 'void' }),
  ]
  const t = invoiceTotals(list)
  eq('committed = approved + paid', t.committed, 80_000)
  eq('quoted is separate',          t.quoted, 90_000)
  eq('unpaid = approved only',      t.unpaid, 30_000)
  eq('void never counts',           t.committed + t.quoted, 170_000)
  eq('count is every row',          t.count, 5)
}

// ── WHAT IS WAITING ON A YES ────────────────────────────────────────────────────────────────────
// needs_approval survives on the row after approval, so the flag alone is not the question —
// "flagged AND not yet signed" is. An approved-then-flagged invoice must not reappear in the queue.
{
  const t = invoiceTotals([
    inv({ amount_cents: 200_000, needs_approval: true }),
    inv({ amount_cents: 300_000, needs_approval: true, approved_at: '2026-09-01T00:00:00Z', status: 'approved' }),
    inv({ amount_cents: 400_000, needs_approval: true, status: 'void' }),
  ])
  eq('one waiting',            t.awaiting, 1)
  eq('waiting amount',         t.awaitingCents, 200_000)
  eq('signed is not waiting',  t.committed, 300_000)
}

eq('empty totals cleanly', invoiceTotals([]).committed, 0)

// ── THE CEILING ─────────────────────────────────────────────────────────────────────────────────
eq('default ceiling',      approvalCeiling(null), INVOICE_APPROVAL_CENTS)
eq('project override',     approvalCeiling({ invoiceApprovalCents: 40_000 }), 40_000)
eq('zero means everything needs a yes', approvalCeiling({ invoiceApprovalCents: 0 }), 0)
eq('nonsense falls back',  approvalCeiling({ invoiceApprovalCents: 'lots' }), INVOICE_APPROVAL_CENTS)
eq('negative falls back',  approvalCeiling({ invoiceApprovalCents: -5 }), INVOICE_APPROVAL_CENTS)

// ── ONE VENDOR, ONE ROW ─────────────────────────────────────────────────────────────────────────
// Every spelling of the same company has to land on the same key, or the directory fills up with
// duplicates and "pull from once you save a vendor" stops working.
eq('spaces to dashes',     slugVendor('Opal Works'), 'opal-works')
eq('case folded',          slugVendor('OPAL WORKS'), 'opal-works')
eq('punctuation dropped',  slugVendor("O'Brien & Sons, LLC"), 'o-brien-sons-llc')
eq('edges trimmed',        slugVendor('  --Opal--  '), 'opal')
eq('empty stays empty',    slugVendor('   '), '')

eq('ten digits',           tidyPhone('3055551234'), '(305) 555-1234')
eq('already formatted',    tidyPhone('(305) 555-1234'), '(305) 555-1234')
eq('dashes and spaces',    tidyPhone('305-555-1234'), '(305) 555-1234')
eq('leading country code', tidyPhone('1 305 555 1234'), '(305) 555-1234')
eq('nothing is null',      tidyPhone(''), null)
eq('letters only is null', tidyPhone('call me'), null)
// An extension or an international number is kept as typed rather than mangled into a US shape.
eq('extension kept',       tidyPhone('305-555-1234 x12'), '305-555-1234 x12')

console.log(failed ? `\n${failed} FAILED` : '\nAll project money checks passed.')
process.exit(failed ? 1 : 0)
