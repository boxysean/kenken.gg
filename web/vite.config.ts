/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app's JSX lives in plain .js files (CRA convention), so both the
// react plugin and esbuild are told to treat src/**/*.js as JSX. esbuild
// applies a single loader to everything `include` matches, so `tsx` is used:
// it parses those JSX .js files and the TypeScript under src/ alike.
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'classic',
      include: /\.(js|jsx|ts|tsx)$/,
    }),
  ],
  esbuild: {
    loader: 'tsx',
    include: /src\/.*\.[jt]sx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  },
});
