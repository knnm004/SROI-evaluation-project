/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./dashboard.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ChulaCharasNew', 'Sarabun', 'sans-serif'],
      },
      colors: {
        chula: {
          light: '#f8b4c4',
          DEFAULT: '#DA5F8E',
          dark: '#e06b78',
          darker: '#c94d5a'
        }
      }
    },
  },
  plugins: [],
}
