import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    gemini: 'src/gemini/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node20',
  outDir: 'dist',
  sourcemap: true,
  cjsInterop: true,
  splitting: false,
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
