// HOW A TASK READS AT A GLANCE, AND WHICH TASKS I AM LOOKING AT.
//
// Jon, 2026-09-24, on the projects board: "so so bad, too easy to mark complete and hard to read
// and see. Need visibility options." He chose: strip each row back to a title, ONE status tag and
// the owner; filters by person, status, priority and due; saved views; collapsible sections.
//
// This file is the pure half of that: given a task and today's date, which single tag does it
// earn, and given a filter set, is it in view. No React, no database, so both the list and the
// board render from one rule and the rule can be tested on its own.
import type { Task, TaskFilters } from './projects-shared'

export type TaskTag = { label: string; tone: 'rose' | 'amber' | 'brand' | 'slate' } | null

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/**
 * ONE TAG PER ROW. The old row carried a priority edge, a due chip, a priority badge, subtask
 * counts, a Breezeway badge and a comment count, all at once — six things competing for the eye on
 * a 32px line. A row now says exactly one thing, and the order below is the order a person on the
 * day actually needs to hear it: is it stuck, is it late, is it today, is it urgent, is it soon,
 * is somebody on it. Nothing else earns the tag; it goes on the quiet second line instead.
 */
export function taskTag(t: Pick<Task, 'status' | 'due_on' | 'priority'>, today: string): TaskTag {
  if (t.status === 'done') return null
  if (t.status === 'blocked') return { label: 'Blocked', tone: 'rose' }
  if (t.due_on && t.due_on < today) return { label: 'Late', tone: 'rose' }
  if (t.due_on === today) return { label: 'Today', tone: 'amber' }
  if (t.priority === 'urgent') return { label: 'Urgent', tone: 'rose' }
  if (t.due_on && t.due_on <= addDays(today, 2)) return { label: 'Soon', tone: 'amber' }
  if (t.priority === 'high') return { label: 'High', tone: 'amber' }
  if (t.status === 'doing') return { label: 'Doing', tone: 'brand' }
  return null
}

/** Which due bucket a task falls in, for the filter. */
export function dueBucket(t: Pick<Task, 'due_on' | 'status'>, today: string): 'late' | 'today' | 'week' | 'later' | 'none' {
  if (!t.due_on) return 'none'
  if (t.status !== 'done' && t.due_on < today) return 'late'
  if (t.due_on === today) return 'today'
  if (t.due_on <= addDays(today, 7)) return 'week'
  return 'later'
}

const lc = (s: any) => String(s || '').trim().toLowerCase()

/**
 * IS THIS TASK IN VIEW. Every filter axis is OR within itself and AND across axes: "Roberto or
 * Vilma, and late or today" reads the way the sentence does. An empty axis is "any". 'me' in the
 * people list stands for the viewer, so a saved "My week" view means the same thing to whoever
 * opens it.
 */
export function taskInView(t: Task, f: TaskFilters, me: string, today: string): boolean {
  if (f.status.length && !f.status.includes(t.status as any)) return false
  if (f.priority.length && !f.priority.includes(t.priority as any)) return false
  if (f.due.length && !f.due.includes(dueBucket(t, today))) return false
  if (f.people.length) {
    const want = f.people.map(p => p === 'me' ? lc(me) : lc(p)).filter(Boolean)
    const have = t.assignees.flatMap(a => [lc(a.email), lc(a.person_key), lc(a.display)]).filter(Boolean)
    if (!want.some(w => have.includes(w))) return false
  }
  return true
}
