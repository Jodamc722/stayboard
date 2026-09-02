// Client-safe vocabulary shared by lib/command-day (server) and components/CommandCockpit (client).
// No server imports here — the cockpit imports VALUES from this file and only TYPES from the engine.
export type Owner = 'housekeeping' | 'maintenance' | 'desk' | 'gm'
export const OWNER_LABEL: Record<Owner, string> = { housekeeping: 'Housekeeping', maintenance: 'Maintenance', desk: 'Guest desk', gm: 'GM' }
