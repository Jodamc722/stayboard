// TRAINING MODULES — the admin side (Jon, 2026-11-25). Feature key `training`.
//
//   GET                                        modules (course order) + per-module stats
//   POST { action, ... }   (edit)
//     save     { module }                       create or update (title EN/ES, summary, roles, lessons in order, draft/active)
//     delete   { id }                           the module only — its lessons stay in the library
//     move     { id, dir: -1 | 1 }              reorder the course
//     sync     { id }                           give everyone on its roles the lessons they are missing
//     seed                                      create the starter course (idempotent; never overwrites)
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listModules, saveModule, deleteModule, moveModule, seedStarter, STARTER } from '@/lib/training-modules'
import { moduleStats, syncModule, quizzesFor } from '@/lib/team-member'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const reply = (r: any) => NextResponse.json(r, { status: r && r.ok === false ? 400 : 200 })

export async function GET() {
  const gate = await requireLevel('training', 'view')
  if (!gate.ok) return gate.res
  const [modules, stats] = await Promise.all([listModules(true), moduleStats()])
  const missingStarter = STARTER.filter(s => !modules.some(m => m.id === s.id)).map(s => s.titleEn)
  const ids = Array.from(new Set(modules.flatMap(m => m.itemIds)))
  const quizzes = await quizzesFor(ids)
  const quizCount: Record<string, number> = {}
  for (const id of Object.keys(quizzes)) quizCount[id] = quizzes[id].length
  return NextResponse.json({ ok: true, modules, stats, missingStarter, quizCount })
}

export async function POST(req: Request) {
  const gate = await requireLevel('training', 'edit')
  if (!gate.ok) return gate.res
  const by = who(gate)
  const body = await req.json().catch(() => ({} as any))
  try {
    switch (String(body?.action || '')) {
      case 'save': return reply(await saveModule(body.module, by))
      case 'delete': return reply(await deleteModule(String(body.id || ''), by))
      case 'move': return reply(await moveModule(String(body.id || ''), Number(body.dir) < 0 ? -1 : 1, by))
      case 'sync': return reply(await syncModule(String(body.id || ''), by))
      case 'seed': return reply(await seedStarter(by))
      default: return reply({ ok: false, error: 'Unknown action.' })
    }
  } catch (e: any) { return reply({ ok: false, error: String(e?.message || e) }) }
}
