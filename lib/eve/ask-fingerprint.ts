// THE FINGERPRINT OF AN ASK (2026-10-02). The action plus its summary with the moving parts blanked
// — hours-ago, days-over, dates, clock times, dollar amounts — so the same ask made an hour later,
// with the counter ticked up, still reads as the same ask. No imports: lib/eve/__tests__ loads it
// with plain node.
export function proposalFingerprint(action: string, summary: string): string {
  const t = String(summary || '').toLowerCase()
    .replace(/\b\d+\s*(h|hr|hrs|hours?|m|min|mins|minutes?|d|days?)\b(\s*(ago|over|late|overdue))?/g, '#')  // "57h ago", "94 days over"
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '#date')
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/g, '#time')
    .replace(/\$[\d,.]+/g, '$#')
    // COUNTS ARE MOVING PARTS TOO (Eve audit 2026-10-07): "129 listings off a major channel" became
    // "128 listings" overnight and the same ask went out three times; "(8 open)" ticked the morning
    // roll-up's ask. A number followed by a counted noun, or in "(N open)", is blanked. Unit numbers
    // ("Hendricks 1", "906/6") are not followed by these words and stay — they are what makes an ask distinct.
    .replace(/\(\s*\d+\s+open\s*\)/g, '(# open)')
    .replace(/\b\d+\s+(listings?|units?|items?|guests?|tasks?|cleans?|asks?|nights?|people|arrivals?|loops?|threads?|messages?|calls?)\b/g, '# $1')
    .replace(/[^a-z0-9#$ ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
  return String(action || '') + '|' + t
}
