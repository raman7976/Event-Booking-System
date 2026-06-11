/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        seat: {
          available: '#22c55e',
          held: '#eab308',
          mine: '#3b82f6',
          booked: '#ef4444',
          disabled: '#6b7280',
        },
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(124, 58, 237, 0.45)',
        'glow-sm': '0 0 14px -2px rgba(124, 58, 237, 0.35)',
        card: '0 16px 44px -24px rgba(15, 23, 42, 0.22)',
      },
    },
  },
  plugins: [],
};
