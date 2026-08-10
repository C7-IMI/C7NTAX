/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // All theme colors use CSS custom properties so they respond to html.light class
        navy: {
          50: "var(--navy-50)",
          100: "var(--navy-100)",
          200: "var(--navy-200)",
          300: "var(--navy-300)",
          400: "var(--navy-400)",
          500: "var(--navy-500)",
          600: "var(--navy-600)",
          700: "var(--navy-700)",
          800: "var(--navy-800)",
          900: "var(--navy-900)",
          950: "var(--navy-950)",
        },
        cyber: {
          50: "var(--cyber-50)",
          100: "var(--cyber-100)",
          200: "var(--cyber-200)",
          300: "var(--cyber-300)",
          400: "var(--cyber-400)",
          500: "var(--cyber-500)",
          600: "var(--cyber-600)",
          700: "var(--cyber-700)",
          800: "var(--cyber-800)",
          900: "var(--cyber-900)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          light: "var(--surface-light)",
          lighter: "var(--surface-lighter)",
          border: "var(--surface-border)",
        },
        alert: {
          red: "var(--alert-red)",
          amber: "var(--alert-amber)",
          green: "var(--alert-green)",
        },
        // Text colors that need theme switching
        white: "var(--text-primary)",
        gray: {
          300: "var(--text-secondary)",
          400: "var(--text-tertiary)",
          500: "var(--text-muted)",
          600: "var(--text-muted-alt)",
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
