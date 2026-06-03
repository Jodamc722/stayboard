import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif']
      },
      colors: {
        // App canvas
        app:    '#F7F7F8',
        ink:    '#0B1220',
        muted:  '#5B6478',
        line:   '#E5E7EB',
        // Brand: refined indigo
        brand: {
          50:  '#EEF1FF',
          100: '#E0E6FF',
          200: '#C7D0FF',
          300: '#A4B0FA',
          400: '#7B86F2',
          500: '#5B63E8',
          600: '#4448D9',
          700: '#3739B5',
          800: '#2D2F92',
          900: '#222470'
        }
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(11 18 32 / 0.04), 0 1px 3px 0 rgb(11 18 32 / 0.04)',
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
