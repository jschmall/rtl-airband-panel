/** @type {import('tailwindcss').Config} */

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

/** A palette whose shades resolve to the theme variables in src/index.css. */
function themed(name) {
  return Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: themed("slate"),
        sky: themed("sky"),
        emerald: themed("emerald"),
        amber: themed("amber"),
        red: themed("red"),
      },
    },
  },
  plugins: [],
};
