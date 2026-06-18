import type { Config } from "tailwindcss";

/**
 * Tailwind maps semantic design tokens (defined as CSS variables in
 * src/styles/tokens.css) onto utilities. The variables flip between the dark
 * (hero) and light themes; everything below references them so a single source
 * of truth drives both. Translucent variants are pre-baked (`*-soft`, `*-line`)
 * rather than relying on alpha modifiers, so they read correctly on either bg.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",

      // Backgrounds (depth via layered surfaces, not shadows).
      base: "var(--bg-base)",
      surface: "var(--bg-surface)",
      raised: "var(--bg-raised)",
      overlay: "var(--bg-overlay)",

      // Foreground / ink.
      fg: {
        DEFAULT: "var(--text-primary)",
        muted: "var(--text-secondary)",
        faint: "var(--text-tertiary)",
      },

      // Hairline borders.
      hairline: {
        DEFAULT: "var(--border)",
        strong: "var(--border-strong)",
      },

      // The one accent — state, focus, single primary action.
      accent: {
        DEFAULT: "var(--accent)",
        hover: "var(--accent-hover)",
        pressed: "var(--accent-pressed)",
        contrast: "var(--accent-contrast)",
        soft: "var(--accent-soft)",
        line: "var(--accent-line)",
      },

      // Meaningful state colors (answered-here / delegated / emergency).
      local: { DEFAULT: "var(--local)", soft: "var(--local-soft)", line: "var(--local-line)" },
      remote: { DEFAULT: "var(--remote)", soft: "var(--remote-soft)", line: "var(--remote-line)" },
      emergency: {
        DEFAULT: "var(--emergency)",
        soft: "var(--emergency-soft)",
        line: "var(--emergency-line)",
        contrast: "var(--emergency-contrast)",
      },
    },
    borderColor: ({ theme }) => ({
      ...theme("colors"),
      DEFAULT: "var(--border)",
    }),
    ringColor: ({ theme }) => ({ ...theme("colors"), DEFAULT: "var(--focus)" }),
    fontFamily: {
      sans: ["Geist Sans", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
    },
    extend: {
      // Modular scale: tight, confident headings; comfortable body.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.55" }],
        lg: ["1.0625rem", { lineHeight: "1.5" }],
        xl: ["1.3125rem", { lineHeight: "1.25" }],
        "2xl": ["1.625rem", { lineHeight: "1.18", letterSpacing: "-0.01em" }],
        "3xl": ["2.0625rem", { lineHeight: "1.12", letterSpacing: "-0.015em" }],
        "4xl": ["2.625rem", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
      },
      letterSpacing: { tightish: "-0.01em" },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      maxWidth: { reading: "44rem", measure: "38rem" },
      boxShadow: {
        // Used sparingly; hairlines do most of the work.
        raised: "0 1px 0 0 var(--border) inset, 0 8px 24px -16px rgba(0,0,0,0.55)",
        pop: "0 16px 48px -20px rgba(0,0,0,0.6)",
      },
      transitionTimingFunction: { spring: "cubic-bezier(0.22, 1, 0.36, 1)" },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.5" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Centered dialog: keep the -50%/-50% centering transform across the whole
        // animation so it never overrides the Tailwind centering classes.
        "dialog-in": {
          "0%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.97)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        // A partial-width bar sweeping across the track — honest "working, no
        // numeric progress" motion for tools that can't report a fraction.
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(340%)" },
        },
      },
      animation: {
        breathe: "breathe 3.2s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.4s ease-out infinite",
        "fade-up": "fade-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "dialog-in": "dialog-in 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        "overlay-in": "overlay-in 160ms ease",
        shimmer: "shimmer 1.6s infinite",
        indeterminate: "indeterminate 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
