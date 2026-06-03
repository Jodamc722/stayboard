// Listing name parser. Shared between the Guesty sync mapper and the Listings page
// (page reparses at render time so updates take effect without re-syncing).

export type ParsedListing = {
  building: string
  unit: string | null
  room_type: string | null
}

const ROOM_TYPE_RE = /\b(STUDIO|FULL|HALF|STU|\d+BR|\d+BD|Studio|Suite|LOFT|Loft|PH|Penthouse)\b/i

export function parseListing(nick?: string | null, title?: string | null): ParsedListing {
  const name = (nick || title || '').trim()
  if (!name) return { building: 'Other', unit: null, room_type: null }

  // Dash-separated: 3+ parts → "Building - Unit - Type"
  const dashParts = name.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean)
  if (dashParts.length >= 3) {
    return { building: dashParts[0], unit: dashParts[1], room_type: dashParts.slice(2).join(' - ') }
  }
  if (dashParts.length === 2) {
    const first = dashParts[0]
    const slash = first.match(/^([^\/]+)\/(.+)$/)
    if (slash) return { building: slash[1].trim(), unit: slash[2].trim(), room_type: dashParts[1] }
    const m = first.match(/^(.+?)\s+(\S+)$/)
    if (m && /\d/.test(m[2])) {
      return { building: m[1].trim(), unit: m[2], room_type: dashParts[1] }
    }
    return { building: first, unit: null, room_type: dashParts[1] }
  }

  // No dashes: "101/1 Lucerne" / "101 Lucerne FULL 4BR"
  const leading = name.match(/^(\d+(?:\/\d+)?)\s+(.+?)(?:\s+(STUDIO|FULL|HALF|STU|\d+BR|\d+BD|Studio|Suite|LOFT|Loft|PH|Penthouse)\b.*)?$/i)
  if (leading) {
    const building = leading[2].replace(ROOM_TYPE_RE, '').trim()
    return { building: building || 'Other', unit: leading[1], room_type: leading[3] || null }
  }
  // Pure numeric "1239/003"
  const numericOnly = name.match(/^(\d+)\/(\d+)$/)
  if (numericOnly) return { building: numericOnly[1], unit: numericOnly[2], room_type: null }

  return { building: name, unit: null, room_type: null }
}

// Normalize building names so e.g. "17WEST", "17 West", "17West" → "17 West"
export function normalizeBuilding(b: string): string {
  return b.trim().replace(/\s+/g, ' ')
}

// Bedroom bucket from room_type or bedroom count
export function bedroomBucket(roomType: string | null | undefined, bedrooms: number | null | undefined): string {
  const rt = (roomType || '').toUpperCase()
  if (/STUDIO|^STU$/.test(rt) || bedrooms === 0) return 'Studio'
  if (/1\s?BR|1\s?BD/.test(rt) || bedrooms === 1) return '1BR'
  if (/2\s?BR|2\s?BD/.test(rt) || bedrooms === 2) return '2BR'
  if (/3\s?BR|3\s?BD/.test(rt) || bedrooms === 3) return '3BR'
  if (bedrooms && bedrooms >= 4) return `${bedrooms}BR+`
  if (/4\s?BR|4\s?BD/.test(rt)) return '4BR+'
  return 'Other'
}
