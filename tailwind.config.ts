import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{vue,ts}", "./functions/**/*.ts"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f7f4",
          100: "#ecece6",
          200: "#d8d8cd",
          300: "#b9b9aa",
          400: "#939383",
          500: "#767666",
          600: "#5d5d50",
          700: "#48483f",
          800: "#33332f",
          900: "#20201d"
        },
        accent: {
          50: "#eff8f7",
          100: "#d8eeec",
          200: "#addbd7",
          300: "#7ac1bc",
          400: "#469f9c",
          500: "#2c827f",
          600: "#246966",
          700: "#225453",
          800: "#1f4443",
          900: "#1b3938"
        },
        legal: {
          gold: "#b98d3a",
          red: "#9f3f46",
          blue: "#345f7d",
          green: "#3d7257"
        }
      },
      boxShadow: {
        soft: "0 14px 40px rgba(32, 32, 29, 0.08)"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
} satisfies Config;

