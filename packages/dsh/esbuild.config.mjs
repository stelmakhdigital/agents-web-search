import { build } from 'esbuild'

// ESM bundle of the DSH adapter. All @deepseek-ai/* peer deps (host-provided at
// runtime) and the core are external: the bundle only carries adapter code.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  outfile: 'lib/index.js',
  sourcemap: false,
  minify: false,
  external: [
    '@deepseek-ai/*',
    '@agents-web-search/core',
    'node:*',
  ],
})
console.log('build: lib/index.js written')
