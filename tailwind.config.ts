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
