'use client'
// THE HOTEL'S TEAM & ACCESS — the Garden Hotel's own user settings (migration 118).
//   Roster  — the hotel's staff by department, with their manager (a login is optional)
//   Logins  — who can sign in to the hotel, their hotel role, and whether they also see the VR side
//   Roles   — the hotel's roles: a level per hotel page
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Loader2, Trash2, Plus, Save } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({})) }
const post = (body: any) => j('/api/garden/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const DEPT_LABEL: Record<string, string> = { management: 'Management', front_desk: 'Front desk', housekeeping: 'Housekeeping', maintenance: 'Maintenance' }
const LEVELS = ['off', 'view', 'edit', 'full']
const input = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-brand-500'

// `rosterOnly` renders just the staff roster inside Users & admin → Settings.
export function GardenTeam({ canEdit, rosterOnly }: { canEdit: boolean; rosterOnly?: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [tab, setTab] = useState<'roster' | 'logins' | 'roles'>('roster')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => setD(await j('/api/garden/team')), [])
  useEffect(() => { load() }, [load])
  const say = (r: any, ok = 'Saved') => { setMsg(r?.error || r?.note || r?.login?.note || ok); setTimeout(() => setMsg(''), 3500); load() }

  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Team & access" icon={<Users size={20} className="text-emerald-700" />} /><LeanEmpty>{/does not exist|schema cache|column/i.test(d.error || '') ? 'Run migration 118_garden_unit.sql, then reload.' : (d.message || d.error)}</LeanEmpty></>
  if (rosterOnly) return <>{msg ? <p className="text-[12px] text-emerald-700 mb-2">{msg}</p> : null}<Roster d={d} canEdit={canEdit} say={say} /></>
  const tabs: { key: 'roster' | 'logins' | 'roles'; label: string; n?: number }[] = [{ key: 'roster', label: 'Staff roster', n: d.staff.filter((s: any) => s.active).length }]
  if (d.me.canUsers) tabs.push({ key: 'logins', label: 'Logins', n: d.members?.length }, { key: 'roles', label: 'Roles', n: d.roles?.length })
  return (
    <>
      <LeanHead title="Team & access" icon={<Users size={20} className="text-emerald-700" />}>
        {msg ? <Pill tone={/error|only|must|cannot|pick|valid/i.test(msg) ? 'rose' : 'emerald'}>{msg}</Pill> : null}
      </LeanHead>
      <p className="text-[12.5px] text-muted mb-3">The Garden Hotel&apos;s own people and access — separate from the vacation-rental side. One login works for both businesses; a hotel role decides what someone sees here, and only the owner or a VR admin can also open the VR side to them.</p>
      <LeanTabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'roster' ? <Roster d={d} canEdit={canEdit} say={say} /> : null}
      {tab === 'logins' ? <Logins d={d} say={say} /> : null}
      {tab === 'roles' ? <Roles d={d} say={say} /> : null}
    </>
  )
}

