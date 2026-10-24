import type { Config } from "tailwindcss";
export default {
  darkMode: ["class"],
  content: {
    relative: true,
    files: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  },
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        border: "hsl(var(--border))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
      },
      fontFamily: { sans: ["Inter", "Arial", "Helvetica", "sans-serif"] },
      boxShadow: {
        panel:
          "0 2px 4px -3px rgba(25,24,45,.07), 0 0 0 1px rgba(25,24,45,.025)",
      },
    },
  },
  plugins: [],
} satisfies Config;
