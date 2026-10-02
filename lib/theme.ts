// THE THEME (Jon, 2026-10-02): Lighthouse is the new look; Legacy is the app as it was before
// October, kept so anyone can switch back from Settings. Stored per person in app_users.prefs.theme
// and mirrored in localStorage so the first paint is already right (app/layout.tsx).
export type ThemeKey = 'lighthouse' | 'legacy'
export const THEMES: { key: ThemeKey; label: string; blurb: string }[] = [
  { key: 'lighthouse', label: 'Lighthouse', blurb: 'Ink on paper, one brass accent, serif titles. The October 2026 redesign.' },
  { key: 'legacy', label: 'Legacy', blurb: 'The app as it looked before October: Inter, indigo, grey canvas.' },
]
export const THEME_LS_KEY = 'lh:theme'

export function isThemeKey(v: unknown): v is ThemeKey {
  return v === 'lighthouse' || v === 'legacy'
}

/** Apply a theme to the document and remember it on this device. Safe to call during render guards. */
export function applyTheme(t: ThemeKey) {
  if (typeof document === 'undefined') return
  if (t === 'legacy') document.documentElement.setAttribute('data-theme', 'legacy')
  else document.documentElement.removeAttribute('data-theme')
  try { localStorage.setItem(THEME_LS_KEY, t) } catch { /* private mode */ }
}

export function readDeviceTheme(): ThemeKey {
  try { const v = localStorage.getItem(THEME_LS_KEY); return isThemeKey(v) ? v : 'lighthouse' } catch { return 'lighthouse' }
}
