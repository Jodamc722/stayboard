#!/usr/bin/env node
// Lighthouse self-audit runner.
//
//   node scripts/audit/run.mjs [--base URL] [--no-live] [--json out.json] [--md out.md]
//
// Prints a report and writes machine-readable output. It compares today's findings against
// scripts/audit/baseline.json and separates NEW / WORSE / FIXED from the standing backlog,
// because a report that repeats 70 known items every morning is a report nobody reads.
//
// Exit code is 0 unless --strict is passed (then 1 when anything NEW is red).

import fs from 'node:fs'
import path from 'node:path'
import { runStatic } from './checks.mjs'
import { runLive } from './live.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1] }
const flag = (n) => argv.includes(n)

const BASE = arg('--base', process.env.AUDIT_BASE || 'https://stayboard-three.vercel.app')
const ROOT = process.env.AUDIT_ROOT || process.cwd()
const BASELINE = path.join(ROOT, 'scripts/audit/baseline.json')
const SEV_RANK = { note: 0, amber: 1, red: 2 }

const stamp = new Date().toISOString()

const stat = runStatic()
const live = flag('--no-live') ? { findings: [], facts: { skipped: true } } : await runLive(BASE)

const findings = [...stat.findings, ...live.findings]
findings.sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || a.area.localeCompare(b.area) || a.id.localeCompare(b.id))

let baseline = {}
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).known || {} } catch {}

const isNew = f => !(f.id in baseline)
const isWorse = f => (f.id in baseline) && SEV_RANK[f.sev] > SEV_RANK[baseline[f.id]]
const nowIds = new Set(findings.map(f => f.id))
const fixed = Object.keys(baseline).filter(id => !nowIds.has(id))

const New = findings.filter(isNew)
const Worse = findings.filter(isWorse)
const Standing = findings.filter(f => !isNew(f) && !isWorse(f))

const verdict = New.some(f => f.sev === 'red') || Worse.some(f => f.sev === 'red') ? 'RED'
  : New.length || Worse.length ? 'AMBER' : 'GREEN'

const report = {
  stamp, base: BASE, verdict,
  counts: { total: findings.length, new: New.length, worse: Worse.length, fixed: fixed.length,
            red: findings.filter(f => f.sev === 'red').length, amber: findings.filter(f => f.sev === 'amber').length },
  new: New, worse: Worse, fixed, standing: Standing,
  checkErrors: stat.errors, live: live.facts,
}

// ── markdown ────────────────────────────────────────────────────────────────
const badge = { red: '🔴', amber: '🟡', note: '⚪' }
const block = (f) => `**${badge[f.sev]} ${f.title}**\n\n${f.detail}\n\n${f.where.map(w => '- `' + w + '`').join('\n')}\n`
let md = `# Lighthouse audit — ${stamp.slice(0, 16).replace('T', ' ')} UTC\n\n**${verdict}** · ${New.length} new · ${Worse.length} worse · ${fixed.length} fixed · ${findings.length} open in total\n\n`
if (report.checkErrors.length) md += `> ⚠️ ${report.checkErrors.length} check(s) crashed: ${report.checkErrors.map(e => e.check).join(', ')}\n\n`
if (New.length) md += `## New since last run\n\n${New.map(block).join('\n')}\n`
if (Worse.length) md += `## Got worse\n\n${Worse.map(block).join('\n')}\n`
if (fixed.length) md += `## Fixed\n\n${fixed.map(id => '- ' + id).join('\n')}\n\n`
if (!New.length && !Worse.length) md += `No new problems. ${Standing.length} known items still open.\n\n`
md += `## Still open (known)\n\n` + ['red', 'amber', 'note'].map(s => {
  const g = Standing.filter(f => f.sev === s); if (!g.length) return ''
  return `### ${badge[s]} ${s} (${g.length})\n` + g.map(f => `- ${f.title} — \`${f.where[0]}\``).join('\n') + '\n'
}).join('\n')

if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(report, null, 2))
if (arg('--md')) fs.writeFileSync(arg('--md'), md)
if (flag('--write-baseline')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
  fs.writeFileSync(BASELINE, JSON.stringify({ updated: stamp, note: 'Known findings. The runner only shouts about ids that are not in here, or whose severity rose.', // Reds are NEVER baselined: something that is broken right now should be said out loud every
    // single run until it is fixed. Only the amber/note backlog gets quietened.
    known: Object.fromEntries(findings.filter(f => f.sev !== 'red').map(f => [f.id, f.sev])) }, null, 2))
  console.log('baseline written:', BASELINE, Object.keys(findings).length)
}
console.log(md)
if (flag('--strict') && verdict === 'RED') process.exit(1)
