import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// GitHub Pages 프로젝트 사이트 주소: https://<계정>.github.io/gagyeboo/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/gagyeboo/',
  plugins: [preact()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
