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
        ink: '#07070d',
        seat: {
          available: '#22c55e',
          held: '#eab308',
          mine: '#3b82f6',
          booked: '#ef4444',
          disabled: '#6b7280',
        },
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(139, 92, 246, 0.55)',
        'glow-sm': '0 0 14px -2px rgba(139, 92, 246, 0.45)',
        card: '0 18px 50px -22px rgba(0, 0, 0, 0.85)',
      },
    },
  },
  plugins: [],
};
