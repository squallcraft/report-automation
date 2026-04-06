/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        'progress-indeterminate': 'progress-indeterminate 1.4s ease-in-out infinite',
      },
      colors: {
        primary: {
          50:  '#edf3fa',
          100: '#d0e2f2',
          200: '#a2c5e6',
          300: '#74a8d9',
          400: '#468bcd',
          500: '#1a6db8',
          600: '#155698',
          700: '#104078',
          800: '#0d3267',
          900: '#073B6E', // eCourier brand navy
          950: '#041f42',
        },
      },
    },
  },
  plugins: [],
}
