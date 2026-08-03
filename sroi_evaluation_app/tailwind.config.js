/** @type {import('tailwindcss').Config} */
module.exports = {
  // This is an explicit list, not a glob over *.html. A new page missing from here
  // builds without error but ships UNSTYLED in production (dev looks fine, because
  // dev does not purge). Add every new HTML page here as well as in vite.config.js.
  content: [
    "./index.html",
    "./dashboard.html",
    "./admin.html",
    "./about.html",
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
