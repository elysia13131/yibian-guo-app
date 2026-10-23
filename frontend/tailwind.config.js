/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          50: '#fdf6ee',
          100: '#f9e8d0',
          200: '#f2cf9e',
          300: '#ebaf66',
          400: '#e59038',
          500: '#d9741b',
          600: '#b85a14',
          700: '#934213',
          800: '#783517',
          900: '#652d18',
        },
      },
      animation: {
        'ripple': 'ripple 0.6s linear',
        'progress': 'progress 2s ease-in-out',
      },
      keyframes: {
        ripple: {
          to: { transform: 'scale(4)', opacity: '0' },
        },
        progress: {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
      },
    },
  },
  plugins: [],
}
