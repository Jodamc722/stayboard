// OUR WALK CHECKLISTS, AS BUILT IN BREEZEWAY (Settings → Tasks → Templates). Breezeway hands a
// task's lines back only once the task is finished (GET /task/{id}/requirements is "user responses
// to completed tasks") and its template list carries names only, so anything that needs the lines
// of a walk nobody has walked yet — the sample owner email (lib/walk-reports sampleReportForTask),
// a rebuild of a template — reads them here. The template in Breezeway is the one the crew sees;
// this copy is kept in step with it by hand. Source: the "Eden Exterior Walk" doc, 2026-11-02.
export type ChecklistSection = { section: string; lines: string[] }

export const WALK_CHECKLISTS: Record<string, ChecklistSection[]> = {
  'Eden Walk 1.0': [
    { section: '1. Street front and parking', lines: [
      'Lot clear: no potholes, pooling, debris or oil, and no unauthorized vehicles?',
      'Striping and the accessible space legible, signage upright?',
      'Low front walls and planters sound: no cracks, loose caps or leaning sections?',
      'EDEN sign, address numbers and cameras intact and lit?',
      'Lot and facade lighting: every fixture lit at dusk, photocells working?',
    ] },
    { section: '2. Front building (3020)', lines: [
      'Entry doors, keypads and closers lock, latch and close on their own?',
      'Sconces and path lights working, no exposed wiring or hanging fixtures?',
      'No new stains, drips or wet stucco under windows, at parapets or along the roof-to-wall line?',
      'Stucco, paint and sealant at windows and doors sound, no rust bleeding from railings or fasteners?',
      'Roof terrace (from the terrace, never the roof): railing posts tight, drains clear, door seals intact, nothing stored against the parapet?',
      'Rooftop condensers (from a safe vantage): running, no rattle or vibration, pads level, disconnects closed, no rust or refrigerant-line damage?',
      'Parapet caps, scuppers and downspouts sealed and flowing, no ponding marks at the roof edge?',
    ] },
    { section: '3. Walkway between the buildings', lines: [
      'Stepping stones level and stable, turf strips intact, no trip lips?',
      'String lights and path lights working: no bulbs out, no sagging cable, plugs dry and on GFCI?',
      'Hose bibs, cleanouts and ground drains along the path: no leaks or blockage?',
    ] },
    { section: '4. Courtyard, pool and spa', lines: [
      'Pool fence intact, gate self-closes and self-latches from any position, no gaps under the fence?',
      'Water clear to the main drain, drain covers intact and secured, no debris?',
      'Handrails tight, depth markers and NO DIVING legible, rules sign posted?',
      'Spa (if operating): water clear, rail secure, temperature normal, no gurgling?',
      'Deck: no loose or lifted pavers, no pooling at the deck drain, no algae on walking surfaces?',
      'Furniture clean and sound: loungers and dining set intact, umbrellas closed and tied when unattended?',
      'Grill clean, lid closed, gas valve off, nothing combustible stored under or beside it?',
      'Water-test entries in the pool log are current (or the pool vendor visits confirmed)?',
      'Pool equipment area locked, no leaks at pump or filter, pressure gauge normal, chemicals closed and off the ground?',
      'Pool and spa lights work, no flicker, no water in the fixtures?',
      'Pool service log reviewed: no missed visits, no open deficiencies, chemistry in range?',
      'Rescue equipment and signage required by the pool permit present and undamaged?',
    ] },
    { section: '5. Rear building (3024)', lines: [
      'Exterior stair: treads solid, no rust at stringers or bolts, railings do not move, lights on?',
      'Second-floor walkway: railing tight, surface drains, nothing stored against the railing?',
      'Wall-mounted AC units: no dripping onto the walkway, no rust, loose sleeves or noise?',
      'Unit entry doors and keypads from outside lock, latch and close?',
      'Wood-slat accent wall and under-stair storage: no rot, loose boards or pests?',
      'Stucco, paint and sealant around wall units and windows sound, no stains below the sleeves?',
      'Stair and walkway fasteners, post bases and brackets checked with a flashlight: no corrosion, no movement?',
    ] },
    { section: '6. Perimeter, fences and landscaping', lines: [
      'Rear wood privacy fence and side walls: no leaning, loose boards or gaps?',
      'Palms and trees: no dead fronds or coconuts over walkways and cars, no branches touching the building or power lines?',
      'Irrigation: no overspray onto stucco or walkways, no broken heads, no standing water?',
      'Mulch and beds not washed onto pavers, no pest harborage, rodent burrows or ant mounds?',
      'Overhead lines above the courtyard clear of the palms (contact is reported to the utility, never trimmed in-house)?',
    ] },
    { section: '7. Utilities, trash and back-of-house', lines: [
      'Trash and recycling area: bins closed, no overflow, odors or pests, pickup on schedule?',
      'Exterior electrical boxes and disconnects closed and latched, no rust holes or exposed conduit?',
      'Water meter readings for 3020 and 3024 written in the note and compared with last week (no jump, no running fixture)?',
      'Main water shutoff and backflow preventer accessible, labeled, not seized, no leaks or weeping?',
      'Exterior storage locked, dry, no roof-leak indicators?',
    ] },
    { section: '8. Life safety', lines: [
      'Common-area fire extinguishers in place, gauges in the green, tags current?',
      'Exit signs and emergency lights lit, alarm panel (if any) shows no trouble light?',
    ] },
    { section: '9. Close-out', lines: [
      'Open exterior tasks and safety barriers (cones, tape, pool closure) still in place and still needed?',
      'Guest-reported exterior issues from messages and reviews (pool, lighting, parking, noise, pests) checked?',
      'Completed repairs from this week verified in person with a functional check and an after-photo, then closed?',
      'Unresolved items carried forward with the reason noted?',
      'Every ISSUE above photographed and noted on this task before leaving the site?',
    ] },
  ],
}

/** The lines of a template, by its Breezeway name (the trailing version is optional). */
export function checklistFor(templateName: string): ChecklistSection[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const want = norm(templateName)
  const key = Object.keys(WALK_CHECKLISTS).find(k => norm(k) === want) || Object.keys(WALK_CHECKLISTS).find(k => norm(k).replace(/\s*\d+(\.\d+)*$/, '') === want.replace(/\s*\d+(\.\d+)*$/, ''))
  return key ? WALK_CHECKLISTS[key] : []
}
