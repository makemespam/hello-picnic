import type { Config } from 'tailwindcss';

// Design tokens per docs/DESIGN_PRINCIPLES.md §2 — the ONLY place colors are defined.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#067A46',
          hover: '#05673B',
          soft: '#E6F4ED',
        },
        accent: {
          DEFAULT: '#F58A07',
          soft: '#FEF3E2',
        },
        surface: '#FFFFFF',
        background: '#FAF8F5',
        ink: {
          DEFAULT: '#1F2937',
          muted: '#57534E',
        },
        success: '#047857',
        warning: '#B45309',
        danger: '#B91C1C',
        info: '#1D4ED8',
        // Recipe-type badge palette (docs/DESIGN_PRINCIPLES.md §2) — single source,
        // consumed only via src/components/RecipeTypeBadge.tsx + src/shared/labels.ts.
        badge: {
          vegan: { bg: '#DCFCE7', fg: '#166534' },
          vegetarisch: { bg: '#F0FDF4', fg: '#15803D' },
          vis: { bg: '#DBEAFE', fg: '#1D4ED8' },
          kip: { bg: '#FEF3C7', fg: '#B45309' },
          rund: { bg: '#FEE2E2', fg: '#B91C1C' },
          varken: { bg: '#FFE4E6', fg: '#BE123C' },
        },
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
