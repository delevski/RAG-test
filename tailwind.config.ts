import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        background: '#07080c',
        surface: '#0e1118',
        'surface-2': '#161a24',
        border: '#232a3a',
        primary: '#6366f1',
        'primary-2': '#8b5cf6',
        secondary: '#22d3ee',
        dim: '#98a2b8',
      },
      boxShadow: {
        glow: '0 0 24px rgba(99, 102, 241, 0.25)',
        card: '0 8px 30px rgba(0, 0, 0, 0.35)',
      },
    },
  },
  plugins: [],
}

export default config