function Roster({ d, canEdit, say }: { d: any; canEdit: boolean; say: (r: any, ok?: string) => void }) {
  const blank = { name: '', role: 'housekeeping', department: 'housekeeping', manager_id: '', phone: '', email: '' }
  const [f, setF] = useState<any>(blank)
  const managers = d.staff.filter((s: any) => s.active && (s.department === 'management' || s.role === 'manager'))
  const byDept = useMemo(() => { const m: Record<string, any[]> = {}; for (const s of d.staff.filter((x: any) => x.active)) (m[s.department || 'unassigned'] = m[s.department || 'unassigned'] || []).push(s); return m }, [d.staff])
  const save = async (row: any) => say(await post({ op: 'staff', ...row, manager_id: row.manager_id || null }))
  return (
    <>
      {canEdit ? (
        <div className="flex flex-wrap gap-2 mb-3">
          <input className={input + ' flex-1 min-w-[10rem]'} placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <select className={input} value={f.department} onChange={e => setF({ ...f, department: e.target.value, role: e.target.value === 'management' ? 'manager' : e.target.value === 'front_desk' ? 'frontdesk' : e.target.value })}>
            {d.depts.map((k: string) => <option key={k} value={k}>{DEPT_LABEL[k]}</option>)}
          </select>
          <select className={input} value={f.manager_id} onChange={e => setF({ ...f, manager_id: e.target.value })}>
            <option value="">No manager</option>{managers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input className={input + ' w-36'} placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          <input className={input + ' w-48'} placeholder="Email (optional)" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          <button onClick={async () => { await save(f); setF(blank) }} className="rounded-lg bg-ink text-white px-3 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={13} /> Add</button>
        </div>
      ) : null}
      {Object.keys(byDept).length ? Object.entries(byDept).map(([dept, people]) => (
        <div key={dept} className="mb-3">
          <div className="px-1 pb-1 text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted/70">{DEPT_LABEL[dept] || 'Unassigned'} · {people.length}</div>
          <LeanList>{people.map((s: any) => (
            <LeanRow key={s.id} name={s.name} meta={[s.phone, s.email].filter(Boolean).join(' · ')}
              tags={<>{s.manager_id ? <Tag>reports to {d.staff.find((m: any) => m.id === s.manager_id)?.name || '—'}</Tag> : null}{s.email && d.members?.some((m: any) => m.email === s.email) ? <Tag tone="emerald">has login</Tag> : null}</>}
              actions={canEdit ? <IconBtn title="Take off the roster" tone="bad" onClick={() => save({ ...s, active: false })}><Trash2 size={14} /></IconBtn> : undefined} />
          ))}</LeanList>
        </div>
      )) : <LeanEmpty>No one on the hotel&apos;s roster yet. Add the front desk, housekeeping, maintenance and managers — the scheduler plans shifts from this list.</LeanEmpty>}
    </>
  )
}

function Logins({ d, say }: { d: any; say: (r: any, ok?: string) => void }) {
  const admin = d.me.canAdmin
  const [f, setF] = useState<any>({ email: '', name: '', garden_role: d.roles?.[1]?.key || 'manager', password: '', vr_role: '' })
  const roleLabel = (k: string) => d.roles.find((r: any) => r.key === k)?.label || k
  const vrLabel = (k: string | null) => k ? ((d.vrRoles || []).find((r: any) => r.key === k)?.label || (k === 'admin' ? 'Admin' : k)) : 'no role yet'
  return (
    <>
      {admin ? (
        <div className="flex flex-wrap gap-2 mb-3">
          <input className={input + ' flex-1 min-w-[12rem]'} placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          <input className={input + ' w-40'} placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <select className={input} value={f.garden_role} onChange={e => setF({ ...f, garden_role: e.target.value })}>{d.roles.map((r: any) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
          <input className={input + ' w-40'} type="password" placeholder="Password (or invite)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          {d.me.canVr ? <select className={input} value={f.vr_role} title="Their role on the Stay Hospitality (VR) side — leave on hotel only for Garden staff" onChange={e => setF({ ...f, vr_role: e.target.value })}><option value="">Hotel only — no VR</option>{(d.vrRoles || []).map((r: any) => <option key={r.key} value={r.key}>VR: {r.label}</option>)}</select> : null}
          <button onClick={async () => { const body: any = { op: 'member', ...f }; if (!d.me.canVr) delete body.vr_role; say(await post(body), f.password ? 'Login created' : 'Added — invite sent'); setF({ ...f, email: '', name: '', password: '' }) }} className="rounded-lg bg-ink text-white px-3 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={13} /> Add login</button>
        </div>
      ) : null}
      <LeanList>
        <LeanRow name="jon@stay-hospitality.com" meta="owner" tags={<><Tag tone="emerald">Hotel: General manager</Tag><Tag tone="brand">VR: Owner (everything)</Tag></>} />
        {(d.members || []).map((m: any) => (
          <LeanRow key={m.email} name={m.name || m.email} meta={m.name ? m.email : undefined}
            tags={<><Tag tone="emerald">Hotel: {roleLabel(m.garden_role)}</Tag>{m.vr ? <Tag tone="brand">VR: {vrLabel(m.vr_role)}</Tag> : <Tag>hotel only</Tag>}{m.status !== 'active' ? <Tag tone="rose">{m.status}</Tag> : null}</>}
            actions={admin ? <>
              <select className={input + ' h-8 py-0'} title="Hotel role" value={m.garden_role} onChange={async e => say(await post({ op: 'member', email: m.email, garden_role: e.target.value }))}>{d.roles.map((r: any) => <option key={r.key} value={r.key}>Hotel: {r.label}</option>)}</select>
              {d.me.canVr ? <select className={input + ' h-8 py-0'} title="VR role — the Stay Hospitality side" value={m.vr ? (m.vr_role || '') : ''} onChange={async e => say(await post({ op: 'member', email: m.email, garden_role: m.garden_role, vr_role: e.target.value }))}><option value="">No VR</option>{(d.vrRoles || []).concat(m.vr_role === 'admin' && !(d.vrRoles || []).some((r: any) => r.key === 'admin') ? [{ key: 'admin', label: 'Admin' }] : []).map((r: any) => <option key={r.key} value={r.key}>VR: {r.label}</option>)}</select> : null}
              <IconBtn title={m.vr ? 'Take off the hotel (keeps VR)' : 'Take off the hotel (login disabled)'} tone="bad" onClick={async () => say(await post({ op: 'remove_member', email: m.email }), 'Removed')}><Trash2 size={14} /></IconBtn>
            </> : undefined} />
        ))}
      </LeanList>
    </>
  )
}

function Roles({ d, say }: { d: any; say: (r: any, ok?: string) => void }) {
  const admin = d.me.canAdmin
  const [edit, setEdit] = useState<Record<string, any>>({})
  const [nk, setNk] = useState('')
  const sections: string[] = Array.from(new Set(d.pages.map((p: any) => p.section)))
  const count = (k: string) => (d.members || []).filter((m: any) => m.garden_role === k).length
  return (
    <>
      {admin ? (
        <div className="flex gap-2 mb-3">
          <input className={input + ' w-64'} placeholder="New role name, e.g. Night auditor" value={nk} onChange={e => setNk(e.target.value)} />
          <button onClick={async () => { if (!nk.trim()) return; say(await post({ op: 'role', key: nk, label: nk, perms: { today: 'view', handbook: 'view' } }), 'Role added'); setNk('') }} className="rounded-lg bg-ink text-white px-3 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={13} /> Add role</button>
        </div>
      ) : null}
      <LeanList>{d.roles.map((r: any) => {
        const cur = edit[r.key] || r
        const dirty = !!edit[r.key]
        return (
          <LeanRow key={r.key} name={r.label} meta={r.blurb || undefined} tags={<><Tag>{count(r.key)} {count(r.key) === 1 ? 'person' : 'people'}</Tag><Tag>lands on {cur.landing}</Tag></>}
            actions={admin ? <>
              {dirty ? <IconBtn title="Save this role" tone="ok" onClick={async () => { say(await post({ op: 'role', ...cur })); setEdit(e => { const n = { ...e }; delete n[r.key]; return n }) }}><Save size={14} /></IconBtn> : null}
              {r.key !== 'gm' ? <IconBtn title="Delete role (only when nobody holds it)" tone="bad" onClick={async () => say(await post({ op: 'delete_role', key: r.key }), 'Deleted')}><Trash2 size={14} /></IconBtn> : null}
            </> : undefined}>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {sections.map(sec => (
                <div key={sec}>
                  <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-muted/60 mt-1.5 mb-0.5">{sec}</div>
                  {d.pages.filter((p: any) => p.section === sec).map((p: any) => (
                    <div key={p.key} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-[12.5px] text-ink" title={p.what}>{p.label}</span>
                      <div className="inline-flex rounded-md border border-line overflow-hidden">
                        {LEVELS.map(l => (
                          <button key={l} disabled={!admin || (r.key === 'gm' && p.key === 'users')}
                            onClick={() => setEdit(e => ({ ...e, [r.key]: { ...cur, perms: { ...cur.perms, [p.key]: l } } }))}
                            className={`px-1.5 py-0.5 text-[10.5px] font-semibold border-l border-line first:border-l-0 ${String(cur.perms?.[p.key] || 'off') === l ? (l === 'off' ? 'bg-slate-200 text-slate-700' : 'bg-emerald-700 text-white') : 'bg-white text-muted'} disabled:cursor-default`}>{l}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {admin ? (
              <label className="text-[12px] text-muted inline-flex items-center gap-2 mt-2">Lands on
                <select className={input + ' py-1'} value={cur.landing} onChange={e => setEdit(x => ({ ...x, [r.key]: { ...cur, landing: e.target.value } }))}>
                  {d.pages.filter((p: any) => p.key !== 'users').map((p: any) => <option key={p.key} value={p.to}>{p.label}</option>)}
                </select>
              </label>
            ) : null}
          </LeanRow>
        )
      })}</LeanList>
    </>
  )
}
