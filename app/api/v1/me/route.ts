import { NextRequest } from 'next/server'
import { v1Gate, json, V1_ENDPOINTS } from '@/lib/api-v1'
import { atLeast } from '@/lib/features'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'me'); if (!g.ok) return g.res
  const can = V1_ENDPOINTS.filter(e => g.viaKey || e.feature === 'me' || atLeast(g.access.levels[e.feature], 'view')).map(e => e.path)
  return json({ email: g.access.email, role: g.access.role, viaKey: g.viaKey, readable: can, endpoints: V1_ENDPOINTS })
}
