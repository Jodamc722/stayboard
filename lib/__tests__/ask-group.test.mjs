// One ask per channel family, every room number on the line (independent study 2026-10-10).
import assert from 'node:assert/strict'
import { groupChannelFindings } from '../eve/ask-group.ts'

const f = (id, unit, state, ch, age = 2, extra = {}) => ({
  id, area: 'listings', severity: 'warn', ageDays: age, fix: 'Open Guesty → Channel Manager and reconnect it.',
  title: `${unit} is ${state} on ${ch}`, detail: 'x', evidence: { platform: ch.toLowerCase(), verdict: state.toLowerCase().replace(/ /g, '_') }, ...extra,
})

{ // five Expedia disconnects → one ask with all five rooms, members carried as refs
  const audits = [
    f('channel:a:expedia', 'Botanica 1103 -Double w/Kitchenette', 'Not connected', 'Expedia', 3),
    f('channel:b:expedia', 'Arya 1418 Full - 2BR', 'Not connected', 'Expedia', 1),
    f('channel:c:expedia', '17WEST - 406 - 3B LOFT', 'Not connected', 'Expedia', 5),
    f('channel:d:expedia', 'Botanica 6206 - King - Forest', 'Not connected', 'Expedia'),
    f('channel:e:expedia', 'Botanica 6203 - w/Sofa - Forest', 'Not connected', 'Expedia'),
    { id: 'feeds:guesty', area: 'feeds', severity: 'critical', ageDays: 1, title: 'Guest message feed is 2 days stale', fix: 'x', evidence: {} },
  ]
  const { items, rest } = groupChannelFindings(audits, () => true)
  assert.equal(items.length, 1)
  assert.equal(rest.length, 1)
  assert.equal(rest[0].id, 'feeds:guesty')
  const g = items[0]
  assert.equal(g.type, 'finding')
  assert.equal(g.ref, 'channel-group:expedia:not_connected')
  assert.deepEqual(g.refs, ['channel:a:expedia', 'channel:b:expedia', 'channel:c:expedia', 'channel:d:expedia', 'channel:e:expedia'])
  assert.match(g.body, /^\*\*5 listings are not connected on Expedia\*\* — /)
  for (const room of ['Botanica 1103', 'Arya 1418', '17WEST 406', 'Botanica 6206', 'Botanica 6203']) assert.ok(g.body.includes(room), room)
  assert.match(g.body, /Oldest open 5 days/)
  assert.equal(g.rank, 505)
}

{ // a member already asked on its own is left out; a family of one is an ordinary finding
  const audits = [
    f('channel:a:expedia', 'Botanica 1103', 'Not connected', 'Expedia'),
    f('channel:b:expedia', 'Arya 1418', 'Not connected', 'Expedia'),
    f('channel:z:airbnb2', 'Eden 2105 - Studio', 'Unlisted', 'Airbnb'),
  ]
  const { items, rest } = groupChannelFindings(audits, (_t, ref) => ref !== 'channel:a:expedia')
  assert.equal(items.length, 0, 'one fresh Expedia member is not a group')
  assert.deepEqual(rest.map(r => r.id).sort(), ['channel:b:expedia', 'channel:z:airbnb2'])
}

{ // two families stay two asks
  const audits = [
    f('channel:a:expedia', 'Botanica 1103', 'Not connected', 'Expedia'),
    f('channel:b:expedia', 'Arya 1418', 'Not connected', 'Expedia'),
    f('channel:c:airbnb2', 'Eden 2105', 'Unlisted', 'Airbnb'),
    f('channel:d:airbnb2', 'Eden 2106', 'Unlisted', 'Airbnb'),
  ]
  const { items } = groupChannelFindings(audits, () => true)
  assert.deepEqual(items.map(i => i.ref).sort(), ['channel-group:airbnb:unlisted', 'channel-group:expedia:not_connected'])
}

{ // more than twelve: the line is capped with a +n tail, refs are complete
  const audits = Array.from({ length: 15 }, (_, i) => f(`channel:${i}:expedia`, `Eden ${1101 + i}`, 'Not connected', 'Expedia'))
  const { items } = groupChannelFindings(audits, () => true)
  assert.equal(items[0].refs.length, 15)
  assert.match(items[0].body, / \+3\n/)
}
console.log('ask-group: ok')
