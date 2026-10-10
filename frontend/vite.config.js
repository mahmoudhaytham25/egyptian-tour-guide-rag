import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  // No proxy needed — src/services/api.js uses an absolute base URL
  // (VITE_API_URL, default http://localhost:3001/api).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    css: false,
    // Vitest's default glob would pick up Playwright specs — exclude e2e/.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
