// THE PROPERTIES MAP (Jon, 2026-11-13: "should have real maps integrated… so we can see our properties").
// Under Properties, so it follows the same access as /buildings. The data comes from /api/map.
import { Shell } from '@/components/Shell'
import { PropertiesMap } from '@/components/PropertiesMap'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Map · Lighthouse' }
export default function MapPage() { return <Shell><PropertiesMap /></Shell> }
