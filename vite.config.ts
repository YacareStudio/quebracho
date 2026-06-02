import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'vendor-monaco';
          if (id.includes('@xterm')) return 'vendor-xterm';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/src-tauri/gen/**',
      ],
    },
  },
});
