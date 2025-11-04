import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0b0d12',
        surface: '#12151c',
        border: '#1f2430',
        primary: '#7c5cff',
        secondary: '#08d9d6'
      }
    }
  },
  plugins: []
}

export default config

