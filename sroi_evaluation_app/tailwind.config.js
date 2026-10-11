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
    "./about-us.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ChulaCharasNew is the ONLY typeface (Chula's CI). 'sans-serif' stays solely as the
      // browser's last resort while the font file loads -- never as a design choice.
      // `mono` is overridden too: Tailwind's default is a system monospace, which is what
      // `font-mono` (money and figures in the report and SROI table) was quietly rendering in.
      fontFamily: {
        sans: ['ChulaCharasNew', 'sans-serif'],
        mono: ['ChulaCharasNew', 'sans-serif'],
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
