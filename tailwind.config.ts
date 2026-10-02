import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ui)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-display)', 'Georgia', 'serif']
      },
      colors: {
        // THEME TOKENS (2026-10-02). Every color below is a CSS variable set in app/globals.css, one
        // block per theme (`:root` = Lighthouse, `[data-theme="legacy"]` = the pre-October look).
        // Switching theme is a single attribute on <html>; no page carries a hex of its own.
        // Values are RGB triplets so Tailwind's opacity modifiers (text-ink/80) keep working.
        app:    'rgb(var(--c-app) / <alpha-value>)',
        rail:   'rgb(var(--c-rail) / <alpha-value>)',
        ink:    'rgb(var(--c-ink) / <alpha-value>)',
        muted:  'rgb(var(--c-muted) / <alpha-value>)',
        line:   'rgb(var(--c-line) / <alpha-value>)',
        // STATUS FAMILIES. Same names the pages already use (rose = late, amber = watch, emerald = done,
        // sky = guest/info, slate = quiet, violet = Eve) — but the shades come from the theme, so
        // Lighthouse gets a calmer, warmer set and Legacy keeps Tailwind's.
        rose: {
          50: 'rgb(var(--s-rose-50) / <alpha-value>)',
          100: 'rgb(var(--s-rose-100) / <alpha-value>)',
          200: 'rgb(var(--s-rose-200) / <alpha-value>)',
          300: 'rgb(var(--s-rose-300) / <alpha-value>)',
          400: 'rgb(var(--s-rose-400) / <alpha-value>)',
          500: 'rgb(var(--s-rose-500) / <alpha-value>)',
          600: 'rgb(var(--s-rose-600) / <alpha-value>)',
          700: 'rgb(var(--s-rose-700) / <alpha-value>)',
          800: 'rgb(var(--s-rose-800) / <alpha-value>)',
        },
        amber: {
          50: 'rgb(var(--s-amber-50) / <alpha-value>)',
          100: 'rgb(var(--s-amber-100) / <alpha-value>)',
          200: 'rgb(var(--s-amber-200) / <alpha-value>)',
          300: 'rgb(var(--s-amber-300) / <alpha-value>)',
          400: 'rgb(var(--s-amber-400) / <alpha-value>)',
          500: 'rgb(var(--s-amber-500) / <alpha-value>)',
          600: 'rgb(var(--s-amber-600) / <alpha-value>)',
          700: 'rgb(var(--s-amber-700) / <alpha-value>)',
          800: 'rgb(var(--s-amber-800) / <alpha-value>)',
        },
        emerald: {
          50: 'rgb(var(--s-emerald-50) / <alpha-value>)',
          100: 'rgb(var(--s-emerald-100) / <alpha-value>)',
          200: 'rgb(var(--s-emerald-200) / <alpha-value>)',
          300: 'rgb(var(--s-emerald-300) / <alpha-value>)',
          400: 'rgb(var(--s-emerald-400) / <alpha-value>)',
          500: 'rgb(var(--s-emerald-500) / <alpha-value>)',
          600: 'rgb(var(--s-emerald-600) / <alpha-value>)',
          700: 'rgb(var(--s-emerald-700) / <alpha-value>)',
          800: 'rgb(var(--s-emerald-800) / <alpha-value>)',
        },
        sky: {
          50: 'rgb(var(--s-sky-50) / <alpha-value>)',
          100: 'rgb(var(--s-sky-100) / <alpha-value>)',
          200: 'rgb(var(--s-sky-200) / <alpha-value>)',
          300: 'rgb(var(--s-sky-300) / <alpha-value>)',
          400: 'rgb(var(--s-sky-400) / <alpha-value>)',
          500: 'rgb(var(--s-sky-500) / <alpha-value>)',
          600: 'rgb(var(--s-sky-600) / <alpha-value>)',
          700: 'rgb(var(--s-sky-700) / <alpha-value>)',
          800: 'rgb(var(--s-sky-800) / <alpha-value>)',
        },
        slate: {
          50: 'rgb(var(--s-slate-50) / <alpha-value>)',
          100: 'rgb(var(--s-slate-100) / <alpha-value>)',
          200: 'rgb(var(--s-slate-200) / <alpha-value>)',
          300: 'rgb(var(--s-slate-300) / <alpha-value>)',
          400: 'rgb(var(--s-slate-400) / <alpha-value>)',
          500: 'rgb(var(--s-slate-500) / <alpha-value>)',
          600: 'rgb(var(--s-slate-600) / <alpha-value>)',
          700: 'rgb(var(--s-slate-700) / <alpha-value>)',
          800: 'rgb(var(--s-slate-800) / <alpha-value>)',
          900: 'rgb(var(--s-slate-900) / <alpha-value>)',
        },
        violet: {
          50: 'rgb(var(--s-violet-50) / <alpha-value>)',
          100: 'rgb(var(--s-violet-100) / <alpha-value>)',
          200: 'rgb(var(--s-violet-200) / <alpha-value>)',
          600: 'rgb(var(--s-violet-600) / <alpha-value>)',
          700: 'rgb(var(--s-violet-700) / <alpha-value>)',
        },
        brand: {
          50:  'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: 'rgb(var(--c-brand-200) / <alpha-value>)',
          300: 'rgb(var(--c-brand-300) / <alpha-value>)',
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)',
          700: 'rgb(var(--c-brand-700) / <alpha-value>)',
          800: 'rgb(var(--c-brand-800) / <alpha-value>)',
          900: 'rgb(var(--c-brand-900) / <alpha-value>)'
        }
      },
      borderRadius: {
        xl: 'var(--r-xl)',
        '2xl': 'var(--r-2xl)'
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lifted: '0 8px 24px -8px rgb(11 18 32 / 0.10), 0 2px 4px -2px rgb(11 18 32 / 0.06)'
      },
      animation: {
        'fade-in':  'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer':  'shimmer 1.6s linear infinite'
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } }
      }
    }
  },
  plugins: []
}
export default config
