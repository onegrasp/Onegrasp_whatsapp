/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        wa: {
          green: "#25D366",
          dark: "#128C7E",
          teal: "#075E54",
          light: "#DCF8C6",
          bg: "#F0FAF2",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          card: "#FFFFFF",
          hover: "#F3FAF4",
          border: "#D7EAD6",
        },
      },
      fontFamily: {
        sans: ["Poppins", "Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
