import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Ops snapshot for a single listing, shown when a clean is clicked in the scheduler.
// Returns: inspection recommendation (+reasons), last guest feedback, a things-to-check
// list derived from recent low reviews, and any already-open inspection task.

const LOW = 3
const DAYS = 180

function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

const CHECK_MAP: { keys: string[]; item: string }[] = [
  { keys: ['clean', 'dirty', 'dust', 'hair', 'stain', 'sticky', 'grime'], item: 'Deep-clean check: floors, surfaces, bathroom, kitchen, linens' },
  { keys: ['ac ', 'a/c', 'air condition', 'too hot', 'too cold', 'temperature', 'thermostat'], item: 'Verify A/C cools properly; check filter and thermostat' },
  { keys: ['smell', 'odor', 'odour', 'musty', 'mold', 'mildew'], item: 'Check for odors: trash, drains, fridge, HVAC, damp areas' },
  { keys: ['noise', 'loud', 'noisy'], item: 'Check noise sources: appliances, HVAC, doors, neighbors' },
  { keys: ['broke', 'broken', 'leak', 'repair', 'maintenance', 'not work', 'malfunction'], item: 'Maintenance sweep: plumbing, fixtures, electronics, locks' },
  { keys: ['towel', 'sheet', 'linen', 'amenit', 'soap', 'shampoo', 'coffee', 'supplies', 'restock'], item: 'Restock supplies: linens, towels, toiletries, coffee, paper goods' },
  { keys: ['wifi', 'wi-fi', 'internet', 'tv ', 'remote', 'streaming'], item: 'Test Wi-Fi speed and TV / streaming logins' },
  { keys: ['key', 'lock', 'code', 'access', 'door', 'fob', 'entry'], item: 'Verify entry: door code, lock, key fob, building access' },
  { keys: ['bug', 'pest', 'roach', 'ant ', 'insect'], item: 'Pest check: kitchen, bathroom, baseboards (flag exterminator if seen)' },
  { keys: ['parking', 'garage'], item: 'Confirm parking / garage access instructions are accurate' },
]

const GENERIC_CHECKS = [
  'Walk every room: cleanliness, damage, missing items',
  'Test A/C, Wi-Fi, TV, and all appliances',
  'Restock linens, towels, and toiletries',
  'Confirm entry codes and building access work',
]

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const listingId = String(url.searchParams.get('listingId') || '').trim()
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const db = supabaseAdmin()
  const since = daysAgoISO(DAYS)
  const [{ data: reviews }, { data: qcs }, { data: listing }] = await Promise.all([
    db.from('guesty_reviews').select('rating,content,guest_name,created_at').eq('listing_id', listingId).order('created_at', { ascending: false }).limit(40),
    db.from('qc_tasks').select('breezeway_task_id,report_url,issue_type,status,department,created_at').eq('listing_id', listingId).eq('status', 'open'),
    db.from('guesty_listings').select('nickname,title').eq('id', listingId).limit(1).maybeSingle(),
  ])

  const revs = (reviews || []) as any[]
  const lastReview = revs[0] || null
  const recentLow = revs.filter((r) => Number(r.rating) > 0 && Number(r.rating) <= LOW && String(r.created_at || '') >= since)
  const openTasks = (qcs || []) as any[]
  const openInspection =
    openTasks.find((q) => String(q.department || q.issue_type || '').toLowerCase().includes('inspect')) || openTasks[0] || null

  const reasons: string[] = []
  if (recentLow.length) reasons.push(recentLow.length + ' low review' + (recentLow.length > 1 ? 's' : '') + ' in the last ' + DAYS + ' days')
  if (openTasks.length) reasons.push(openTasks.length + ' open QC/inspection task' + (openTasks.length > 1 ? 's' : ''))
  const recommended = reasons.length > 0

  const blob = recentLow.map((r) => String(r.content || '')).join(' ').toLowerCase()
  const checklist: string[] = []
  for (const m of CHECK_MAP) if (m.keys.some((k) => new RegExp('\\b' + k.trim()).test(blob))) checklist.push(m.item)
  if (!checklist.length) for (const g of GENERIC_CHECKS) checklist.push(g)

  const lastFeedback = lastReview
    ? {
        rating: lastReview.rating ?? null,
        guest: lastReview.guest_name || null,
        date: String(lastReview.created_at || '').slice(0, 10),
        excerpt: String(lastReview.content || '').slice(0, 300),
      }
    : null

  return NextResponse.json({
    listingId,
    unit: listing?.nickname || listing?.title || 'Unit',
    inspection: { recommended, reasons },
    lastFeedback,
    checklist,
    openInspection: openInspection
      ? { taskId: String(openInspection.breezeway_task_id || ''), reportUrl: openInspection.report_url || null }
      : null,
  })
}
