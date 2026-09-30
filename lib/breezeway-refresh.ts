// Re-read one task from Breezeway into our mirror (billing detail + the task row). Shared by the
// billing task route and the translate pass, so a renamed / re-described task shows at once.
import 'server-only'
import { retrieveBreezewayTask, mapBreezewayTask } from './breezeway'

export async function refreshFromBreezeway(db: any, taskId: string) {
  const r = await retrieveBreezewayTask(taskId)
  if (!r.ok || !r.data) return
  const t = r.data
  await db.from('breezeway_billing_details').upsert({
    task_id: taskId,
    bill_to: t?.bill_to ? String(t.bill_to) : null,
    rate_type: t?.rate_type ? String(t.rate_type) : null,
    costs: Array.isArray(t?.costs) ? t.costs : [],
    supplies: Array.isArray(t?.supplies) ? t.supplies : [],
    synced_at: new Date().toISOString(),
  }, { onConflict: 'task_id' })
  const m: any = mapBreezewayTask(t)
  if (m?.id) {
    const rp = Number(m.rate_paid)
    m.rate_paid = Number.isFinite(rp) ? rp : null
    m.synced_at = new Date().toISOString()
    await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
  }
}

