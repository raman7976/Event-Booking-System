/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        seat: {
          available: '#22c55e',
          held: '#eab308',
          mine: '#3b82f6',
          booked: '#ef4444',
          disabled: '#6b7280',
        },
      },
    },
  },
  plugins: [],
};
