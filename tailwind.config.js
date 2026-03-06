/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: '#09090B',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '0.9' },
        },
        hexagramGlow: {
          '0%, 100%': { opacity: '0.9', textShadow: '0 0 20px rgba(250, 204, 21, 0.4)' },
          '50%': { opacity: '1', textShadow: '0 0 32px rgba(250, 204, 21, 0.7)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'hexagram-glow': 'hexagramGlow 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
