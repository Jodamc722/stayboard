// BREEZEWAY PICKERS for the board — who can be assigned, and which checklist templates exist.
// Cached upstream (lib/breezeway); members with view may read: the names are the ops roster the
// rest of the app already shows.
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listBreezewayPeople, listBreezewayTemplates } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const [people, templates] = await Promise.all([
    listBreezewayPeople().catch(() => []),
    listBreezewayTemplates().catch(() => []),
  ])
  return NextResponse.json({
    ok: true,
    people: people.map(p => ({ id: p.id, name: p.name, departments: p.departments, region: p.region })).sort((a, b) => a.name.localeCompare(b.name)),
    templates: templates.map(t => ({ id: t.id, name: t.name, department: t.department })),
  })
}
