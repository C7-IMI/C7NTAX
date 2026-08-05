/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // C7 Overwatch color system — cyber/navy palette
        navy: {
          50: "#e8edf5",
          100: "#c5d1e5",
          200: "#9eb3d3",
          300: "#7895c1",
          400: "#5b7db3",
          500: "#3e64a5",
          600: "#365796",
          700: "#2b4783",
          800: "#223771",
          900: "#142454",
          950: "#0a1628",
        },
        cyber: {
          50: "#e0f7fe",
          100: "#b3edfc",
          200: "#80e2fa",
          300: "#4dd6f8",
          400: "#26cbf6",
          500: "#00c0f4",
          600: "#00aae0",
          700: "#0090c4",
          800: "#0077a9",
          900: "#00507d",
        },
        surface: {
          DEFAULT: "#0f1a2e",
          light: "#162238",
          lighter: "#1e2d48",
          border: "#2a3a5c",
        },
        alert: {
          red: "#ef4444",
          amber: "#f59e0b",
          green: "#22c55e",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      spacing: {
        18: "4.5rem",
        88: "22rem",
        100: "25rem",
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.75rem",
        "2xl": "1rem",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
        "slide-in-right": "slideInRight 0.25s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
