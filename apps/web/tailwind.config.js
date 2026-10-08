/** @type {import('tailwindcss').Config} */

/**
 * Theme colours are CSS custom properties so both themes can move them, but a bare `var(--x)` is
 * not something Tailwind can put an alpha on: `bg-cyber-600/20` then emits no rule at all, and the
 * element that asked for a subtle tint gets none. Wrapping the variable keeps the colour where the
 * themes can reach it and hands the alpha to the colour itself, so the opacity modifiers work.
 */
const themed = (variable) => `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: {
          50: themed("--navy-50"),
          100: themed("--navy-100"),
          200: themed("--navy-200"),
          300: themed("--navy-300"),
          400: themed("--navy-400"),
          500: themed("--navy-500"),
          600: themed("--navy-600"),
          700: themed("--navy-700"),
          800: themed("--navy-800"),
          900: themed("--navy-900"),
          950: themed("--navy-950"),
        },
        cyber: {
          50: themed("--cyber-50"),
          100: themed("--cyber-100"),
          200: themed("--cyber-200"),
          300: themed("--cyber-300"),
          400: themed("--cyber-400"),
          500: themed("--cyber-500"),
          600: themed("--cyber-600"),
          700: themed("--cyber-700"),
          800: themed("--cyber-800"),
          900: themed("--cyber-900"),
        },
        surface: {
          DEFAULT: themed("--surface"),
          light: themed("--surface-light"),
          lighter: themed("--surface-lighter"),
          border: themed("--surface-border"),
        },
        alert: {
          red: themed("--alert-red"),
          amber: themed("--alert-amber"),
          green: themed("--alert-green"),
        },
        // Text colors that need theme switching
        white: themed("--text-primary"),
        gray: {
          300: themed("--text-secondary"),
          400: themed("--text-tertiary"),
          500: themed("--text-muted"),
          600: themed("--text-muted-alt"),
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
