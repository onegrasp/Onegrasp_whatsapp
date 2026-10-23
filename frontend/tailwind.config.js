/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Single brand color (WhatsApp-adjacent green). Use for primary actions,
        // active navigation and focus — not for decoration.
        brand: {
          50: "#ecf8f4",
          100: "#d1efe5",
          200: "#a4dfcc",
          300: "#6cc8ad",
          400: "#38aa8b",
          500: "#159071",
          600: "#0b7a60",
          700: "#08624e",
          800: "#074e3f",
          900: "#063f34",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "16px"],
        13: ["13px", "20px"],
      },
      boxShadow: {
        overlay: "0 10px 38px -10px rgba(16, 24, 40, 0.25), 0 10px 20px -15px rgba(16, 24, 40, 0.2)",
      },
    },
  },
  plugins: [],
};
