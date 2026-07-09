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
