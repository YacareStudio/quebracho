/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Forge palette
        'forge-bg': 'rgb(var(--forge-bg) / <alpha-value>)',
        'forge-titlebar': 'rgb(var(--forge-titlebar) / <alpha-value>)',
        'forge-activitybar': 'rgb(var(--forge-activitybar) / <alpha-value>)',
        'forge-sidebar': 'rgb(var(--forge-sidebar) / <alpha-value>)',
        'forge-tabbar': 'rgb(var(--forge-tabbar) / <alpha-value>)',
        'forge-tab-active': 'rgb(var(--forge-tab-active) / <alpha-value>)',
        'forge-editor': 'rgb(var(--forge-editor) / <alpha-value>)',
        'forge-statusbar': 'rgb(var(--forge-statusbar) / <alpha-value>)',
        'forge-terminal': 'rgb(var(--forge-terminal) / <alpha-value>)',
        'forge-border': 'rgb(var(--forge-border) / <alpha-value>)',
        'forge-input': 'rgb(var(--forge-input) / <alpha-value>)',
        'forge-hover': 'rgb(var(--forge-hover) / <alpha-value>)',

        // Text colors
        'forge-text': 'rgb(var(--forge-text) / <alpha-value>)',
        'forge-text-strong': 'rgb(var(--forge-text-strong) / <alpha-value>)',
        'forge-text-dim': 'rgb(var(--forge-text-dim) / <alpha-value>)',
        'forge-text-tab': 'rgb(var(--forge-text-tab) / <alpha-value>)',
        'forge-text-term': 'rgb(var(--forge-text-term) / <alpha-value>)',
        'forge-text-menu': 'rgb(var(--forge-text-menu) / <alpha-value>)',
        'forge-accent': 'rgb(var(--forge-accent) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
