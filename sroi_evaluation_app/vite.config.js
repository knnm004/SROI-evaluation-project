import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      // Every HTML page MUST be listed here or it 404s in production while working
      // fine in dev (this is what commit 3b86e68 fixed for dashboard.html).
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        admin: resolve(__dirname, 'admin.html'),
        about: resolve(__dirname, 'about.html')
      }
    }
  }
});