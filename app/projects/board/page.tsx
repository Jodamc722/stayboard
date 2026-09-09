// BOARD OVERVIEW — the kanban by stage, one card per project. Reached from the rail; the New
// project modal opens straight away with ?new=1 (or ?new=personal for a private board).
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { ProjectBoard } from '@/components/ProjectBoard'

export const dynamic = 'force-dynamic'

export default async function BoardPage({ searchParams }: { searchParams: { new?: string } }) {
  const access = await getAccess()
  const level = access.levels['projects']
  const autoNew = searchParams?.new ? String(searchParams.new) : null   // '1' | 'personal' | a template key
  return (
    <>
      <header className="mb-3">
        <h1 className="text-2xl font-bold text-ink tracking-tight">Board overview</h1>
        <p className="text-[13px] text-muted mt-0.5 max-w-3xl">Every team project by stage. Drag a card to move it; click one to open it.</p>
      </header>
      <ProjectBoard canEdit={atLeast(level, 'edit')} canFull={atLeast(level, 'full')} me={access.email || ''} autoNew={autoNew} />
    </>
  )
}
